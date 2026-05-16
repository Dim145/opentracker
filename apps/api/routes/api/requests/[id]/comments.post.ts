/**
 * POST /api/requests/:id/comments
 *
 * Append a comment to a request thread. Open to any authenticated
 * user — discussion isn't gated by participation (a third party
 * might want to point the requester at an existing torrent or ask
 * for clarification). The notify fan-out targets the requester and
 * the current filler when either is not the author.
 */
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { notify } from '~~/utils/notify';

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z.object({
  body: z.string().min(1).max(4000),
});

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const { id } = paramsSchema.parse(getRouterParams(event));
  const body = await readValidatedBody(event, bodySchema.parse);

  const request = await db.query.uploadRequests.findFirst({
    where: eq(schema.uploadRequests.id, id),
    columns: {
      id: true,
      title: true,
      requesterId: true,
      filledById: true,
      status: true,
    },
  });
  if (!request) {
    throw createError({ statusCode: 404, message: 'Request not found' });
  }
  // Discussion is closed on resolved requests — validated and
  // cancelled rows are case-closed records, not active threads.
  if (request.status === 'validated' || request.status === 'cancelled') {
    throw createError({
      statusCode: 400,
      message: 'Discussion is closed on this request',
    });
  }

  const commentId = randomUUID();
  await db.insert(schema.uploadRequestComments).values({
    id: commentId,
    requestId: id,
    authorId: user.id,
    body: body.body,
  });

  // Notify the requester + the active filler (if any), excluding
  // the comment's author from their own ping.
  const targets = new Set<string>();
  if (request.requesterId !== user.id) targets.add(request.requesterId);
  if (request.filledById && request.filledById !== user.id) {
    targets.add(request.filledById);
  }
  for (const targetId of targets) {
    void notify(
      targetId,
      'request_new_comment',
      {
        requestId: id,
        requestTitle: request.title,
        authorUsername: user.username,
        preview: body.body.slice(0, 200),
      },
      `/requests/${id}`,
    );
  }

  return { id: commentId };
});
