import AppShell from '@/components/app-shell';
import AppointmentList from '@/components/appointment-list';
import { pageActor } from '@/server/page-actor';
export const dynamic = 'force-dynamic';
export default async function Page() {
  const actor = await pageActor();
  
  return <AppShell role={actor.role}><header className="page-header"><span className="eyebrow">RUANG KERJA ANDA</span><h1>Ringkasan</h1><p>Pantau janji temu dan kelola hari Anda dengan lebih tenang.</p></header><AppointmentList dashboard role={actor.role} /></AppShell>;
}
