import { describe, expect, it } from 'vitest';
import { getSlots, localInterval, workSlots } from '@/server/availability';
import { parseService, parseHours, parseStaff, parseBusiness, assertCatalogAdmin } from '@/server/catalog';

const interval = { date: '2026-11-02', time: '09:00', durationMinutes: 30, timezone: 'Asia/Jakarta' };
describe('strict local intervals', () => {
  it('maps Jakarta to UTC', () => {
    expect(localInterval(interval)).toEqual({ start: new Date('2026-11-02T02:00:00.000Z'), end: new Date('2026-11-02T02:30:00.000Z') });
  });
  it.each([
    { timezone: 'Invalid/Zone' }, { timezone: '+07:00' }, { date: '2026-02-30' }, { date: '2026-2-02' },
    { time: '24:00' }, { time: '9:00' }, { durationMinutes: 0 },
    { date: '2026-03-08', time: '02:30', timezone: 'America/New_York' },
    { date: '2026-11-01', time: '01:30', timezone: 'America/New_York' },
    { date: '2026-11-01', time: '00:30', durationMinutes: 60, timezone: 'America/New_York' },
  ])('rejects invalid or ambiguous local input %j', (patch) => {
    expect(() => localInterval({ ...interval, ...patch })).toThrow();
  });
});
describe('catalog validation and authorization', () => {
  it('accepts existing names through 120 characters', () => {
    expect(parseService({ name: 'x'.repeat(120), price: 0, durationMinutes: 30 }).name).toHaveLength(120);
    expect(parseStaff({ name: 'x'.repeat(120), email: 'staff@example.com', password: 'valid-password-123' }).name).toHaveLength(120);
    expect(() => parseService({ name: 'x'.repeat(121), price: 0, durationMinutes: 30 })).toThrow();
  });
  it('rejects invalid money, duration, overnight and overlapping hours', () => {
    for (const patch of [{ price: -1 }, { price: 1.5 }, { durationMinutes: 0 }]) {
      expect(() => parseService({ name: 'Potong', price: 50000, durationMinutes: 30, ...patch })).toThrow();
    }
    expect(() => parseHours([{ weekday: 1, start: '22:00', end: '01:00' }])).toThrow();
    expect(() => parseHours([{ weekday: 1, start: '09:00', end: '11:00' }, { weekday: 1, start: '10:00', end: '12:00' }])).toThrow();
    expect(parseHours([{ weekday: 1, start: '09:00', end: '11:00' }, { weekday: 1, start: '11:00', end: '12:00' }])).toHaveLength(2);
  });
  it('rejects customer edits and privileged staff fields', () => {
    expect(() => assertCatalogAdmin({ id: crypto.randomUUID(), role: 'customer' })).toThrow('Akses ditolak');
    expect(() => parseStaff({ name: 'Staf', email: 'staff@example.com', password: 'valid-password-123', role: 'admin' })).toThrow();
    expect(() => parseBusiness({ name: 'Bisnis', timezone: '+07:00' })).toThrow();
  });
});
describe('work slots', () => {
  it('rejects malformed identifiers before touching the database', async () => {
    await expect(getSlots({ serviceId: 'bad', staffId: 'bad', date: interval.date }, new Date())).rejects.toMatchObject({ status: 400 });
  });
  const input = { date: interval.date, timezone: interval.timezone, durationMinutes: 30, hours: [{ start: '09:00', end: '10:00' }] };
  it('offers 15-minute starts only when full duration fits', () => {
    expect(workSlots(input, new Date('2026-11-01T00:00:00Z')).map((s) => s.start)).toEqual([
      '2026-11-02T02:00:00.000Z', '2026-11-02T02:15:00.000Z', '2026-11-02T02:30:00.000Z',
    ]);
  });
  it('keeps elapsed-duration slots that fit across DST rollback', () => {
    const slots = workSlots({ date: '2026-11-01', timezone: 'America/New_York', durationMinutes: 180, hours: [{ start: '00:00', end: '03:00' }] }, new Date('2026-10-31T00:00:00Z'));
    expect(slots).toEqual([0, 15, 30, 45].map((minute) => ({
      start: `2026-11-01T04:${String(minute).padStart(2, '0')}:00.000Z`,
      end: `2026-11-01T07:${String(minute).padStart(2, '0')}:00.000Z`,
    })));
  });
  it.each([
    { date: '2026-11-01', start: '00:00', end: '01:30', expected: ['04:00', '04:15', '04:30'] },
    { date: '2026-11-01', start: '01:30', end: '03:00', expected: ['07:00', '07:15', '07:30', '07:45'] },
    { date: '2026-03-08', start: '00:00', end: '02:30', expected: ['05:00', '05:15', '05:30', '05:45', '06:00', '06:15', '06:30', '06:45'] },
    { date: '2026-03-08', start: '02:30', end: '04:00', expected: ['07:00', '07:15', '07:30', '07:45'] },
  ])('preserves safe candidates with transition boundary $date $start–$end', ({ date, start, end, expected }) => {
    const slots = workSlots({ date, timezone: 'America/New_York', durationMinutes: 15, hours: [{ start, end }] }, new Date('2026-01-01T00:00:00Z'));
    expect(slots.map((slot) => slot.start)).toEqual(expected.map((time) => `${date}T${time}:00.000Z`));
  });
  it('clips a gap closing to the transition, not the shifted wall time', () => {
    const slots = workSlots({ date: '2026-03-08', timezone: 'America/New_York', durationMinutes: 150, hours: [{ start: '00:00', end: '02:30' }] }, new Date('2026-01-01T00:00:00Z'));
    expect(slots).toEqual([]);
  });
  it('never offers ambiguous or nonexistent starts on DST transition days', () => {
    for (const [date, excludedHour] of [['2026-11-01', '01'], ['2026-03-08', '02']]) {
      const slots = workSlots({ date, timezone: 'America/New_York', durationMinutes: 15, hours: [{ start: '00:00', end: '04:00' }] }, new Date('2026-01-01T00:00:00Z'));
      expect(slots.length).toBeGreaterThan(0);
      for (const slot of slots) {
        const hour = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }).format(new Date(slot.start));
        expect(hour).not.toBe(excludedHour);
        expect(new Date(slot.end).getTime()).toBeLessThanOrEqual(new Date(`${date}T${date === '2026-11-01' ? '09' : '08'}:00:00Z`).getTime());
      }
    }
  });
  it('does not return past starts', () => {
    expect(workSlots(input, new Date('2026-11-02T02:16:00Z')).map((s) => s.start)).toEqual(['2026-11-02T02:30:00.000Z']);
    expect(workSlots(input, new Date('2026-11-03T00:00:00Z'))).toEqual([]);
  });
});
