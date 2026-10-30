import { Temporal } from '@js-temporal/polyfill';
import { and, eq, getTableColumns, gte, lt, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { db, appointments, businesses, users, services, payments, reminders, requireDatabaseConfig } from '@/db';
import { type Actor, assertRole, requireActor } from './auth';
import { eligibleSlots } from './availability';
import { apiResponse, assertOrigin, HttpError } from './http';
import { planReminder } from './reminders';

export type Appointment = typeof appointments.$inferSelect;
// Sample only after database locks; tests supply a clock instead of freezing request-entry time.
export type AppointmentClock = () => Date;
const systemClock: AppointmentClock = () => new Date();
const instant = z.iso.datetime({ offset: true }).transform((value, context) => {
  try {
    const parsed = Temporal.Instant.from(value);
    if (parsed.epochNanoseconds % 1000000n !== 0n) throw new Error('Unsupported precision');
    return new Date(parsed.epochMilliseconds);
  }
  catch { context.addIssue({ code: 'custom', message: 'Waktu tidak valid' }); return z.NEVER; }
});
const creation = z.object({ serviceId: z.uuid(), staffId: z.uuid(), start: instant }).strict();
export const parseAppointment = (input: unknown) => creation.parse(input);
export function parseAppointmentList(input: unknown) {
  return z.object({ from: instant, to: instant, limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).max(10000).default(0) }).strict()
    .refine((value) => value.to > value.from && value.to.getTime() - value.from.getTime() <= 31 * 86400000, 'Rentang maksimal 31 hari').parse(input);
}
type Owned = Pick<Appointment, 'customerId' | 'staffId'>;
export function assertAppointmentRead(actor: Actor, row: Owned): void {
  if (actor.role !== 'admin' && (actor.role === 'customer' ? row.customerId : row.staffId) !== actor.id) throw new HttpError(404, 'Janji temu tidak ditemukan');
}
export function assertAppointmentTransition(actor: Actor, row: Owned & Pick<Appointment, 'status' | 'startsAt' | 'endsAt'>, status: 'cancelled' | 'completed', now: Date): void {
  assertAppointmentRead(actor, row);
  assertRole(actor, status === 'cancelled' ? ['admin', 'customer'] : ['admin', 'staff']);
  if (row.status !== 'confirmed' || (status === 'cancelled' ? now >= row.startsAt : now < row.endsAt)) throw new HttpError(409, 'Status atau waktu janji temu tidak mengizinkan perubahan');
}
function scope(actor: Actor) {
  return actor.role === 'admin' ? undefined : eq(actor.role === 'customer' ? appointments.customerId : appointments.staffId, actor.id);
}
export async function createAppointment(actor: Actor, input: { serviceId: string; staffId: string; start: string }, clock: AppointmentClock = systemClock): Promise<Appointment> {
  assertRole(actor, ['customer']);
  const data = parseAppointment(input);
  requireDatabaseConfig();
  try {
    return await db.transaction(async (tx) => {
      // Shared catalog lock order: business, staff, service. READ COMMITTED revalidates after waiting.
      const [business] = await tx.select().from(businesses).for('update');
      if (!business) throw new HttpError(400, 'Bisnis tidak tersedia');
      const [staff] = await tx.select().from(users).where(eq(users.id, data.staffId)).for('update');
      const [service] = await tx.select().from(services).where(eq(services.id, data.serviceId)).for('update');
      const [customer] = await tx.select().from(users).where(and(eq(users.id, actor.id), eq(users.role, 'customer'), eq(users.active, true), eq(users.businessId, business.id))).for('update');
      if (!customer) throw new HttpError(403, 'Akses ditolak');
      if (!staff || !service || staff.businessId !== business.id || service.businessId !== business.id) throw new HttpError(400, 'Layanan atau staf tidak tersedia');
      const date = Temporal.Instant.from(data.start.toISOString()).toZonedDateTimeISO(business.timezone).toPlainDate().toString();
      const now = clock();
      const slots = await eligibleSlots(tx, { ...data, date }, now);
      const slot = slots.find((candidate) => candidate.start === data.start.toISOString());
      if (!slot) throw new HttpError(400, 'Slot tidak tersedia');
      const [row] = await tx.insert(appointments).values({ customerId: actor.id, staffId: data.staffId, serviceId: data.serviceId, startsAt: data.start, endsAt: new Date(slot.end), price: service.price, durationMinutes: service.durationMinutes }).returning();
      const reminder = planReminder(customer, row.startsAt, now);
      if (reminder) await tx.insert(reminders).values({ appointmentId: row.id, ...reminder, nextAttemptAt: reminder.dueAt });
      return row;
    });
  } catch (error) {
    const cause = error instanceof Error && error.cause ? error.cause : error;
    if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === '23P01') throw new HttpError(409, 'Slot sudah dipesan');
    throw error;
  }
}
export async function getAppointment(actor: Actor, id: string): Promise<Appointment> {
  z.uuid().parse(id);
  requireDatabaseConfig();
  const [row] = await db.select().from(appointments).where(and(eq(appointments.id, id), scope(actor))).limit(1);
  if (!row) throw new HttpError(404, 'Janji temu tidak ditemukan');
  return row;
}
export async function listAppointments(actor: Actor, input: unknown) {
  const query = parseAppointmentList(input);
  requireDatabaseConfig();
  const staffUser = alias(users, 'appointment_staff');
  const customerUser = alias(users, 'appointment_customer');
  const rows = await db.select({ ...getTableColumns(appointments), serviceName: services.name, staffName: staffUser.name, customerName: customerUser.name, paymentStatus: payments.status }).from(appointments)
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .innerJoin(staffUser, eq(staffUser.id, appointments.staffId))
    .innerJoin(customerUser, eq(customerUser.id, appointments.customerId))
    .leftJoin(payments, eq(payments.appointmentId, appointments.id))
    .where(and(scope(actor), gte(appointments.startsAt, query.from), lt(appointments.startsAt, query.to)))
    .orderBy(appointments.startsAt, appointments.id).limit(query.limit + 1).offset(query.offset);
  return { items: rows.slice(0, query.limit), nextOffset: rows.length > query.limit ? query.offset + query.limit : null };
}
async function transition(actor: Actor, id: string, status: 'cancelled' | 'completed', clock: AppointmentClock): Promise<Appointment> {
  z.uuid().parse(id);
  requireDatabaseConfig();
  return db.transaction(async (tx) => {
    // Payment/refund callers must lock this same appointment row before related writes.
    const [row] = await tx.select().from(appointments).where(and(eq(appointments.id, id), scope(actor))).for('update');
    if (!row) throw new HttpError(404, 'Janji temu tidak ditemukan');
    const now = clock();
    assertAppointmentTransition(actor, row, status, now);
    if (status === 'cancelled') {
      await tx.update(payments).set({ status: 'refunded', updatedAt: now }).where(and(eq(payments.appointmentId, id), eq(payments.status, 'paid')));
      await tx.update(reminders).set({ status: 'cancelled', leaseToken: null, leaseUntil: null }).where(and(eq(reminders.appointmentId, id), eq(reminders.status, 'pending')));
    }
    return (await tx.update(appointments).set({ status, sequence: sql`${appointments.sequence} + 1`, updatedAt: now }).where(eq(appointments.id, id)).returning())[0];
  });
}
export const cancelAppointment = (actor: Actor, id: string, clock: AppointmentClock = systemClock) => transition(actor, id, 'cancelled', clock);
export const completeAppointment = (actor: Actor, id: string, clock: AppointmentClock = systemClock) => transition(actor, id, 'completed', clock);

export function handleAppointments(request: Request, id?: string, actorOverride?: Actor): Promise<Response> {
  return apiResponse(async () => {
    if (request.method !== 'GET') assertOrigin(request);
    const actor = actorOverride ?? await requireActor();
    if (request.method === 'GET') return Response.json(id ? await getAppointment(actor, id) : await listAppointments(actor, Object.fromEntries(new URL(request.url).searchParams)));
    if (request.method === 'POST' && !id) return Response.json(await createAppointment(actor, creation.omit({ start: true }).extend({ start: z.string() }).parse(await request.json())), { status: 201 });
    if (request.method === 'PATCH' && id) {
      const { action } = z.object({ action: z.enum(['cancel', 'complete']) }).strict().parse(await request.json());
      return Response.json(await (action === 'cancel' ? cancelAppointment : completeAppointment)(actor, id));
    }
    throw new HttpError(405, 'Metode tidak didukung');
  });
}
