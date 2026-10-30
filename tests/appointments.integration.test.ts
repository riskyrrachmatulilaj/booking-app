import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { assertIsolatedTestDatabase } from './helpers/database-safety';
const url = process.env.TEST_DATABASE_URL;
assertIsolatedTestDatabase(url, process.env.DATABASE_URL);
if (!url) console.warn('BLOCKED: TEST_DATABASE_URL is absent; PostgreSQL appointment integration tests cannot run.');
describe.skipIf(!url)('transactional appointments (isolated PostgreSQL)', () => {
  let pool: Pool;
  let database: typeof import('@/db');
  let appointments: typeof import('@/server/appointments');
  let availability: typeof import('@/server/availability');
  const customer = { id: crypto.randomUUID(), role: 'customer' as const };
  const other = { id: crypto.randomUUID(), role: 'customer' as const };
  const staff = { id: crypto.randomUUID(), role: 'staff' as const };
  const staff2 = { id: crypto.randomUUID(), role: 'staff' as const };
  const serviceId = crypto.randomUUID();
  const now = new Date('2026-11-01T00:00:00Z');
  const input = (start = '2026-11-02T02:00:00Z', staffId = staff.id) => ({ serviceId, staffId, start });
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    pool = new Pool({ connectionString: url });
    await (await import('@/db/migrate')).migrate(pool);
    database = await import('@/db');
    appointments = await import('@/server/appointments');
    availability = await import('@/server/availability');
    const business = (await pool.query('SELECT id FROM businesses LIMIT 1')).rows[0];
    for (const actor of [customer, other, staff, staff2]) await pool.query("INSERT INTO users(id,business_id,name,email,password_hash,role) VALUES ($1,$2,'Booking test',$3,'unused',$4)", [actor.id, business.id, `${actor.id}@example.com`, actor.role]);
    await pool.query("INSERT INTO services(id,business_id,name,price,duration_minutes) VALUES ($1,$2,$3,50000,30)", [serviceId, business.id, serviceId]);
    for (const actor of [staff, staff2]) {
      await pool.query('INSERT INTO staff_services(staff_id,service_id) VALUES ($1,$2)', [actor.id, serviceId]);
      await pool.query("INSERT INTO working_hours(staff_id,weekday,start,\"end\") VALUES ($1,1,'09:00','12:00')", [actor.id]);
    }
  });
  afterAll(async () => {
    if (pool) {
      try {
        await pool.query('DELETE FROM appointments WHERE service_id=$1', [serviceId]);
        await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [[customer.id, other.id, staff.id, staff2.id]]);
        await pool.query('DELETE FROM services WHERE id=$1', [serviceId]);
      } finally { await pool.end(); }
    }
    if (database) await database.pool.end();
  });
  it('accepts one simultaneous identical create, other staff and adjacent intervals', async () => {
    const results = await Promise.allSettled([appointments.createAppointment(customer, input(), () => now), appointments.createAppointment(customer, input(), () => now)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
    await expect(appointments.createAppointment(customer, input('2026-11-02T02:00:00Z', staff2.id), () => now)).resolves.toMatchObject({ price: 50000, durationMinutes: 30 });
    await expect(appointments.createAppointment(customer, input('2026-11-02T02:30:00Z'), () => now)).resolves.toMatchObject({ status: 'confirmed' });
  });
  it('enforces half-open overlaps directly in PostgreSQL', async () => {
    await expect(pool.query(`INSERT INTO appointments(customer_id,staff_id,service_id,starts_at,ends_at,price,duration_minutes)
      VALUES ($1,$2,$3,'2026-11-02T02:15:00Z','2026-11-02T02:45:00Z',1,30)`, [customer.id, staff.id, serviceId]))
      .rejects.toMatchObject({ code: '23P01', constraint: 'appointments_staff_overlap' });
    await expect(pool.query(`INSERT INTO appointments(customer_id,staff_id,service_id,starts_at,ends_at,price,duration_minutes)
      VALUES ($1,$2,$3,'2026-11-02T05:00:00Z','2026-11-02T05:00:00Z',1,30)`, [customer.id, staff.id, serviceId]))
      .rejects.toMatchObject({ code: '23514' });
  });
  it('enforces ownership on detail/list/transitions and cancellation frees slots', async () => {
    const row = await appointments.createAppointment(customer, input('2026-11-02T03:00:00Z'), () => now);
    await expect(appointments.getAppointment(other, row.id)).rejects.toMatchObject({ status: 404 });
    await expect(appointments.cancelAppointment(other, row.id, () => now)).rejects.toMatchObject({ status: 404 });
    await expect(appointments.completeAppointment(customer, row.id, () => row.endsAt)).rejects.toMatchObject({ status: 403 });
    await expect(appointments.completeAppointment(staff, row.id, () => now)).rejects.toMatchObject({ status: 409 });
    await expect(appointments.cancelAppointment(customer, row.id, () => row.startsAt)).rejects.toMatchObject({ status: 409 });
    const query = { from: '2026-11-02T00:00:00Z', to: '2026-11-03T00:00:00Z' };
    expect((await appointments.listAppointments(other, query)).items).toEqual([]);
    expect((await appointments.listAppointments(staff2, query)).items.every((r) => r.staffId === staff2.id)).toBe(true);
    expect((await availability.getSlots({ serviceId, staffId: staff.id, date: '2026-11-02' }, now)).some((s) => s.start === row.startsAt.toISOString())).toBe(false);
    const cancelled = await appointments.cancelAppointment(customer, row.id, () => now);
    expect(cancelled.sequence).toBe(1);
    expect((await availability.getSlots({ serviceId, staffId: staff.id, date: '2026-11-02' }, now)).some((s) => s.start === row.startsAt.toISOString())).toBe(true);
    await appointments.createAppointment(customer, input('2026-11-02T03:00:00Z'), () => now);
  });
  async function waitForBlockedQuery(blocker: number): Promise<string> {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const result = await pool.query('SELECT query FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid)) AND datname = current_database()', [blocker]);
      if (result.rows.length) return result.rows[0].query;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Expected operation to reach PostgreSQL lock wait');
  }
  it.each(['staff', 'assignment', 'hours', 'service', 'business'] as const)('serializes real catalog %s writes before target mutation', async (branch) => {
    const { handleCatalog } = await import('@/server/catalog');
    const admin = { id: crypto.randomUUID(), role: 'admin' as const };
    const client = await pool.connect();
    const business = (await pool.query('SELECT id,name,timezone FROM businesses LIMIT 1')).rows[0];
    const snapshot = async () => ({
      business: (await pool.query('SELECT name,timezone FROM businesses WHERE id=$1', [business.id])).rows,
      staff: (await pool.query('SELECT name,active FROM users WHERE id=$1', [staff2.id])).rows,
      service: (await pool.query('SELECT price FROM services WHERE id=$1', [serviceId])).rows,
      assignments: (await pool.query('SELECT service_id FROM staff_services WHERE staff_id=$1 ORDER BY service_id', [staff2.id])).rows,
      hours: (await pool.query('SELECT weekday,start,"end" FROM working_hours WHERE staff_id=$1 ORDER BY weekday,start', [staff2.id])).rows,
    });
    const resource = branch === 'hours' ? 'working-hours' : branch === 'assignment' ? 'staff' : branch === 'service' ? 'services' : branch;
    const body = branch === 'staff' ? { id: staff2.id, active: false } : branch === 'assignment' ? { id: staff2.id, serviceIds: [] } : branch === 'hours' ? { staffId: staff2.id, hours: [] } : branch === 'service' ? { id: serviceId, price: 50001 } : { name: 'Catalog contention test', timezone: business.timezone };
    let pending: Promise<Response> | undefined;
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE', [business.id]);
      const blocker = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const before = await snapshot();
      pending = handleCatalog(resource, new Request('http://localhost:3000/api/catalog', { method: 'PATCH', headers: { origin: 'http://localhost:3000' }, body: JSON.stringify(body) }), admin);
      const query = await waitForBlockedQuery(blocker);
      // Even business UPDATE blocks naturally; require the shared pre-write SELECT lock itself.
      expect(query.toLowerCase()).toMatch(/^select .*"businesses".*for update/);
      expect(await snapshot()).toEqual(before);
      await client.query('COMMIT');
      expect((await pending).status).toBe(200);
      expect(await snapshot()).not.toEqual(before);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      if (pending) await pending;
      await pool.query('UPDATE businesses SET name=$1,timezone=$2 WHERE id=$3', [business.name, business.timezone, business.id]);
      await pool.query('UPDATE users SET active=true WHERE id=$1', [staff2.id]);
      await pool.query('UPDATE services SET price=50000 WHERE id=$1', [serviceId]);
      await pool.query('INSERT INTO staff_services(staff_id,service_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [staff2.id, serviceId]);
      if (branch === 'hours') await pool.query("INSERT INTO working_hours(staff_id,weekday,start,\"end\") VALUES ($1,1,'09:00','12:00')", [staff2.id]);
    }
  });
  it.each(['staff', 'hours'] as const)('revalidates committed %s eligibility after waiting for the real catalog writer', async (branch) => {
    const { handleCatalog } = await import('@/server/catalog');
    const admin = { id: crypto.randomUUID(), role: 'admin' as const };
    const client = await pool.connect();
    const start = '2026-11-02T04:00:00Z';
    let writer: Promise<Response> | undefined;
    let booking: Promise<unknown> | undefined;
    try {
      // Pause the real writer at its staff lock, after it owns the business lock.
      await client.query('BEGIN');
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [staff2.id]);
      const blocker = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      expect((await availability.getSlots({ serviceId, staffId: staff2.id, date: '2026-11-02' }, now)).some((slot) => slot.start === new Date(start).toISOString())).toBe(true);
      const resource = branch === 'staff' ? 'staff' : 'working-hours';
      const body = branch === 'staff' ? { id: staff2.id, active: false } : { staffId: staff2.id, hours: [] };
      writer = handleCatalog(resource, new Request('http://localhost:3000/api/catalog', { method: 'PATCH', headers: { origin: 'http://localhost:3000' }, body: JSON.stringify(body) }), admin);
      const writerQuery = await waitForBlockedQuery(blocker);
      expect(writerQuery.toLowerCase()).toMatch(/^select .*"users".*for update/);
      const waiting = await pool.query('SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid)) AND datname = current_database()', [blocker]);
      expect(waiting.rows).toHaveLength(1);
      const writerPid = waiting.rows[0].pid;
      booking = appointments.createAppointment(customer, input(start, staff2.id), () => now)
        .then((value) => ({ value }), (error: unknown) => ({ error }));
      // Do not release the writer until creation actually waits on its business lock.
      const bookingQuery = await waitForBlockedQuery(writerPid);
      expect(bookingQuery.toLowerCase()).toMatch(/^select .*"businesses".*for update/);
      await client.query('COMMIT');
      expect((await writer).status).toBe(200);
      expect(await booking).toMatchObject({ error: { status: 400 } });
      expect((await pool.query('SELECT id FROM appointments WHERE staff_id=$1 AND starts_at=$2', [staff2.id, start])).rows).toEqual([]);
      if (branch === 'staff') expect((await pool.query('SELECT active FROM users WHERE id=$1', [staff2.id])).rows[0].active).toBe(false);
      else expect((await pool.query('SELECT id FROM working_hours WHERE staff_id=$1', [staff2.id])).rows).toEqual([]);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      if (writer) await writer;
      if (booking) await booking;
      await pool.query('DELETE FROM appointments WHERE staff_id=$1 AND starts_at=$2', [staff2.id, start]);
      await pool.query('UPDATE users SET active=true WHERE id=$1', [staff2.id]);
      if (branch === 'hours') {
        await pool.query('DELETE FROM working_hours WHERE staff_id=$1', [staff2.id]);
        await pool.query("INSERT INTO working_hours(staff_id,weekday,start,\"end\") VALUES ($1,1,'09:00','12:00')", [staff2.id]);
      }
    }
  });
  it.each(['create', 'cancel', 'complete'] as const)('samples fresh time after real %s lock waits', async (action) => {
    const start = '2026-11-02T04:00:00Z';
    const row = action === 'create' ? undefined : await appointments.createAppointment(customer, input(start, staff2.id), () => now);
    const client = await pool.connect();
    let current = new Date('2026-11-02T03:59:59Z');
    let pending: Promise<unknown> | undefined;
    try {
      await client.query('BEGIN');
      if (row) await client.query('SELECT id FROM appointments WHERE id=$1 FOR UPDATE', [row.id]);
      else await client.query('SELECT id FROM businesses FOR UPDATE');
      const blocker = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const operation = action === 'create' ? appointments.createAppointment(customer, input(start, staff2.id), () => current)
        : action === 'cancel' ? appointments.cancelAppointment(customer, row!.id, () => current) : appointments.completeAppointment(staff2, row!.id, () => current);
      pending = operation.then((value) => ({ value }), (error: unknown) => ({ error }));
      await waitForBlockedQuery(blocker);
      current = new Date(action === 'complete' ? '2026-11-02T04:30:00Z' : '2026-11-02T04:00:01Z');
      await client.query('COMMIT');
      expect(await pending).toMatchObject(action === 'complete' ? { value: { status: 'completed', updatedAt: current } } : { error: { status: action === 'create' ? 400 : 409 } });
    } finally {
      await client.query('ROLLBACK'); client.release();
      if (pending) await pending;
      if (row) await pool.query('DELETE FROM appointments WHERE id=$1', [row.id]);
    }
  });
  it('serializes concurrent cancellation and completion with one terminal result', async () => {
    const row = await appointments.createAppointment(customer, input('2026-11-02T04:30:00Z'), () => now);
    const results = await Promise.allSettled([
      appointments.cancelAppointment(customer, row.id, () => now),
      appointments.completeAppointment(staff, row.id, () => row.endsAt),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
    expect((await appointments.getAppointment(customer, row.id)).sequence).toBe(1);
  });
  it('serializes transitions with payment-ready row locks', async () => {
    const row = await appointments.createAppointment(customer, input('2026-11-02T03:30:00Z'), () => now);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM appointments WHERE id=$1 FOR UPDATE', [row.id]);
      const blocker = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const pending = appointments.cancelAppointment(customer, row.id, () => now);
      await waitForBlockedQuery(blocker);
      await client.query('COMMIT');
      expect((await pending).status).toBe('cancelled');
    } finally { await client.query('ROLLBACK'); client.release(); }
  });
  it('rejects inactive, unassigned, off-grid, invalid-offset and past starts', async () => {
    for (const start of ['2026-11-02T04:01:00Z', '2026-11-02T04:00:00', '2026-11-02T04:00:00+25:00']) await expect(appointments.createAppointment(customer, input(start), () => now)).rejects.toBeDefined();
    await expect(appointments.createAppointment(customer, input('2026-11-02T04:00:00Z'), () => new Date('2026-11-03T00:00:00Z'))).rejects.toMatchObject({ status: 400 });
    await pool.query('UPDATE services SET active=false WHERE id=$1', [serviceId]);
    await expect(appointments.createAppointment(customer, input('2026-11-02T04:00:00Z'), () => now)).rejects.toMatchObject({ status: 400 });
    await pool.query('UPDATE services SET active=true WHERE id=$1', [serviceId]);
    await pool.query('UPDATE users SET active=false WHERE id=$1', [staff.id]);
    await expect(appointments.createAppointment(customer, input('2026-11-02T04:00:00Z'), () => now)).rejects.toMatchObject({ status: 400 });
    await pool.query('UPDATE users SET active=true WHERE id=$1', [staff.id]);
    await pool.query('DELETE FROM staff_services WHERE staff_id=$1', [staff.id]);
    await expect(appointments.createAppointment(customer, input('2026-11-02T04:00:00Z'), () => now)).rejects.toMatchObject({ status: 400 });
    await pool.query('INSERT INTO staff_services(staff_id,service_id) VALUES ($1,$2)', [staff.id, serviceId]);
  });
  it('preserves copied price, duration and UTC instants after catalog edits', async () => {
    const row = await appointments.createAppointment(customer, input('2026-11-02T04:00:00Z'), () => now);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("UPDATE businesses SET timezone='UTC'");
      await client.query("UPDATE working_hours SET start='10:00' WHERE staff_id=$1", [staff.id]);
      await client.query('UPDATE services SET price=1,duration_minutes=15 WHERE id=$1', [serviceId]);
      const persisted = (await client.query('SELECT * FROM appointments WHERE id=$1', [row.id])).rows[0];
      expect(persisted.starts_at.toISOString()).toBe(row.startsAt.toISOString());
      expect(persisted.price).toBe(50000);
      expect(persisted.duration_minutes).toBe(30);
    } finally { await client.query('ROLLBACK'); client.release(); }
    expect((await appointments.completeAppointment(staff, row.id, () => row.endsAt)).status).toBe('completed');
  });
});
