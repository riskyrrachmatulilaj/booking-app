import { expect, test } from '@playwright/test';

test('public routes, keyboard, retained error input and mobile layout', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Masuk ke Booking B2B' })).toBeVisible();
  await page.getByLabel('Email').fill('pelanggan@example.com');
  await page.getByLabel('Kata sandi').fill('incorrect-password');
  const toggle = page.getByRole('button', { name: 'Tampilkan sandi' });
  await expect(toggle).toBeVisible();
  await expect(page.getByLabel('Kata sandi')).toHaveAttribute('type', 'password');
  await toggle.click();
  await expect(page.getByLabel('Kata sandi')).toHaveAttribute('type', 'text');
  await expect(page.getByRole('button', { name: 'Sembunyikan sandi' })).toBeVisible();
  await page.getByRole('button', { name: 'Sembunyikan sandi' }).click();
  await expect(page.getByLabel('Kata sandi')).toHaveAttribute('type', 'password');
  await page.route('**/api/auth/login', route => route.fulfill({ status: 401, json: { error: 'Email atau kata sandi salah' } }));
  await page.getByLabel('Kata sandi').press('Enter');
  await expect(page.getByRole('alert').filter({ hasText: 'Email atau kata sandi salah' })).toContainText('Email atau kata sandi salah');
  await expect(page.getByLabel('Email')).toHaveValue('pelanggan@example.com');
  await page.keyboard.press('Tab');
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 375);
  await page.screenshot({ path: 'test-results/screenshots/mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/screenshots/desktop.png', fullPage: true });
  await page.getByRole('link', { name: 'Buat akun pelanggan' }).click();
  await expect(page.getByLabel('Nama')).toBeVisible();
  await page.getByLabel('Nama').fill('Nama pelanggan sangat panjang untuk menguji tata letak tanpa pemotongan');
  await page.goto('/team');
  await expect(page).toHaveURL(/\/login/);
});

test('private APIs reject missing session without database', async ({ request }) => {
  for (const url of ['/api/profile', '/api/services', '/api/staff', '/api/business', '/api/appointments']) {
    expect((await request.get(url)).status()).toBe(401);
  }
});

