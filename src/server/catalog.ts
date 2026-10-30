import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import { db, requireDatabaseConfig, businesses, users, services, staffServices, workingHours } from '@/db';
import { type Actor, assertRole, hashPassword, requireActor } from './auth';
import { apiResponse, assertOrigin, HttpError } from './http';
import { validateTimezone } from './availability';

const name = z.string().trim().min(1).max(120);
const id = z.uuid();
const service = z.object({ name, price: z.number().int().min(0).max(2147483647), durationMinutes: z.number().int().min(1).max(1440) }).strict();
const staff = z.object({ name, email: z.string().trim().toLowerCase().pipe(z.email().max(254)), password: z.string().min(12).max(128) }).strict();
const business = z.object({ name, timezone: z.string().min(1).max(100).refine((value) => { try { validateTimezone(value); return true; } catch { return false; } }) }).strict();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const hours = z.array(z.object({ weekday: z.number().int().min(0).max(6), start: time, end: time }).strict()).max(100).superRefine((rows, context) => {
  rows.forEach((row, i) => {
    if (row.start >= row.end) context.addIssue({ code: 'custom', message: 'Jam lintas tengah malam tidak didukung', path: [i] });
    if (rows.some((other, j) => j < i && other.weekday === row.weekday && other.start < row.end && row.start < other.end)) {
      context.addIssue({ code: 'custom', message: 'Jam kerja beririsan', path: [i] });
    }
  });
});
export const parseService = (data: unknown) => service.parse(data);
export const parseStaff = (data: unknown) => staff.parse(data);
export const parseBusiness = (data: unknown) => business.parse(data);
export const parseHours = (data: unknown) => hours.parse(data);
export const assertCatalogAdmin = (actor: Actor) => assertRole(actor, ['admin']);
type Resource = 'services' | 'staff' | 'working-hours' | 'business';
const publicStaff = { id: users.id, name: users.name, active: users.active };

