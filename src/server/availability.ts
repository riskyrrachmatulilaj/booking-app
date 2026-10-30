import { z } from 'zod';
import { Temporal } from '@js-temporal/polyfill';
import { and, eq, lt, gt } from 'drizzle-orm';
import { db, businesses, services, users, staffServices, workingHours, appointments, requireDatabaseConfig } from '@/db';
import { HttpError } from './http';

export function validateTimezone(timezone: string): string {
  if (/^[+-]/.test(timezone)) throw new HttpError(400, 'Zona waktu tidak valid');
  try { Temporal.Now.zonedDateTimeISO(timezone); }
  catch { throw new HttpError(400, 'Zona waktu tidak valid'); }
  return timezone;
}
export function parseLocalDate(date: string): Temporal.PlainDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'Tanggal tidak valid');
  try { return Temporal.PlainDate.from(date, { overflow: 'reject' }); }
  catch { throw new HttpError(400, 'Tanggal tidak valid'); }
}
export function localInterval(input: { date: string; time: string; durationMinutes: number; timezone: string }): { start: Date; end: Date } {
  const date = parseLocalDate(input.date);
  validateTimezone(input.timezone);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time) || !Number.isSafeInteger(input.durationMinutes) || input.durationMinutes <= 0 || input.durationMinutes > 1440) {
    throw new HttpError(400, 'Waktu atau durasi tidak valid');
  }
  try {
    const start = date.toPlainDateTime(input.time).toZonedDateTime(input.timezone, { disambiguation: 'reject' });
    const end = start.add({ minutes: input.durationMinutes });
    end.toPlainDateTime().toZonedDateTime(input.timezone, { disambiguation: 'reject' });
    return { start: new Date(start.epochMilliseconds), end: new Date(end.epochMilliseconds) };
  } catch { throw new HttpError(400, 'Waktu lokal tidak ada atau ambigu'); }
}
function workBoundary(local: Temporal.PlainDateTime, timezone: string, opening: boolean): number {
  const earlier = local.toZonedDateTime(timezone, { disambiguation: 'earlier' });
  const later = local.toZonedDateTime(timezone, { disambiguation: 'later' });
  if (!earlier.toPlainDateTime().equals(local)) {
    // Gap boundaries clip to the transition itself, not the gap-shifted wall time.
    const transition = earlier.getTimeZoneTransition('next');
    if (!transition || transition.epochMilliseconds > later.epochMilliseconds) throw new HttpError(400, 'Batas jam kerja tidak valid');
    return transition.epochMilliseconds;
  }
  // Repeated boundaries narrow the interval: open later and close earlier.
  return (opening ? later : earlier).epochMilliseconds;
}
export function workSlots(input: { date: string; timezone: string; durationMinutes: number; hours: { start: string; end: string }[] }, now: Date): { start: string; end: string }[] {
  const date = parseLocalDate(input.date);
  validateTimezone(input.timezone);
  const result: { start: string; end: string }[] = [];
  for (const hours of input.hours) {
    const first = Temporal.PlainTime.from(hours.start);
    const last = Temporal.PlainTime.from(hours.end);
    const workStart = workBoundary(date.toPlainDateTime(first), input.timezone, true);
    const workEnd = workBoundary(date.toPlainDateTime(last), input.timezone, false);
    for (let time = first; Temporal.PlainTime.compare(time, last) < 0;) {
      const minutes = time.hour * 60 + time.minute;
      try {
        const slot = localInterval({ ...input, time: time.toString({ smallestUnit: 'minute' }) });
        if (slot.start.getTime() >= workStart && slot.end.getTime() <= workEnd && slot.start >= now) {
          result.push({ start: slot.start.toISOString(), end: slot.end.toISOString() });
        }
      } catch (error) {
        // DST gaps and repeated local times are never offered as booking starts.
        if (!(error instanceof HttpError)) throw error;
      }
      if (minutes + 15 >= 1440) break;
      time = time.add({ minutes: 15 });
    }
  }
  return result;
}
export async function eligibleSlots(connection: Pick<typeof db, 'select'>, input: { serviceId: string; staffId: string; date: string }, now: Date) {
  const date = parseLocalDate(input.date);
  if (!z.uuid().safeParse(input.serviceId).success || !z.uuid().safeParse(input.staffId).success) throw new HttpError(400, 'ID tidak valid');
  requireDatabaseConfig();
  const [eligible] = await connection.select({ durationMinutes: services.durationMinutes, timezone: businesses.timezone }).from(staffServices)
    .innerJoin(services, eq(services.id, staffServices.serviceId))
    .innerJoin(users, eq(users.id, staffServices.staffId))
    .innerJoin(businesses, eq(businesses.id, users.businessId))
    .where(and(eq(services.id, input.serviceId), eq(services.businessId, businesses.id), eq(users.id, input.staffId), eq(services.active, true), eq(users.active, true), eq(users.role, 'staff'))).limit(1);
  if (!eligible) throw new HttpError(400, 'Layanan atau staf tidak tersedia atau belum ditugaskan');
  const hours = await connection.select({ start: workingHours.start, end: workingHours.end }).from(workingHours)
    .where(and(eq(workingHours.staffId, input.staffId), eq(workingHours.weekday, date.dayOfWeek % 7))).orderBy(workingHours.start);
  return workSlots({ date: input.date, ...eligible, hours }, now);
}
export async function getSlots(input: { serviceId: string; staffId: string; date: string }, now: Date): Promise<{ start: string; end: string }[]> {
  // Task 3 subtracts confirmed appointments; existing UTC appointments must never move.
  const slots = await eligibleSlots(db, input, now);
  if (!slots.length) return [];
  const busy = await db.select({ start: appointments.startsAt, end: appointments.endsAt }).from(appointments)
    .where(and(eq(appointments.staffId, input.staffId), eq(appointments.status, 'confirmed'),
      lt(appointments.startsAt, new Date(slots[slots.length - 1].end)), gt(appointments.endsAt, new Date(slots[0].start))));
  return slots.filter((slot) => !busy.some((interval) => interval.start < new Date(slot.end) && interval.end > new Date(slot.start)));
}
