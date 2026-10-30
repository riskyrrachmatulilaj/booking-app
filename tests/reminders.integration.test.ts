import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { assertIsolatedTestDatabase } from './helpers/database-safety';
const url = process.env.TEST_DATABASE_URL;
assertIsolatedTestDatabase(url, process.env.DATABASE_URL);
if (!url) console.warn('BLOCKED: TEST_DATABASE_URL is absent; safe real PostgreSQL reminder integration cannot run.');
describe.skipIf(!url)('reminders (isolated real PostgreSQL)', () => {
  let pool: Pool;
  let database: typeof import('@/db');
  let worker: typeof import('@/server/reminders');
  let booking: typeof import('@/server/appointments');
  const customer = { id: crypto.randomUUID(), role: 'customer' as const };
  const staff = crypto.randomUUID();
  const service = crypto.randomUUID();
  const now = new Date('2026-11-01T00:00:00Z');
  const phone = '+628123456789';
  let day = 2;
  async function fixture() {
    const start = new Date(Date.UTC(2026, 10, day++, 2));
    const result = await pool.query(`INSERT INTO appointments(customer_id,staff_id,service_id,starts_at,ends_at,price,duration_minutes) VALUES ($1,$2,$3,$4,$5,50000,30) RETURNING id`, [customer.id, staff, service, start, new Date(+start + 1800000)]);
    const id = result.rows[0].id;
    const reminder = await pool.query('INSERT INTO reminders(appointment_id,phone_snapshot,due_at,next_attempt_at) VALUES ($1,$2,$3,$3) RETURNING id', [id, phone, now]);
    return { id, reminderId: reminder.rows[0].id };
  }
  const read = async (id: string) => (await pool.query('SELECT * FROM reminders WHERE id=$1', [id])).rows[0];
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    pool = new Pool({ connectionString: url });
    await (await import('@/db/migrate')).migrate(pool);
    database = await import('@/db');
    worker = await import('@/server/reminders');
    booking = await import('@/server/appointments');
    const business = (await pool.query('SELECT id FROM businesses LIMIT 1')).rows[0].id;
    for (const [id, role] of [[customer.id, 'customer'], [staff, 'staff']]) await pool.query("INSERT INTO users(id,business_id,name,email,password_hash,role) VALUES ($1,$2,'Reminder test',$3,'unused',$4)", [id, business, `${id}@example.com`, role]);
    await pool.query('INSERT INTO services(id,business_id,name,price,duration_minutes) VALUES ($1,$2,$3,50000,30)', [service, business, service]);
    await pool.query('INSERT INTO staff_services(staff_id,service_id) VALUES ($1,$2)', [staff, service]);
    await pool.query(`INSERT INTO working_hours(staff_id,weekday,start,"end") SELECT $1,d,'09:00','12:00' FROM generate_series(0,6) d`, [staff]);
  });
  afterEach(async () => {
    vi.unstubAllGlobals(); vi.unstubAllEnvs();
    await pool.query('DELETE FROM reminders WHERE appointment_id IN (SELECT id FROM appointments WHERE service_id=$1)', [service]);
    await pool.query('DELETE FROM appointments WHERE service_id=$1', [service]);
  });
  afterAll(async () => {
    if (pool) {
      try {
        await pool.query('DELETE FROM staff_services WHERE service_id=$1', [service]);
        await pool.query('DELETE FROM services WHERE id=$1', [service]);
        await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [[customer.id, staff]]);
      } finally { await pool.end(); }
    }
    if (database) await database.pool.end();
  });
  async function configured() {
    for (const [key, value] of Object.entries({ WHATSAPP_ACCESS_TOKEN: 'fake', WHATSAPP_PHONE_NUMBER_ID: '123', WHATSAPP_TEMPLATE_NAME: 'reminder', WHATSAPP_TEMPLATE_LANGUAGE: 'id' })) vi.stubEnv(key, value);
    await worker.updateProfile(customer, { whatsappPhone: phone, optIn: true });
  }
  it('inserts reminder atomically with booking and rolls back booking if reminder write fails', async () => {
    await configured();
    const start = new Date(Date.UTC(2026, 10, day++, 3));
    const input = { serviceId: service, staffId: staff, start: start.toISOString() };
    const row = await booking.createAppointment(customer, input, () => now);
    const reminder = (await pool.query('SELECT * FROM reminders WHERE appointment_id=$1', [row.id])).rows[0];
    expect(reminder).toMatchObject({ phone_snapshot: phone, due_at: new Date(+start - 86400000), attempts: 0 });
    const constraint = `test_reminder_${customer.id.replaceAll('-', '')}`;
    const next = new Date(Date.UTC(2026, 10, day++, 3));
    try {
      await pool.query(`ALTER TABLE reminders ADD CONSTRAINT ${constraint} CHECK (phone_snapshot <> '${phone}') NOT VALID`);
      await expect(booking.createAppointment(customer, { ...input, start: next.toISOString() }, () => now)).rejects.toBeDefined();
      expect((await pool.query('SELECT id FROM appointments WHERE service_id=$1 AND starts_at=$2', [service, next])).rows).toHaveLength(0);
    } finally { await pool.query(`ALTER TABLE reminders DROP CONSTRAINT IF EXISTS ${constraint}`); }
  });
  it('rolls back cancellation and profile revocation if pending cancellation fails', async () => {
    await configured(); const row = await fixture();
    const constraint = `test_cancel_${customer.id.replaceAll('-', '')}`;
    try {
      await pool.query(`ALTER TABLE reminders ADD CONSTRAINT ${constraint} CHECK (id <> '${row.reminderId}'::uuid OR status='pending')`);
      await expect(booking.cancelAppointment(customer, row.id, () => now)).rejects.toBeDefined();
      expect((await pool.query('SELECT status FROM appointments WHERE id=$1', [row.id])).rows[0].status).toBe('confirmed');
      await expect(worker.updateProfile(customer, { whatsappPhone: phone, optIn: false })).rejects.toBeDefined();
      expect((await pool.query('SELECT whatsapp_opted_in_at FROM users WHERE id=$1', [customer.id])).rows[0].whatsapp_opted_in_at).not.toBeNull();
    } finally { await pool.query(`ALTER TABLE reminders DROP CONSTRAINT IF EXISTS ${constraint}`); }
  });
  it('missing provider config preserves pending and retry budget', async () => {
    vi.stubEnv('WHATSAPP_ACCESS_TOKEN', '');
    const row = await fixture();
    expect((await worker.runReminders(now, () => now)).sent).toBe(0);
    expect(await read(row.reminderId)).toMatchObject({ status: 'pending', attempts: 0, lease_token: null });
  });
  it('concurrent workers claim once and retain message ID', async () => {
    await configured(); const row = await fixture(); let calls = 0;
    vi.stubGlobal('fetch', async () => { calls++; return Response.json({ messages: [{ id: 'wamid.test' }] }); });
    await Promise.all([worker.runReminders(now, () => now), worker.runReminders(now, () => now)]);
    expect(calls).toBe(1);
    expect(await read(row.reminderId)).toMatchObject({ status: 'sent', attempts: 1, provider_message_id: 'wamid.test' });
  });
  it('recovers a lease that expires between claim and preflight without terminal cancellation', async () => {
    await configured(); const row = await fixture();
    const name = `expire_${row.reminderId.replaceAll('-', '')}`;
    try {
      await pool.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.id='${row.reminderId}'::uuid AND OLD.lease_token IS NULL AND NEW.lease_token IS NOT NULL THEN NEW.lease_until=clock_timestamp()-interval '1 second'; END IF;
        RETURN NEW; END $$`);
      await pool.query(`CREATE TRIGGER ${name} BEFORE UPDATE ON reminders FOR EACH ROW EXECUTE FUNCTION ${name}()`);
      let calls = 0; vi.stubGlobal('fetch', async () => { calls++; return Response.json({ messages: [{ id: 'recovered' }] }); });
      await worker.runReminders(now, () => now);
      expect(calls).toBe(0);
      expect(await read(row.reminderId)).toMatchObject({ status: 'pending', attempts: 0 });
      await pool.query(`DROP TRIGGER ${name} ON reminders`);
      await worker.runReminders(now, () => now);
      expect(calls).toBe(1);
      expect(await read(row.reminderId)).toMatchObject({ status: 'sent', attempts: 1 });
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${name} ON reminders`);
      await pool.query(`DROP FUNCTION IF EXISTS ${name}()`);
    }
  });
  it('samples live eligibility after claim and backs off from provider completion', async () => {
    await configured(); const expired = await fixture();
    const start = (await pool.query('SELECT starts_at FROM appointments WHERE id=$1', [expired.id])).rows[0].starts_at;
    let calls = 0; vi.stubGlobal('fetch', async () => { calls++; return new Response('', { status: 500 }); });
    await worker.runReminders(now, () => start);
    expect(calls).toBe(0);
    expect((await read(expired.reminderId)).status).toBe('cancelled');
    const delayed = await fixture(); let live = now;
    vi.stubGlobal('fetch', async () => { live = new Date(+now + 90000); return new Response('', { status: 500 }); });
    await worker.runReminders(now, () => live);
    expect(await read(delayed.reminderId)).toMatchObject({ status: 'pending', attempts: 1, next_attempt_at: new Date(+live + 60000) });
  });
  it('does not steal live leases and terminalizes an expired third attempt', async () => {
    await configured(); const live = await fixture(); const exhausted = await fixture();
    await pool.query("UPDATE reminders SET lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '1 hour' WHERE id=$1", [live.reminderId]);
    await pool.query('UPDATE reminders SET attempts=3,lease_token=gen_random_uuid(),lease_until=$2 WHERE id=$1', [exhausted.reminderId, new Date(0)]);
    let calls = 0; vi.stubGlobal('fetch', async () => { calls++; return Response.json({ messages: [{ id: 'wrong' }] }); });
    await worker.runReminders(now, () => now);
    expect(calls).toBe(0);
    expect(await read(live.reminderId)).toMatchObject({ status: 'pending', attempts: 0 });
    expect(await read(exhausted.reminderId)).toMatchObject({ status: 'failed', attempts: 3 });
  });
  it('recovers expired leases, but never exceeds three reserved attempts', async () => {
    await configured(); const row = await fixture();
    await pool.query("UPDATE reminders SET lease_token=gen_random_uuid(),lease_until=$2,attempts=1 WHERE id=$1", [row.reminderId, new Date(0)]);
    vi.stubGlobal('fetch', async () => Response.json({ messages: [{ id: 'recovered' }] }));
    await worker.runReminders(now, () => now);
    expect(await read(row.reminderId)).toMatchObject({ status: 'sent', attempts: 2 });
  });
  it('backs off provider failures and terminates third attempt without false sent', async () => {
    await configured(); const row = await fixture();
    vi.stubGlobal('fetch', async () => new Response('secret detail', { status: 500 }));
    await worker.runReminders(now, () => now);
    expect(await read(row.reminderId)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'provider_http_500' });
    await worker.runReminders(new Date(+now + 60000), () => new Date(+now + 60000));
    await worker.runReminders(new Date(+now + 360000), () => new Date(+now + 360000));
    expect(await read(row.reminderId)).toMatchObject({ status: 'failed', attempts: 3, provider_message_id: null });
  });
  it('cancellation, revoked consent and changed phone suppress pending sends', async () => {
    await configured(); const cancelled = await fixture();
    await booking.cancelAppointment(customer, cancelled.id, () => now);
    expect((await read(cancelled.reminderId)).status).toBe('cancelled');
    const revoked = await fixture(); await worker.updateProfile(customer, { whatsappPhone: phone, optIn: false });
    expect((await read(revoked.reminderId)).status).toBe('cancelled');
    await configured(); const changed = await fixture();
    await worker.updateProfile(customer, { whatsappPhone: '+628987654321', optIn: true });
    expect((await read(changed.reminderId)).status).toBe('cancelled');
    vi.stubGlobal('fetch', async () => { throw new Error('must not send'); });
    expect((await worker.runReminders(now, () => now)).sent).toBe(0);
  });
  it('rechecks direct status/phone changes immediately before network', async () => {
    await configured(); const row = await fixture();
    await pool.query("UPDATE appointments SET status='cancelled' WHERE id=$1", [row.id]);
    let calls = 0; vi.stubGlobal('fetch', async () => { calls++; return Response.json({ messages: [{ id: 'wrong' }] }); });
    await worker.runReminders(now, () => now);
    expect(calls).toBe(0); expect((await read(row.reminderId)).status).toBe('cancelled');
  });
  it('releases database locks during HTTP; revocation wins finalization of in-flight sends', async () => {
    await configured(); const row = await fixture();
    let release!: () => void; let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const hold = new Promise<void>((resolve) => { release = resolve; });
    vi.stubGlobal('fetch', async () => { entered(); await hold; return Response.json({ messages: [{ id: 'inflight' }] }); });
    const running = worker.runReminders(now, () => now);
    try {
      await started;
      await worker.updateProfile(customer, { whatsappPhone: phone, optIn: false });
    } finally { release(); }
    expect((await running).sent).toBe(0);
    expect((await read(row.reminderId)).status).toBe('cancelled');
  });
});
