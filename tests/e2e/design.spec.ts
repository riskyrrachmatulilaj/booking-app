import { expect, test } from '@playwright/test';

for (const width of [390, 1440]) {
  test(`auth design remains usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/login', '/register']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: path === '/login' ? 'Masuk' : 'Daftar', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  });
}

test('dashboard cards show actual page counts without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.route('**/api/business', route => route.fulfill({ json: { name: 'Fixture', timezone: 'Asia/Jakarta' } }));
  await page.route('**/api/appointments?*', route => route.fulfill({ json: {
    items: [
      { id: '1', serviceName: 'Konsultasi', staffName: 'Staf A', customerName: 'Pelanggan A', startsAt: '2030-11-02T06:00:00Z', endsAt: '2030-11-02T06:30:00Z', price: 75000, durationMinutes: 30, status: 'confirmed', paymentStatus: null },
      { id: '2', serviceName: 'Layanan lanjutan', staffName: 'Staf B', customerName: 'Pelanggan B', startsAt: '2030-11-02T07:00:00Z', endsAt: '2030-11-02T07:30:00Z', price: 50000, durationMinutes: 30, status: 'completed', paymentStatus: 'paid' },
    ], nextOffset: null,
  } }));
  await page.goto('http://127.0.0.1:4173/tests/e2e/harness.html?dashboard');
  const cards = page.getByRole('region', { name: 'Statistik halaman jadwal' }).getByRole('article');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0).locator('strong')).toHaveText('2');
  await expect(cards.nth(1).locator('strong')).toHaveText('1');
  await expect(cards.nth(2).locator('strong')).toHaveText('1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
