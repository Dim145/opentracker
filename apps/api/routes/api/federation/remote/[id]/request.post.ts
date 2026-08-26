/**
 * POST /api/federation/remote/:id/request   { categoryId?, rewardPoints? }
 *
 * The request→fill bridge (M1). A member sees a release on a partner they cannot
 * pull, and raises a request for it HERE — a normal `upload_request`, filled by a
 * local member who has the content (through their own partner account, a seedbox,
 * anywhere) by uploading it to us. No bytes cross a tracker outside its rules; the
 * federation only made "who wants what" legible.
 *
 * The request is pre-filled from the mirror row (title, category via the taxonomy
 * bridge, the origin's content key for proving a fill), and the members who also
 * hold an account on that partner — the people most able to fill — are notified
 * first.
 */
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { requireAuthSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { holdReward, RewardError } from '~~/utils/requestPoints';
import { notifyMany } from '~~/utils/notify';
import { NOT_MASKED } from '~~/utils/federation/remoteMask';
import {
  fillersForPeer,
  openFederatedRequestId,
  resolveLocalCategoryForRemote,
} from '~~/utils/federation/federatedRequest';

const bodySchema = z.object({
  categoryId: z.string().min(1).max(128).optional(),
  rewardPoints: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

export default defineEventHandler(async (event) => {
  const { user } = await requireAuthSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, message: 'Missing id' });
  const body = await readValidatedBody(event, bodySchema.parse);

  const [row] = await db
    .select({
      id: schema.remoteTorrents.id,
      peerId: schema.remoteTorrents.peerId,
      name: schema.remoteTorrents.name,
      infoHash: schema.remoteTorrents.infoHash,
      categorySlug: schema.remoteTorrents.categorySlug,
      categoryType: schema.remoteTorrents.categoryType,
      contentRootV2: schema.remoteTorrents.contentRootV2,
      recordId: schema.remoteTorrents.recordId,
    })
    .from(schema.remoteTorrents)
    // Masked by a moderator = not a release this instance re-exposes, so it is
    // not one a member may turn into a public request either.
    .where(and(eq(schema.remoteTorrents.id, id), NOT_MASKED))
    .limit(1);
  if (!row) {
    throw createError({ statusCode: 404, message: 'Federated release not found' });
  }

  // Already asked for here? Don't raise a second bounty for the same content —
  // hand back the one that already exists while it is still open.
  const existingId = await openFederatedRequestId(row.infoHash);
  if (existingId) return { id: existingId, deduped: true };

  const categoryId = await resolveLocalCategoryForRemote(
    row.categorySlug,
    row.categoryType,
    body.categoryId,
  );
  if (!categoryId) {
    throw createError({
      statusCode: 400,
      message:
        'No local category maps to this release. Pass categoryId to choose one.',
    });
  }

  const peer = await db.query.federationPeers.findFirst({
    where: eq(schema.federationPeers.id, row.peerId),
    columns: { displayName: true, baseUrl: true, status: true },
  });
  // De-trusted peer: its cached rows are not purged on a status change, so a
  // stale mirror row must not seed a request. The detail route refuses the same
  // way.
  if (!peer || peer.status !== 'active') {
    throw createError({ statusCode: 404, message: 'Federated release not found' });
  }
  const peerName = peer.displayName || peer.baseUrl || 'a partner';

  const requestId = randomUUID();
  try {
    await db.transaction(async (tx) => {
      if (body.rewardPoints > 0) {
        await holdReward(tx, user.id, body.rewardPoints);
      }
      await tx.insert(schema.uploadRequests).values({
        id: requestId,
        requesterId: user.id,
        categoryId,
        title: row.name.slice(0, 200),
        description: `Requested from a release mirrored from ${peerName}. A member who holds this content can fill it by uploading it here.`,
        rewardPoints: body.rewardPoints,
        status: 'requested',
        federatedPeerId: row.peerId,
        federatedInfoHash: row.infoHash,
        federatedContentRootV2: row.contentRootV2,
      });
    });
  } catch (err) {
    if (err instanceof RewardError) {
      throw createError({ statusCode: err.statusCode, message: err.message });
    }
    throw err;
  }

  // Notify the members who also have a proven account on that partner — the ones
  // most likely to already hold the content. Best-effort; a notify hiccup must
  // not undo the request.
  try {
    const targets = await fillersForPeer(row.peerId, user.id);
    if (targets.length) {
      await notifyMany(
        targets,
        'federated_request_created',
        { title: row.name, peerName, rewardPoints: body.rewardPoints },
        `/requests/${requestId}`,
      );
    }
  } catch {
    /* the request stands regardless */
  }

  return { id: requestId };
});
