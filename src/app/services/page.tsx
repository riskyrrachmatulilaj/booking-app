import AppShell from '@/components/app-shell';
import CatalogEditor from '@/components/catalog-editor';
import { pageActor } from '@/server/page-actor';
export const dynamic = 'force-dynamic';
export default async function Page() {
  const actor = await pageActor();
  if (actor.role !== 'admin') return <AppShell role={actor.role}><h1>Akses ditolak</h1><p>Halaman ini hanya tersedia untuk Admin.</p></AppShell>;
  return <AppShell role={actor.role}><header className="page-header"><span className="eyebrow">KATALOG BISNIS</span><h1>Layanan</h1><p>Atur pilihan layanan, harga, dan durasi untuk pelanggan Anda.</p></header><CatalogEditor /></AppShell>;
}
