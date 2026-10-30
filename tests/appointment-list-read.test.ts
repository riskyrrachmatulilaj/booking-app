import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ actor: vi.fn(), config: vi.fn(), select: vi.fn(), where: vi.fn(), offset: vi.fn() }));
vi.mock('@/server/auth', async original => ({ ...await original<typeof import('@/server/auth')>(), requireActor: mocks.actor }));
vi.mock('@/db', async original => ({ ...await original<typeof import('@/db')>(), requireDatabaseConfig: mocks.config, db: { select: mocks.select } }));
import { handleAppointments, listAppointments } from '@/server/appointments';
import { HttpError } from '@/server/http';
afterEach(() => vi.resetAllMocks());
it('rejects unauthenticated appointment reads before database query', async () => {
  mocks.actor.mockRejectedValue(new HttpError(401, 'Silakan masuk'));
  expect((await handleAppointments(new Request('http://localhost:3000/api/appointments'))).status).toBe(401);
  expect(mocks.select).not.toHaveBeenCalled();
});
it.each(['admin', 'staff', 'customer'] as const)('preserves pagination and explicit safe projection for %s', async role => {
  const chain = { innerJoin: vi.fn(), leftJoin: vi.fn(), where: mocks.where, orderBy: vi.fn(), limit: vi.fn(), offset: mocks.offset };
  chain.innerJoin.mockReturnValue(chain); chain.leftJoin.mockReturnValue(chain); mocks.where.mockReturnValue(chain); chain.orderBy.mockReturnValue(chain); chain.limit.mockReturnValue(chain);
  mocks.select.mockReturnValue({ from: () => chain });
  mocks.offset.mockResolvedValue([{ id: 'first', serviceName: 'Layanan panjang', staffName: 'Staf', customerName: 'Pelanggan', paymentStatus: 'paid' }, { id: 'second' }]);
  const result = await listAppointments({ id: crypto.randomUUID(), role }, { from: '2026-10-01T00:00:00Z', to: '2026-10-31T00:00:00Z', limit: 1 });
  expect(result.items).toHaveLength(1); expect(result.nextOffset).toBe(1);
  const projection = mocks.select.mock.calls[0][0];
  expect(projection).toHaveProperty('staffName'); expect(projection).toHaveProperty('paymentStatus');
  expect(projection).not.toHaveProperty('passwordHash'); expect(projection).not.toHaveProperty('whatsappPhone');
  expect(mocks.where).toHaveBeenCalledOnce();
});
