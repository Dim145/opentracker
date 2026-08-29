/**
 * DELETE /api/messaging/blocks/:username
 *
 * Lift a block. The shared conversation comes back as `pending` rather
 * than `active`: unblocking is not the same as agreeing to a conversation
 * again, so it lands in requests and waits to be accepted.
 */
import { db, schema } from '@trackarr/db';
import { and, eq, inArray } from 'drizzle-orm';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { requireDmAccess } from '~~/utils/messaging/guard';

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await requireDmAccess(user);
  await rateLimit(event, RATE_LIMITS.mutation);

  const username = getRouterParam(event, 'username');
  if (!username) throw createError({ statusCode: 400, message: 'Missing username' });

  const target = await db.query.users.findFirst({
    where: eq(schema.users.username, username),
    columns: { id: true },
  });
  if (!target) throw createError({ statusCode: 404, message: 'No such member' });

  await db
    .delete(schema.messagingBlocks)
    .where(
      and(
        eq(schema.messagingBlocks.userId, user.id),
        eq(schema.messagingBlocks.blockedId, target.id)
      )
    );

  // Bring the shared conversation back — as `pending`, not `active`.
  //
  // The comment used to say this and the code did not do it, so lifting a
  // block left the thread invisible to the person who had blocked: the
  // refusal was gone but the conversation stayed buried. The e2e caught
  // it.
  //
  // `pending` rather than `active` because unblocking is not the same as
  // agreeing to talk again. It lands back in requests and waits.
  const theirs = await db
    .select({ id: schema.conversationParticipants.conversationId })
    .from(schema.conversationParticipants)
    .where(eq(schema.conversationParticipants.userId, target.id));

  if (theirs.length > 0) {
    await db
      .update(schema.conversationParticipants)
      .set({ state: 'pending' })
      .where(
        and(
          eq(schema.conversationParticipants.userId, user.id),
          eq(schema.conversationParticipants.state, 'blocked'),
          inArray(
            schema.conversationParticipants.conversationId,
            theirs.map((t) => t.id)
          )
        )
      );
  }

  return { ok: true };
});
