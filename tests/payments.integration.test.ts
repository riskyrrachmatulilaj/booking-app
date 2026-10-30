import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { assertIsolatedTestDatabase } from './helpers/database-safety';
const url = process.env.TEST_DATABASE_URL;
assertIsolatedTestDatabase(url, process.env.DATABASE_URL);
if (!url) console.warn('BLOCKED: TEST_DATABASE_URL is absent; PostgreSQL payment/calendar integration tests cannot run.');
describe.skipIf(!url)('mock payments and export (isolated PostgreSQL)', () => {
  let pool: Pool;
  let database: typeof import('@/db');
  let payments: typeof import('@/server/payments');
  let appointments: typeof import('@/server/appointments');
  let calendar: typeof import('@/server/calendar');
  const customer = { id: crypto.randomUUID(), role: 'customer' as const };
  const other = { id: crypto.randomUUID(), role: 'customer' as const };
  const staff = { id: crypto.randomUUID(), role: 'staff' as const };
  const admin = { id: crypto.randomUUID(), role: 'admin' as const };
  const serviceId = crypto.randomUUID();
  const now = new Date('2026-11-01T00:00:00Z');
  let counter = 0;
  async function create(status = 'confirmed') {
    const start = new Date(Date.UTC(2026, 10, 2 + counter++, 2));
    const result = await pool.query(`INSERT INTO appointments(customer_id,staff_id,service_id,starts_at,ends_at,price,duration_minutes,status)
      VALUES ($1,$2,$3,$4,$5,50000,30,$6) RETURNING id`, [customer.id, staff.id, serviceId, start, new Date(+start + 1800000), status]);
    return appointments.getAppointment(customer, result.rows[0].id);
  }
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    pool = new Pool({ connectionString: url });
    await (await import('@/db/migrate')).migrate(pool);
    database = await import('@/db');
    payments = await import('@/server/payments');
    appointments = await import('@/server/appointments');
    calendar = await import('@/server/calendar');
    const business = (await pool.query('SELECT id FROM businesses LIMIT 1')).rows[0];
    for (const actor of [customer, other, staff, admin]) await pool.query("INSERT INTO users(id,business_id,name,email,password_hash,role) VALUES ($1,$2,'Payment test',$3,'unused',$4)", [actor.id, business.id, `${actor.id}@example.com`, actor.role]);
    await pool.query('INSERT INTO services(id,business_id,name,price,duration_minutes) VALUES ($1,$2,$3,50000,30)', [serviceId, business.id, serviceId]);
  });
  afterAll(async () => {
    if (pool) {
      try {
        await pool.query('DELETE FROM payments WHERE appointment_id IN (SELECT id FROM appointments WHERE service_id=$1)', [serviceId]);
        await pool.query('DELETE FROM appointments WHERE service_id=$1', [serviceId]);
        await pool.query('DELETE FROM services WHERE id=$1', [serviceId]);
        await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [[customer.id, other.id, staff.id, admin.id]]);
      } finally { await pool.end(); }
    }
    if (database) await database.pool.end();
  });
  it('serializes repeated/concurrent mock pay, copies rupiah amount and enforces database uniqueness', async () => {
    const row = await create();
    const results = await Promise.all([payments.payMock(customer, row.id, () => now), payments.payMock(admin, row.id, () => now)]);
    expect(results[0]).toMatchObject({ id: results[1].id, amount: 50000, status: 'paid', simulated: true });
    expect(await payments.payMock(customer, row.id, () => now)).toEqual(results[0]);
    expect((await pool.query('SELECT id FROM payments WHERE appointment_id=$1', [row.id])).rows).toHaveLength(1);
    await expect(pool.query('INSERT INTO payments(appointment_id,amount) VALUES ($1,50000)', [row.id])).rejects.toMatchObject({ code: '23505' });
  });
  it('rejects staff, non-owner, terminal and past payments', async () => {
    const row = await create();
    await expect(payments.payMock(staff, row.id, () => now)).rejects.toMatchObject({ status: 403 });
    await expect(payments.payMock(other, row.id, () => now)).rejects.toMatchObject({ status: 404 });
    await expect(payments.payMock(customer, row.id, () => row.startsAt)).rejects.toMatchObject({ status: 409 });
    for (const status of ['cancelled', 'completed']) {
      const terminal = await create(status);
      await expect(payments.payMock(customer, terminal.id, () => now)).rejects.toMatchObject({ status: 409 });
    }
  });
  it('refunds inside cancellation transaction and increments calendar sequence', async () => {
    const row = await create();
    await payments.payMock(customer, row.id, () => now);
    const cancelled = await appointments.cancelAppointment(customer, row.id, () => now);
    expect(cancelled).toMatchObject({ calendarUid: row.calendarUid, sequence: 1 });
    expect((await pool.query('SELECT status FROM payments WHERE appointment_id=$1', [row.id])).rows[0].status).toBe('refunded');
    const snapshot = calendar.toIcs(cancelled);
    expect(snapshot).not.toMatch(/^METHOD:/m);
    expect(snapshot).toContain('STATUS:CANCELLED');
    expect(snapshot).toContain('SEQUENCE:1');
    expect(snapshot).toContain(`UID:${row.calendarUid}`);
    await expect(payments.payMock(customer, row.id, () => now)).rejects.toMatchObject({ status: 409 });
  });
  it('rolls back cancellation if refund fails', async () => {
    const row = await create();
    await payments.payMock(customer, row.id, () => now);
    // A fixture-scoped check forces a real refund write failure without changing other fixtures.
    const constraint = `test_refund_${row.id.replaceAll('-', '')}`;
    try {
      await pool.query(`ALTER TABLE payments ADD CONSTRAINT ${constraint} CHECK (appointment_id <> '${row.id}'::uuid OR status = 'paid')`);
      await expect(appointments.cancelAppointment(customer, row.id, () => now)).rejects.toBeDefined();
      expect(await appointments.getAppointment(customer, row.id)).toMatchObject({ status: 'confirmed', sequence: 0 });
      expect((await pool.query('SELECT status FROM payments WHERE appointment_id=$1', [row.id])).rows[0].status).toBe('paid');
    } finally { await pool.query(`ALTER TABLE payments DROP CONSTRAINT IF EXISTS ${constraint}`); }
  });
  it('never leaves a cancelled appointment paid during simultaneous requests', async () => {
    for (let i = 0; i < 4; i++) {
      const row = await create();
      const results = await Promise.allSettled([payments.payMock(customer, row.id, () => now), appointments.cancelAppointment(customer, row.id, () => now)]);
      expect(results[1].status).toBe('fulfilled');
      if (results[0].status === 'rejected') expect(results[0].reason).toMatchObject({ status: 409 });
      expect((await pool.query('SELECT status FROM payments WHERE appointment_id=$1', [row.id])).rows.every((p) => p.status === 'refunded')).toBe(true);
      expect((await appointments.getAppointment(customer, row.id)).status).toBe('cancelled');
    }
  });
  it('samples payment clock only after appointment lock wait', async () => {
    const row = await create();
    const client = await pool.connect();
    let current = now;
    let pending: Promise<unknown> | undefined;
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM appointments WHERE id=$1 FOR UPDATE', [row.id]);
      const blocker = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      pending = payments.payMock(customer, row.id, () => current).then((value) => ({ value }), (error: unknown) => ({ error }));
      const deadline = Date.now() + 3000;
      let blocked = false;
      while (Date.now() < deadline) {
        if ((await pool.query('SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid)) AND datname=current_database()', [blocker])).rowCount) { blocked = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      current = row.startsAt;
      await client.query('COMMIT');
      expect(await pending).toMatchObject({ error: { status: 409 } });
      expect((await pool.query('SELECT id FROM payments WHERE appointment_id=$1', [row.id])).rows).toEqual([]);
    } finally { await client.query('ROLLBACK'); client.release(); if (pending) await pending; }
  });
  it('protects export ownership, sends safe private download and checks mutation origin', async () => {
    const row = await create();
    const request = new Request('http://localhost:3000/api/calendar');
    expect((await calendar.handleCalendar(request, row.id, other)).status).toBe(404);
    for (const actor of [customer, staff, admin]) {
      const response = await calendar.handleCalendar(request, row.id, actor);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/calendar');
      expect(response.headers.get('content-disposition')).toBe(`attachment; filename="appointment-${row.id}.ics"`);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(await response.text()).toContain(`UID:${row.calendarUid}`);
    }
    expect((await payments.handlePayment(new Request(request.url, { method: 'POST', headers: { origin: 'https://evil.example' } }), row.id, customer)).status).toBe(403);
  });
});
