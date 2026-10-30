import { z } from 'zod';
import { requireActor } from '@/server/auth';
import { getSlots } from '@/server/availability';
import { apiResponse } from '@/server/http';
export const GET = (request: Request) => apiResponse(async () => {
  await requireActor();
  const input = z.object({ serviceId: z.uuid(), staffId: z.uuid(), date: z.string() }).strict().parse(Object.fromEntries(new URL(request.url).searchParams));
  return Response.json(await getSlots(input, new Date()));
});
