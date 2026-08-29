/**
 * POST /api/messaging/conversations/:id/messages
 *
 * Send. This is the write path, and it stays in the API for the reason
 * the plan gives: permissions, rate limits and moderation live here, and
 * a delivery service that only fans out never has to know about them.
 *
 * The payload has to match the conversation. An encrypted conversation
 * takes `cipher`+`iv` and refuses plaintext; a plain one is the reverse.
 * The database enforces it too — this check exists to answer with a
 * readable 400 rather than a constraint violation.
 */
import { db, schema } from '@trackarr/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';
import { requireDmAccess } from '~~/utils/messaging/guard';
import {
  participantOf,
  recordMessage,
} from '~~/utils/messaging/conversations';

/** Long enough for a real message, short enough not to be a document. */
const BODY_MAX = 4000;

const bodySchema = z
  .object({
    body: z.string().trim().min(1).max(BODY_MAX).optional(),
    cipher: z.string().base64().max(BODY_MAX * 2).optional(),
    iv: z.string().base64().max(64).optional(),
  })
  .strict();

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await requireDmAccess(user);
  await rateLimit(event, RATE_LIMITS.mutation);

  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, message: 'Missing id' });

  const membership = await participantOf(id, user.id);
  if (!membership || membership.state === 'blocked') {
    throw createError({ statusCode: 404, message: 'Not found' });
  }

  const conversation = await db.query.conversations.findFirst({
    where: eq(schema.conversations.id, id),
  });
  if (!conversation) {
    throw createError({ statusCode: 404, message: 'Not found' });
  }

  const body = await validateBody(event, bodySchema);

  if (conversation.encrypted) {
    if (!body.cipher || !body.iv || body.body) {
      throw createError({
        statusCode: 400,
        message: 'This conversation is encrypted — send cipher and iv',
      });
    }
  } else if (!body.body || body.cipher || body.iv) {
    throw createError({
      statusCode: 400,
      message: 'This conversation is not encrypted — send body',
    });
  }

  const message = await recordMessage({
    conversationId: id,
    authorId: user.id,
    body: conversation.encrypted ? undefined : body.body,
    cipher: body.cipher ? Buffer.from(body.cipher, 'base64') : undefined,
    iv: body.iv ? Buffer.from(body.iv, 'base64') : undefined,
  });

  // Answering the sender is not the same as replying to a stranger:
  // writing into a conversation you were invited to accepts it.
  if (membership.state === 'pending') {
    await db
      .update(schema.conversationParticipants)
      .set({ state: 'active' })
      .where(
        and(
          eq(schema.conversationParticipants.conversationId, id),
          eq(schema.conversationParticipants.userId, user.id)
        )
      );
  }

  return {
    id: message!.id,
    createdAt: message!.createdAt,
  };
});
