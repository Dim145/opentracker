/**
 * POST /api/mod/torrents/:hash/reset
 *
 * Move a `rejected` torrent back into the moderation queue. This is
 * the only way out of `rejected` — the uploader cannot edit a
 * rejected row, so a staff member has to re-open the case manually.
 *
 * Body: `{ message }` (required) explaining the about-face. Lands on
 * `pending` by default, or another status if the staffer specifies
 * one (`changes_requested` and `accepted` both make sense in
 * practice — accept it directly if the original rejection was a
 * mistake; ask for changes if the underlying issue can be fixed).
 */
import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod/v4';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { reevaluateUserRole } from '~~/utils/roleRules';
import { validateBody } from '~~/utils/schemas';
import {
  transitionStatus,
  type ModerationStatus,
} from '~~/utils/torrentModeration';

const bodySchema = z.object({
  message: z.string().trim().min(1, 'A note is required').max(4000),
  // The reset target — anything except `rejected` is fair (you can
  // already reach `rejected` via /reject; bouncing right back is
  // pointless and the schema forbids it).
  to: z
    .enum(['pending', 'accepted', 'changes_requested'])
    .default('pending'),
});

export default defineEventHandler(async (event) => {
  const session = await requireModeratorSession(event);
  const hash = getRouterParam(event, 'hash');
  if (!hash) {
    throw createError({ statusCode: 400, message: 'Torrent hash is required' });
  }
  const body = await validateBody(event, bodySchema);

  const torrent = await db.query.torrents.findFirst({
    where: eq(schema.torrents.infoHash, hash.toLowerCase()),
    columns: { id: true, uploaderId: true, moderationStatus: true },
  });
  if (!torrent) {
    throw createError({ statusCode: 404, message: 'Torrent not found' });
  }
  if (torrent.moderationStatus !== 'rejected') {
    throw createError({
      statusCode: 409,
      message: '/reset is only valid for rejected torrents.',
    });
  }

  const updated = await transitionStatus({
    torrentId: torrent.id,
    nextStatus: body.to as ModerationStatus,
    actorId: session.user.id,
    body: body.message,
  });

  // Re-eval roles in case `accepted` was reached — `approvedUploads`
  // would tick up.
  if (updated.uploaderId && body.to === 'accepted') {
    void reevaluateUserRole(updated.uploaderId).catch((err) => {
      console.error('[Roles] post-reset sweep failed:', err);
    });
  }

  return { success: true, torrent: updated };
});