test('registration errors retain long names and private routes redirect', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/register');
  const name = 'Nama pelanggan panjang '.repeat(4).trim();
  await page.getByLabel('Nama').fill(name);
  await page.getByLabel('Email').fill('existing@example.com');
  await page.getByLabel('Kata sandi').fill('long-password-123');
  await page.route('**/api/auth/register', route => route.fulfill({ status: 409, json: { error: 'Email sudah terdaftar' } }));
  await page.getByRole('button', { name: 'Daftar', exact: true }).click();
  await expect(page.getByLabel('Nama')).toHaveValue(name);
  await expect(page.getByRole('alert').filter({ hasText: 'Email sudah terdaftar' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
  for (const path of ['/', '/dashboard', '/bookings', '/services', '/team', '/settings']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
  }
});

test.describe('database journey', () => {
  test.skip(!process.env.E2E_DATABASE_READY, 'Requires migrated PostgreSQL, seed admin and isolated E2E environment.');
  test('admin edits catalog, staff assignments, hours and business', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill(process.env.E2E_ADMIN_EMAIL!);
    await page.getByLabel('Kata sandi', { exact: true }).fill(process.env.E2E_ADMIN_PASSWORD!);
    await page.getByRole('button', { name: 'Masuk', exact: true }).click();
    await expect(page).toHaveURL(/dashboard/);
    await page.goto('/services');
    const name = `Layanan E2E ${Date.now()}`;
    const createService = page.locator('section').filter({ hasText: 'Tambah layanan' });
    await createService.getByLabel('Nama layanan').fill(name);
    await createService.getByLabel('Harga (Rp)').fill('75000');
    await createService.getByLabel('Durasi (menit)').fill('30');
    await createService.getByRole('button', { name: 'Tambah layanan', exact: true }).click();
    await page.getByText(name, { exact: false }).last().click();
    await page.getByRole('button', { name: 'Simpan layanan' }).last().click();
    await page.goto('/team');
    const staffName = `Staf E2E ${Date.now()}`;
    const createStaff = page.locator('section').filter({ hasText: 'Tambah akun staf' });
    await createStaff.getByLabel('Nama staf', { exact: true }).fill(staffName);
    await createStaff.getByLabel('Email staf').fill(`staff-${Date.now()}@example.com`);
    await createStaff.getByLabel('Kata sandi awal').fill('E2E-password-12345');
    await createStaff.getByRole('button', { name: 'Tambah staf', exact: true }).click();
    const editor = page.locator('details').filter({ has: page.locator('summary', { hasText: staffName }) });
    await editor.locator('summary').click();
    await editor.getByLabel(name, { exact: true }).check();
    await editor.getByRole('button', { name: 'Simpan staf & penugasan' }).click();
    await expect(editor.getByRole('status').filter({ hasText: 'Perubahan staf tersimpan' })).toBeVisible();
    await editor.getByRole('button', { name: 'Tambah rentang jam' }).click();
    await editor.getByRole('button', { name: 'Simpan jam kerja' }).click();
    await expect(editor.getByRole('status').filter({ hasText: 'Perubahan staf tersimpan' })).toBeVisible();
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Simpan bisnis' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Pengaturan bisnis tersimpan' })).toBeVisible();
  });
  test('staff can complete own finished appointment, but cannot edit catalog', async ({ page, request }) => {
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill(process.env.E2E_STAFF_EMAIL!);
    await page.getByLabel('Kata sandi', { exact: true }).fill(process.env.E2E_STAFF_PASSWORD!);
    await page.getByRole('button', { name: 'Masuk', exact: true }).click();
    await expect(page).toHaveURL(/dashboard/);
    await page.goto('/team');
    await expect(page.getByRole('heading', { name: 'Akses ditolak' })).toBeVisible();
    const cookies = await page.context().cookies();
    const denied = await request.post('/api/services', { headers: { origin: 'http://localhost:3000', cookie: cookies.map(row => `${row.name}=${row.value}`).join('; ') }, data: { name: 'Forbidden', price: 0, durationMinutes: 30 } });
    expect(denied.status()).toBe(403);
    await page.goto('/bookings');
    await page.getByLabel('Mulai rentang (tanggal bisnis)').fill(process.env.E2E_COMPLETION_DATE!);
    const own = page.locator('li').filter({ has: page.locator(`a[href="/api/appointments/${process.env.E2E_COMPLETION_ID}/calendar"]`) });
    await own.getByRole('button', { name: 'Tandai selesai' }).click();
    await expect(page.getByText('Selesai', { exact: true }).first()).toBeVisible();
  });
  test('register and customer booking journey', async ({ page }) => {
    await page.goto('/register');
    await page.getByLabel('Nama').fill('Pelanggan E2E');
    await page.getByLabel('Email').fill(`e2e-${Date.now()}@example.com`);
    await page.getByLabel('Kata sandi').fill('E2E-password-12345');
    await page.getByRole('button', { name: 'Daftar', exact: true }).click();
    await expect(page).toHaveURL(/dashboard/);
    await page.goto('/team');
    await expect(page.getByRole('heading', { name: 'Akses ditolak' })).toBeVisible();
    const denied = await page.request.post('/api/services', { headers: { origin: 'http://localhost:3000' }, data: { name: 'Forbidden', price: 0, durationMinutes: 30 } });
    expect(denied.status()).toBe(403);
    await page.goto('/bookings');
    await page.getByRole('combobox', { name: 'Layanan', exact: true }).selectOption(process.env.E2E_SERVICE_ID!);
    await page.getByRole('combobox', { name: 'Staf', exact: true }).selectOption(process.env.E2E_STAFF_ID!);
    await page.getByLabel('Mulai rentang (tanggal bisnis)').fill(process.env.E2E_BOOKING_DATE!);
    await page.getByLabel('Tanggal').fill(process.env.E2E_BOOKING_DATE!);
    await page.getByRole('button', { name: 'Cari slot' }).click();
    await page.getByRole('radio').first().check();
    const created = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/api/appointments'));
    await page.getByRole('button', { name: 'Konfirmasi booking' }).click();
    const appointment = await (await created).json();
    await expect(page.getByRole('status').filter({ hasText: 'Booking berhasil' })).toBeVisible();
    const row = page.locator('li').filter({ has: page.locator(`a[href="/api/appointments/${appointment.id}/calendar"]`) });
    await row.getByRole('button', { name: 'Bayar simulasi' }).click();
    await expect(page.getByText('Lunas simulasi').first()).toBeVisible();
    const download = page.waitForEvent('download');
    await row.getByRole('link', { name: 'Unduh ICS' }).click();
    expect((await download).suggestedFilename()).toMatch(/\.ics$/);
    page.once('dialog', dialog => dialog.accept());
    await row.getByRole('button', { name: 'Batalkan' }).click();
    await expect(page.getByText('Dibatalkan', { exact: true }).first()).toBeVisible();
  });
});
