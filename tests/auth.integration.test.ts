import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { assertIsolatedTestDatabase } from './helpers/database-safety';

const url = process.env.TEST_DATABASE_URL;
assertIsolatedTestDatabase(url, process.env.DATABASE_URL);
if (!url) console.warn('BLOCKED: TEST_DATABASE_URL is absent; PostgreSQL integration tests cannot run.');

describe.skipIf(!url)('persisted authentication (isolated PostgreSQL)', () => {
  let pool: Pool;
  let migrated = false;
  let auth: typeof import('@/server/auth');
  let database: typeof import('@/db');
  const email = `auth-${crypto.randomUUID()}@example.com`;
  const request = (data: unknown, token?: string) => new Request('http://localhost:3000/api/auth', {
    method: 'POST', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json', ...(token ? { cookie: `session=${token}` } : {}) }, body: JSON.stringify(data),
  });
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.APP_URL = 'http://localhost:3000';
    pool = new Pool({ connectionString: url });
    const { migrate } = await import('@/db/migrate');
    await migrate(pool);
    migrated = true;
    database = await import('@/db');
    auth = await import('@/server/auth');
  });
  afterAll(async () => {
    if (pool) {
      try {
        if (migrated) {
          await pool.query('DELETE FROM login_attempts WHERE email = $1', [email]);
          await pool.query('DELETE FROM users WHERE email = $1', [email]);
        }
      } finally { await pool.end(); }
    }
    if (database) await database.pool.end();
  });
  it('rejects forged registration role with 400', async () => {
    expect((await auth.handleAuth('register', request({ name: 'Ayu', email, password: 'password-valid-123', role: 'admin' }))).status).toBe(400);
  });
  it('registers only customer, stores a hashed 7-day session, rejects duplicate normalized email', async () => {
    const response = await auth.handleAuth('register', request({ name: 'Ayu', email, password: 'password-valid-123' }));
    expect(response.status).toBe(201);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('SameSite=Lax');
    const token = response.headers.get('set-cookie')!.match(/session=([^;]+)/)![1];
    expect((await auth.actorForToken(token)).role).toBe('customer');
    const rows = await pool.query('SELECT token_hash, expires_at FROM sessions JOIN users ON users.id = sessions.user_id WHERE email = $1', [email]);
    expect(rows.rows[0].token_hash).not.toBe(token);
    expect(new Date(rows.rows[0].expires_at).getTime() - Date.now()).toBeGreaterThan(6.9 * 86400000);
    expect((await auth.handleAuth('register', request({ name: 'Ayu', email: ` ${email.toUpperCase()} `, password: 'password-valid-123' }))).status).toBe(409);
  });
  it('logs in, revokes logout session, and rejects expired sessions', async () => {
    const response = await auth.handleAuth('login', request({ email, password: 'password-valid-123' }));
    expect(response.status).toBe(200);
    const token = response.headers.get('set-cookie')!.match(/session=([^;]+)/)![1];
    expect((await auth.actorForToken(token)).role).toBe('customer');
    expect((await auth.handleAuth('logout', request({}, token))).status).toBe(200);
    await expect(auth.actorForToken(token)).rejects.toMatchObject({ status: 401 });
    const next = await auth.handleAuth('login', request({ email, password: 'password-valid-123' }));
    const expiredToken = next.headers.get('set-cookie')!.match(/session=([^;]+)/)![1];
    await pool.query('UPDATE sessions SET expires_at = now() - interval \'1 second\' WHERE user_id = (SELECT id FROM users WHERE email = $1)', [email]);
    await expect(auth.actorForToken(expiredToken)).rejects.toMatchObject({ status: 401 });
  });
  it('serializes concurrent normalized-account failures: exactly five 401 and remaining 429', async () => {
    const responses = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      auth.handleAuth('login', request({ email: i % 2 ? email.toUpperCase() : email, password: 'wrong-password' })),
    ));
    expect(responses.map((response) => response.status).sort()).toEqual([
      401, 401, 401, 401, 401, 429, 429, 429, 429, 429,
    ]);
    const failures = await pool.query('SELECT count(*)::int AS count FROM login_attempts WHERE email = $1', [email]);
    expect(failures.rows[0].count).toBe(5);
    await pool.query('DELETE FROM login_attempts WHERE email = $1', [email]);
  });
  it('persists five failures and blocks sixth normalized-account attempt with 429', async () => {
    for (let i = 0; i < 5; i++) expect((await auth.handleAuth('login', request({ email: email.toUpperCase(), password: 'wrong-password' }))).status).toBe(401);
    expect((await auth.handleAuth('login', request({ email, password: 'wrong-password' }))).status).toBe(429);
    expect((await auth.handleAuth('login', request({ email, password: 'password-valid-123' }))).status).toBe(429);
    await pool.query('UPDATE login_attempts SET attempted_at = now() - interval \'16 minutes\' WHERE email = $1', [email]);
    expect((await auth.handleAuth('login', request({ email, password: 'password-valid-123' }))).status).toBe(200);
  });
});
