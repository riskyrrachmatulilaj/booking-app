import AppShell from '@/components/app-shell';
import StaffEditor from '@/components/staff-editor';
import { pageActor } from '@/server/page-actor';
export const dynamic = 'force-dynamic';
export default async function Page() {
  const actor = await pageActor();
  if (actor.role !== 'admin') return <AppShell role={actor.role}><h1>Akses ditolak</h1><p>Halaman ini hanya tersedia untuk Admin.</p></AppShell>;
  return <AppShell role={actor.role}><header className="page-header"><span className="eyebrow">ORANG & KETERSEDIAAN</span><h1>Tim & jam kerja</h1><p>Kelola anggota tim dan waktu layanan agar jadwal tetap tertata.</p></header><StaffEditor /></AppShell>;
}
