/**
 * DELETE /api/messaging/conversations/:id/messages/:messageId
 *
 * Withdraw a message. The author may take back their own; staff may
 * remove any.
 *
 * The row is kept and blanked rather than deleted. Three reasons, and the
 * third is the one that matters: the thread stays coherent for the other
 * reader, a report already filed still points at something, and
 * `deletedById` records who did it. A deletion with no author is a
 * deletion nobody can defend later.
 */
import { db, schema } from '@trackarr/db';
import { and, eq } from 'drizzle-orm';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { requireDmAccess } from '~~/utils/messaging/guard';
import { participantOf } from '~~/utils/messaging/conversations';

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await requireDmAccess(user);
  await rateLimit(event, RATE_LIMITS.mutation);

  const conversationId = getRouterParam(event, 'id');
  const messageId = getRouterParam(event, 'messageId');
  if (!conversationId || !messageId) {
    throw createError({ statusCode: 400, message: 'Missing id' });
  }

  const isStaff = !!user.isAdmin || !!user.isModerator;

  const message = await db.query.messages.findFirst({
    where: and(
      eq(schema.messages.id, messageId),
      eq(schema.messages.conversationId, conversationId)
    ),
  });
  if (!message) throw createError({ statusCode: 404, message: 'Not found' });

  // Staff reach it without a seat in the conversation; everybody else
  // needs one, and may only withdraw what they wrote.
  if (!isStaff) {
    const seat = await participantOf(conversationId, user.id);
    if (!seat) throw createError({ statusCode: 404, message: 'Not found' });
    if (message.authorId !== user.id) {
      throw createError({ statusCode: 403, message: 'Not your message' });
    }
  }

  if (message.deletedAt) return { ok: true, alreadyDeleted: true };

  await db
    .update(schema.messages)
    .set({
      body: null,
      cipher: null,
      iv: null,
      deletedAt: new Date(),
      deletedById: user.id,
    })
    .where(eq(schema.messages.id, messageId));

  return { ok: true, alreadyDeleted: false };
});
