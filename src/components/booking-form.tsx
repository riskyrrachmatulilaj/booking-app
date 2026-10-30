'use client';
import { useRef, useState, type FormEvent } from 'react';
import { api, dateTime, Feedback, localDate, ResourceState, rupiah, useResource, type Service, type Staff } from './ui';
export default function BookingForm({ timezone, onBooked }: { timezone: string; onBooked: () => void }) {
  const services = useResource<Service[]>('services');
  const [serviceId, setService] = useState('');
  const staff = useResource<Staff[]>(`staff${serviceId ? `?serviceId=${serviceId}` : ''}`);
  const [staffId, setStaff] = useState('');
  const [date, setDate] = useState(localDate(timezone));
  const [slots, setSlots] = useState<{ start: string; end: string }[] | null>(null);
  const [start, setStart] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const selected = services.data?.find(row => row.id === serviceId);
  const lookup = useRef(0);
  function resetSlots() { lookup.current++; setBusy(false); setSlots(null); setStart(''); setMessage(''); }
  async function find(event: FormEvent) {
    event.preventDefault(); const request = ++lookup.current; setBusy(true); setError(''); setStart(''); setSlots(null);
    try { const result = await api<{ start: string; end: string }[]>(`availability?${new URLSearchParams({ serviceId, staffId, date })}`); if (request === lookup.current) setSlots(result); }
    catch (error) { if (request === lookup.current) setError((error as Error).message); }
    finally { if (request === lookup.current) setBusy(false); }
  }
  async function book(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await api('appointments', 'POST', { serviceId, staffId, start }); setMessage('Booking berhasil. Lihat janji temu Anda di bawah.'); setSlots(null); setStart(''); onBooked(); }
    catch (error) { setError(`${(error as Error).message}. Cari slot lagi; pilihan layanan dan tanggal Anda tetap tersimpan.`); }
    finally { setBusy(false); }
  }
  return <section className="panel"><h2>Booking baru</h2><p>Pilih layanan dan waktu. Semua waktu mengikuti {timezone}.</p><ResourceState loading={services.loading} error={services.error} retry={services.reload} />{services.data?.length === 0 && <p>Belum ada layanan aktif. Hubungi pengelola bisnis.</p>}
    <form onSubmit={find} className="form-grid"><label>Layanan<select value={serviceId} required onChange={event => { setService(event.target.value); setStaff(''); resetSlots(); }}><option value="">Pilih layanan</option>{services.data?.map(row => <option key={row.id} value={row.id}>{row.name} · {rupiah(row.price)} · {row.durationMinutes} menit</option>)}</select></label>
    <label>Staf<select value={staff.data?.some(row => row.id === staffId) ? staffId : ''} required disabled={!serviceId || staff.loading} onChange={event => { setStaff(event.target.value); resetSlots(); }}><option value="">{staff.loading ? 'Memuat staf…' : 'Pilih staf'}</option>{serviceId && staff.data?.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
    <label>Tanggal<input type="date" required min={localDate(timezone)} value={date} onChange={event => { setDate(event.target.value); resetSlots(); }} /></label><button disabled={busy || !serviceId || !staff.data?.some(row => row.id === staffId)}>{busy ? 'Memproses…' : 'Cari slot'}</button></form>
    <ResourceState loading={!!serviceId && staff.loading} error={staff.error} retry={staff.reload} />{serviceId && staff.data?.length === 0 && <p>Tidak ada staf untuk layanan ini. Pilih layanan lain.</p>}
    {slots && <form onSubmit={book}><fieldset><legend>Waktu tersedia · {timezone}</legend>{slots.length ? <div className="slots">{slots.map(slot => <label className="slot" key={slot.start}><input type="radio" name="slot" value={slot.start} checked={start === slot.start} required onChange={() => setStart(slot.start)} />{dateTime(slot.start, timezone)}</label>)}</div> : <p>Tidak ada slot tersedia. Pilih tanggal atau staf lain.</p>}</fieldset>{start && <div className="confirmation"><h3>Periksa booking</h3><p>{selected?.name} · {selected && rupiah(selected.price)} · {selected?.durationMinutes} menit</p><p>{dateTime(start, timezone)} · {timezone}</p><p>Booking langsung dikonfirmasi. Pembayaran berikutnya hanya simulasi, tanpa uang nyata.</p><button disabled={busy}>Konfirmasi booking</button></div>}</form>}
    <Feedback error={error} message={message} /></section>;
}
