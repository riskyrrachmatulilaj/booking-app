import AppShell from '@/components/app-shell';
import AppointmentList from '@/components/appointment-list';
import { pageActor } from '@/server/page-actor';
export const dynamic = 'force-dynamic';
export default async function Page() {
  const actor = await pageActor();
  
  return <AppShell role={actor.role}><header className="page-header"><h1>Ringkasan</h1></header><AppointmentList dashboard role={actor.role} /></AppShell>;
}
