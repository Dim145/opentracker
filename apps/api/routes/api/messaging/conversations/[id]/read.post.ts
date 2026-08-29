/**
 * POST /api/messaging/conversations/:id/read
 *
 * Mark the conversation read up to now.
 *
 * The client calls this at most once every few seconds and on blur, never
 * once per message seen. At ten thousand people online that difference is
 * the whole write budget of the feature — a per-message write would make
 * reading more expensive than sending.
 *
 * Idempotent: marking an already-read conversation costs one UPDATE that
 * changes nothing.
 */
import { db, schema } from '@trackarr/db';
import { and, eq, inArray } from 'drizzle-orm';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { requireDmAccess } from '~~/utils/messaging/guard';
import {
  participantOf,
  participantsOf,
} from '~~/utils/messaging/conversations';
import { publishToUsers } from '~~/utils/messaging/relay';

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await requireDmAccess(user);
  await rateLimit(event, RATE_LIMITS.public);

  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, message: 'Missing id' });

  const membership = await participantOf(id, user.id);
  if (!membership || membership.state === 'blocked') {
    throw createError({ statusCode: 404, message: 'Not found' });
  }

  const readAt = new Date();
  await db
    .update(schema.conversationParticipants)
    .set({ lastReadAt: readAt, unreadCount: 0 })
    .where(
      and(
        eq(schema.conversationParticipants.conversationId, id),
        eq(schema.conversationParticipants.userId, user.id)
      )
    );

  // Reciprocal: the receipt goes out only if this member accepts receiving
  // them. Turning the setting off stops sending AND stops seeing — the
  // asymmetric version would hand out an information advantage, which is
  // not what somebody who opts out is asking for.
  const me = await db.query.users.findFirst({
    where: eq(schema.users.id, user.id),
    columns: { messagingReadReceipts: true },
  });

  if (me?.messagingReadReceipts) {
    const others = (await participantsOf(id)).filter((u) => u !== user.id);
    // Only to those who accept them too. One side opting out silences the
    // exchange in both directions, which is the honest reading of a
    // reciprocal setting.
    const willing = others.length
      ? await db
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(
            and(
              inArray(schema.users.id, others),
              eq(schema.users.messagingReadReceipts, true)
            )
          )
      : [];
    if (willing.length) {
      await publishToUsers(
        willing.map((w) => w.id),
        { type: 'read', conversationId: id, by: user.id, at: readAt }
      );
    }
  }

  return { ok: true, readAt };
});
