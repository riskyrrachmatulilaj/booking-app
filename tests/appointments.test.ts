import { describe, expect, it } from 'vitest';
import { handleAppointments, parseAppointment, parseAppointmentList, assertAppointmentRead, assertAppointmentTransition } from '@/server/appointments';

const customer = { id: crypto.randomUUID(), role: 'customer' as const };
const staff = { id: crypto.randomUUID(), role: 'staff' as const };
const admin = { id: crypto.randomUUID(), role: 'admin' as const };
const row = { customerId: customer.id, staffId: staff.id, status: 'confirmed' as const, startsAt: new Date('2026-11-02T02:00:00Z'), endsAt: new Date('2026-11-02T02:30:00Z') };
describe('appointment boundaries and authorization', () => {
  it('origin-checks all mutations before parsing or database access', async () => {
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      expect((await handleAppointments(new Request('http://localhost:3000/api/appointments', { method }), undefined, customer)).status).toBe(403);
    }
  });
  it('rejects sub-millisecond instants rather than rounding onto valid slots', () => {
    expect(() => parseAppointment({ serviceId: crypto.randomUUID(), staffId: staff.id, start: '2026-11-02T02:00:00.000001Z' })).toThrow();
  });
  it('requires UUIDs, explicit valid offsets and exact seconds', () => {
    const input = { serviceId: crypto.randomUUID(), staffId: staff.id, start: '2026-11-02T09:00:00+07:00' };
    expect(parseAppointment(input).start.toISOString()).toBe('2026-11-02T02:00:00.000Z');
    for (const start of ['2026-11-02T09:00:00', '2026-02-30T09:00:00Z', '2026-11-02T09:00:00+25:00']) expect(() => parseAppointment({ ...input, start })).toThrow();
    expect(() => parseAppointment({ ...input, serviceId: 'bad' })).toThrow();
    expect(() => parseAppointment({ ...input, customerId: admin.id })).toThrow();
  });
  it('bounds listing dates and pagination', () => {
    expect(parseAppointmentList({ from: '2026-11-01T00:00:00Z', to: '2026-12-01T00:00:00Z' }).limit).toBe(50);
    for (const input of [{}, { from: '2026-01-01T00:00:00Z', to: '2027-01-01T00:00:00Z' }, { from: '2026-11-01T00:00:00Z', to: '2026-11-02T00:00:00Z', limit: '101' }]) expect(() => parseAppointmentList(input)).toThrow();
  });
  it('hides unrelated rows and lets staff read only own rows', () => {
    for (const actor of [customer, staff, admin]) expect(() => assertAppointmentRead(actor, row)).not.toThrow();
    for (const role of ['customer', 'staff'] as const) expect(() => assertAppointmentRead({ id: crypto.randomUUID(), role }, row)).toThrow(expect.objectContaining({ status: 404 }));
  });
  it('allows only owner or admin cancellation strictly before start', () => {
    expect(() => assertAppointmentTransition(customer, row, 'cancelled', new Date('2026-11-02T01:59:59Z'))).not.toThrow();
    expect(() => assertAppointmentTransition(admin, row, 'cancelled', row.startsAt)).toThrow();
    expect(() => assertAppointmentTransition(staff, row, 'cancelled', new Date(0))).toThrow();
  });
  it('allows staff owner or admin completion at end and rejects terminal transitions', () => {
    for (const actor of [staff, admin]) expect(() => assertAppointmentTransition(actor, row, 'completed', row.endsAt)).not.toThrow();
    expect(() => assertAppointmentTransition(customer, row, 'completed', row.endsAt)).toThrow();
    expect(() => assertAppointmentTransition(staff, row, 'completed', row.startsAt)).toThrow();
    for (const status of ['cancelled', 'completed'] as const) expect(() => assertAppointmentTransition(admin, { ...row, status }, 'completed', row.endsAt)).toThrow();
  });
});
