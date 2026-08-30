/**
 * Staff broadcasts: one message, written once, delivered to a cohort.
 *
 * The shape of this file is decided by one number. At the membership this
 * project is designed for, "message everyone" is upwards of a million
 * rows — conversations, participants, messages, counters, notifications —
 * and none of it can happen inside a request. So:
 *
 * - The audiences are BOUNDED cohorts. A role, the inactive, hit-and-run
 *   violators, staff. There is deliberately no "everybody": a private
 *   message to 352k people is not a private message, it is an
 *   announcement, and the site already has a banner and a notification
 *   feed that cost one row between them.
 * - The count is shown BEFORE sending. Staff should know they are about
 *   to write to four thousand people, and the only honest way to say so
 *   is to have counted.
 * - Progress is a row, not a variable. A process that restarts halfway
 *   through a loop leaves no record of how far it got, and the question
 *   "did that go out?" then has no answer.
 */
import { and, eq, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { randomUUID } from 'node:crypto';
import {
  findOrCreateDirectConversation,
  recordMessage,
} from './conversations';
import { publishToUsers } from './relay';
import { notify } from '../notify';

/** How many recipients one pass handles before the row is updated. */
const BATCH = 50;

export type Audience =
  | { kind: 'role'; roleId: string }
  | { kind: 'inactive'; days: number }
  | { kind: 'hnr' }
  | { kind: 'staff' };

export function parseAudience(raw: string): Audience | null {
  if (raw === 'hnr') return { kind: 'hnr' };
  if (raw === 'staff') return { kind: 'staff' };
  const [head, tail] = raw.split(':');
  if (head === 'role' && tail) return { kind: 'role', roleId: tail };
  if (head === 'inactive' && tail) {
    const days = Number(tail);
    // A window of zero days would resolve to every member who is not
    // online right now, which is the unbounded audience this refuses.
    if (Number.isInteger(days) && days >= 7 && days <= 3650) {
      return { kind: 'inactive', days };
    }
  }
  return null;
}

export const formatAudience = (a: Audience): string =>
  a.kind === 'role'
    ? `role:${a.roleId}`
    : a.kind === 'inactive'
      ? `inactive:${a.days}`
      : a.kind;

/**
 * Who the audience resolves to, right now.
 *
 * Banned and erased accounts are never included. A banned member cannot
 * read it, and an erased one is a row that only still exists because
 * erasure keeps it — writing to either produces a conversation with
 * nobody on the other end.
 */
export async function resolveAudience(
  audience: Audience,
  senderId: string
): Promise<string[]> {
  const alive = and(
    isNull(schema.users.deletedAt),
    eq(schema.users.isBanned, false),
    ne(schema.users.id, senderId)
  );

  if (audience.kind === 'staff') {
    const rows = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(
        and(
          alive,
          or(eq(schema.users.isAdmin, true), eq(schema.users.isModerator, true))
        )
      );
    return rows.map((r) => r.id);
  }

  if (audience.kind === 'role') {
    const rows = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .innerJoin(schema.userRoles, eq(schema.userRoles.userId, schema.users.id))
      .where(and(alive, eq(schema.userRoles.roleId, audience.roleId)));
    return [...new Set(rows.map((r) => r.id))];
  }

  if (audience.kind === 'inactive') {
    const cutoff = new Date(Date.now() - audience.days * 86400_000);
    const rows = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(and(alive, lt(schema.users.lastSeen, cutoff)));
    return rows.map((r) => r.id);
  }

  // Hit and run. Distinct members, not distinct violations: somebody with
  // nine open violations gets one message, not nine.
  const rows = await db
    .selectDistinct({ id: schema.users.id })
    .from(schema.users)
    .innerJoin(
      schema.hnrTracking,
      eq(schema.hnrTracking.userId, schema.users.id)
    )
    .where(
      and(
        alive,
        eq(schema.hnrTracking.isHnr, true),
        eq(schema.hnrTracking.isExempt, false)
      )
    );
  return rows.map((r) => r.id);
}

/**
 * Deliver, in batches, updating the row as it goes.
 *
 * Not awaited by the route: the caller returns the id and the total, and
 * the interface polls. A broadcast to four thousand members takes longer
 * than any sensible request timeout, and holding the connection open
 * would make a proxy decide the question.
 *
 * A recipient that fails — blocked the sender, was erased between the
 * count and the send — is skipped rather than aborting the run. One bad
 * recipient must not stop the other three thousand nine hundred.
 */
export async function runBroadcast(
  broadcastId: string,
  senderId: string,
  senderName: string,
  recipients: string[],
  body: string
): Promise<void> {
  let sent = 0;
  try {
    for (let i = 0; i < recipients.length; i += BATCH) {
      const batch = recipients.slice(i, i + BATCH);
      for (const recipientId of batch) {
        try {
          const { conversation } = await findOrCreateDirectConversation(
            senderId,
            recipientId,
            // Staff, by definition of who may call this — so it lands in
            // the inbox. A broadcast in the request queue is a broadcast
            // that gets refused unread.
            { direct: true }
          );
          /*
           * In clear, including into a conversation the pair opened
           * encrypted — there is one conversation per pair, and a
           * broadcast cannot be sealed for each recipient: the sender
           * never holds thousands of public keys, and this loop runs on
           * the server with no key at all.
           *
           * Not silent about it. The thread renders any plaintext line
           * inside an encrypted conversation with a "not encrypted"
           * mark, so the padlock on the thread keeps meaning what it
           * says. See `msg-clear` in apps/web/app/pages/messages.vue.
           */
          const { message } = await recordMessage({
            conversationId: conversation.id,
            authorId: senderId,
            body,
          });
          await publishToUsers([recipientId], {
            type: 'message',
            conversationId: conversation.id,
            message: {
              id: message!.id,
              createdAt: message!.createdAt,
              authorId: senderId,
              body,
              cipher: null,
              iv: null,
              replyToId: null,
            },
          });
          void notify(
            recipientId,
            'message_received',
            { from: senderName, conversationId: conversation.id },
            '/messages'
          );
          sent += 1;
        } catch {
          // Skipped, deliberately. See the header.
        }
      }
      await db
        .update(schema.messagingBroadcasts)
        .set({ sent })
        .where(eq(schema.messagingBroadcasts.id, broadcastId));
    }

    await db
      .update(schema.messagingBroadcasts)
      .set({ sent, finishedAt: new Date() })
      .where(eq(schema.messagingBroadcasts.id, broadcastId));
    console.log(
      `[messaging] broadcast ${broadcastId}: ${sent}/${recipients.length} delivered`
    );
  } catch (err) {
    await db
      .update(schema.messagingBroadcasts)
      .set({ sent, finishedAt: new Date(), error: (err as Error).message })
      .where(eq(schema.messagingBroadcasts.id, broadcastId))
      .catch(() => {});
    console.warn('[messaging] broadcast failed:', (err as Error).message);
  }
}

export const newBroadcastId = () => randomUUID();
