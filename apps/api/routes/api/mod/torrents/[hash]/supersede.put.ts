/**
 * PUT /api/mod/torrents/:hash/supersede   { supersededById, reason? }
 *
 * Mark this release as replaced by a better one — "trumping", in the vocabulary
 * of the trackers that have had it for twenty years.
 *
 * ## What it does not do
 *
 * It does not retire the older release. It stays listed, stays downloadable,
 * keeps its swarm, and its snatchers keep their hit-and-run obligations. People
 * are seeding it; pulling it out from under them would turn a tidy-up into a
 * hit-and-run of the operator's own making.
 *
 * What changes is that both pages say so. A member choosing between two copies
 * of the same work is told which one the staff consider current, and the older
 * page points at the newer. That is the whole feature — a catalogue with no way
 * to express "this replaces that" ages by accumulating duplicates of uneven
 * quality with no hierarchy between them.
 *
 * ## The guards, and why each one exists
 *
 *   - **Not itself.** A row superseded by itself would render a page pointing
 *     at itself and, worse, would make the chain walk below never terminate.
 *   - **No cycle.** A supersedes B supersedes A is the same non-termination
 *     reached the long way round. Walked forward from the target, bounded.
 *   - **The target must be `accepted`.** Pointing members at something pending
 *     or rejected sends them to a page they may not be allowed to read.
 *   - **The target must not itself be superseded.** Otherwise the pointer sends
 *     a member to a dead end, and they have to walk the chain by hand. Staff are
 *     told to point at the head of the chain instead.
 *
 * Lifting the marking again is the sibling `supersede.delete.ts`.
 *
 * Both verbs land in the staff audit log — they are mutating calls under
 * `/api/mod/`, so the hook records them whether or not this route says anything.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod/v4';
import { db, schema } from '@trackarr/db';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { auditDetail } from '~~/utils/audit';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';

const bodySchema = z.object({
  /** The replacement's infohash — what a moderator has in front of them. */
  supersededById: z.string().regex(/^[a-fA-F0-9]{40}$/),
  reason: z.string().trim().max(500).optional(),
});

/** How far a supersede chain may be walked before we call it a cycle. */
const MAX_CHAIN = 32;

export default defineEventHandler(async (event) => {
  await requireModeratorSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);

  const hash = getRouterParam(event, 'hash');
  if (!hash) {
    throw createError({ statusCode: 400, message: 'Torrent hash is required' });
  }
  const infoHash = hash.toLowerCase();

  const source = await db.query.torrents.findFirst({
    where: eq(schema.torrents.infoHash, infoHash),
    columns: { id: true, name: true, supersededById: true },
  });
  if (!source) {
    throw createError({ statusCode: 404, message: 'Torrent not found' });
  }

  const body = await validateBody(event, bodySchema);
  const targetHash = body.supersededById.toLowerCase();

  if (targetHash === infoHash) {
    throw createError({
      statusCode: 400,
      message: 'A release cannot supersede itself.',
    });
  }

  const target = await db.query.torrents.findFirst({
    where: eq(schema.torrents.infoHash, targetHash),
    columns: {
      id: true,
      name: true,
      moderationStatus: true,
      isActive: true,
      supersededById: true,
    },
  });
  if (!target) {
    throw createError({
      statusCode: 404,
      message: 'The replacement torrent was not found.',
    });
  }
  if (target.moderationStatus !== 'accepted' || !target.isActive) {
    throw createError({
      statusCode: 400,
      message:
        'The replacement must be an accepted, active release — otherwise the pointer sends members to a page they may not be able to read.',
    });
  }
  if (target.supersededById) {
    throw createError({
      statusCode: 400,
      message:
        'That release is itself superseded. Point at the head of the chain instead.',
    });
  }

  // Walk forward from the target: if the chain reaches back to the source, the
  // pointer would close a loop. Bounded by MAX_CHAIN so a pre-existing cycle in
  // the data — which this route refuses to create, but a restore or a manual
  // edit could — cannot hang the request.
  let cursor: string | null = target.id;
  for (let i = 0; cursor && i < MAX_CHAIN; i++) {
    if (cursor === source.id) {
      throw createError({
        statusCode: 400,
        message: 'That would create a supersede loop.',
      });
    }
    const next: { supersededById: string | null } | undefined =
      await db.query.torrents.findFirst({
        where: eq(schema.torrents.id, cursor),
        columns: { supersededById: true },
      });
    cursor = next?.supersededById ?? null;
  }

  auditDetail(event, {
    action: 'torrent.supersede',
    targetType: 'torrent',
    targetId: source.id,
    targetLabel: source.name,
    changes: {
      supersededBy: { from: source.supersededById, to: target.id },
      supersededByName: target.name,
      ...(body.reason ? { reason: body.reason } : {}),
    },
  });

  await db
    .update(schema.torrents)
    .set({
      supersededById: target.id,
      supersededAt: new Date(),
      supersedeReason: body.reason ?? null,
    })
    // Guarded on the value we read, so two moderators racing on the same row
    // cannot interleave into a state neither of them chose. `isNull` rather
    // than `eq(col, null)`: the latter compiles to `= NULL`, which is never
    // true, and the guard would silently match nothing.
    .where(
      and(
        eq(schema.torrents.id, source.id),
        source.supersededById === null
          ? isNull(schema.torrents.supersededById)
          : eq(schema.torrents.supersededById, source.supersededById)
      )
    );

  return {
    success: true,
    supersededBy: { infoHash: targetHash, name: target.name },
  };
});
