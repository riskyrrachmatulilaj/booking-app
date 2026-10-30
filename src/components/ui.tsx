'use client';
import { useEffect, useRef, useState } from 'react';

export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Permintaan gagal. Coba lagi.');
  return data as T;
}
export function useResource<T>(path: string) {
  const [state, setState] = useState<{ path: string; version: number; data?: T; error: string }>({ path: '', version: -1, error: '' });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    api<T>(path).then(data => { if (live) setState({ path, version, data, error: '' }); }).catch(error => { if (live) setState({ path, version, error: error.message }); });
    return () => { live = false; };
  }, [path, version]);
  const current = state.path === path && state.version === version;
  const samePath = state.path === path;
  return { data: samePath ? state.data : undefined, error: current ? state.error : '', loading: !current, reload: () => setVersion(value => value + 1) };
}
export function PasswordInput({ id, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { id: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="password-field">
      <input id={id} type={show ? 'text' : 'password'} {...props} />
      <button
        type="button"
        className="password-toggle"
        onClick={() => setShow(prev => !prev)}
        aria-label={show ? 'Sembunyikan sandi' : 'Tampilkan sandi'}
        aria-pressed={show}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          {show ? (
            <>
              <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
              <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
              <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
              <line x1="2" y1="2" x2="22" y2="22" />
            </>
          ) : (
            <>
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
              <circle cx="12" cy="12" r="3" />
            </>
          )}
        </svg>
      </button>
    </div>
  );
}
export function Feedback({ error, message }: { error?: string; message?: string }) {
  const summary = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) summary.current?.focus(); }, [error]);
  return <>{error && <p ref={summary} tabIndex={-1} className="notice error" role="alert">{error}</p>}{message && <p className="notice success" role="status">{message}</p>}</>;
}
export function ResourceState({ loading, error, retry }: { loading: boolean; error: string; retry: () => void }) {
  return <>{loading && <p role="status">Memuat data…</p>}{error && <div className="notice error"><p role="alert">{error}</p><button type="button" className="secondary" onClick={retry}>Coba lagi</button></div>}</>;
}
export const rupiah = (value: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
export const dateTime = (value: string, timezone: string) => new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(value));
export const localDate = (timezone: string) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export type Service = { id: string; name: string; price: number; durationMinutes: number; active: boolean };
export type Staff = { id: string; name: string; active: boolean; serviceIds?: string[] };
export type Business = { name: string; timezone: string };
