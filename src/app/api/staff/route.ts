import { handleCatalog } from '@/server/catalog';
export const runtime = 'nodejs';
export const GET = (request: Request) => handleCatalog('staff', request);
export const POST = (request: Request) => handleCatalog('staff', request);
export const PATCH = (request: Request) => handleCatalog('staff', request);
