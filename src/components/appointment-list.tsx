'use client';
import { useState } from 'react';
import type { Role } from '@/server/auth';
import BookingForm from './booking-form';
import { businessDateRange } from './date-range';
import { api, dateTime, Feedback, localDate, ResourceState, rupiah, useResource, type Business } from './ui';
type Row = { id: string; serviceName: string; staffName: string; customerName: string; startsAt: string; endsAt: string; price: number; durationMinutes: number; status: 'confirmed' | 'cancelled' | 'completed'; paymentStatus: 'paid' | 'refunded' | null };
const labels = { confirmed: 'Dikonfirmasi', cancelled: 'Dibatalkan', completed: 'Selesai' };
export default function AppointmentList({ role, dashboard = false }: { role: Role; dashboard?: boolean }) {
  const business = useResource<Business>('business');
  return <><ResourceState loading={business.loading} error={business.error} retry={business.reload} />{business.data && <Schedule role={role} dashboard={dashboard} timezone={business.data.timezone} />}</>;
}
function Schedule({ role, dashboard, timezone }: { role: Role; dashboard: boolean; timezone: string }) {
  const [date, setDate] = useState(localDate(timezone));
  const [status, setStatus] = useState('all');
  const [offset, setOffset] = useState(0);
  // Convert each local midnight independently so DST days retain their business-date boundaries.
  const { from, to } = businessDateRange(date, timezone);
  const rows = useResource<{ items: Row[]; nextOffset: number | null }>(`appointments?${new URLSearchParams({ from, to, limit: '100', offset: String(offset) })}`);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  async function action(id: string, action: 'cancel' | 'complete' | 'pay') {
    if (action === 'cancel' && !window.confirm('Batalkan janji temu ini? Slot akan tersedia kembali. Pembayaran simulasi yang lunas akan dikembalikan secara simulasi.')) return;
    setBusy(id); setError(''); setMessage('');
    try { await api(`appointments/${id}${action === 'pay' ? '/payment' : ''}`, action === 'pay' ? 'POST' : 'PATCH', action === 'pay' ? {} : { action }); setMessage(action === 'pay' ? 'Pembayaran simulasi tercatat. Tidak ada uang nyata.' : 'Janji temu diperbarui.'); rows.reload(); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(''); }
  }
  const visible = rows.data?.items.filter(row => status === 'all' || row.status === status);
  return <><p className="timezone">Zona waktu bisnis: <strong>{timezone}</strong></p>{!dashboard && role === 'customer' && <BookingForm timezone={timezone} onBooked={rows.reload} />}
    {dashboard && rows.data && <section className="stat-grid" aria-label="Statistik halaman jadwal">
      <article className="stat-card"><div className="stat-top"><span>Total janji temu</span><span className="stat-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M4 5h16v16H4z M8 2v6 M16 2v6 M4 11h16" /></svg></span></div><strong>{rows.data.items.length}</strong><p>Catatan pada halaman ini</p></article>
      <article className="stat-card positive"><div className="stat-top"><span>Dikonfirmasi</span><span className="stat-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></svg></span></div><strong>{rows.data.items.filter(row => row.status === 'confirmed').length}</strong><p>Janji temu pada halaman ini</p></article>
      <article className="stat-card positive"><div className="stat-top"><span>Selesai</span><span className="stat-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m4 12 5 5L20 6 M4 6h7 M4 21h16" /></svg></span></div><strong>{rows.data.items.filter(row => row.status === 'completed').length}</strong><p>Layanan pada halaman ini</p></article>
    </section>}
    <section className="panel"><h2>{dashboard ? 'Ringkasan jadwal' : 'Daftar janji temu'}</h2><p>Rentang 30 hari: {dateTime(from, timezone)} sampai sebelum {dateTime(to, timezone)}. Maksimal 100 catatan per halaman.</p>
    <div className="filters"><label>Mulai rentang (tanggal bisnis)<input type="date" required value={date} onChange={event => { if (event.target.value) { setDate(event.target.value); setOffset(0); } }} /></label><label>Status<select value={status} onChange={event => setStatus(event.target.value)}><option value="all">Semua status</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
    <ResourceState loading={rows.loading} error={rows.error} retry={rows.reload} /><Feedback error={error} message={message} />
    {rows.data && <><p className="summary">Halaman ini: {rows.data.items.length} janji temu · {rows.data.items.filter(row => row.status === 'confirmed').length} dikonfirmasi · {rows.data.items.filter(row => row.status === 'completed').length} selesai</p>{visible?.length === 0 && <div className="empty"><h3>Belum ada janji temu</h3><p>Ubah rentang atau status{role === 'customer' ? ', atau buat booking baru.' : ' untuk melihat jadwal lain.'}</p></div>}
    <ul className="appointments">{visible?.map(row => <li key={row.id}><div className="appointment-heading"><h3>{row.serviceName}</h3><span className={`badge ${row.status}`}>{labels[row.status]}</span></div><p className="appointment-time">{dateTime(row.startsAt, timezone)} – {new Intl.DateTimeFormat('id-ID', { timeStyle: 'short', timeZone: timezone }).format(new Date(row.endsAt))}</p><p>{row.staffName} · {row.customerName}</p><p>{rupiah(row.price)} · {row.durationMinutes} menit · {row.paymentStatus === 'paid' ? 'Lunas simulasi' : row.paymentStatus === 'refunded' ? 'Dikembalikan (simulasi)' : 'Belum dibayar (simulasi)'}</p><div className="actions"><a className="button secondary" href={`/api/appointments/${row.id}/calendar`} download>Unduh ICS</a>{row.status === 'confirmed' && <>{role !== 'staff' && <><button className="secondary" disabled={busy === row.id} onClick={() => action(row.id, 'pay')}>Bayar simulasi</button><button className="danger" disabled={busy === row.id} onClick={() => action(row.id, 'cancel')}>Batalkan</button></>}{role !== 'customer' && <button disabled={busy === row.id} onClick={() => action(row.id, 'complete')}>Tandai selesai</button>}</>}</div><p className="hint">Pembatalan/pembayaran hanya sebelum mulai. Selesai hanya sesudah waktu berakhir; server memeriksa waktu terkini.</p></li>)}</ul>
    <div className="actions"><button className="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))}>Sebelumnya</button><button className="secondary" disabled={rows.data.nextOffset === null} onClick={() => setOffset(rows.data!.nextOffset!)}>Berikutnya</button></div></>}
    </section></>;
}
