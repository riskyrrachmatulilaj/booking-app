import { handleAuth } from '@/server/auth';
export const runtime = 'nodejs';
export async function POST(request: Request) { return handleAuth('logout', request); }
