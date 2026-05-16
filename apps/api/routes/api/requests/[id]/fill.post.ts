/**
 * POST /api/requests/:id/fill
 *
 * Propose a torrent against an open request. Validation:
 *   - request must be in `requested` (not `filled`, `cancelled`,
 *     `validated`)
 *   - the caller can't fill their own request (self-reward abuse)
 *   - the torrent must exist and be `accepted` (rejected /
 *     pending torrents shouldn't earn rewards)
 *   - the caller must be the uploader of the torrent — otherwise
 *     anyone could claim someone else's upload as a fill
 *   - the caller's per-request attempt count must be below the
 *     operator-set cap (REQUEST_MAX_FILLS_PER_USER)
 *
 * On success: a `proposed` attempt row + request transitions to
 * `filled` + the requester is notified.
 */
import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { notify } from '~~/utils/notify';
import { getRequestMaxFillsPerUser } from '~~/utils/settings';

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z.object({
  // Accept either the SHA-1 infoHash or the internal uuid. The FE
  // form binds to infoHash (more user-friendly to paste) but the
  // detail-page "Fill" button can shortcut with the id directly.
  infoHash: z.string().min(40).max(40).optional(),
  torrentId: z.string().uuid().optional(),
}).refine((b) => b.infoHash || b.torrentId, {
  message: 'infoHash or torrentId is required',
});

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const { id } = paramsSchema.parse(getRouterParams(event));
  const body = await readValidatedBody(event, bodySchema.parse);

  const request = await db.query.uploadRequests.findFirst({
    where: eq(schema.uploadRequests.id, id),
  });
  if (!request) {
    throw createError({ statusCode: 404, message: 'Request not found' });
  }
  if (request.status !== 'requested') {
    throw createError({
      statusCode: 400,
      message: 'This request is not open for new proposals',
    });
  }
  if (request.requesterId === user.id) {
    throw createError({
      statusCode: 400,
      message: 'You cannot fill your own request',
    });
  }

  const torrent = await db.query.torrents.findFirst({
    where: body.torrentId
      ? eq(schema.torrents.id, body.torrentId)
      : eq(schema.torrents.infoHash, body.infoHash!.toLowerCase()),
    columns: {
      id: true,
      infoHash: true,
      name: true,
      uploaderId: true,
      categoryId: true,
      moderationStatus: true,
    },
  });
  if (!torrent) {
    throw createError({ statusCode: 404, message: 'Torrent not found' });
  }
  if (torrent.moderationStatus !== 'accepted') {
    throw createError({
      statusCode: 400,
      message: 'Only accepted torrents can fill a request',
    });
  }
  if (torrent.uploaderId !== user.id) {
    throw createError({
      statusCode: 403,
      message: 'Only the uploader of the torrent can use it as a fill',
    });
  }

  // Category match. Exact-match is too strict — a request filed
  // against "TV" should accept a fill in any "TV/*" subcategory.
  // We walk the category tree upward from the torrent's category
  // looking for the request's category as an ancestor (or self).
  if (torrent.categoryId !== request.categoryId) {
    let cursor: string | null = torrent.categoryId ?? null;
    let matched = false;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      if (cursor === request.categoryId) {
        matched = true;
        break;
      }
      const parent: { parentId: string | null } | undefined =
        await db.query.categories.findFirst({
          where: eq(schema.categories.id, cursor),
          columns: { parentId: true },
        });
      cursor = parent?.parentId ?? null;
    }
    if (!matched) {
      throw createError({
        statusCode: 400,
        message:
          "Torrent category doesn't match the request's category",
      });
    }
  }

  // Enforce the per-user attempt cap. Each rejected proposal
  // counts; the active `proposed` row also counts so a user can't
  // bypass by stacking unresolved proposals (only one proposal
  // can be active at a time per request anyway).
  const maxAttempts = await getRequestMaxFillsPerUser();
  const [{ value: attempts } = { value: 0 }] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(schema.uploadRequestFillAttempts)
    .where(
      and(
        eq(schema.uploadRequestFillAttempts.requestId, id),
        eq(schema.uploadRequestFillAttempts.userId, user.id),
      ),
    );
  if (attempts >= maxAttempts) {
    throw createError({
      statusCode: 400,
      message: `You have reached the maximum of ${maxAttempts} proposals on this request`,
    });
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(schema.uploadRequestFillAttempts).values({
      id: randomUUID(),
      requestId: id,
      userId: user.id,
      torrentId: torrent.id,
      status: 'proposed',
    });
    await tx
      .update(schema.uploadRequests)
      .set({
        status: 'filled',
        filledById: user.id,
        filledTorrentId: torrent.id,
        filledAt: now,
        updatedAt: now,
      })
      .where(eq(schema.uploadRequests.id, id));
  });

  // Notify the requester. Best-effort — a notify failure must not
  // sink the fill.
  void notify(
    request.requesterId,
    'request_filled',
    {
      requestId: id,
      requestTitle: request.title,
      fillerUsername: user.username,
      torrentName: torrent.name,
      torrentInfoHash: torrent.infoHash,
    },
    `/requests/${id}`,
  );

  return { success: true };
});
