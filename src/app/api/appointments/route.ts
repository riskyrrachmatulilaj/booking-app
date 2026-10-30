import { handleAppointments } from '@/server/appointments';
export const GET = (request: Request) => handleAppointments(request);
export const POST = (request: Request) => handleAppointments(request);
