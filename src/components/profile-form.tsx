'use client';
import { useState, type FormEvent } from 'react';
import { api, Feedback, ResourceState, useResource, type Business } from './ui';
type Profile = { name: string; email: string; whatsappPhone: string | null; whatsappOptedInAt: string | null };
export default function ProfileForm({ admin }: { admin: boolean }) {
  const profile = useResource<Profile>('profile'); const business = useResource<Business>('business');
  return <><section className="panel"><h2>Profil & persetujuan WhatsApp</h2><ResourceState loading={profile.loading} error={profile.error} retry={profile.reload} />{profile.data && <Consent profile={profile.data} />}</section>{admin && <section className="panel"><h2>Pengaturan bisnis</h2><ResourceState loading={business.loading} error={business.error} retry={business.reload} />{business.data && <BusinessForm business={business.data} />}</section>}</>;
}
function Consent({ profile }: { profile: Profile }) {
  const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); setError(''); setMessage('');
    try { await api('profile', 'PATCH', { whatsappPhone: String(data.get('phone')).trim() || null, optIn: data.get('optIn') === 'on' }); setMessage('Preferensi tersimpan. Ini bukan konfirmasi pengiriman pengingat.'); }
    catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  return <><p><strong>{profile.name}</strong><br />{profile.email}</p><form onSubmit={save}><label>Nomor WhatsApp (opsional)<input name="phone" type="tel" autoComplete="tel" pattern="\+[1-9][0-9]{7,14}" defaultValue={profile.whatsappPhone || ''} placeholder="+6281234567890" aria-describedby="phone-hint" /></label><p id="phone-hint" className="hint">Format internasional E.164, misalnya +6281234567890.</p><label className="check"><input name="optIn" type="checkbox" defaultChecked={!!profile.whatsappOptedInAt} />Saya setuju menerima pengingat janji temu melalui WhatsApp ke nomor ini.</label><p>Pengingat direncanakan 24 jam sebelum booking yang memenuhi syarat. Pengiriman memerlukan provider dan scheduler aktif. Mencabut persetujuan membatalkan pengingat tertunda; tidak menghapus booking.</p><Feedback error={error} message={message} /><button disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan preferensi'}</button></form></>;
}
function BusinessForm({ business }: { business: Business }) {
  const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try { await api('business', 'PATCH', Object.fromEntries(new FormData(event.currentTarget))); setMessage('Pengaturan bisnis tersimpan. Booking lama tetap pada instan UTC semula.'); }
    catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  return <form onSubmit={save}><label>Nama bisnis<input name="name" defaultValue={business.name} required maxLength={120} /></label><label>Zona waktu IANA<input name="timezone" defaultValue={business.timezone} required maxLength={100} aria-describedby="timezone-hint" /></label><p id="timezone-hint">Contoh: Asia/Jakarta. Perubahan memengaruhi pencarian slot berikutnya, bukan waktu booking lama.</p><Feedback error={error} message={message} /><button disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan bisnis'}</button></form>;
}
