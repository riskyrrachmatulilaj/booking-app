'use client';
import { useState, type FormEvent } from 'react';
import { api, Feedback, PasswordInput, ResourceState, useResource, type Service, type Staff } from './ui';
type Hours = { weekday: number; start: string; end: string };
const weekdays = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
export default function StaffEditor() {
  const staff = useResource<Staff[]>('staff?includeInactive=true');
  const services = useResource<Service[]>('services');
  const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; setBusy(true); setError(''); setMessage('');
    try { await api('staff', 'POST', Object.fromEntries(new FormData(form))); form.reset(); setMessage('Akun staf dibuat. Tetapkan layanan dan jam kerja di bawah.'); staff.reload(); }
    catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  return <><section className="panel"><h2>Tambah akun staf</h2><form onSubmit={create}><div className="form-grid"><label>Nama staf<input name="name" required maxLength={120} autoComplete="off" /></label><label>Email staf<input name="email" type="email" required maxLength={254} autoComplete="off" /></label><div className="field"><label htmlFor="staff-password">Kata sandi awal</label><PasswordInput id="staff-password" name="password" required minLength={12} maxLength={128} autoComplete="new-password" /></div></div><p className="hint">Minimal 12 karakter. Berikan kredensial kepada staf melalui saluran aman.</p><Feedback error={error} message={message} /><button disabled={busy}>{busy ? 'Membuat…' : 'Tambah staf'}</button></form></section><section className="panel"><h2>Staf, penugasan & jam kerja</h2><ResourceState loading={staff.loading || services.loading} error={staff.error || services.error} retry={() => { staff.reload(); services.reload(); }} />{staff.data?.length === 0 && <p>Belum ada staf. Buat akun staf terlebih dahulu.</p>}{staff.data && services.data && staff.data.map(row => <details key={row.id}><summary>{row.name} · {row.active ? 'Aktif' : 'Nonaktif'}</summary><StaffDetails row={row} services={services.data!} onSaved={staff.reload} /></details>)}</section></>;
}
function StaffDetails({ row, services, onSaved }: { row: Staff; services: Service[]; onSaved: () => void }) {
  const hours = useResource<Hours[]>(`working-hours?staffId=${row.id}&includeInactive=true`);
  const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>, working = false) {
    event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); setError(''); setMessage('');
    try {
      if (working) {
        const records = data.getAll('weekday').map((day, index) => ({ weekday: Number(day), start: String(data.getAll('start')[index]), end: String(data.getAll('end')[index]) }));
        await api('working-hours', 'PATCH', { staffId: row.id, hours: records }); hours.reload();
      } else {
        const selected = data.getAll('serviceIds').map(String);
        const visibleAssigned = (row.serviceIds || []).filter(id => services.some(service => service.id === id));
        const changed = selected.length !== visibleAssigned.length || selected.some(id => !visibleAssigned.includes(id));
        if (changed && (row.serviceIds || []).some(id => !services.some(service => service.id === id)) && !window.confirm('Mengganti penugasan akan menghapus penugasan layanan nonaktif yang tidak ditampilkan. Lanjutkan?')) return;
        await api('staff', 'PATCH', { id: row.id, name: data.get('name'), active: data.get('active') === 'on', ...(changed ? { serviceIds: selected } : {}) }); onSaved();
      }
      setMessage('Perubahan staf tersimpan.');
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  return <><form onSubmit={event => save(event)}><label>Nama staf<input name="name" required maxLength={120} defaultValue={row.name} /></label><label className="check"><input name="active" type="checkbox" defaultChecked={row.active} />Staf aktif</label><fieldset><legend>Layanan yang ditangani</legend>{services.length === 0 && <p>Tambahkan layanan aktif terlebih dahulu.</p>}{services.map(service => <label className="check" key={service.id}><input name="serviceIds" type="checkbox" value={service.id} defaultChecked={row.serviceIds?.includes(service.id)} />{service.name}</label>)}</fieldset><button disabled={busy}>Simpan staf & penugasan</button></form><h3>Jam kerja</h3><p>Waktu lokal bisnis. Jam beririsan atau lintas tengah malam ditolak. Hapus semua baris untuk menutup jadwal staf.</p><ResourceState loading={hours.loading} error={hours.error} retry={hours.reload} />{hours.data && <HoursForm key={JSON.stringify(hours.data)} initial={hours.data} busy={busy} onSave={event => save(event, true)} />}<Feedback error={error} message={message} /></>;
}
function HoursForm({ initial, busy, onSave }: { initial: Hours[]; busy: boolean; onSave: (event: FormEvent<HTMLFormElement>) => void }) {
  const [rows, setRows] = useState(initial.map((row, index) => ({ ...row, key: index })));
  return <form onSubmit={onSave}>{rows.map((row, index) => <div className="hours-row" key={row.key}><label>Hari<select name="weekday" defaultValue={row.weekday}>{weekdays.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label><label>Mulai<input name="start" type="time" required defaultValue={row.start} /></label><label>Selesai<input name="end" type="time" required defaultValue={row.end} /></label><button className="danger" type="button" aria-label={`Hapus jam kerja baris ${index + 1}`} onClick={() => setRows(rows.filter(item => item.key !== row.key))}>Hapus</button></div>)}{rows.length === 0 && <p>Belum ada jam kerja. Staf tidak menawarkan slot.</p>}<div className="actions"><button className="secondary" type="button" onClick={() => setRows([...rows, { weekday: 1, start: '09:00', end: '17:00', key: Math.max(-1, ...rows.map(row => row.key)) + 1 }])}>Tambah rentang jam</button><button disabled={busy}>Simpan jam kerja</button></div></form>;
}
