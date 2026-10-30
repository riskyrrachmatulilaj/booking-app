import { handleCatalog } from '@/server/catalog';
export const runtime = 'nodejs';
export const GET = (request: Request) => handleCatalog('services', request);
export const POST = (request: Request) => handleCatalog('services', request);
export const PATCH = (request: Request) => handleCatalog('services', request);
