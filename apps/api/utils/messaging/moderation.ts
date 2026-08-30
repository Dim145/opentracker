import { db, schema } from '@trackarr/db';
import { and, eq, gte, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

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
        eq(schema.reports.targetId, messageId),
        // While the report is OPEN, not for ever after.
        //
        // Without this, one report — even one the staff themselves
        // dismissed, or one the reporter withdrew — left that private
        // message readable by every moderator permanently. The window is
        // the report; closing the report closes the window.
        eq(schema.reports.status, 'pending')
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
    /** For the access log. Which report opened the window. */
    reportId: reported[0]!.id,
  };
}

/**
 * Record that a staff member read a reported private message.
 *
 * On the READ, never on the report. A report is somebody asking; this is
 * somebody looking, and only the second is an access to private data.
 * They are different acts and usually days apart.
 *
 * `readerName` is stored alongside the id because the id is nulled when
 * that account is erased, and a log that becomes a column of nulls in the
 * one case where it matters most — the reader themselves — is not a log.
 *
 * The message id is deliberately NOT a foreign key: retention or a
 * withdrawal can remove the message, and the record of it having been
 * read must survive that. An audit trail that disappears with its subject
 * is the shape of the problem, not the fix.
 *
 * Best-effort, and it says so out loud rather than in a comment: a failed
 * write must not swallow the moderator's answer, but it must not be
 * silent either — an accountability record nobody notices missing is
 * worse than none.
 */
export async function logReportedMessageRead(input: {
  readerId: string;
  readerName: string;
  messageId: string;
  conversationId: string;
  reportId: string | null;
  disclosed: boolean;
}): Promise<void> {
  try {
    await db.insert(schema.messageReadLog).values({
      id: randomUUID(),
      readerId: input.readerId,
      readerName: input.readerName,
      messageId: input.messageId,
      conversationId: input.conversationId,
      reportId: input.reportId,
      disclosed: input.disclosed,
    });
  } catch (err) {
    console.error(
      '[moderation] failed to log a reported-message read:',
      (err as Error).message
    );
  }
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
