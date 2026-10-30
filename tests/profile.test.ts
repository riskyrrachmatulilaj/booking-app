import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ actor: vi.fn(), where: vi.fn(), limit: vi.fn(), config: vi.fn() }));
vi.mock('@/server/auth', () => ({ requireActor: mocks.actor }));
vi.mock('@/db', async original => ({ ...await original<typeof import('@/db')>(), requireDatabaseConfig: mocks.config, db: { select: () => ({ from: () => ({ where: mocks.where }) }) } }));
import { handleProfileRead } from '@/server/profile';
import { HttpError } from '@/server/http';
afterEach(() => vi.resetAllMocks());
it('rejects unauthenticated profile reads before database access', async () => {
  mocks.actor.mockRejectedValue(new HttpError(401, 'Silakan masuk'));
  expect((await handleProfileRead()).status).toBe(401);
  expect(mocks.config).not.toHaveBeenCalled();
});
it.each(['admin', 'staff', 'customer'] as const)('reads only current %s profile and omits credentials', async role => {
  const actor = { id: crypto.randomUUID(), role };
  mocks.where.mockReturnValue({ limit: mocks.limit });
  mocks.limit.mockResolvedValue([{ name: 'Nama', email: 'nama@example.com', role, whatsappPhone: null, whatsappOptedInAt: null }]);
  const response = await handleProfileRead(actor);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(await response.json()).not.toHaveProperty('passwordHash');
  expect(mocks.where).toHaveBeenCalledOnce();
});
