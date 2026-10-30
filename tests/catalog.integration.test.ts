import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { assertIsolatedTestDatabase } from './helpers/database-safety';

const url = process.env.TEST_DATABASE_URL;
assertIsolatedTestDatabase(url, process.env.DATABASE_URL);
if (!url) console.warn('BLOCKED: TEST_DATABASE_URL is absent; PostgreSQL catalog integration tests cannot run.');

describe.skipIf(!url)('persisted catalog (isolated PostgreSQL)', () => {
  let pool: Pool;
  let database: typeof import('@/db');
  let catalog: typeof import('@/server/catalog');
  let availability: typeof import('@/server/availability');
  const admin = { id: crypto.randomUUID(), role: 'admin' as const };
  const customer = { id: crypto.randomUUID(), role: 'customer' as const };
  let staffId: string;
  let serviceId: string;
  const email = `catalog-${crypto.randomUUID()}@example.com`;
  const request = (method: string, body?: unknown, query = '') => new Request(`http://localhost:3000/api/catalog${query}`, {
    method, headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    pool = new Pool({ connectionString: url });
    await (await import('@/db/migrate')).migrate(pool);
    database = await import('@/db');
    catalog = await import('@/server/catalog');
    availability = await import('@/server/availability');
  });
  afterAll(async () => {
    if (pool) {
      try {
        if (staffId) await pool.query('DELETE FROM users WHERE id = $1', [staffId]);
        if (serviceId) await pool.query('DELETE FROM services WHERE id = $1', [serviceId]);
      } finally { await pool.end(); }
    }
    if (database) await database.pool.end();
  });
  it('blocks customer mutations and forged privileged staff attributes', async () => {
    expect((await catalog.handleCatalog('services', request('POST', { name: 'Test', price: 0, durationMinutes: 30 }), customer)).status).toBe(403);
    expect((await catalog.handleCatalog('staff', request('POST', { name: 'Test', email, password: 'password-valid-123', role: 'admin' }), admin)).status).toBe(400);
  });
  it('creates staff using scrypt with a fixed role and no password in response', async () => {
    const response = await catalog.handleCatalog('staff', request('POST', { name: 'Staf demo pengujian', email, password: 'password-valid-123' }), admin);
    expect(response.status).toBe(201);
    const body = await response.json();
    staffId = body.id;
    expect(body).not.toHaveProperty('passwordHash');
    const result = await pool.query('SELECT role, password_hash FROM users WHERE id = $1', [staffId]);
    expect(result.rows[0].role).toBe('staff');
    expect(await (await import('@/server/auth')).verifyPassword('password-valid-123', result.rows[0].password_hash)).toBe(true);
  });
  it('creates service, assigns eligible staff and replaces weekly hours', async () => {
    const response = await catalog.handleCatalog('services', request('POST', { name: 'x'.repeat(120), price: 50000, durationMinutes: 30 }), admin);
    expect(response.status).toBe(201);
    serviceId = (await response.json()).id;
    expect((await catalog.handleCatalog('services', request('POST', { name: 'x'.repeat(120), price: 1, durationMinutes: 15 }), admin)).status).toBe(409);
    expect((await catalog.handleCatalog('staff', request('PATCH', { id: staffId, serviceIds: [serviceId] }), admin)).status).toBe(200);
    expect((await catalog.handleCatalog('working-hours', request('POST', { staffId, hours: [{ weekday: 1, start: '09:00', end: '10:00' }] }), admin)).status).toBe(200);
    const staff = await (await catalog.handleCatalog('staff', request('GET', undefined, `?serviceId=${serviceId}`), customer)).json();
    expect(staff.map((row: { id: string }) => row.id)).toContain(staffId);
    const slots = await availability.getSlots({ staffId, serviceId, date: '2026-11-02' }, new Date('2026-11-01T00:00:00Z'));
    expect(slots).toHaveLength(3);
    expect(await availability.getSlots({ staffId, serviceId, date: '2026-11-02' }, new Date('2026-11-03T00:00:00Z'))).toEqual([]);
  });
  it('returns 409 for duplicate rename and preserves the original service', async () => {
    const name = `rename-${crypto.randomUUID()}`;
    const created = await catalog.handleCatalog('services', request('POST', { name, price: 1, durationMinutes: 15 }), admin);
    expect(created.status).toBe(201);
    const otherId = (await created.json()).id;
    try {
      const response = await catalog.handleCatalog('services', request('PATCH', { id: otherId, name: 'x'.repeat(120) }), admin);
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: 'Nama layanan sudah digunakan' });
      expect((await pool.query('SELECT name FROM services WHERE id = $1', [otherId])).rows[0].name).toBe(name);
    } finally { await pool.query('DELETE FROM services WHERE id = $1', [otherId]); }
  });
  it('rejects assigning non-staff users and overlapping hours, preserves hours on failure', async () => {
    const [business] = (await pool.query('SELECT id FROM businesses LIMIT 1')).rows;
    await pool.query("INSERT INTO users(id, business_id, name, email, password_hash, role) VALUES ($1,$2,'Test',$3,'unused','customer')", [customer.id, business.id, `customer-${email}`]);
    try {
      expect((await catalog.handleCatalog('staff', request('PATCH', { id: customer.id, serviceIds: [serviceId] }), admin)).status).toBe(400);
      expect((await catalog.handleCatalog('working-hours', request('POST', { staffId: customer.id, hours: [] }), admin)).status).toBe(400);
    } finally { await pool.query('DELETE FROM users WHERE id = $1', [customer.id]); }
    expect((await catalog.handleCatalog('working-hours', request('POST', { staffId, hours: [{ weekday: 1, start: '09:00', end: '11:00' }, { weekday: 1, start: '10:00', end: '12:00' }] }), admin)).status).toBe(400);
    expect((await pool.query('SELECT * FROM working_hours WHERE staff_id = $1', [staffId])).rows).toHaveLength(1);
  });
  it('rejects inactive or unassigned service/staff and hides them from customers', async () => {
    await catalog.handleCatalog('staff', request('PATCH', { id: staffId, serviceIds: [] }), admin);
    await expect(availability.getSlots({ staffId, serviceId, date: '2026-11-02' }, new Date())).rejects.toMatchObject({ status: 400 });
    await catalog.handleCatalog('staff', request('PATCH', { id: staffId, serviceIds: [serviceId], active: false }), admin);
    await expect(availability.getSlots({ staffId, serviceId, date: '2026-11-02' }, new Date())).rejects.toMatchObject({ status: 400 });
    await catalog.handleCatalog('staff', request('PATCH', { id: staffId, active: true }), admin);
    await catalog.handleCatalog('services', request('PATCH', { id: serviceId, active: false }), admin);
    await expect(availability.getSlots({ staffId, serviceId, date: '2026-11-02' }, new Date())).rejects.toMatchObject({ status: 400 });
    const list = await (await catalog.handleCatalog('services', request('GET'), customer)).json();
    expect(list.map((row: { id: string }) => row.id)).not.toContain(serviceId);
  });
});
