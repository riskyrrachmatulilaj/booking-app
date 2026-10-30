import { handleCalendar } from '@/server/calendar';
type Context = { params: Promise<{ id: string }> };
export const GET = async (request: Request, context: Context) => handleCalendar(request, (await context.params).id);
