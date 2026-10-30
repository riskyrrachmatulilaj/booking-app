import { eq } from 'drizzle-orm';
import { db, users, requireDatabaseConfig } from '@/db';
import { requireActor, type Actor } from './auth';
import { apiResponse, HttpError } from './http';

export function handleProfileRead(actorOverride?: Actor) {
  return apiResponse(async () => {
    const actor = actorOverride ?? await requireActor();
    requireDatabaseConfig();
    const [profile] = await db.select({ name: users.name, email: users.email, role: users.role, whatsappPhone: users.whatsappPhone, whatsappOptedInAt: users.whatsappOptedInAt }).from(users).where(eq(users.id, actor.id)).limit(1);
    if (!profile) throw new HttpError(404, 'Profil tidak ditemukan');
    return Response.json(profile, { headers: { 'Cache-Control': 'private, no-store' } });
  });
}
