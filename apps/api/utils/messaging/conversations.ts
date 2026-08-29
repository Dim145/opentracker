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
  opts: { encrypted?: boolean } = {}
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
  if (await blockExistsBetween(meId, otherId)) {
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
      { conversationId: id, userId: otherId, joinedAt: now, state: 'pending' },
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
 * Record a message and move the counters that make the inbox cheap to
 * render: `lastMessageAt` on the conversation, `unreadCount` on every
 * other participant. Both are denormalised on purpose — recomputing them
 * as aggregates is the first thing that falls over under load.
 *
 * One transaction, so a message can never exist without its counters
 * having moved.
 */
export async function recordMessage(input: {
  conversationId: string;
  authorId: string;
  body?: string;
  cipher?: Buffer;
  iv?: Buffer;
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
        createdAt: now,
      })
      .returning();

    await tx
      .update(schema.conversations)
      .set({ lastMessageAt: now })
      .where(eq(schema.conversations.id, input.conversationId));

    await tx
      .update(schema.conversationParticipants)
      .set({ unreadCount: sql`${schema.conversationParticipants.unreadCount} + 1` })
      .where(
        and(
          eq(
            schema.conversationParticipants.conversationId,
            input.conversationId
          ),
          ne(schema.conversationParticipants.userId, input.authorId)
        )
      );

    return message;
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
