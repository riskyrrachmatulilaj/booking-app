import { describe, expect, it } from 'vitest';
import { toIcs, type CalendarAppointment } from '@/server/calendar';

const row: CalendarAppointment = {
  calendarUid: 'bb979de1-8926-46ee-81bf-c47a07b19242', sequence: 0, status: 'confirmed',
  startsAt: new Date('2026-11-02T02:00:00Z'), endsAt: new Date('2026-11-02T02:30:00Z'),
  updatedAt: new Date('2026-11-01T00:00:00Z'),
};
describe('calendar export', () => {
  it('uses stable persisted UID, UTC dates and CRLF', () => {
    const text = toIcs(row);
    expect(text).toContain(`UID:${row.calendarUid}\r\n`);
    expect(text).toContain('DTSTART:20261102T020000Z\r\nDTEND:20261102T023000Z');
    expect(text).toContain('DTSTAMP:20261101T000000Z');
    expect(text).not.toMatch(/^METHOD:/m);
    expect(text).toContain('STATUS:CONFIRMED');
    expect(text).toContain('SEQUENCE:0');
    expect(text.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
    expect(text.endsWith('\r\n')).toBe(true);
  });
  it('escapes text and folds every physical line to 75 UTF-8 octets without splitting Unicode', () => {
    const summary = 'Layanan, satu; dua\\tiga\r\nSTATUS:CANCELLED ' + '界😀é'.repeat(40);
    const text = toIcs({ ...row, summary });
    const unfolded = text.replaceAll('\r\n ', '');
    expect(unfolded).toContain('SUMMARY:Layanan\\, satu\\; dua\\\\tiga\\nSTATUS:CANCELLED ' + '界😀é'.repeat(40));
    for (const line of text.split('\r\n')) {
      expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
      expect(Buffer.from(line).toString('utf8')).toBe(line);
      expect(line).not.toContain('\uFFFD');
    }
  });
  it('exports a cancelled snapshot without scheduling METHOD, preserving UID and incremented sequence', () => {
    const text = toIcs({ ...row, status: 'cancelled', sequence: 1 });
    expect(text).not.toMatch(/^METHOD:/m);
    expect(text).toContain('STATUS:CANCELLED');
    expect(text).toContain('SEQUENCE:1');
    expect(text).toContain(`UID:${row.calendarUid}`);
    expect(toIcs({ ...row, status: 'completed', sequence: 1 })).toContain('STATUS:CONFIRMED');
  });
});
