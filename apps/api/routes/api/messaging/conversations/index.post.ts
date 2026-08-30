/**
 * POST /api/messaging/conversations
 *
 * Open a conversation with a member, or return the one that already
 * exists — a pair has at most one DM, so this is idempotent by design and
 * pressing "message" twice is not an error.
 *
 * `encrypted` is accepted **only here**. The flag is immutable after
 * creation: a conversation half of which is encrypted is unreadable to
 * render, to export and to report on, and impossible to explain to the
 * person using it.
 */
import { db, schema } from '@trackarr/db';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';
import { requireDmAccess } from '~~/utils/messaging/guard';
import {
  findDirectConversation,
  findOrCreateDirectConversation,
} from '~~/utils/messaging/conversations';
import {
  CONVERSATIONS_PER_DAY,
  conversationsOpenedToday,
} from '~~/utils/messaging/moderation';

const bodySchema = z
  .object({
    username: z.string().trim().min(1).max(64),
    encrypted: z.boolean().optional(),
  })
  .strict();

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await requireDmAccess(user);
  await rateLimit(event, RATE_LIMITS.mutation);

  const body = await validateBody(event, bodySchema);

  // An erased account keeps its row, blanked. It must not be a valid
  // recipient: the conversation would have nobody left to read it.
  const target = await db.query.users.findFirst({
    where: and(eq(schema.users.username, body.username), isNull(schema.users.deletedAt)),
    columns: { id: true, username: true, displayName: true },
  });
  if (!target) {
    throw createError({ statusCode: 404, message: 'No such member' });
  }

  // The per-minute limiter stops a burst; this stops the patient version —
  // one new conversation a minute, all day. Checked before the lookup so
  // an existing conversation is never refused by it: reopening a thread
  // you already have is not opening a new one.
  const existing = await findDirectConversation(user.id, target.id);
  if (!existing && (await conversationsOpenedToday(user.id)) >= CONVERSATIONS_PER_DAY) {
    throw createError({
      statusCode: 429,
      message: `At most ${CONVERSATIONS_PER_DAY} new conversations a day`,
    });
  }

  /*
   * An encrypted conversation needs BOTH published keys, and the flag is
   * immutable — so accepting `encrypted: true` against a member who has
   * never published one creates a thread neither side can ever open, for
   * ever. The client hides the checkbox in that case, but the client's
   * answer is debounced and it kept the previous recipient's: typing a
   * name and pressing Enter fast enough ticked the box for somebody it
   * had not looked up. The rule belongs here.
   *
   * Skipped when a conversation already exists: the flag was decided when
   * it was created and this request cannot change it.
   */
  if (body.encrypted && !existing) {
    const peerKey = await db.query.userMessageKeys.findFirst({
      where: eq(schema.userMessageKeys.userId, target.id),
      columns: { userId: true },
    });
    if (!peerKey) {
      throw createError({
        statusCode: 409,
        message: 'That member has not published a key — this conversation cannot be encrypted',
      });
    }
  }

  const { conversation, created } = await findOrCreateDirectConversation(
    user.id,
    target.id,
    {
      encrypted: body.encrypted,
      // Staff bypass the queue, as the design always said they would.
      // Checked on the SENDER's session, so it cannot be claimed.
      direct: !!user.isAdmin || !!user.isModerator,
    }
  );

  return {
    id: conversation.id,
    encrypted: conversation.encrypted,
    created,
    with: target,
  };
});
