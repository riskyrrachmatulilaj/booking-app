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
  async function logout() {
    setBusy(true); setError('');
    try { await api('auth/logout', 'POST', {}); router.push('/login'); router.refresh(); }
    catch (error) { setError((error as Error).message); setBusy(false); }
  }
  return <div className="app"><a className="skip" href="#content">Lewati navigasi</a><aside className="rail"><Link href="/dashboard" className="brand">Booking B2B</Link><p className="role">{({ admin: 'Admin', staff: 'Staf', customer: 'Pelanggan' })[role]}</p><nav aria-label="Navigasi utama">{links.filter(([href]) => role === 'admin' || !['/services', '/team'].includes(href)).map(([href, label, drawing]) => <Link key={href} href={href} aria-current={path === href ? 'page' : undefined}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d={drawing} /></svg>{label}</Link>)}</nav><button className="logout" disabled={busy} onClick={logout}>{busy ? 'Keluar…' : 'Keluar'}</button><Feedback error={error} /></aside><main id="content" className="workspace">{children}</main></div>;
}
