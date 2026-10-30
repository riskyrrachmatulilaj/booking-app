import { handleReminderCron } from '@/server/reminders';
export const runtime = 'nodejs';
export const POST = (request: Request) => handleReminderCron(request);
