/**
 * POST /api/federation/follows  — authenticated.
 *
 * Follow a remote uploader on a partner instance. Purely local: the
 * catalogue sync already mirrors the partner's torrents, so when a new one
 * from this uploader lands the follower gets a `federated_followed_upload`
 * notice. No S2S Follow protocol — the partner is never told.
 *
 * Body: { peerId, username }
 */
import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { requireAuthSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';

const bodySchema = z.object({
  peerId: z.string().min(1).max(64),
  username: z.string().trim().min(1).max(120),
});

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const body = await validateBody(event, bodySchema);

  const [peer] = await db
    .select({ id: schema.federationPeers.id, status: schema.federationPeers.status })
    .from(schema.federationPeers)
    .where(eq(schema.federationPeers.id, body.peerId))
    .limit(1);
  if (!peer) throw createError({ statusCode: 404, message: 'Unknown peer' });
  if (peer.status !== 'active') {
    throw createError({ statusCode: 400, message: 'Peer is not active' });
  }

  await db
    .insert(schema.federatedFollows)
    .values({
      id: uuid(),
      localUserId: session.user.id,
      peerId: body.peerId,
      remoteUsername: body.username,
    })
    .onConflictDoNothing();

  return { ok: true, following: true };
});
