'use client';
import { useState, type FormEvent } from 'react';
import { api, Feedback, ResourceState, rupiah, useResource, type Service } from './ui';
export default function CatalogEditor() {
  const rows = useResource<Service[]>('services?includeInactive=true');
  return <><ResourceState loading={rows.loading} error={rows.error} retry={rows.reload} /><section className="panel"><h2>Tambah layanan</h2><ServiceForm onSaved={rows.reload} /></section><section className="panel"><h2>Katalog layanan</h2><p>Nonaktifkan layanan untuk menghentikan booking baru tanpa menghapus riwayat.</p>{rows.data?.length === 0 && <p>Belum ada layanan. Tambahkan layanan pertama di atas.</p>}{rows.data?.map(row => <details key={row.id}><summary>{row.name} · {rupiah(row.price)} · {row.durationMinutes} menit · {row.active ? 'Aktif' : 'Nonaktif'}</summary><ServiceForm row={row} onSaved={rows.reload} /></details>)}</section></>;
}
function ServiceForm({ row, onSaved }: { row?: Service; onSaved: () => void }) {
  const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); setBusy(true); setError(''); setMessage('');
    try { await api('services', row ? 'PATCH' : 'POST', { ...(row ? { id: row.id, active: data.get('active') === 'on' } : {}), name: data.get('name'), price: Number(data.get('price')), durationMinutes: Number(data.get('durationMinutes')) }); setMessage('Layanan tersimpan.'); if (!row) form.reset(); onSaved(); }
    catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  return <form onSubmit={save}><div className="form-grid"><label>Nama layanan<input name="name" required maxLength={120} defaultValue={row?.name} /></label><label>Harga (Rp)<input name="price" type="number" required min={0} max={2147483647} step={1} defaultValue={row?.price} /></label><label>Durasi (menit)<input name="durationMinutes" type="number" required min={1} max={1440} step={1} defaultValue={row?.durationMinutes} /></label></div>{row && <label className="check"><input type="checkbox" name="active" defaultChecked={row.active} />Layanan aktif</label>}<Feedback error={error} message={message} /><button disabled={busy}>{busy ? 'Menyimpan…' : row ? 'Simpan layanan' : 'Tambah layanan'}</button></form>;
}
