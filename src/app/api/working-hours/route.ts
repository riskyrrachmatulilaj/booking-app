import { handleCatalog } from '@/server/catalog';
export const runtime = 'nodejs';
export const GET = (request: Request) => handleCatalog('working-hours', request);
export const POST = (request: Request) => handleCatalog('working-hours', request);
export const PATCH = (request: Request) => handleCatalog('working-hours', request);
