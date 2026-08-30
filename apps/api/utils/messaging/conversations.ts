import { db, schema } from '@trackarr/db';
import { and, eq, ne, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { blockExistsBetween } from './moderation';

/**
 * Either the pool or an open transaction.
 *
 * Derived from `db.transaction` rather than named directly: drizzle's
 * transaction type carries the schema and the relations, so spelling it
 * out by hand would drift the moment a table is added.
 */
type Tx = Parameters<Parameters<(typeof db)['transaction']>[0]>[0];
type Executor = typeof db | Tx;

/**
 * Find the direct conversation between two members, or open one.
 *
 * A pair has at most one DM. Rather than carry a `(userA, userB)` column
 * pair — which needs a canonical ordering and a partial unique index to
 * enforce, and which makes group conversations impossible later — the
 * lookup counts participants: the DM between A and B is the `dm` whose
 * participant set is exactly {A, B}.
 *
 * The write runs inside a transaction with an advisory lock keyed on the
 * pair. Two members pressing "message" on each other at the same instant
 * is rare but not impossible, and without the lock it produces two
 * conversations that both look right and slowly diverge.
 */
export async function findOrCreateDirectConversation(
  meId: string,
  otherId: string,
  opts: {
    encrypted?: boolean;
    /**
     * Skip the first-contact queue.
     *
     * True only for staff, and it is not a convenience: a moderator
     * writing "your upload was rejected, here is why" lands in Requests
     * otherwise, next to the spam the queue exists to hold — where it can
     * be refused without being read, and refusing silently blocks the
     * sender. The member then never hears from the staff again.
     */
    direct?: boolean;
  } = {}
) {
  if (meId === otherId) {
    throw createError({
      statusCode: 400,
      message: 'Cannot open a conversation with yourself',
    });
  }

  // A block is symmetric, and it is checked here rather than only hidden
  // from the list: a refusal that merely hides is a refusal the other side
  // can walk around by keeping the URL.
  //
  // The message says nothing about who blocked whom. From the blocked
  // side this has to look like any other conversation that cannot be
  // opened, or the refusal becomes a notification.
  //
  // Staff are exempt as SENDER. `direct` is set from the sender's own
  // staff flags and nothing else, so it cannot be claimed. Without this a
  // member made themselves permanently unreachable by the moderation team
  // by blocking one of them — and a broadcast skipped them in silence,
  // because `runBroadcast` swallows the refusal and its `sent` counter
  // simply does not count them. Gazelle has the same carve-out.
  if (!opts.direct && (await blockExistsBetween(meId, otherId))) {
    throw createError({
      statusCode: 403,
      message: 'This conversation cannot be opened',
    });
  }

  const existing = await findDirectConversation(meId, otherId);
  if (existing) return { conversation: existing, created: false };

  return db.transaction(async (tx) => {
    // Same lock for (A,B) and (B,A): the pair is unordered, so the key
    // has to be too.
    const [lo, hi] = meId < otherId ? [meId, otherId] : [otherId, meId];
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`dm:${lo}:${hi}`}))`
    );

    // Somebody may have won the race between the check above and the lock.
    const raced = await findDirectConversation(meId, otherId, tx);
    if (raced) return { conversation: raced, created: false };

    const id = randomUUID();
    const now = new Date();
    const [conversation] = await tx
      .insert(schema.conversations)
      .values({
        id,
        kind: 'dm',
        encrypted: opts.encrypted ?? false,
        createdById: meId,
        createdAt: now,
        lastMessageAt: now,
      })
      .returning();

    await tx.insert(schema.conversationParticipants).values([
      { conversationId: id, userId: meId, joinedAt: now, state: 'active' },
      // The recipient starts in the first-contact queue. Accepting moves
      // it to the inbox; without this step a known uploader's inbox is
      // unusable within weeks at this membership size.
      {
        conversationId: id,
        userId: otherId,
        joinedAt: now,
        state: opts.direct ? 'active' : 'pending',
      },
    ]);

    return { conversation, created: true };
  });
}

export async function findDirectConversation(
  meId: string,
  otherId: string,
  tx: Executor = db
) {
  const rows = await tx
    .select({ id: schema.conversations.id })
    .from(schema.conversations)
    .innerJoin(
      schema.conversationParticipants,
      eq(
        schema.conversationParticipants.conversationId,
        schema.conversations.id
      )
    )
    .where(
      and(
        eq(schema.conversations.kind, 'dm'),
        sql`${schema.conversations.id} IN (
          SELECT conversation_id FROM conversation_participants WHERE user_id = ${meId}
          INTERSECT
          SELECT conversation_id FROM conversation_participants WHERE user_id = ${otherId}
        )`
      )
    )
    .groupBy(schema.conversations.id)
    // Exactly two participants — never a group that happens to contain both.
    .having(sql`count(*) = 2`)
    .limit(1);

  if (!rows[0]) return null;
  return (
    (await tx.query.conversations.findFirst({
      where: eq(schema.conversations.id, rows[0].id),
    })) ?? null
  );
}

/** The membership row, or null when the viewer is not in the conversation. */
export async function participantOf(conversationId: string, userId: string) {
  return (
    (await db.query.conversationParticipants.findFirst({
      where: and(
        eq(schema.conversationParticipants.conversationId, conversationId),
        eq(schema.conversationParticipants.userId, userId)
      ),
    })) ?? null
  );
}

/**
 * Refuse anything that would reach somebody who refused this member.
 *
 * A block is symmetric, and "symmetric" has to cover every way of
 * reaching the other side — not only a new message. Editing an old line
 * rewrites text the other side already has and pushes an `edit` frame
 * down their relay; a reaction pushes a `reaction` frame; a read receipt
 * pushes presence. Each one is a channel, and the edit one is unlimited:
 * a direct message has no edit window, so the same row can be rewritten
 * for ever.
 *
 * The refusal says "closed", never "you have been blocked" — a refusal
 * that names itself is the notification the silence exists to avoid.
 *
 * Checks BOTH directions, because `state = 'blocked'` is written only on
 * the blocker's own participant row: the blocked side's row stays
 * `active` and their seat check passes.
 */
export async function requireNoBlockInConversation(
  conversationId: string,
  userId: string
) {
  const others = (await participantsOf(conversationId)).filter(
    (u) => u !== userId
  );
  for (const other of others) {
    if (await blockExistsBetween(userId, other)) {
      throw createError({
        statusCode: 403,
        message: 'This conversation is closed',
      });
    }
  }
}

/**
 * Refuse a write from a seat that has filed the conversation away.
 *
 * Archiving is read-only, and read-only has to mean every way of writing
 * — not just new messages. Editing, withdrawing and reacting all change
 * what the other side sees and all push a frame down the relay, so a
 * thread on the shelf that can still be edited is not on a shelf.
 *
 * Takes the seat the caller has already fetched: every call site needs it
 * for its own checks, and re-reading it here would be a second query for
 * an answer already in hand.
 *
 * Staff acting without a seat pass `null` and are not concerned: their
 * authority does not come from a participant row, and moderating a
 * conversation somebody filed away is exactly when it is needed.
 */
export function requireUnarchivedSeat(
  seat: { archivedAt: Date | null } | null
) {
  if (seat?.archivedAt) {
    throw createError({
      statusCode: 409,
      message: 'This conversation is archived — take it out of the archive first',
    });
  }
}

/**
 * Record a message and move the counters that make the inbox cheap to
 * render: `lastMessageAt` on the conversation, `unreadCount` on every
 * other participant. Both are denormalised on purpose — recomputing them
 * as aggregates is the first thing that falls over under load.
 *
 * One transaction, so a message can never exist without its counters
 * having moved.
 *
 * Returns the message and the participant rows the bump touched. The
 * caller needs those to decide who to notify: a row that comes back with
 * `unreadCount` of exactly 1 was at 0 before this message, which is the
 * only precise definition of "the first unread in this thread". Reading
 * it back afterwards would race with a concurrent send; taking it from
 * the same statement cannot.
 */
export async function recordMessage(input: {
  conversationId: string;
  authorId: string;
  body?: string;
  cipher?: Buffer;
  iv?: Buffer;
  replyToId?: string;
}) {
  const id = randomUUID();
  const now = new Date();

  return db.transaction(async (tx) => {
    const [message] = await tx
      .insert(schema.messages)
      .values({
        id,
        conversationId: input.conversationId,
        authorId: input.authorId,
        body: input.body ?? null,
        cipher: input.cipher ?? null,
        iv: input.iv ?? null,
        replyToId: input.replyToId ?? null,
        createdAt: now,
      })
      .returning();

    await tx
      .update(schema.conversations)
      .set({ lastMessageAt: now })
      .where(eq(schema.conversations.id, input.conversationId));

    /*
     * `archivedAt: null` alongside the counter: a message arriving takes
     * the conversation off the shelf for whoever receives it.
     *
     * Otherwise archiving silences somebody rather than filing their
     * thread — the unread count would climb inside a list nobody looks
     * at, and the only way back would be to remember they exist. It is
     * cleared for RECIPIENTS only; the author's own filing is untouched,
     * and the send route refuses a send from an archived seat anyway.
     */
    const recipients = await tx
      .update(schema.conversationParticipants)
      .set({
        unreadCount: sql`${schema.conversationParticipants.unreadCount} + 1`,
        archivedAt: null,
      })
      .where(
        and(
          eq(
            schema.conversationParticipants.conversationId,
            input.conversationId
          ),
          ne(schema.conversationParticipants.userId, input.authorId)
        )
      )
      .returning({
        userId: schema.conversationParticipants.userId,
        unreadCount: schema.conversationParticipants.unreadCount,
        mutedUntil: schema.conversationParticipants.mutedUntil,
        state: schema.conversationParticipants.state,
      });

    return { message, recipients };
  });
}

/** Everybody in the conversation — the audience a published frame reaches. */
export async function participantsOf(conversationId: string) {
  const rows = await db
    .select({ userId: schema.conversationParticipants.userId })
    .from(schema.conversationParticipants)
    .where(
      eq(schema.conversationParticipants.conversationId, conversationId)
    );
  return rows.map((r) => r.userId);
}
