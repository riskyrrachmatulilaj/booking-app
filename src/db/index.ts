import 'dotenv/config';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

// The pool stays lazy so static builds and unauthenticated pages need no database connection.
export const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
export const db = drizzle(pool, { schema });
export function requireDatabaseConfig(): void {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
}
export * from './schema';
