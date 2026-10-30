import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { pool, requireDatabaseConfig } from '@/db';
import { type Actor, requireActor } from './auth';
import { apiResponse, assertOrigin, HttpError } from './http';

const e164 = z.string().regex(/^\+[1-9]\d{7,14}$/);
const profileInput = z.object({ whatsappPhone: e164.nullable(), optIn: z.boolean() }).strict().refine((value) => !value.optIn || value.whatsappPhone !== null, 'Nomor WhatsApp diperlukan');
export const parseProfile = (input: unknown) => profileInput.parse(input);
export function planReminder(customer: { whatsappPhone: string | null; whatsappOptedInAt: Date | null }, start: Date, now: Date) {
  if (!customer.whatsappOptedInAt || !e164.safeParse(customer.whatsappPhone).success || +start - +now < 86400000) return null;
  return { phoneSnapshot: customer.whatsappPhone!, dueAt: new Date(+start - 86400000) };
}
type ProviderConfig = { token: string; phoneId: string; template: string; language: string };
export function providerConfig(): ProviderConfig | null {
  const { WHATSAPP_ACCESS_TOKEN: token, WHATSAPP_PHONE_NUMBER_ID: phoneId, WHATSAPP_TEMPLATE_NAME: template, WHATSAPP_TEMPLATE_LANGUAGE: language } = process.env;
  return token?.trim() && phoneId && /^\d+$/.test(phoneId) && template?.trim() && language?.trim() ? { token, phoneId, template, language } : null;
}
export async function sendWhatsApp(config: ProviderConfig, phone: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`https://graph.facebook.com/v22.0/${config.phoneId}/messages`, {
      method: 'POST', headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: phone, type: 'template', template: { name: config.template, language: { code: config.language } } }),
      signal: AbortSignal.timeout(10000), redirect: 'error',
    });
  } catch { throw new Error('provider_network_or_timeout'); }
  if (!response.ok) throw new Error(`provider_http_${response.status}`);
  let body: unknown;
  try { body = await response.json(); } catch { throw new Error('provider_missing_message_id'); }
  const parsed = z.object({ messages: z.array(z.object({ id: z.string().min(1).max(1024) })).min(1) }).safeParse(body);
  if (!parsed.success) throw new Error('provider_missing_message_id');
  return parsed.data.messages[0].id;
}
export function retryResult(attempts: number, now: Date) {
  return { status: attempts >= 3 ? 'failed' as const : 'pending' as const, nextAttemptAt: new Date(+now + (attempts >= 3 ? 0 : attempts === 1 ? 60000 : 300000)) };
}
export async function updateProfile(actor: Actor, input: unknown) {
  const data = parseProfile(input);
  requireDatabaseConfig();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const previous = (await client.query('SELECT whatsapp_phone,whatsapp_opted_in_at FROM users WHERE id=$1 AND active FOR UPDATE', [actor.id])).rows[0];
    if (!previous) throw new HttpError(403, 'Akses ditolak');
    // Preserve the original consent time for unchanged consent; a new number needs fresh explicit consent.
    const consent = data.optIn ? previous.whatsapp_phone === data.whatsappPhone && previous.whatsapp_opted_in_at ? previous.whatsapp_opted_in_at : new Date() : null;
    const result = await client.query('UPDATE users SET whatsapp_phone=$2,whatsapp_opted_in_at=$3 WHERE id=$1 RETURNING whatsapp_phone AS "whatsappPhone",whatsapp_opted_in_at AS "whatsappOptedInAt"', [actor.id, data.whatsappPhone, consent]);
    if (!data.optIn || previous.whatsapp_phone !== data.whatsappPhone) await client.query(`UPDATE reminders SET status='cancelled',lease_token=NULL,lease_until=NULL WHERE status='pending' AND appointment_id IN (SELECT id FROM appointments WHERE customer_id=$1)`, [actor.id]);
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
export type ReminderClock = () => Date;
type PreflightRow = { leaseToken: string | null; leaseUntil: Date | null; status: string; appointmentStatus: string; startsAt: Date; active: boolean; optedIn: boolean; phone: string | null; phoneSnapshot: string };
export function reminderPreflight(row: PreflightRow, token: string, now: Date, leaseNow: Date = now): 'skip' | 'cancel' | 'send' {
  if (row.status !== 'pending' || row.leaseToken !== token || !row.leaseUntil || row.leaseUntil <= leaseNow) return 'skip';
  return row.appointmentStatus === 'confirmed' && row.startsAt > now && row.active && row.optedIn && row.phone === row.phoneSnapshot ? 'send' : 'cancel';
}
export async function runReminders(now: Date, clock: ReminderClock = () => new Date()): Promise<{ sent: number; failed: number; pending: number }> {
  requireDatabaseConfig();
  const config = providerConfig();
  let sent = 0; let failed = 0;
  if (config) {
    const exhausted = await pool.query(`WITH expired AS (
      SELECT id FROM reminders WHERE status='pending' AND attempts>=3 AND (lease_until IS NULL OR lease_until<=clock_timestamp())
      ORDER BY due_at,id LIMIT 10 FOR UPDATE SKIP LOCKED
    ) UPDATE reminders r SET status='failed',lease_token=NULL,lease_until=NULL,last_error='attempts_exhausted'
      FROM expired WHERE r.id=expired.id RETURNING r.id`);
    failed += exhausted.rowCount ?? 0;
    const claimed = await pool.query(`WITH due AS (
      SELECT id FROM reminders WHERE status='pending' AND due_at<=$1 AND next_attempt_at<=$1 AND attempts<3
      AND (lease_until IS NULL OR lease_until<=clock_timestamp()) ORDER BY due_at,id LIMIT 10 FOR UPDATE SKIP LOCKED
    ) UPDATE reminders r SET lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds'
      FROM due WHERE r.id=due.id RETURNING r.id,r.lease_token`, [now]);
    await Promise.all(claimed.rows.map(async (claim: { id: string; lease_token: string }) => {
      // One short transaction rechecks current committed consent, status, and snapshot before HTTP.
      const client = await pool.connect();
      let ready: { phone_snapshot: string; attempts: number } | undefined;
      try {
        await client.query('BEGIN');
        await client.query('SELECT id FROM reminders WHERE id=$1 FOR UPDATE', [claim.id]);
        const row = (await client.query(`SELECT r.lease_token AS "leaseToken",r.lease_until AS "leaseUntil",r.status,
          a.status AS "appointmentStatus",a.starts_at AS "startsAt",u.active,
          (u.whatsapp_opted_in_at IS NOT NULL) AS "optedIn",u.whatsapp_phone AS phone,r.phone_snapshot AS "phoneSnapshot",
          clock_timestamp() AS "leaseNow"
          FROM reminders r JOIN appointments a ON a.id=r.appointment_id JOIN users u ON u.id=a.customer_id WHERE r.id=$1`, [claim.id])).rows[0];
        // Sample the live clock after connection/row-lock waits, not at invocation entry.
        const decision = row ? reminderPreflight(row, claim.lease_token, clock(), row.leaseNow) : 'skip';
        if (decision === 'cancel') await client.query("UPDATE reminders SET status='cancelled',lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2 AND status='pending' AND lease_until>clock_timestamp()", [claim.id, claim.lease_token]);
        if (decision === 'send') ready = (await client.query(`UPDATE reminders SET attempts=attempts+1 WHERE id=$1 AND lease_token=$2 AND status='pending' AND lease_until>clock_timestamp() RETURNING phone_snapshot,attempts`, [claim.id, claim.lease_token])).rows[0];
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
      if (!ready) return;
      let messageId: string | null = null;
      let error: string | null = null;
      try { messageId = await sendWhatsApp(config, ready.phone_snapshot); }
      catch (cause) { error = cause instanceof Error ? cause.message : 'provider_network_or_timeout'; }
      const retry = retryResult(ready.attempts, clock());
      const status = messageId ? 'sent' : retry.status;
      const result = await pool.query(`UPDATE reminders SET status=$3,provider_message_id=$4,last_error=$5,next_attempt_at=$6,
        lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2 AND status='pending' AND lease_until>clock_timestamp() RETURNING id`,
      [claim.id, claim.lease_token, status, messageId, error, retry.nextAttemptAt]);
      if (result.rowCount) { if (messageId) sent++; else if (status === 'failed') failed++; }
    }));
  }
  const pending = Number((await pool.query("SELECT count(*) FROM reminders WHERE status='pending'")).rows[0].count);
  return { sent, failed, pending };
}
export function handleProfile(request: Request, actorOverride?: Actor): Promise<Response> {
  return apiResponse(async () => {
    if (request.method !== 'PATCH') throw new HttpError(405, 'Metode tidak didukung');
    assertOrigin(request);
    const actor = actorOverride ?? await requireActor();
    return Response.json(await updateProfile(actor, await request.json()), { headers: { 'cache-control': 'private, no-store' } });
  });
}
export function handleReminderCron(request: Request): Promise<Response> {
  return apiResponse(async () => {
    const secret = process.env.REMINDER_CRON_SECRET;
    if (!secret?.trim()) throw new HttpError(503, 'Worker belum dikonfigurasi');
    const received = Buffer.from(request.headers.get('authorization') ?? '');
    const expected = Buffer.from(`Bearer ${secret}`);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new HttpError(401, 'Akses ditolak');
    if (request.method !== 'POST') throw new HttpError(405, 'Metode tidak didukung');
    if (!providerConfig()) throw new HttpError(503, 'Konfigurasi WhatsApp diperlukan');
    return Response.json(await runReminders(new Date()), { headers: { 'cache-control': 'no-store' } });
  });
}
