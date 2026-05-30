/**
 * DELETE /api/federation/follows  — authenticated.
 *
 * Unfollow a remote uploader. Idempotent. Body: { peerId, username }.
 */
import { and, eq } from 'drizzle-orm';
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

  await db
    .delete(schema.federatedFollows)
    .where(
      and(
        eq(schema.federatedFollows.localUserId, session.user.id),
        eq(schema.federatedFollows.peerId, body.peerId),
        eq(schema.federatedFollows.remoteUsername, body.username),
      ),
    );

  return { ok: true, following: false };
});
