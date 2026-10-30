# Booking B2B — Aplikasi Manajemen Janji Temu UMKM

Aplikasi web full-stack modern berbasis Next.js dan PostgreSQL untuk usaha mikro, kecil, dan menengah (UMKM) di Indonesia. Sistem ini mengelola katalog layanan, penugasan staf, jam operasional, serta alur janji temu (booking) transaksional dengan pencegahan konflik jadwal berbasis relasional database, simulasi pembayaran mock, ekspor kalender iCalendar (`.ics`), dan pengingat WhatsApp berbasis persetujuan (opt-in).

Seluruh antarmuka pengguna (UI) dirancang dalam Bahasa Indonesia yang aksesibel, responsif untuk layar ponsel (375px) hingga desktop (1440px), serta memenuhi standar kontras WCAG AA (minimal 4.5:1), navigasi keyboard penuh, dan dukungan preferensi *reduced motion*.

---

## Daftar Isi

1. [Gambaran Proyek & Arsitektur](#gambaran-proyek--arsitektur)
2. [Tech Stack](#tech-stack)
3. [Konfigurasi Environment Variables](#konfigurasi-environment-variables)
4. [Panduan Setup Database PostgreSQL](#panduan-setup-database-postgresql)
5. [Migrasi & Seed Database](#migrasi--seed-database)
6. [Menjalankan Aplikasi & Pengujian](#menjalankan-aplikasi--pengujian)
7. [Worker Pengingat WhatsApp & Konfigurasi Cron](#worker-pengingat-whatsapp--konfigurasi-cron)
8. [Aturan Bisnis Utama](#aturan-bisnis-utama)
9. [Batasan Sistem (Known Limitations)](#batasan-sistem-known-limitations)
10. [Daftar Periksa Kesiapan Produksi (Production Readiness Checklist)](#daftar-periksa-kesiapan-produksi-production-readiness-checklist)

---

## Gambaran Proyek & Arsitektur

Aplikasi ini menggunakan arsitektur monolit modern Next.js App Router di mana antarmuka pengguna (React Server Components dan Client Components) dan backend API (Route Handlers) berada dalam satu repositori yang kohesif.

```
┌─────────────────────────────────────────────────────────────────┐
│                      Next.js App Router                         │
│  ┌──────────────────────────┐    ┌───────────────────────────┐  │
│  │   UI Pages & Components  │    │  Route Handlers (/api/*)  │  │
│  │  - Dashboard, Bookings   │    │  - Auth (/api/auth/*)     │  │
│  │  - Services, Team        │    │  - Catalog & Availability │  │
│  │  - Settings, Profile     │    │  - Appointments & Payment │  │
│  └─────────────┬────────────┘    │  - Reminders (/internal)  │  │
│                │                 └─────────────┬─────────────┘  │
│                ▼                               ▼                │
│       Aksesibilitas & Token         Server Services Layer       │
│       Semantic CSS / Operatif       Otorisasi, Validasi Zod     │
└────────────────────────────────────────────────┼────────────────┘
                                                 │
                                                 ▼
                              ┌───────────────────────────────────┐
                              │     PostgreSQL Database           │
                              │  - Drizzle ORM Schema             │
                              │  - btree_gist Exclusion Constraint│
                              │  - Row-level Lock (FOR UPDATE)    │
                              │  - Transaksi ACID Penuh           │
                              └───────────────────────────────────┘
```

Prinsip arsitektur:
- **Server-driven state**: Sumber kebenaran status booking, ketersediaan, dan sesi otorisasi sepenuhnya berada di server dan database PostgreSQL; tidak ada penyimpanan jadwal di *client-side localStorage*.
- **Otorisasi berlapis**: Otorisasi diperiksa di setiap Route Handler dan Server Service; role-based UI hanya melengkapi pengalaman navigasi dan tidak pernah menggantikan verifikasi server.
- **Pencegahan konflik database**: Integritas jadwal tidak hanya mengandalkan pengecekan logika kode, melainkan dikunci oleh constraint eksklusi PostgreSQL (`btree_gist`) pada level database engine.

---

## Tech Stack

| Kategori | Teknologi | Kegunaan |
|---|---|---|
| **Framework** | Next.js 16 (App Router) & React 19 | Frontend web responsif dan Backend API Route Handlers |
| **Bahasa** | TypeScript 5 (Strict Mode) | Pengetikan tipe statis dari skema hingga antarmuka pengguna |
| **Database** | PostgreSQL 16+ / 17 | Penyimpanan data relasional dengan ekstensi `btree_gist` |
| **ORM & Driver** | Drizzle ORM & `pg` (node-postgres) | Query builder bertipe, pooling koneksi, dan eksekusi transaksi |
| **Validasi** | Zod 4 | Validasi skema input pada batas HTTP dan formulir |
| **Zona Waktu** | `@js-temporal/polyfill` | Konversi waktu eksplisit ISO 8601 dan kalkulasi zona waktu IANA |
| **Pengujian Unit** | Vitest 4 | Pengujian fungsi murni, otorisasi, ketersediaan, dan ICS |
| **Pengujian E2E** | Playwright 1.64 | Pengujian alur pengguna browser, keyboard, dan responsivitas |
| **Styling** | Semantic CSS Tokens | Desain kontras tinggi (WCAG AA), responsive 375px/1440px |

---

## Konfigurasi Environment Variables

Salin berkas template lingkungan sebelum menjalankan aplikasi:

```powershell
cp .env.example .env
```

Setiap variabel di dalam `.env` memiliki fungsi spesifik:

| Variabel | Sifat | Deskripsi |
|---|---|---|
| `POSTGRES_PASSWORD` | Wajib (Docker) | Kata sandi untuk instance PostgreSQL dalam container Docker Compose. |
| `DATABASE_URL` | Wajib | URL koneksi utama PostgreSQL untuk runtime aplikasi, migrasi, dan seed (`postgresql://user:pass@host:port/db`). |
| `TEST_DATABASE_URL` | Wajib (Integrasi) | URL koneksi ke database terpisah untuk pengujian integrasi Vitest. Guard keamanan otomatis membatalkan tes jika bernilai sama dengan `DATABASE_URL`. |
| `APP_URL` | Wajib | Origin resmi aplikasi (misal `http://localhost:3000` di lokal atau `https://booking.umkm.id` di produksi) untuk validasi proteksi CSRF. |
| `SEED_ADMIN_EMAIL` | Wajib (Seed) | Email untuk inisialisasi akun Administrator saat menjalankan `npm run db:seed`. |
| `SEED_ADMIN_PASSWORD` | Wajib (Seed) | Kata sandi akun Administrator (12–128 karakter) saat seed. Tidak ada password default. |
| `WHATSAPP_ACCESS_TOKEN` | Opsional | Token akses Meta Graph API untuk pengiriman pesan template WhatsApp. |
| `WHATSAPP_PHONE_NUMBER_ID` | Opsional | Phone Number ID WhatsApp Business dari Meta Developer Portal. |
| `WHATSAPP_TEMPLATE_NAME` | Opsional | Nama template WhatsApp yang sudah disetujui tanpa parameter dinamis. |
| `WHATSAPP_TEMPLATE_LANGUAGE`| Opsional | Kode bahasa template yang disetujui (misal `id` atau `en_US`). |
| `REMINDER_CRON_SECRET` | Wajib (Cron) | Bearer secret token untuk mengamankan pemanggilan `POST /api/internal/reminders`. |
| `E2E_DATABASE_READY` | Opsional (E2E) | Flag `true` untuk mengaktifkan skenario pengujian E2E dengan database hidup. |

---

## Panduan Setup Database PostgreSQL

Aplikasi membutuhkan database PostgreSQL dengan hak akses untuk membuat ekstensi `btree_gist`.

### Opsi A: Menggunakan Docker Compose (Direkomendasikan untuk Lokal)

Jika Docker Desktop / Docker daemon sudah terpasang di sistem:

1. Pastikan nilai `POSTGRES_PASSWORD` sudah disetel pada `.env`.
2. Jalankan container PostgreSQL:
   ```powershell
   docker compose up -d db
   ```
3. Buat database pengujian terpisah untuk menjalankan pengujian integrasi:
   ```powershell
   docker compose exec db createdb -U booking booking_test
   ```

### Opsi B: Menggunakan PostgreSQL Manual / Layanan Cloud

Jika menggunakan instalasi PostgreSQL mandiri di sistem (Windows/Linux/macOS) atau layanan database cloud (seperti Neon, Supabase, Aiven):

1. Masuk ke console PostgreSQL via `psql`:
   ```sql
   CREATE USER booking WITH PASSWORD 'rahasia-sangat-kuat';
   CREATE DATABASE booking OWNER booking;
   CREATE DATABASE booking_test OWNER booking;
   GRANT ALL PRIVILEGES ON DATABASE booking TO booking;
   GRANT ALL PRIVILEGES ON DATABASE booking_test TO booking;
   ```
2. Pastikan user memiliki izin `SUPERUSER` atau `CREATEDB` / hak memasang extension (`CREATE EXTENSION IF NOT EXISTS btree_gist;`).
3. Setel `DATABASE_URL` dan `TEST_DATABASE_URL` di `.env` merujuk ke kedua database tersebut.

> **Peringatan Keamanan Database Uji:**
> Jangan pernah mengarahkan `TEST_DATABASE_URL` ke database operasional atau produksi. Pengujian integrasi menjalankan migrasi dan menghapus baris data pengujian secara otomatis setelah pengujian selesai.

---

## Migrasi & Seed Database

### 1. Menjalankan Migrasi Database

Skrip migrasi dijalankan secara berurutan dan diamankan menggunakan PostgreSQL advisory lock transaksi (`pg_advisory_xact_lock(728301)`) sehingga aman dari eksekusi migrasi paralel:

```powershell
npm.cmd run db:migrate
```

Tahapan migrasi yang dieksekusi:
1. `Version 1`: Enum `role` (`admin`, `staff`, `customer`), tabel `businesses` (singleton), `users`, `sessions`, dan `login_attempts`.
2. `Version 2`: Tabel `services`, `staff_services`, dan `working_hours` mingguan.
3. `Version 3`: Ekstensi `btree_gist` dan tabel `appointments` dengan PostgreSQL Exclusion Constraint untuk menolak irisan jadwal staf.
4. `Version 4`: Tabel `payments` dengan constraint unik satu pembayaran per janji temu.
5. `Version 5`: Tabel `reminders` dengan kolom lease lock untuk pemrosesan paralel yang aman.

### 2. Mengisi Data Awal (Seeding)

Sebelum menjalankan seeding, pastikan `SEED_ADMIN_EMAIL` dan `SEED_ADMIN_PASSWORD` telah diisi di `.env`.

```powershell
npm.cmd run db:seed
```

Karakteristik proses seed:
- Membuat entitas bisnis awal dengan zona waktu default `Asia/Jakarta`.
- Membuat satu akun Administrator awal dengan hash password `scrypt`. Jika email sudah terdaftar, proses dibatalkan tanpa mengubah password yang ada.
- Menambahkan 2 layanan contoh yang diberi label eksplisit `[DEMO] Konsultasi umum non-medis` dan `[DEMO] Sesi pendampingan`.
- **Tidak pernah membuat data pelanggan palsu, staf tiruan, atau janji temu rekaan** demi menjaga kebersihan data operasional.

---

## Menjalankan Aplikasi & Pengujian

### 1. Menjalankan Server Pengembangan (Development)

```powershell
npm.cmd run dev
```
Buka peramban di [http://localhost:3000](http://localhost:3000).

### 2. Menjalankan Pemeriksaan Kode (Lint & Typecheck)

```powershell
# Pemeriksaan tipe TypeScript statis
npm.cmd run typecheck

# Pemeriksaan gaya kode dan aturan Next.js/ESLint
npm.cmd run lint
```

### 3. Menjalankan Pengujian

Proyek menyediakan 3 tingkatan pengujian:

```powershell
# Menjalankan seluruh pengujian unit Vitest (84 unit tests)
npm.cmd test

# Menjalankan pengujian integrasi database PostgreSQL (5 berkas integrasi)
# Jika TEST_DATABASE_URL tidak tersedia, tes integrasi akan berstatus SKIPPED (BLOCKED)
# dan TIDAK PERNAH memberikan status hijau palsu (silent pass).
npm.cmd run test:integration

# Menjalankan pengujian fungsional browser Playwright (E2E)
# Menguji alur halaman publik, formulir, mitigasi konflik jadwal, dan layout mobile 375px
npm.cmd run test:e2e
```

### 4. Build & Jalankan untuk Produksi

```powershell
# Kompilasi aplikasi produksi Next.js
npm.cmd run build

# Menjalankan server produksi lokal
npm.cmd run start
```

---

## Worker Pengingat WhatsApp & Konfigurasi Cron

### 1. Alur Pengingat & Persetujuan (Opt-In)

- **Persetujuan Eksplisit**: Pelanggan memilih secara sukarela untuk menerima notifikasi pengingat melalui menu Pengaturan Profil (`PATCH /api/profile`) dengan memasukkan nomor WhatsApp berformat E.164 (contoh: `+6281234567890`). Waktu persetujuan dicatat secara presisi.
- **Pencabutan Izin**: Pelanggan dapat mematikan persetujuan kapan saja (`optIn: false`), yang secara otomatis membatalkan seluruh pengingat yang berstatus `pending`.
- **Jadwal Pengingat**: Pengingat dibuat otomatis hanya untuk booking yang dipesan minimal 24 jam sebelum waktu mulai. Pengingat jatuh tempo tepat 24 jam sebelum waktu mulai (`starts_at - 24 hours`).

### 2. Eksekusi Worker Internal via Cron

Worker dijalankan melalui HTTP POST terjadwal (misal menggunakan Cloudflare Cron Triggers, GitHub Actions, atau Linux Crontab):

- **Metode**: `POST`
- **URL**: `https://<DOMAIN_ANDA>/api/internal/reminders`
- **Header**: `Authorization: Bearer <REMINDER_CRON_SECRET>`

Rekomendasi frekuensi penjadwalan: **1 kali setiap 1 menit**.

### 3. Mekanisme Keamanan Transaksi Worker

1. **Atomic Lease Lock**: Worker mengambil maksimal 10 baris pengingat yang jatuh tempo menggunakan query PostgreSQL `FOR UPDATE SKIP LOCKED` dengan durasi sewa (*lease*) 60 detik. Dua worker paralel tidak akan mengambil baris yang sama.
2. **I/O Jaringan di Luar Transaksi Database**: Panggilan HTTP ke Meta Graph API dilakukan di luar transaksi database dengan batas waktu (*deadline*) abort 10 detik guna mencegah penumpukan lock database.
3. **Pengecekan Pra-Kirim (Preflight Check)**: Sesaat sebelum payload dikirim ke Meta, worker memeriksa ulang apakah pelanggan masih aktif, persetujuan belum dicabut, janji temu masih berstatus `confirmed`, dan nomor telepon tidak berubah.
4. **Retry & Backoff**: Maksimal 3 kali percobaan. Percobaan ke-2 berjarak 1 menit, percobaan ke-3 berjarak 5 menit. Jika tetap gagal setelah percobaan ke-3, status diubah menjadi `failed` secara permanen.
5. **Mode Unconfigured**: Jika 4 variabel WhatsApp di `.env` belum dikonfigurasi, endpoint mengembalikan HTTP 503 dengan pesan konfigurasi, pengingat tetap berstatus `pending`, dan **kuota percobaan (retry budget) tidak berkurang**.

### 4. Risiko Duplikasi & Timeout (At-Least-Once Delivery)

Pengiriman pesan pihak ketiga beroperasi di bawah prinsip **at-least-once**, bukan *exactly-once*:
- Jika server mengalami *network timeout* saat mengirim ke Meta padahal Meta sebenarnya telah menerima request tersebut, worker akan menganggapnya gagal dan melakukan retry saat lease kedaluwarsa. Hal ini dapat menimbulkan pengiriman pesan ganda.
- Pembatalan janji temu atau pencabutan persetujuan pelanggan yang terjadi tepat bersamaan saat request HTTP sedang berada dalam pipa jaringan Meta tidak dapat dicegah secara instan tanpa mengorbankan integritas kunci database. Worker membatalkan lease tersebut agar status `cancelled` tidak ditimpa status `sent`.

---

## Aturan Bisnis Utama

### 1. Pembagian Peran Pengguna (Multi-Role Access Control)

| Peran | Pendaftaran | Hak Akses & Operasional |
|---|---|---|
| **Administrator** | Dibuat saat seed pertama kali | Mengelola profil bisnis, menambah staf, mengatur katalog layanan, mengatur jam kerja mingguan seluruh staf, melihat seluruh booking, membatalkan booking sebelum mulai, dan menandai janji temu selesai. |
| **Staf** | Dibuat oleh Admin di menu Tim | Hanya dapat melihat jadwal janji temu miliknya sendiri. Hanya dapat menandai janji temu miliknya sebagai `completed` setelah waktu selesai terlewati. Tidak dapat mengubah katalog, tidak dapat melihat booking staf lain, dan tidak dapat membatalkan janji temu pelanggan. |
| **Pelanggan** | Pendaftaran publik mandiri | Hanya dapat memesan layanan aktif dan staf yang ditugaskan, melihat jadwal miliknya, membatalkan janji temunya sendiri sebelum jam mulai, melakukan simulasi pembayaran, mengunduh kalender `.ics`, serta mengatur izin notifikasi WhatsApp. |

### 2. Penanganan Zona Waktu & Integritas Jam Kerja

- **Zona Waktu Bisnis**: Nilai default `Asia/Jakarta` (WIB) disimpan sebagai IANA Identifier di tabel `businesses` dan dapat diubah oleh Admin.
- **Penyimpanan UTC Murni**: Semua instan waktu (`starts_at`, `ends_at`, `created_at`, dll.) disimpan di PostgreSQL sebagai tipe data `timestamptz` dalam format UTC murni.
- **Kekebalan Perubahan Jam/Zona Waktu**: Perubahan jam kerja operasional atau zona waktu bisnis di kemudian hari **tidak pernah menggeser instan UTC janji temu yang sudah terkonfirmasi sebelumnya**.
- **Ketiadaan Jadwal Lintas Tengah Malam**: Jam operasional staf harus berawal dan berakhir pada hari kalender yang sama (rentang 00:00 hingga 23:59 waktu lokal bisnis).

### 3. Pencegahan Tabrakan Jadwal (Exclusion Constraint)

- Janji temu menggunakan konsep interval setengah terbuka: `[starts_at, ends_at)`.
- Janji temu yang bersebelahan persis (misal 09:00–09:30 dan 09:30–10:00) dinyatakan sah dan tidak bertabrakan.
- Konflik jadwal dicegah langsung di tingkat database menggunakan PostgreSQL GiST index:
  ```sql
  EXCLUDE USING gist (
    staff_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status = 'confirmed')
  ```
- Jika ada dua permintaan pemesanan pada milidetik yang sama untuk staf yang sama, database secara mutlak hanya meloloskan satu transaksi dan melempar *exclusion violation* yang dikonversi server menjadi HTTP 409 Conflict.

### 4. Simulasi Pembayaran Mock (Tanpa Uang Nyata)

- Aplikasi ditujukan untuk peragaan alur bisnis UMKM tanpa integrasi payment gateway perbankan nyata.
- Transaksi pembayaran ditandai secara gamblang di API dan UI sebagai **Simulasi Pembayaran Mock**.
- Bersifat **idempotent**: Menekan tombol bayar berulang kali pada booking yang sama hanya menghasilkan satu catatan pembayaran `paid`.
- Pembayaran hanya dapat dilakukan untuk booking berstatus `confirmed` sebelum waktu layanan dimulai.
- Jika booking yang telah dibayar dibatalkan sebelum jadwal mulai, status pembayaran diubah secara atomik menjadi `refunded`.

### 5. Ekspor Kalender iCalendar (`.ics`)

- Pelanggan dan Admin dapat mengunduh berkas `.ics` terstandarisasi RFC 5545 melalui endpoint `/api/appointments/:id/calendar`.
- Memiliki UID stabil berbasis UUID janji temu dan waktu UTC (`DTSTART`/`DTEND`).
- Mendukung pembaruan status: Jika janji temu dibatalkan, unduhan `.ics` baru menyertakan `METHOD:REQUEST` dengan nomor `SEQUENCE` yang bertambah dan `STATUS:CANCELLED` agar aplikasi kalender (Google Calendar, Apple Calendar, Outlook) otomatis mencoret agenda.

---

## Batasan Sistem (Known Limitations)

1. **Satu Bisnis per Instalasi (Single-Tenant)**: Aplikasi didesain untuk satu entitas UMKM per database (tabel `businesses` menggunakan constraint unik singleton). Tidak mendukung multi-tenant / multi-cabang terisolasi dalam satu instalasi database.
2. **Cakupan Non-Klinis**: Ditujukan untuk bisnis jasa umum (salon, bengkel, konsultan, bimbingan belajar, studio foto). Bukan sistem informasi rekam medis elektronik (RME) atau kepatuhan data kesehatan sensitif (HIPAA).
3. **Simulasi Pembayaran Saja**: Tidak terhubung ke gateway pembayaran nyata (seperti Midtrans, Xendit, atau Stripe). Tidak ada dana riil yang dipindahkan.
4. **Fallback WhatsApp Tanpa Kredensial**: Tanpa konfigurasi Meta Cloud API, pesan pengingat tidak akan terkirim ke jaringan seluler, namun status tetap ditahan di database secara transparan tanpa klaim pengiriman palsu.
5. **Tidak Ada Reschedule Otomatis**: Alur perubahan jadwal dilakukan secara konvensional: membatalkan janji temu yang ada lalu membuat janji temu baru pada slot yang tersedia.

---

## Daftar Periksa Kesiapan Produksi (Production Readiness Checklist)

Sebelum merilis aplikasi ini ke domain publik atau jaringan produksi terbuka, tim pengembang dan administrator wajib memastikan langkah-langkah berikut telah terpenuhi:

- [ ] **Protokol TLS/HTTPS Wajib**: Aplikasi harus disajikan secara eksklusif melalui protokol HTTPS. Cookie sesi menggunakan atribut `HttpOnly`, `SameSite=Lax`, dan secara otomatis mengaktifkan flag `Secure` saat `NODE_ENV=production`.
- [ ] **Pemberian Nilai APP_URL**: Setel `APP_URL` pada `.env` sama persis dengan domain publik (contoh `https://booking.namaumkm.com`) untuk menjamin proteksi cross-origin request forgery (CSRF).
- [ ] **Pengelolaan Rahasia (Secrets Management)**: Jauhkan file `.env` dari kontrol versi git. Gunakan layanan manajemen rahasia (seperti AWS Secrets Manager, Doppler, Vault, atau Environment Variables di Vercel/Railway).
- [ ] **Pembatasan Laju Perimeter (Perimeter Rate Limiting)**: Aplikasi memiliki pengaman bawaan database untuk membatasi 5 kali kegagalan login per akun per 15 menit (HTTP 429). Namun untuk menghadapi serangan DDoS atau pencurian kredensial terdistribusi, pasang WAF atau Reverse Proxy dengan rate limiting (Cloudflare, Nginx `limit_req`, AWS WAF).
- [ ] **Strategi Backup Database**: Konfigurasikan snapshot berkala dan WAL (Write-Ahead Logging) archiving PostgreSQL untuk pemulihan bencana (*Disaster Recovery*) dengan uji coba restorasi berkala.
- [ ] **Retensi & Privasi Data (Kebijakan Privasi)**: Sediakan skrip pembersihan berkala untuk menghapus baris tabel `sessions` yang sudah kedaluwarsa dan riwayat `login_attempts` lama. Pastikan penyimpanan nomor telepon mematuhi regulasi perlindungan data pribadi (UU PDP Indonesia).
