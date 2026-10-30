import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, appointments, payments, requireDatabaseConfig } from '@/db';
import { type Actor, assertRole, requireActor } from './auth';
import { type AppointmentClock, assertAppointmentRead } from './appointments';
import { apiResponse, assertOrigin, HttpError } from './http';

export type Payment = typeof payments.$inferSelect;
export async function payMock(actor: Actor, id: string, clock: AppointmentClock = () => new Date()): Promise<Payment> {
  assertRole(actor, ['admin', 'customer']);
  z.uuid().parse(id);
  requireDatabaseConfig();
  return db.transaction(async (tx) => {
    // Match cancellation lock order: appointment first, then its mock payment.
    const [row] = await tx.select().from(appointments).where(eq(appointments.id, id)).for('update');
    if (!row) throw new HttpError(404, 'Janji temu tidak ditemukan');
    assertAppointmentRead(actor, row);
    const now = clock();
    if (row.status !== 'confirmed' || now >= row.startsAt) throw new HttpError(409, 'Pembayaran simulasi hanya untuk janji temu mendatang yang dikonfirmasi');
    const [existing] = await tx.select().from(payments).where(eq(payments.appointmentId, id));
    if (existing) return existing;
    return (await tx.insert(payments).values({ appointmentId: id, amount: row.price, simulated: true, createdAt: now, updatedAt: now }).returning())[0];
  });
}
export function handlePayment(request: Request, id: string, actorOverride?: Actor): Promise<Response> {
  return apiResponse(async () => {
    assertOrigin(request);
    if (request.method !== 'POST') throw new HttpError(405, 'Metode tidak didukung');
    const payment = await payMock(actorOverride ?? await requireActor(), id);
    return Response.json({ ...payment, message: 'Pembayaran simulasi; tidak ada uang nyata.' }, { headers: { 'Cache-Control': 'private, no-store' } });
  });
}
