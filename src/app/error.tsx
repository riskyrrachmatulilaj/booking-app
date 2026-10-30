'use client';
import Link from 'next/link';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="workspace"><h1>Halaman belum dapat dimuat</h1><p role="alert">Tidak dapat membaca data. Periksa koneksi dan konfigurasi server, lalu coba lagi.</p><div className="actions"><button onClick={reset}>Coba lagi</button><Link className="button secondary" href="/login">Kembali ke halaman masuk</Link></div></main>;
}
