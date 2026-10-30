'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Role } from '@/server/auth';
import { api, Feedback } from './ui';
const links = [
  ['/dashboard', 'Ringkasan', 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z'],
  ['/bookings', 'Janji temu', 'M4 5h16v16H4z M8 2v6 M16 2v6 M4 11h16'],
  ['/services', 'Layanan', 'M4 5h16v16H4z M8 9h8 M8 13h8 M8 17h5'],
  ['/team', 'Tim & jam kerja', 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 3a4 4 0 1 0 0 8a4 4 0 0 0 0-8 M17 4a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-4'],
  ['/settings', 'Pengaturan', 'M4 7h16 M4 17h16 M8 4v6 M16 14v6'],
];
export default function AppShell({ role, children }: { role: Role; children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const roleLabel = ({ admin: 'Admin', staff: 'Staf', customer: 'Pelanggan' })[role];
  const pageLabel = links.find(([href]) => href === path)?.[1] ?? 'Ruang kerja';
  async function logout() {
    setBusy(true); setError('');
    try { await api('auth/logout', 'POST', {}); router.push('/login'); router.refresh(); }
    catch (error) { setError((error as Error).message); setBusy(false); }
  }
  return <div className="app">
    <a className="skip" href="#content">Lewati navigasi</a>
    <aside className="rail">
      <Link href="/dashboard" className="brand"><span className="brand-mark"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M5 5h14v16H5z M8 2v6 M16 2v6 M5 11h14 M9 15l2 2 4-4" /></svg></span><span>Booking <span className="brand-light">B2B</span></span></Link>
      <div className="rail-workspace"><span className="workspace-symbol" aria-hidden="true">B</span><div><strong>Ruang kerja bisnis</strong><span>Pengelolaan jadwal</span></div></div>
      <p className="nav-caption">MENU UTAMA</p>
      <nav aria-label="Navigasi utama">{links.filter(([href]) => role === 'admin' || !['/services', '/team'].includes(href)).map(([href, label, drawing]) => <Link key={href} href={href} aria-current={path === href ? 'page' : undefined}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d={drawing} /></svg>{label}</Link>)}</nav>
      <div className="rail-bottom"><div className="rail-note"><span className="eyebrow">LEBIH TERATUR, LEBIH TENANG</span><p>Satu tempat untuk jadwal dan layanan Anda.</p></div><div className="rail-account"><span className="avatar" aria-hidden="true">{roleLabel[0]}</span><div><strong>{roleLabel}</strong><span>Akun Anda</span></div></div><button className="logout" disabled={busy} onClick={logout}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M9 4H4v16h5 M13 8l4 4-4 4 M8 12h13" /></svg>{busy ? 'Keluar…' : 'Keluar'}</button><Feedback error={error} /></div>
    </aside>
    <div className="main-area"><header className="topbar"><div className="breadcrumb">Ruang kerja <span aria-hidden="true">/</span> <strong>{pageLabel}</strong></div><div className="topbar-account"><span className="account-role">{roleLabel}</span><span className="avatar" aria-hidden="true">{roleLabel[0]}</span></div></header><main id="content" className="workspace">{children}<footer className="workspace-footer"><span>Booking B2B</span><span>Jadwal tertata. Layanan terjaga.</span></footer></main></div>
  </div>;
}