// Actor override is for trusted server callers; HTTP routes always resolve the database session.
export async function handleCatalog(resource: Resource, request: Request, actorOverride?: Actor): Promise<Response> {
  return apiResponse(async () => {
    const actor = actorOverride ?? await requireActor();
    const write = request.method !== 'GET';
    if (write) { assertOrigin(request); assertCatalogAdmin(actor); }
    requireDatabaseConfig();
    const params = new URL(request.url).searchParams;
    const includeInactive = actor.role === 'admin' && params.get('includeInactive') === 'true';
    if (!write) {
      if (resource === 'business') {
        const [row] = await db.select({ id: businesses.id, name: businesses.name, timezone: businesses.timezone }).from(businesses).limit(1);
        if (!row) throw new HttpError(404, 'Bisnis tidak ditemukan');
        return Response.json(row);
      }
      if (resource === 'services') return Response.json(await db.select().from(services).where(includeInactive ? undefined : eq(services.active, true)).orderBy(services.name));
      if (resource === 'staff') {
        const serviceId = params.get('serviceId');
        if (serviceId) {
          id.parse(serviceId);
          return Response.json(await db.select(publicStaff).from(users)
            .innerJoin(staffServices, eq(staffServices.staffId, users.id)).innerJoin(services, eq(services.id, staffServices.serviceId))
            .where(and(eq(users.role, 'staff'), eq(users.active, true), eq(services.active, true), eq(services.id, serviceId))).orderBy(users.name));
        }
        const rows = await db.select(publicStaff).from(users).where(and(eq(users.role, 'staff'), includeInactive ? undefined : eq(users.active, true))).orderBy(users.name);
        const assignments = rows.length ? await db.select().from(staffServices).where(inArray(staffServices.staffId, rows.map((row) => row.id))) : [];
        return Response.json(rows.map((row) => ({ ...row, serviceIds: assignments.filter((assignment) => assignment.staffId === row.id).map((assignment) => assignment.serviceId) })));
      }
      const staffId = id.parse(params.get('staffId'));
      return Response.json(await db.select().from(workingHours).innerJoin(users, eq(users.id, workingHours.staffId))
        .where(and(eq(workingHours.staffId, staffId), eq(users.role, 'staff'), includeInactive ? undefined : eq(users.active, true)))
        .orderBy(workingHours.weekday, workingHours.start).then((rows) => rows.map((row) => row.working_hours)));
    }
    if (request.method !== 'POST' && request.method !== 'PATCH') throw new HttpError(405, 'Metode tidak didukung');
    const input: unknown = await request.json();
    const [installation] = await db.select({ id: businesses.id }).from(businesses).limit(1);
    if (!installation) throw new Error('Run database migration first');
    return db.transaction(async (tx) => {
    // Lock order: business, then staff/service rows. Booking uses the same order.
    await tx.select({ id: businesses.id }).from(businesses).where(eq(businesses.id, installation.id)).for('update');
    const db = tx;
    if (resource === 'business') {
      if (request.method !== 'PATCH') throw new HttpError(405, 'Gunakan PATCH');
      const data = parseBusiness(input);
      const [row] = await db.update(businesses).set(data).where(eq(businesses.id, installation.id)).returning();
      return Response.json(row);
    }
    if (resource === 'services') {
      if (request.method === 'POST') {
        const [row] = await db.insert(services).values({ ...parseService(input), businessId: installation.id })
          .onConflictDoNothing({ target: [services.businessId, services.name] }).returning();
        if (!row) throw new HttpError(409, 'Nama layanan sudah digunakan');
        return Response.json(row, { status: 201 });
      }
      const { id: serviceId, ...data } = service.partial().extend({ id, active: z.boolean().optional() }).strict().parse(input);
      if (!Object.keys(data).length) throw new HttpError(400, 'Tidak ada perubahan');
      const [row] = await db.update(services).set(data).where(eq(services.id, serviceId)).returning().catch((error: unknown) => {
        // Drizzle wraps PostgreSQL errors in cause; match only this unique constraint.
        const postgresError = error instanceof Error && error.cause ? error.cause : error;
        if (typeof postgresError === 'object' && postgresError !== null && 'code' in postgresError && 'constraint' in postgresError
          && postgresError.code === '23505' && postgresError.constraint === 'services_business_name_idx') {
          throw new HttpError(409, 'Nama layanan sudah digunakan');
        }
        throw error;
      });
      if (!row) throw new HttpError(404, 'Layanan tidak ditemukan');
      return Response.json(row);
    }
    if (resource === 'staff' && request.method === 'POST') {
      const { password, ...data } = parseStaff(input);
      const [row] = await db.insert(users).values({ ...data, passwordHash: await hashPassword(password), businessId: installation.id, role: 'staff' })
        .onConflictDoNothing({ target: users.email }).returning(publicStaff);
      if (!row) throw new HttpError(409, 'Email sudah terdaftar');
      return Response.json({ ...row, serviceIds: [] }, { status: 201 });
    }
    if (resource === 'staff') {
      const { id: staffId, serviceIds, ...data } = z.object({ id, name: name.optional(), active: z.boolean().optional(), serviceIds: z.array(id).max(100).refine((ids) => new Set(ids).size === ids.length).optional() }).strict().parse(input);
      if (!Object.keys(data).length && !serviceIds) throw new HttpError(400, 'Tidak ada perubahan');
      const row = await db.transaction(async (tx) => {
        const [staffRow] = await tx.select(publicStaff).from(users).where(and(eq(users.id, staffId), eq(users.role, 'staff'))).for('update');
        if (!staffRow) throw new HttpError(400, 'Pengguna bukan staf');
        if (serviceIds) {
          if (serviceIds.length) {
            const valid = await tx.select({ id: services.id }).from(services).where(and(inArray(services.id, serviceIds), eq(services.active, true), eq(services.businessId, installation.id)));
            if (valid.length !== serviceIds.length) throw new HttpError(400, 'Layanan tidak tersedia');
          }
          await tx.delete(staffServices).where(eq(staffServices.staffId, staffId));
          if (serviceIds.length) await tx.insert(staffServices).values(serviceIds.map((serviceId) => ({ staffId, serviceId })));
        }
        if (Object.keys(data).length) return (await tx.update(users).set(data).where(eq(users.id, staffId)).returning(publicStaff))[0];
        return staffRow;
      });
      const assignments = await db.select({ serviceId: staffServices.serviceId }).from(staffServices).where(eq(staffServices.staffId, staffId));
      return Response.json({ ...row, serviceIds: assignments.map((assignment) => assignment.serviceId) });
    }
    const data = z.object({ staffId: id, hours }).strict().parse(input);
    const rows = await db.transaction(async (tx) => {
      const [staffRow] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, data.staffId), eq(users.role, 'staff'))).for('update');
      if (!staffRow) throw new HttpError(400, 'Pengguna bukan staf');
      // Lock the staff row before replacing hours, so concurrent edits cannot interleave.
      await tx.delete(workingHours).where(eq(workingHours.staffId, data.staffId));
      return data.hours.length ? await tx.insert(workingHours).values(data.hours.map((row) => ({ ...row, staffId: data.staffId }))).returning() : [];
    });
    return Response.json(rows);
    });
  });
}
