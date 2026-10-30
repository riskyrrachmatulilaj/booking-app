import 'dotenv/config';
import { db, pool, users, businesses, services, requireDatabaseConfig } from './index';
import { hashPassword, parseRegistration } from '../server/auth';

try {
  requireDatabaseConfig();
  const data = parseRegistration({ name: 'Admin', email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD });
  const [business] = await db.select({ id: businesses.id }).from(businesses).limit(1);
  if (!business) throw new Error('Run npm run db:migrate first');
  const [created] = await db.insert(users).values({ name: data.name, email: data.email, passwordHash: await hashPassword(data.password), businessId: business.id, role: 'admin' })
    .onConflictDoNothing({ target: users.email }).returning({ id: users.id });
  if (!created) throw new Error('Admin email already exists; seed does not change roles or passwords');
  await db.insert(services).values([
    { businessId: business.id, name: '[DEMO] Konsultasi umum non-medis', price: 50000, durationMinutes: 30 },
    { businessId: business.id, name: '[DEMO] Sesi pendampingan', price: 100000, durationMinutes: 60 },
  ]).onConflictDoNothing({ target: [services.businessId, services.name] });
  console.log('Admin and labeled demo catalog created; no customer, staff, or booking data invented');
} finally { await pool.end(); }
