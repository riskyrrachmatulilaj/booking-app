'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api, Feedback, PasswordInput } from '@/components/ui';
export default function AuthForm({ register = false }: { register?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try { await api(`auth/${register ? 'register' : 'login'}`, 'POST', data); router.push('/dashboard'); router.refresh(); }
    catch (error) { setError((error as Error).message); setBusy(false); }
  }
  return <form onSubmit={submit} aria-busy={busy}>
    {register && <label>Nama<input name="name" autoComplete="name" required maxLength={100} /></label>}
    <label>Email<input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
    <div className="field">
      <label htmlFor="password">Kata sandi</label>
      <PasswordInput
        id="password"
        name="password"
        autoComplete={register ? 'new-password' : 'current-password'}
        required
        minLength={register ? 12 : 1}
        maxLength={128}
        aria-describedby={register ? 'password-hint' : undefined}
      />
    </div>
    {register && <p className="hint" id="password-hint">Minimal 12 karakter. Akun baru berperan sebagai Pelanggan.</p>}
    <Feedback error={error} /><button disabled={busy} type="submit">{busy ? 'Memproses…' : register ? 'Daftar' : 'Masuk'}</button>
    <Link className="auth-switch" href={register ? '/login' : '/register'}>{register ? 'Sudah punya akun? Masuk' : 'Buat akun pelanggan'}</Link>
  </form>;
}
