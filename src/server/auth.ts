import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
import { and, eq, gt } from 'drizzle-orm';
import { db, pool, requireDatabaseConfig, users, sessions, businesses } from '@/db';
import { apiResponse, assertOrigin, HttpError } from './http';

export type Role = 'admin' | 'staff' | 'customer';
export type Actor = { id: string; role: Role };
const derive = promisify(scrypt);
const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const password = z.string().min(12).max(128);
const registration = z.object({ name: z.string().trim().min(1).max(100), email, password }).strict();
const login = z.object({ email, password: z.string().min(1).max(128) }).strict();
const lifetime = 7 * 24 * 60 * 60;
const digest = (token: string) => createHash('sha256').update(token).digest('hex');

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt, 64) as Buffer;
  return `scrypt:${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const match = /^scrypt:([a-f0-9]{32}):([a-f0-9]{128})$/.exec(hash);
  if (!match) return false;
  const actual = await derive(password, match[1], 64) as Buffer;
  return timingSafeEqual(actual, Buffer.from(match[2], 'hex'));
}
export function parseRegistration(data: unknown) { return registration.parse(data); }
export function assertRole(actor: Actor, roles: Role[]): void {
  if (!roles.includes(actor.role)) throw new HttpError(403, 'Akses ditolak');
}
export async function actorForToken(token: string | undefined): Promise<Actor> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new HttpError(401, 'Silakan masuk');
  requireDatabaseConfig();
  const [actor] = await db.select({ id: users.id, role: users.role }).from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, digest(token)), gt(sessions.expiresAt, new Date()))).limit(1);
  if (!actor) throw new HttpError(401, 'Sesi tidak valid atau kedaluwarsa');
  return actor;
}
export async function requireActor(): Promise<Actor> {
  const { cookies } = await import('next/headers');
  return actorForToken((await cookies()).get('session')?.value);
}
function cookie(token: string, maxAge = lifetime): string {
  return `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}
async function newSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await db.insert(sessions).values({ userId, tokenHash: digest(token), expiresAt: new Date(Date.now() + lifetime * 1000) });
  return token;
}
export async function handleAuth(action: 'register' | 'login' | 'logout', request: Request): Promise<Response> {
  return apiResponse(async () => {
    assertOrigin(request);
    if (action === 'logout') {
      const token = request.headers.get('cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith('session='))?.slice(8);
      requireDatabaseConfig();
      if (token) await db.delete(sessions).where(eq(sessions.tokenHash, digest(token)));
      return Response.json({ ok: true }, { headers: { 'Set-Cookie': cookie('', 0) } });
    }
    const input = await request.json();
    const data = action === 'register' ? parseRegistration(input) : login.parse(input);
    requireDatabaseConfig();
    let userId: string;
    if (action === 'register') {
      const registrationData = data as z.infer<typeof registration>;
      const [business] = await db.select({ id: businesses.id }).from(businesses).limit(1);
      if (!business) throw new Error('Run database migration first');
      const [user] = await db.insert(users).values({ name: registrationData.name, email: registrationData.email, passwordHash: await hashPassword(data.password), businessId: business.id, role: 'customer' })
        .onConflictDoNothing({ target: users.email }).returning({ id: users.id });
      if (!user) throw new HttpError(409, 'Email sudah terdaftar');
      userId = user.id;
    } else {
      // Serialize attempts per normalized account across processes, including concurrent requests.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [data.email]);
        const failures = await client.query("SELECT count(*)::int AS count FROM login_attempts WHERE email = $1 AND attempted_at > now() - interval '15 minutes'", [data.email]);
        if (failures.rows[0].count >= 5) {
          await client.query('COMMIT');
          throw new HttpError(429, 'Terlalu banyak percobaan. Coba lagi nanti.');
        }
        const result = await client.query('SELECT id, password_hash FROM users WHERE email = $1', [data.email]);
        const user = result.rows[0];
        // Unknown accounts incur the same scrypt cost as known accounts.
        const valid = await verifyPassword(data.password, user?.password_hash ?? `scrypt:${'0'.repeat(32)}:${'0'.repeat(128)}`);
        if (!user || !valid) {
          await client.query('INSERT INTO login_attempts(email) VALUES ($1)', [data.email]);
          await client.query('COMMIT');
          throw new HttpError(401, 'Email atau kata sandi salah');
        }
        await client.query('DELETE FROM login_attempts WHERE email = $1', [data.email]);
        await client.query('COMMIT');
        userId = user.id;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    }
    const token = await newSession(userId);
    return Response.json({ ok: true }, { status: action === 'register' ? 201 : 200, headers: { 'Set-Cookie': cookie(token) } });
  });
}
