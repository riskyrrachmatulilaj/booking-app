import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Booking B2B', description: 'Pengelolaan janji temu bisnis' };
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="id"><body>{children}</body></html>;
}
