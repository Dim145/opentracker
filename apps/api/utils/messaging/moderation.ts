import { db, schema } from '@trackarr/db';
import { and, eq, gte, or, sql } from 'drizzle-orm';

/**
 * Moderation primitives for messaging: who may reach whom, and how much.
 */

/**
 * Is either side refusing the other?
 *
 * Symmetric on purpose. A block stops the conversation in both
 * directions, because the alternative — the blocker can still write, the
 * blocked cannot — is a shape people use to get the last word.
 */
export async function blockExistsBetween(a: string, b: string) {
  const rows = await db
    .select({ userId: schema.messagingBlocks.userId })
    .from(schema.messagingBlocks)
    .where(
      or(
        and(
          eq(schema.messagingBlocks.userId, a),
          eq(schema.messagingBlocks.blockedId, b)
        ),
        and(
          eq(schema.messagingBlocks.userId, b),
          eq(schema.messagingBlocks.blockedId, a)
        )
      )
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * How many conversations this member has opened today.
 *
 * The per-minute rate limit stops a burst; this stops the patient version
 * of the same abuse — one new conversation a minute, all day, spread
 * across three hundred thousand members. The limiter would never fire.
 */
export const CONVERSATIONS_PER_DAY = 30;

export async function conversationsOpenedToday(userId: string) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.conversations)
    .where(
      and(
        eq(schema.conversations.createdById, userId),
        eq(schema.conversations.kind, 'dm'),
        gte(schema.conversations.createdAt, since)
      )
    );
  return row?.count ?? 0;
}

/**
 * May this viewer read the message behind a report?
 *
 * Staff, and only for a message that has actually been reported — the
 * inbox of a private conversation is not something a moderator browses,
 * it is something a report opens one message of. And an encrypted
 * conversation yields nothing whatever the role: the server holds
 * ciphertext and no key, which is the honest answer rather than an error.
 */
export async function reportedMessageFor(messageId: string) {
  const reported = await db
    .select({ id: schema.reports.id })
    .from(schema.reports)
    .where(
      and(
        eq(schema.reports.targetType, 'message'),
        eq(schema.reports.targetId, messageId)
      )
    )
    .limit(1);
  if (reported.length === 0) return null;

  const message = await db.query.messages.findFirst({
    where: eq(schema.messages.id, messageId),
  });
  if (!message) return null;

  const conversation = await db.query.conversations.findFirst({
    where: eq(schema.conversations.id, message.conversationId),
  });

  return {
    id: message.id,
    conversationId: message.conversationId,
    authorId: message.authorId,
    createdAt: message.createdAt,
    deletedAt: message.deletedAt,
    encrypted: !!conversation?.encrypted,
    // Null when the conversation is encrypted, and that is not a failure
    // to report: nobody holds the key, including us.
    body: conversation?.encrypted ? null : message.body,
  };
}

/** Everyone this member is refusing, for the settings screen. */
export async function blocksOf(userId: string) {
  return db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      displayName: schema.users.displayName,
      createdAt: schema.messagingBlocks.createdAt,
    })
    .from(schema.messagingBlocks)
    .leftJoin(
      schema.users,
      eq(schema.users.id, schema.messagingBlocks.blockedId)
    )
    .where(eq(schema.messagingBlocks.userId, userId));
}
