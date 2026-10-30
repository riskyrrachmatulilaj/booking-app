import AppShell from '@/components/app-shell';
import ProfileForm from '@/components/profile-form';
import { pageActor } from '@/server/page-actor';
export const dynamic = 'force-dynamic';
export default async function Page() {
  const actor = await pageActor();
  
  return <AppShell role={actor.role}><header className="page-header"><span className="eyebrow">PREFERENSI AKUN</span><h1>Pengaturan</h1><p>Perbarui profil dan sesuaikan informasi bisnis Anda.</p></header><ProfileForm admin={actor.role === 'admin'} /></AppShell>;
}
