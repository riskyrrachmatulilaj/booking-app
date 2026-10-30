import { afterEach, describe, expect, it, vi } from 'vitest';
import { planReminder, parseProfile, providerConfig, sendWhatsApp, retryResult, handleReminderCron, handleProfile, reminderPreflight } from '@/server/reminders';
const now = new Date('2026-11-01T00:00:00Z');
const phone = '+628123456789';
const config = { token: 'private-token', phoneId: '123', template: 'booking_reminder', language: 'id' };
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('preflight ownership and live eligibility', () => {
  const row = { leaseToken: 'owned', leaseUntil: new Date(+now + 60000), status: 'pending', appointmentStatus: 'confirmed', startsAt: new Date(+now + 30000), active: true, optedIn: true, phone, phoneSnapshot: phone };
  it('leaves expired or replaced leases recoverable rather than cancelling', () => {
    expect(reminderPreflight(row, 'owned', new Date(+now + 60000))).toBe('skip');
    expect(reminderPreflight(row, 'new-owner', now)).toBe('skip');
    expect(reminderPreflight({ ...row, leaseToken: 'new-owner', leaseUntil: new Date(+now + 120000), startsAt: new Date(+now + 180000) }, 'new-owner', new Date(+now + 60000))).toBe('send');
  });
  it('uses current time after waits and cancels only business-ineligible owned leases', () => {
    expect(reminderPreflight(row, 'owned', now)).toBe('send');
    expect(reminderPreflight(row, 'owned', row.startsAt)).toBe('cancel');
    expect(reminderPreflight({ ...row, optedIn: false }, 'owned', now)).toBe('cancel');
    expect(reminderPreflight({ ...row, phone: '+628999999999' }, 'owned', now)).toBe('cancel');
  });
});
describe('reminder planning and consent', () => {
  it('requires a valid number and explicit consent, and skips bookings under 24 hours', () => {
    const start = new Date(+now + 86400000);
    expect(planReminder({ whatsappPhone: null, whatsappOptedInAt: now }, start, now)).toBeNull();
    expect(planReminder({ whatsappPhone: phone, whatsappOptedInAt: null }, start, now)).toBeNull();
    expect(planReminder({ whatsappPhone: phone, whatsappOptedInAt: now }, new Date(+start - 1), now)).toBeNull();
    expect(planReminder({ whatsappPhone: phone, whatsappOptedInAt: now }, start, now)).toEqual({ phoneSnapshot: phone, dueAt: now });
    expect(planReminder({ whatsappPhone: phone, whatsappOptedInAt: now }, new Date(+start + 1000), now)?.dueAt).toEqual(new Date(+now + 1000));
  });
  it('validates E.164 and requires explicit opt-in; revocation permits removing the phone', () => {
    expect(parseProfile({ whatsappPhone: phone, optIn: true })).toEqual({ whatsappPhone: phone, optIn: true });
    expect(parseProfile({ whatsappPhone: null, optIn: false }).optIn).toBe(false);
    for (const input of [{ whatsappPhone: '0812345', optIn: true }, { whatsappPhone: null, optIn: true }, { whatsappPhone: phone }, { whatsappPhone: '+0123456789', optIn: true }]) expect(() => parseProfile(input)).toThrow();
  });
  it('leaves configuration optional and never substitutes missing credentials', () => {
    for (const key of ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_TEMPLATE_NAME', 'WHATSAPP_TEMPLATE_LANGUAGE']) vi.stubEnv(key, '');
    expect(providerConfig()).toBeNull();
  });
  it('retries at most three attempts with bounded backoff', () => {
    expect(retryResult(1, now)).toEqual({ status: 'pending', nextAttemptAt: new Date(+now + 60000) });
    expect(retryResult(2, now)).toEqual({ status: 'pending', nextAttemptAt: new Date(+now + 300000) });
    expect(retryResult(3, now)).toEqual({ status: 'failed', nextAttemptAt: now });
  });
});
describe('WhatsApp network boundary', () => {
  it('uses configured template, snapshot recipient and returns only provider message ID', async () => {
    const network = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://graph.facebook.com/v22.0/123/messages');
      expect(JSON.parse(init.body as string)).toEqual({ messaging_product: 'whatsapp', to: phone, type: 'template', template: { name: 'booking_reminder', language: { code: 'id' } } });
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return Response.json({ messages: [{ id: 'wamid.test' }] });
    });
    vi.stubGlobal('fetch', network);
    expect(await sendWhatsApp(config, phone)).toBe('wamid.test');
  });
  it.each([400, 401, 429, 500, 503])('never treats HTTP %s as sent or leaks provider errors', async (status) => {
    vi.stubGlobal('fetch', async () => new Response('private-token', { status }));
    await expect(sendWhatsApp(config, phone)).rejects.toThrow(`provider_http_${status}`);
  });
  it('sets a ten-second network deadline', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal('fetch', async () => Response.json({ messages: [{ id: 'bounded' }] }));
    try {
      await sendWhatsApp(config, phone);
      expect(timeout).toHaveBeenCalledWith(10000);
    } finally { timeout.mockRestore(); }
  });
  it('rejects timeout/network failure and malformed success without claiming sent', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('private-token'); });
    await expect(sendWhatsApp(config, phone)).rejects.toThrow('provider_network_or_timeout');
    vi.stubGlobal('fetch', async () => Response.json({ messages: [] }));
    await expect(sendWhatsApp(config, phone)).rejects.toThrow('provider_missing_message_id');
  });
});
describe('HTTP guards before database access', () => {
  it('rejects missing cron secret, missing bearer and wrong bearer', async () => {
    vi.stubEnv('REMINDER_CRON_SECRET', '');
    expect((await handleReminderCron(new Request('http://localhost/api/internal/reminders', { method: 'POST' }))).status).toBe(503);
    vi.stubEnv('REMINDER_CRON_SECRET', 'test-secret');
    for (const authorization of ['', 'Bearer wrong', 'test-secret']) {
      expect((await handleReminderCron(new Request('http://localhost/api/internal/reminders', { method: 'POST', headers: { authorization } }))).status).toBe(401);
    }
  });
  it('reports missing provider configuration for an authorized cron without database access', async () => {
    vi.stubEnv('REMINDER_CRON_SECRET', 'test-secret');
    vi.stubEnv('WHATSAPP_ACCESS_TOKEN', '');
    const response = await handleReminderCron(new Request('http://localhost/api/internal/reminders', { method: 'POST', headers: { authorization: 'Bearer test-secret' } }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Konfigurasi WhatsApp diperlukan' });
  });
  it('rejects cross-origin profile mutations', async () => {
    const response = await handleProfile(new Request('http://localhost:3000/api/profile', { method: 'PATCH', headers: { origin: 'https://evil.example' } }), { id: crypto.randomUUID(), role: 'customer' });
    expect(response.status).toBe(403);
  });
});
