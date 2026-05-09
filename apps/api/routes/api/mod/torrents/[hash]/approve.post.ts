/**
 * POST /api/mod/torrents/:hash/approve
 *
 * Move a torrent to `accepted`. Optional message body — accepts go
 * through silently more often than rejects, but the moderator can
 * still leave a note ("Looks good, thanks!"). The row is logged to
 * the moderation thread either way so the timeline stays complete.
 */
import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod/v4';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { reevaluateUserRole } from '~~/utils/roleRules';
import { validateBody } from '~~/utils/schemas';
import { transitionStatus } from '~~/utils/torrentModeration';

const bodySchema = z
  .object({
    message: z.string().trim().max(4000).optional(),
  })
  .optional()
  .default({});

export default defineEventHandler(async (event) => {
  const session = await requireModeratorSession(event);
  const hash = getRouterParam(event, 'hash');
  if (!hash) {
    throw createError({ statusCode: 400, message: 'Torrent hash is required' });
  }

  const torrent = await db.query.torrents.findFirst({
    where: eq(schema.torrents.infoHash, hash.toLowerCase()),
    columns: { id: true, uploaderId: true, moderationStatus: true },
  });
  if (!torrent) {
    throw createError({ statusCode: 404, message: 'Torrent not found' });
  }
  if (torrent.moderationStatus === 'accepted') {
    throw createError({
      statusCode: 409,
      message: 'Torrent is already accepted.',
    });
  }

  const raw = await readBody(event).catch(() => ({}));
  const parsed = bodySchema.safeParse(raw ?? {});
  const message = parsed.success ? parsed.data?.message?.trim() : undefined;

  const updated = await transitionStatus({
    torrentId: torrent.id,
    nextStatus: 'accepted',
    actorId: session.user.id,
    body: message && message.length > 0 ? message : null,
  });

  // Crossing the approval line bumps the uploader's `approvedUploads`
  // count, which can in turn satisfy auto-role rules. Fire-and-forget
  // so the moderator's request isn't held up by the sweep.
  if (updated.uploaderId) {
    void reevaluateUserRole(updated.uploaderId).catch((err) => {
      console.error('[Roles] post-approve sweep failed:', err);
    });
  }

  return { success: true, torrent: updated };
});
