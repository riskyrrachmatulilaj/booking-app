import { handleAppointments } from '@/server/appointments';
type Context = { params: Promise<{ id: string }> };
export const GET = async (request: Request, context: Context) => handleAppointments(request, (await context.params).id);
export const PATCH = async (request: Request, context: Context) => handleAppointments(request, (await context.params).id);
