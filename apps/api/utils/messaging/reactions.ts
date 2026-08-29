/**
 * Reactions, for both surfaces.
 *
 * A reaction is a toggle, not an append: clicking the same key twice
 * leaves no trace. The primary key `(message, user, key)` is what makes
 * that true in the database rather than in the handler, so a double-tap
 * or a retried request cannot double count.
 *
 * What goes over the wire is a DELTA — one message, one key, +1 or -1 —
 * not the recomputed aggregate. At room scale the aggregate would be a
 * query per reaction and a payload proportional to how popular the
 * message is; the delta is four fields whatever happens, and the client
 * already holds the count it is adjusting.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { REACTION_KEYS, type ReactionKey } from '@trackarr/db';

export { REACTION_KEYS, type ReactionKey };

export const isReactionKey = (v: unknown): v is ReactionKey =>
  typeof v === 'string' && (REACTION_KEYS as readonly string[]).includes(v);

/** What one message's reactions look like to a reader. */
export interface ReactionSummary {
  /** Key → how many members used it. Absent keys are zero. */
  counts: Record<string, number>;
  /** The keys THIS reader used. What the UI highlights. */
  mine: string[];
}

export type ReactionsByMessage = Record<string, ReactionSummary>;

/**
 * Toggle, and say which way it went.
 *
 * The delete-then-insert is not a transaction on purpose: the two
 * outcomes are "the row is there" and "the row is not", and both are
 * idempotent. A concurrent double-click resolves to one of them rather
 * than to an error.
 */
export async function toggleDirectReaction(
  messageId: string,
  userId: string,
  key: ReactionKey
): Promise<'added' | 'removed'> {
  const removed = await db
    .delete(schema.messageReactions)
    .where(
      and(
        eq(schema.messageReactions.messageId, messageId),
        eq(schema.messageReactions.userId, userId),
        eq(schema.messageReactions.key, key)
      )
    )
    .returning({ key: schema.messageReactions.key });

  if (removed.length > 0) return 'removed';

  await db
    .insert(schema.messageReactions)
    .values({ messageId, userId, key })
    .onConflictDoNothing();
  return 'added';
}

/** Same, for the room. Carries the message's day: it is the partition key. */
export async function toggleRoomReaction(
  messageId: string,
  messageCreatedAt: Date,
  userId: string,
  key: ReactionKey
): Promise<'added' | 'removed'> {
  const removed = await db
    .delete(schema.roomMessageReactions)
    .where(
      and(
        eq(schema.roomMessageReactions.messageId, messageId),
        eq(schema.roomMessageReactions.messageCreatedAt, messageCreatedAt),
        eq(schema.roomMessageReactions.userId, userId),
        eq(schema.roomMessageReactions.key, key)
      )
    )
    .returning({ key: schema.roomMessageReactions.key });

  if (removed.length > 0) return 'removed';

  await db
    .insert(schema.roomMessageReactions)
    .values({ messageId, messageCreatedAt, userId, key })
    .onConflictDoNothing();
  return 'added';
}

/**
 * Reactions for a page of messages, in one round trip.
 *
 * Grouped in the database rather than in Node: the alternative is
 * shipping every reaction row to the API just to count them, which on a
 * popular room message is thousands of rows to produce one integer.
 */
export async function directReactionsFor(
  messageIds: string[],
  viewerId: string
): Promise<ReactionsByMessage> {
  if (messageIds.length === 0) return {};
  const rows = await db
    .select({
      messageId: schema.messageReactions.messageId,
      key: schema.messageReactions.key,
      count: sql<number>`count(*)::int`,
      mine: sql<boolean>`bool_or(${schema.messageReactions.userId} = ${viewerId})`,
    })
    .from(schema.messageReactions)
    .where(inArray(schema.messageReactions.messageId, messageIds))
    .groupBy(schema.messageReactions.messageId, schema.messageReactions.key);

  return shape(rows);
}

export async function roomReactionsFor(
  messageIds: string[],
  viewerId: string
): Promise<ReactionsByMessage> {
  if (messageIds.length === 0) return {};
  const rows = await db
    .select({
      messageId: schema.roomMessageReactions.messageId,
      key: schema.roomMessageReactions.key,
      count: sql<number>`count(*)::int`,
      mine: sql<boolean>`bool_or(${schema.roomMessageReactions.userId} = ${viewerId})`,
    })
    .from(schema.roomMessageReactions)
    .where(inArray(schema.roomMessageReactions.messageId, messageIds))
    .groupBy(
      schema.roomMessageReactions.messageId,
      schema.roomMessageReactions.key
    );

  return shape(rows);
}

function shape(
  rows: Array<{ messageId: string; key: string; count: number; mine: boolean }>
): ReactionsByMessage {
  const out: ReactionsByMessage = {};
  for (const row of rows) {
    const entry = (out[row.messageId] ??= { counts: {}, mine: [] });
    entry.counts[row.key] = row.count;
    if (row.mine) entry.mine.push(row.key);
  }
  return out;
}
