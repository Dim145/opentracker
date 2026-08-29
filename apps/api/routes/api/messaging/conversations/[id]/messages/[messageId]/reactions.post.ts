/**
 * POST /api/messaging/conversations/:id/messages/:messageId/reactions
 *
 * Toggle one reaction on one message. Sending the same key twice removes
 * it — there is no separate DELETE, because "react" and "un-react" are
 * the same gesture in every interface that has this and modelling them
 * apart only invites the two to disagree.
 *
 * Works on encrypted conversations. A reaction key is not the message: it
 * says somebody agreed, not what they agreed with, and the server could
 * not read the message anyway.
 */
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { z } from 'zod';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';
import { requireDmAccess } from '~~/utils/messaging/guard';
import { participantOf, participantsOf } from '~~/utils/messaging/conversations';
import { publishToUsers } from '~~/utils/messaging/relay';
import { REACTION_KEYS, toggleDirectReaction } from '~~/utils/messaging/reactions';

const bodySchema = z.object({ key: z.enum(REACTION_KEYS) }).strict();

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await requireDmAccess(user);
  await rateLimit(event, RATE_LIMITS.mutation);

  const id = getRouterParam(event, 'id');
  const messageId = getRouterParam(event, 'messageId');
  if (!id || !messageId) {
    throw createError({ statusCode: 400, message: 'Missing id' });
  }

  // Membership is the authorisation, and 404 rather than 403 for the same
  // reason as everywhere else on this surface: probing ids must tell you
  // nothing about which ones exist.
  const membership = await participantOf(id, user.id);
  if (!membership || membership.state === 'blocked') {
    throw createError({ statusCode: 404, message: 'Not found' });
  }

  const body = await validateBody(event, bodySchema);

  // The message has to be in THIS conversation. Without the second
  // clause, a member of any conversation could react to any message id.
  const message = await db.query.messages.findFirst({
    where: and(
      eq(schema.messages.id, messageId),
      eq(schema.messages.conversationId, id)
    ),
    columns: { id: true, deletedAt: true },
  });
  if (!message) throw createError({ statusCode: 404, message: 'Not found' });
  if (message.deletedAt) {
    throw createError({
      statusCode: 409,
      message: 'That message was removed',
    });
  }

  const action = await toggleDirectReaction(messageId, user.id, body.key);

  // A delta, not the aggregate: four fields regardless of how popular the
  // message is, and the client already holds the count it is adjusting.
  const others = await participantsOf(id);
  await publishToUsers(others, {
    type: 'reaction',
    conversationId: id,
    messageId,
    key: body.key,
    delta: action === 'added' ? 1 : -1,
    userId: user.id,
  });

  return { key: body.key, action };
});
