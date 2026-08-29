/**
 * POST /api/messaging/blocks
 *
 * Refuse a member. Symmetric and immediate: neither side can open a
 * conversation with the other, and neither can write into one they share.
 *
 * Nothing is sent to the blocked party. A refusal that notifies is an
 * invitation to come back from another account, and from their side this
 * has to be indistinguishable from someone who simply stopped replying.
 */
import { db, schema } from '@trackarr/db';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';
import { requireDmAccess } from '~~/utils/messaging/guard';

const bodySchema = z.object({ username: z.string().trim().min(1).max(64) }).strict();

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await requireDmAccess(user);
  await rateLimit(event, RATE_LIMITS.mutation);

  const body = await validateBody(event, bodySchema);
  const target = await db.query.users.findFirst({
    where: eq(schema.users.username, body.username),
    columns: { id: true },
  });
  if (!target) throw createError({ statusCode: 404, message: 'No such member' });
  if (target.id === user.id) {
    throw createError({ statusCode: 400, message: 'Cannot block yourself' });
  }

  await db
    .insert(schema.messagingBlocks)
    .values({ userId: user.id, blockedId: target.id })
    .onConflictDoNothing();

  // Any conversation they share goes quiet on this side. The row is kept
  // rather than deleted: the staff may still need it behind a report, and
  // deleting it would take the other party's copy with it.
  const shared = await db
    .select({ id: schema.conversationParticipants.conversationId })
    .from(schema.conversationParticipants)
    .where(eq(schema.conversationParticipants.userId, target.id));

  if (shared.length > 0) {
    await db
      .update(schema.conversationParticipants)
      .set({ state: 'blocked' })
      .where(
        and(
          eq(schema.conversationParticipants.userId, user.id),
          inArray(
            schema.conversationParticipants.conversationId,
            shared.map((s) => s.id)
          )
        )
      );
  }

  return { ok: true };
});
