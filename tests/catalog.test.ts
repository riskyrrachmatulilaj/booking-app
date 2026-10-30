import { afterEach, describe, expect, it, vi } from 'vitest';

const { returning } = vi.hoisted(() => ({ returning: vi.fn() }));
vi.mock('@/db', async (original) => ({
  ...await original<typeof import('@/db')>(),
  requireDatabaseConfig: vi.fn(),
  db: {
    select: () => ({ from: () => ({ limit: async () => [{ id: crypto.randomUUID() }] }) }),
    transaction: async (action: (tx: unknown) => Promise<unknown>) => action({
      select: () => ({ from: () => ({ where: () => ({ for: async () => [{ id: crypto.randomUUID() }] }) }) }),
      update: () => ({ set: () => ({ where: () => ({ returning }) }) }),
    }),
  },
}));
import { handleCatalog } from '@/server/catalog';

const request = () => new Request('http://localhost:3000/api/services', {
  method: 'PATCH', headers: { origin: 'http://localhost:3000' },
  body: JSON.stringify({ id: crypto.randomUUID(), name: 'Already used' }),
});
afterEach(() => vi.restoreAllMocks());
describe('service rename database errors', () => {
  it.each([false, true])('returns 409 for unique service name (wrapped=%s)', async (wrapped) => {
    const error = Object.assign(new Error('duplicate'), { code: '23505', constraint: 'services_business_name_idx' });
    returning.mockRejectedValueOnce(wrapped ? new Error('Failed query', { cause: error }) : error);
    const response = await handleCatalog('services', request(), { id: crypto.randomUUID(), role: 'admin' });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'Nama layanan sudah digunakan' });
  });
  it.each([
    { code: '23505', constraint: 'another_index' },
    { code: '23514', constraint: 'services_business_name_idx' },
  ])('keeps unrelated database errors as 500 (%j)', async (details) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    returning.mockRejectedValueOnce(new Error('Failed query', { cause: Object.assign(new Error('database'), details) }));
    const response = await handleCatalog('services', request(), { id: crypto.randomUUID(), role: 'admin' });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Kesalahan server' });
  });
});
