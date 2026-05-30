/**
 * PUT /api/torrents/:hash/federate-swarm  — authenticated.
 *
 * Per-torrent opt-in for swarm federation (Phase 4). The uploader (or staff)
 * marks a torrent so its peers may be shared with / mixed from partner
 * instances that have a swarm-scoped link. Off by default.
 *
 * Body: { enabled: boolean }
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { requireAuthSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';

const bodySchema = z.object({ enabled: z.boolean() });

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const hash = getRouterParam(event, 'hash')?.toLowerCase();
  if (!hash || !/^[0-9a-f]{40}$/.test(hash)) {
    throw createError({ statusCode: 400, message: 'Invalid info hash' });
  }
  const body = await validateBody(event, bodySchema);

  const [t] = await db
    .select({ id: schema.torrents.id, uploaderId: schema.torrents.uploaderId })
    .from(schema.torrents)
    .where(eq(schema.torrents.infoHash, hash))
    .limit(1);
  if (!t) throw createError({ statusCode: 404, message: 'Torrent not found' });

  const isStaff = !!session.user.isAdmin || !!session.user.isModerator;
  if (t.uploaderId !== session.user.id && !isStaff) {
    throw createError({ statusCode: 403, message: 'Not your torrent' });
  }

  await db
    .update(schema.torrents)
    .set({ federateSwarm: body.enabled })
    .where(eq(schema.torrents.id, t.id));

  return { ok: true, federateSwarm: body.enabled };
});
