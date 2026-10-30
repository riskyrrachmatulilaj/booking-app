import { pgTable, pgEnum, uuid, text, timestamp, index, boolean, integer, primaryKey, uniqueIndex } from 'drizzle-orm/pg-core';

export const appointmentStatusEnum = pgEnum('appointment_status', ['confirmed', 'cancelled', 'completed']);
export const roleEnum = pgEnum('role', ['admin', 'staff', 'customer']);
export const businesses = pgTable('businesses', {
  id: uuid('id').defaultRandom().primaryKey(),
  singleton: boolean('singleton').notNull().default(true).unique(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('Asia/Jakarta'),
});
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').notNull().references(() => businesses.id),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: roleEnum('role').notNull().default('customer'),
  active: boolean('active').notNull().default(true),
  whatsappPhone: text('whatsapp_phone'),
  whatsappOptedInAt: timestamp('whatsapp_opted_in_at', { withTimezone: true }),
}, (t) => [index('users_business_idx').on(t.businessId)]);
export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (t) => [index('sessions_user_idx').on(t.userId), index('sessions_expiry_idx').on(t.expiresAt)]);
export const loginAttempts = pgTable('login_attempts', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull(),
  attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('login_attempts_account_time_idx').on(t.email, t.attemptedAt)]);
export const services = pgTable('services', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id').notNull().references(() => businesses.id),
  name: text('name').notNull(),
  price: integer('price').notNull(),
  durationMinutes: integer('duration_minutes').notNull(),
  active: boolean('active').notNull().default(true),
}, (t) => [index('services_business_idx').on(t.businessId), uniqueIndex('services_business_name_idx').on(t.businessId, t.name)]);
export const staffServices = pgTable('staff_services', {
  staffId: uuid('staff_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  serviceId: uuid('service_id').notNull().references(() => services.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.staffId, t.serviceId] }), index('staff_services_service_idx').on(t.serviceId)]);
export const appointments = pgTable('appointments', {
  id: uuid('id').defaultRandom().primaryKey(),
  customerId: uuid('customer_id').notNull().references(() => users.id),
  staffId: uuid('staff_id').notNull().references(() => users.id),
  serviceId: uuid('service_id').notNull().references(() => services.id),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  price: integer('price').notNull(),
  durationMinutes: integer('duration_minutes').notNull(),
  status: appointmentStatusEnum('status').notNull().default('confirmed'),
  sequence: integer('sequence').notNull().default(0),
  calendarUid: uuid('calendar_uid').notNull().defaultRandom().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('appointments_customer_start_idx').on(t.customerId, t.startsAt, t.id), index('appointments_staff_start_idx').on(t.staffId, t.startsAt, t.id), index('appointments_start_idx').on(t.startsAt, t.id), index('appointments_service_idx').on(t.serviceId)]);
export const paymentStatusEnum = pgEnum('payment_status', ['paid', 'refunded']);
export const payments = pgTable('payments', {
  id: uuid('id').defaultRandom().primaryKey(),
  appointmentId: uuid('appointment_id').notNull().references(() => appointments.id).unique(),
  amount: integer('amount').notNull(),
  status: paymentStatusEnum('status').notNull().default('paid'),
  simulated: boolean('simulated').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export const reminderStatusEnum = pgEnum('reminder_status', ['pending', 'sent', 'failed', 'cancelled']);
export const reminders = pgTable('reminders', {
  id: uuid('id').defaultRandom().primaryKey(),
  appointmentId: uuid('appointment_id').notNull().references(() => appointments.id, { onDelete: 'cascade' }).unique(),
  phoneSnapshot: text('phone_snapshot').notNull(),
  dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull(),
  status: reminderStatusEnum('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  leaseToken: uuid('lease_token'),
  leaseUntil: timestamp('lease_until', { withTimezone: true }),
  providerMessageId: text('provider_message_id'),
  lastError: text('last_error'),
}, (t) => [index('reminders_due_idx').on(t.status, t.nextAttemptAt, t.dueAt)]);
export const workingHours = pgTable('working_hours', {
  id: uuid('id').defaultRandom().primaryKey(),
  staffId: uuid('staff_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  weekday: integer('weekday').notNull(),
  start: text('start').notNull(),
  end: text('end').notNull(),
}, (t) => [index('working_hours_staff_day_idx').on(t.staffId, t.weekday)]);
