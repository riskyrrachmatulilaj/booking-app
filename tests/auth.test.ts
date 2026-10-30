import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword, parseRegistration, assertRole, actorForToken } from '@/server/auth';
import { assertOrigin, apiResponse } from '@/server/http';

describe('passwords', () => {
  it('round-trips passwords with independently salted hashes', async () => {
    const hash = await hashPassword('password-valid-123');
    expect(await verifyPassword('password-valid-123', hash)).toBe(true);
    expect(await hashPassword('password-valid-123')).not.toBe(hash);
  });
  it('rejects wrong passwords and malformed hashes', async () => {
    const hash = await hashPassword('password-valid-123');
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
    expect(await verifyPassword('password-valid-123', 'broken')).toBe(false);
  });
});
it('normalizes registration email and rejects privileged or unknown fields', () => {
  expect(parseRegistration({ name: 'Ayu', email: ' AYU@Example.com ', password: 'password-valid-123' }).email).toBe('ayu@example.com');
  for (const extra of [{ role: 'admin' }, { businessId: crypto.randomUUID() }]) {
    expect(() => parseRegistration({ name: 'Ayu', email: 'ayu@example.com', password: 'password-valid-123', ...extra })).toThrow();
  }
  expect(() => parseRegistration({ name: '', email: 'bad', password: 'short' })).toThrow();
});
it('returns 401 for absent session without opening a database', async () => {
  const response = await apiResponse(async () => { await actorForToken(undefined); return Response.json({}); });
  expect(response.status).toBe(401);
  expect(await response.json()).toHaveProperty('error');
});
it('enforces server-side roles', () => {
  expect(() => assertRole({ id: crypto.randomUUID(), role: 'customer' }, ['admin'])).toThrow();
  expect(() => assertRole({ id: crypto.randomUUID(), role: 'admin' }, ['admin'])).not.toThrow();
});
it('rejects foreign and absent origins with 403; accepts configured origin', async () => {
  process.env.APP_URL = 'http://localhost:3000';
  for (const origin of ['https://foreign.example', undefined]) {
    const response = await apiResponse(async () => {
      assertOrigin(new Request('http://localhost:3000/api/auth/login', { method: 'POST', headers: origin ? { origin } : {} }));
      return Response.json({});
    });
    expect(response.status).toBe(403);
  }
  expect(() => assertOrigin(new Request('http://localhost:3000', { headers: { origin: 'http://localhost:3000' } }))).not.toThrow();
});
