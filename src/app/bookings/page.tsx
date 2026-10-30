import AppShell from '@/components/app-shell';
import AppointmentList from '@/components/appointment-list';
import { pageActor } from '@/server/page-actor';
export const dynamic = 'force-dynamic';
export default async function Page() {
  const actor = await pageActor();
  
  return <AppShell role={actor.role}><header className="page-header"><span className="eyebrow">JADWAL & PEMESANAN</span><h1>Janji temu</h1><p>Temukan waktu yang sesuai dan kelola setiap pemesanan di satu tempat.</p></header><AppointmentList role={actor.role} /></AppShell>;
}
