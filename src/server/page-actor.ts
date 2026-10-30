import { redirect } from 'next/navigation';
import { requireActor } from './auth';
import { HttpError } from './http';
export async function pageActor() {
  let actor;
  try { actor = await requireActor(); }
  catch (error) { if (error instanceof HttpError && error.status === 401) redirect('/login'); throw error; }
  return actor;
}
