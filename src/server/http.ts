import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function assertOrigin(request: Request): void {
  const configured = process.env.APP_URL;
  if (!configured && process.env.NODE_ENV === 'production') throw new Error('APP_URL is required in production');
  const allowed = new URL(configured || 'http://localhost:3000').origin;
  if (request.headers.get('origin') !== allowed) throw new HttpError(403, 'Origin tidak diizinkan');
}
export async function apiResponse(action: () => Promise<Response>): Promise<Response> {
  try { return await action(); }
  catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof ZodError || error instanceof SyntaxError) return Response.json({ error: 'Data tidak valid' }, { status: 400 });
    // Do not expose database details, credentials, or request payloads.
    console.error('Authentication request failed', error instanceof Error ? error.name : 'UnknownError');
    return Response.json({ error: 'Kesalahan server' }, { status: 500 });
  }
}
