import 'dotenv/config';
import { Pool } from 'pg';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

export async function migrate(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(728301)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY);
      `);
    const applied = await client.query('SELECT version FROM schema_migrations WHERE version = 1');
    if (!applied.rowCount) {
      await client.query(`
        CREATE TYPE role AS ENUM ('admin', 'staff', 'customer');
        CREATE TABLE businesses (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), singleton boolean NOT NULL DEFAULT true UNIQUE CHECK (singleton),
          name text NOT NULL, timezone text NOT NULL DEFAULT 'Asia/Jakarta'
        );
        CREATE TABLE users (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES businesses(id),
          name text NOT NULL, email text NOT NULL UNIQUE CHECK (email = lower(btrim(email))),
          password_hash text NOT NULL, role role NOT NULL DEFAULT 'customer'
        );
        CREATE INDEX users_business_idx ON users(business_id);
        CREATE TABLE sessions (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL
        );
        CREATE INDEX sessions_user_idx ON sessions(user_id);
        CREATE INDEX sessions_expiry_idx ON sessions(expires_at);
        CREATE TABLE login_attempts (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, attempted_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX login_attempts_account_time_idx ON login_attempts(email, attempted_at);
        INSERT INTO businesses(name) VALUES ('Bisnis Saya');
        INSERT INTO schema_migrations(version) VALUES (1);
      `);
    }
    const catalog = await client.query('SELECT version FROM schema_migrations WHERE version = 2');
    if (!catalog.rowCount) {
      await client.query(await readFile(new URL('./migrations/0001_catalog.sql', import.meta.url), 'utf8'));
      await client.query('INSERT INTO schema_migrations(version) VALUES (2)');
    }
    const booking = await client.query('SELECT version FROM schema_migrations WHERE version = 3');
    if (!booking.rowCount) {
      await client.query(await readFile(new URL('./migrations/0001_booking.sql', import.meta.url), 'utf8'));
      await client.query('INSERT INTO schema_migrations(version) VALUES (3)');
    }
    const payments = await client.query('SELECT version FROM schema_migrations WHERE version = 4');
    if (!payments.rowCount) {
      await client.query(await readFile(new URL('./migrations/0004_payments.sql', import.meta.url), 'utf8'));
      await client.query('INSERT INTO schema_migrations(version) VALUES (4)');
    }
    const reminders = await client.query('SELECT version FROM schema_migrations WHERE version = 5');
    if (!reminders.rowCount) {
      await client.query(await readFile(new URL('./migrations/0005_reminders.sql', import.meta.url), 'utf8'));
      await client.query('INSERT INTO schema_migrations(version) VALUES (5)');
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try { await migrate(pool); console.log('Migration complete'); } finally { await pool.end(); }
}
