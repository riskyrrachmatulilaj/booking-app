import { handleProfileRead } from '@/server/profile';
import { handleProfile } from '@/server/reminders';
export const GET = () => handleProfileRead();
export const PATCH = (request: Request) => handleProfile(request);
