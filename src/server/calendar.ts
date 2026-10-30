import type { Appointment } from './appointments';
import { getAppointment } from './appointments';
import { type Actor, requireActor } from './auth';
import { apiResponse, HttpError } from './http';

export type CalendarAppointment = Pick<Appointment, 'calendarUid' | 'sequence' | 'status' | 'startsAt' | 'endsAt' | 'updatedAt'> & { summary?: string };
const utc = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const escapeText = (text: string) => text.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
function fold(line: string): string {
  let result = '';
  let octets = 0;
  for (const character of line) {
    const size = Buffer.byteLength(character, 'utf8');
    if (octets + size > 75) { result += '\r\n '; octets = 1; }
    result += character;
    octets += size;
  }
  return result;
}
export function toIcs(appointment: CalendarAppointment): string {
  const cancelled = appointment.status === 'cancelled';
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Booking B2B//Calendar//ID', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${escapeText(appointment.calendarUid)}`, `DTSTAMP:${utc(appointment.updatedAt)}`,
    `DTSTART:${utc(appointment.startsAt)}`, `DTEND:${utc(appointment.endsAt)}`,
    `SEQUENCE:${appointment.sequence}`, `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    `SUMMARY:${escapeText(appointment.summary ?? 'Janji temu')}`, 'END:VEVENT', 'END:VCALENDAR',
  ].map(fold).join('\r\n') + '\r\n';
}
export function handleCalendar(request: Request, id: string, actorOverride?: Actor): Promise<Response> {
  return apiResponse(async () => {
    if (request.method !== 'GET') throw new HttpError(405, 'Metode tidak didukung');
    const row = await getAppointment(actorOverride ?? await requireActor(), id);
    return new Response(toIcs(row), { headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="appointment-${row.id}.ics"`,
      'Cache-Control': 'private, no-store',
    } });
  });
}
