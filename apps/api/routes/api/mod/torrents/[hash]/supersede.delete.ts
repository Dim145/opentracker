/**
 * DELETE /api/mod/torrents/:hash/supersede
 *
 * Lift a supersede marking — the release is current again, or the pointer was
 * wrong. Sibling of `supersede.put.ts`, which carries the reasoning and the
 * guards; this end needs neither, because clearing a pointer cannot create a
 * loop or send anybody to a page they cannot read.
 *
 * Unconditional: clearing an already-clear marking succeeds and says so. A 404
 * for "it was not superseded anyway" would make the UI carry a state check for
 * an operation whose outcome is the same either way.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { auditDetail } from '~~/utils/audit';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';

export default defineEventHandler(async (event) => {
  await requireModeratorSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);

  const hash = getRouterParam(event, 'hash');
  if (!hash) {
    throw createError({ statusCode: 400, message: 'Torrent hash is required' });
  }

  const source = await db.query.torrents.findFirst({
    where: eq(schema.torrents.infoHash, hash.toLowerCase()),
    columns: { id: true, name: true, supersededById: true },
  });
  if (!source) {
    throw createError({ statusCode: 404, message: 'Torrent not found' });
  }

  auditDetail(event, {
    action: 'torrent.supersede.clear',
    targetType: 'torrent',
    targetId: source.id,
    targetLabel: source.name,
    changes: { supersededBy: { from: source.supersededById, to: null } },
  });

  await db
    .update(schema.torrents)
    .set({ supersededById: null, supersededAt: null, supersedeReason: null })
    .where(eq(schema.torrents.id, source.id));

  return { success: true, supersededBy: null };
});
