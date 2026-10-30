import { handleCatalog } from '@/server/catalog';
export const runtime = 'nodejs';
export const GET = (request: Request) => handleCatalog('business', request);
export const PATCH = (request: Request) => handleCatalog('business', request);
