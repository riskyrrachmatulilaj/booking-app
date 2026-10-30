import { redirect } from 'next/navigation';
import { pageActor } from '@/server/page-actor';
export const dynamic = 'force-dynamic';
export default async function Home() {
  await pageActor();
  redirect('/dashboard');
}
