import { afterEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ lock: vi.fn(), rows: [] as unknown[], eligible: vi.fn(), update: vi.fn() }));
vi.mock('@/db', async (original) => ({
  ...await original<typeof import('@/db')>(),
  requireDatabaseConfig: vi.fn(),
  db: { transaction: async (callback: (tx: unknown) => unknown) => callback({
    select: () => ({ from: () => ({
      for: async () => { await state.lock(); return [state.rows.shift()]; },
      where: () => ({ for: async () => { await state.lock(); return [state.rows.shift()]; }, then: (resolve: (rows: unknown[]) => void) => resolve([state.rows.shift()]) }),
    }) }),
    update: () => ({ set: (value: unknown) => { state.update(value); return { where: () => ({ returning: async () => [{}] }) }; } }),
    insert: () => ({ values: () => ({ returning: async () => [{}] }) }),
  }) },
}));
vi.mock('@/server/availability', () => ({ eligibleSlots: state.eligible }));
import { cancelAppointment, completeAppointment, createAppointment } from '@/server/appointments';
const customer = { id: crypto.randomUUID(), role: 'customer' as const };
const staff = { id: crypto.randomUUID(), role: 'staff' as const };
const row = { id: crypto.randomUUID(), customerId: customer.id, staffId: staff.id, status: 'confirmed', startsAt: new Date('2026-11-02T02:00:00Z'), endsAt: new Date('2026-11-02T02:30:00Z') };
afterEach(() => { vi.resetAllMocks(); state.rows = []; });
function barrier() {
  let release!: () => void;
  let entered!: () => void;
  const reached = new Promise<void>((resolve) => { entered = resolve; });
  const wait = new Promise<void>((resolve) => { release = resolve; });
  state.lock.mockImplementationOnce(async () => { entered(); await wait; });
  return { reached, release };
}
describe('time sampled after database lock waits', () => {
  it('rejects cancellation after the start passes while waiting', async () => {
    state.rows = [row];
    const lock = barrier();
    let now = new Date(row.startsAt.getTime() - 1);
    const clock = vi.fn(() => now);
    const pending = cancelAppointment(customer, row.id, clock);
    await lock.reached;
    expect(clock).not.toHaveBeenCalled();
    now = row.startsAt;
    lock.release();
    await expect(pending).rejects.toMatchObject({ status: 409 });
    expect(state.update).not.toHaveBeenCalled();
  });
  it('permits completion when end passes while waiting, using fresh update timestamp', async () => {
    state.rows = [row];
    const lock = barrier();
    let now = row.startsAt;
    const pending = completeAppointment(staff, row.id, () => now);
    await lock.reached;
    now = row.endsAt;
    lock.release();
    await expect(pending).resolves.toBeDefined();
    expect(state.update).toHaveBeenCalledWith(expect.objectContaining({ updatedAt: row.endsAt }));
  });
  it('checks creation against time after business/staff/service locks', async () => {
    const businessId = crypto.randomUUID();
    const serviceId = crypto.randomUUID();
    state.rows = [{ id: businessId, timezone: 'Asia/Jakarta' }, { businessId }, { businessId, price: 1, durationMinutes: 30 }, { id: customer.id }];
    const lock = barrier();
    let now = new Date(row.startsAt.getTime() - 1);
    state.eligible.mockImplementation(async (_tx, _input, sampled: Date) => sampled > row.startsAt ? [] : [{ start: row.startsAt.toISOString(), end: row.endsAt.toISOString() }]);
    const clock = vi.fn(() => now);
    const pending = createAppointment(customer, { staffId: staff.id, serviceId, start: row.startsAt.toISOString() }, clock);
    await lock.reached;
    expect(clock).not.toHaveBeenCalled();
    now = new Date(row.startsAt.getTime() + 1);
    lock.release();
    await expect(pending).rejects.toMatchObject({ status: 400 });
    expect(state.eligible).toHaveBeenCalledWith(expect.anything(), expect.anything(), now);
  });
});
