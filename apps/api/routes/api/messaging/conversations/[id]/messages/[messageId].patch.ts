/**
 * PATCH /api/messaging/conversations/:id/messages/:messageId
 *
 * Edit your own message.
 *
 * `messages.edited_at` has existed since the table did, and until now
 * nothing could ever set it: the API returned the field on every message
 * and there was no route to write it. This closes that.
 *
 * The edit is not silent. `editedAt` is returned to every reader and the
 * interface shows it, because an edit that leaves no mark lets somebody
 * rewrite what they said after being answered — which on a surface where
 * reports quote messages is not a cosmetic problem.
 *
 * Authorship only. Staff can remove a message, and that is a different
 * act with a different record: removal is visible as removal, and
 * rewriting somebody's words in their name is not a moderation power
 * anyone should have.
 */
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { z } from 'zod';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';
import { requireDmAccess } from '~~/utils/messaging/guard';
import {
  participantOf,
  participantsOf,
  requireNoBlockInConversation,
  requireUnarchivedSeat,
} from '~~/utils/messaging/conversations';
import { publishToUsers } from '~~/utils/messaging/relay';

const BODY_MAX = 4000;

const bodySchema = z
  .object({
    body: z.string().trim().min(1).max(BODY_MAX).optional(),
    cipher: z.string().base64url().max(16000).optional(),
    iv: z.string().base64url().max(64).optional(),
  })
  .strict();

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await requireDmAccess(user);
  await rateLimit(event, RATE_LIMITS.mutation);

  const id = getRouterParam(event, 'id');
  const messageId = getRouterParam(event, 'messageId');
  if (!id || !messageId) {
    throw createError({ statusCode: 400, message: 'Missing id' });
  }

  const membership = await participantOf(id, user.id);
  requireUnarchivedSeat(membership);
  if (!membership || membership.state === 'blocked') {
    throw createError({ statusCode: 404, message: 'Not found' });
  }
  await requireNoBlockInConversation(id, user.id);

  const conversation = await db.query.conversations.findFirst({
    where: eq(schema.conversations.id, id),
    columns: { encrypted: true },
  });
  if (!conversation) throw createError({ statusCode: 404, message: 'Not found' });

  const body = await validateBody(event, bodySchema);

  // The same payload rule as sending, and it has to be repeated rather
  // than assumed: an edit that switched a conversation's messages from
  // ciphertext to plaintext would silently publish them.
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

  const message = await db.query.messages.findFirst({
    where: and(
      eq(schema.messages.id, messageId),
      eq(schema.messages.conversationId, id)
    ),
    columns: { id: true, authorId: true, isSystem: true, deletedAt: true },
  });
  if (!message) throw createError({ statusCode: 404, message: 'Not found' });

  // 403 rather than 404 here, unlike the lookups above: the caller is in
  // the conversation and can already see the message. Hiding its
  // existence at this point would only be confusing.
  if (message.authorId !== user.id) {
    throw createError({ statusCode: 403, message: 'Not your message' });
  }
  if (message.isSystem) {
    throw createError({ statusCode: 403, message: 'System messages cannot be edited' });
  }
  if (message.deletedAt) {
    throw createError({ statusCode: 409, message: 'That message was removed' });
  }

  const editedAt = new Date();
  await db
    .update(schema.messages)
    .set({
      body: conversation.encrypted ? null : (body.body ?? null),
      cipher: body.cipher ? Buffer.from(body.cipher, 'base64url') : null,
      iv: body.iv ? Buffer.from(body.iv, 'base64url') : null,
      editedAt,
    })
    .where(eq(schema.messages.id, messageId));

  // No unread bump: an edit is not a new message, and making it one would
  // let somebody re-notify a thread by retyping a word.
  await publishToUsers(await participantsOf(id), {
    type: 'edit',
    conversationId: id,
    messageId,
    body: conversation.encrypted ? null : (body.body ?? null),
    cipher: body.cipher ?? null,
    iv: body.iv ?? null,
    editedAt: editedAt.toISOString(),
  });

  return { id: messageId, editedAt };
});
