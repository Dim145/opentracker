/**
 * POST /api/messaging/conversations/:id/messages
 *
 * Send. This is the write path, and it stays in the API for the reason
 * the plan gives: permissions, rate limits and moderation live here, and
 * a delivery service that only fans out never has to know about them.
 *
 * The payload has to match the conversation. An encrypted conversation
 * takes `cipher`+`iv` and refuses plaintext; a plain one is the reverse.
 * The database enforces it too — this check exists to answer with a
 * readable 400 rather than a constraint violation.
 */
import { db, schema } from '@trackarr/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';
import { requireDmAccess } from '~~/utils/messaging/guard';
import {
  participantOf,
  participantsOf,
  recordMessage,
} from '~~/utils/messaging/conversations';
import { publishToUsers } from '~~/utils/messaging/relay';
import { blockExistsBetween } from '~~/utils/messaging/moderation';
import { notify } from '~~/utils/notify';

/** Long enough for a real message, short enough not to be a document. */
const BODY_MAX = 4000;

/**
 * base64**url**, not base64.
 *
 * The browser produces the URL-safe alphabet — `-` and `_`, no padding —
 * because that is what `e2ee.ts` emits and what the key columns already
 * hold. Validating against standard base64 rejected every ciphertext with
 * a 400 that named the field and not the reason, which is a slow way to
 * find a one-character difference.
 */
const B64URL = /^[A-Za-z0-9_-]+$/;

const bodySchema = z
  .object({
    body: z.string().trim().min(1).max(BODY_MAX).optional(),
    cipher: z.string().regex(B64URL).max(BODY_MAX * 2).optional(),
    iv: z.string().regex(B64URL).max(64).optional(),
    /** The message being answered. Must be in this conversation. */
    replyToId: z.string().uuid().optional(),
  })
  .strict();

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await requireDmAccess(user);
  await rateLimit(event, RATE_LIMITS.mutation);

  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, message: 'Missing id' });

  const membership = await participantOf(id, user.id);
  if (!membership || membership.state === 'blocked') {
    throw createError({ statusCode: 404, message: 'Not found' });
  }

  const conversation = await db.query.conversations.findFirst({
    where: eq(schema.conversations.id, id),
  });
  if (!conversation) {
    throw createError({ statusCode: 404, message: 'Not found' });
  }

  /*
   * Filed away is read-only.
   *
   * Archiving used to be a listing filter and nothing more, so a thread
   * could be answered from inside the archive and stay archived — which
   * is not a shelf, it is a hiding place. Refused here rather than only
   * hidden in the interface: a rule the client alone enforces is a
   * suggestion, and this one is the whole meaning of the shelf.
   *
   * Only the SENDER's own row. Somebody who filed a conversation away
   * still receives into it — that is what un-archives it, below.
   */
  if (membership.archivedAt) {
    throw createError({
      statusCode: 409,
      message: 'This conversation is archived — take it out of the archive to reply',
    });
  }

  // Blocked either way stops the send, not just the listing. `state` on
  // my own row covers the case where I did the blocking; the standing
  // refusal table covers the case where they did.
  if (membership.state === 'blocked') {
    throw createError({ statusCode: 403, message: 'This conversation is closed' });
  }
  // Staff are exempt as sender, for the reason written at the block check
  // in `findOrCreateDirectConversation`: a member must not be able to put
  // themselves out of the moderation team's reach. Read from the live
  // roles — `requireDmAccess` reconciles them — not from the cookie.
  const staffSender = !!user.isAdmin || !!user.isModerator;
  const others = (await participantsOf(id)).filter((u) => u !== user.id);
  if (!staffSender) {
    for (const other of others) {
      if (await blockExistsBetween(user.id, other)) {
        throw createError({ statusCode: 403, message: 'This conversation is closed' });
      }
    }
  }

  const body = await validateBody(event, bodySchema);

  if (conversation.encrypted) {
    if (!body.cipher || !body.iv || body.body) {
      throw createError({
        statusCode: 400,
        message: 'This conversation is encrypted — send cipher and iv',
      });
    }
  } else if (!body.body || body.cipher || body.iv) {
    throw createError({
      statusCode: 400,
      message: 'This conversation is not encrypted — send body',
    });
  }

  // A reply target from another conversation would quote something the
  // reader cannot see — and would let anyone confirm an id exists by
  // watching whether the send succeeds.
  if (body.replyToId) {
    const target = await db.query.messages.findFirst({
      where: and(
        eq(schema.messages.id, body.replyToId),
        eq(schema.messages.conversationId, id)
      ),
      columns: { id: true },
    });
    if (!target) {
      throw createError({
        statusCode: 400,
        message: 'The message being replied to is not in this conversation',
      });
    }
  }

  const { message, recipients } = await recordMessage({
    conversationId: id,
    authorId: user.id,
    replyToId: body.replyToId,
    body: conversation.encrypted ? undefined : body.body,
    cipher: body.cipher ? Buffer.from(body.cipher, 'base64url') : undefined,
    iv: body.iv ? Buffer.from(body.iv, 'base64url') : undefined,
  });

  // Answering the sender is not the same as replying to a stranger:
  // writing into a conversation you were invited to accepts it.
  if (membership.state === 'pending') {
    await db
      .update(schema.conversationParticipants)
      .set({ state: 'active' })
      .where(
        and(
          eq(schema.conversationParticipants.conversationId, id),
          eq(schema.conversationParticipants.userId, user.id)
        )
      );
  }

  // After the commit, and never before. A frame for a message that is not
  // in Postgres is a message the reader watches vanish on reload — and the
  // publish is allowed to fail: the row is written, the client will find it
  // on its next fetch or on reconnect. Losing the live copy degrades; losing
  // the message would be a bug.
  await publishToUsers([user.id, ...others], {
    type: 'message',
    conversationId: id,
    message: {
      id: message!.id,
      createdAt: message!.createdAt,
      authorId: user.id,
      body: conversation.encrypted ? null : (body.body ?? null),
      cipher: body.cipher ?? null,
      iv: body.iv ?? null,
      replyToId: body.replyToId ?? null,
    },
  });

  // Notify, after the publish and never instead of it.
  //
  // Two rules, and both are about not becoming the thing people mute:
  //
  // 1. Only the FIRST unread of a thread. `unreadCount` came back as 1,
  //    so it was 0 before this message — anything after that is telling
  //    somebody about a badge they are already looking at. At this
  //    membership, one notification per message would make the bell
  //    useless within a day.
  // 2. Muting the conversation silences the notification, not the
  //    counter. Muting means "stop interrupting me", not "pretend
  //    nothing happened".
  //
  // A pending row gets its own type. It is a stranger's first contact,
  // and calling it the same event as a reply would let the queue the
  // whole design rests on push to somebody's phone.
  const now = Date.now();
  for (const r of recipients) {
    if (r.unreadCount !== 1) continue;
    if (r.state === 'blocked') continue;
    if (r.mutedUntil && r.mutedUntil.getTime() > now) continue;
    void notify(
      r.userId,
      r.state === 'pending' ? 'message_request_received' : 'message_received',
      { from: user.username, conversationId: id },
      '/messages'
    );
  }

  return {
    id: message!.id,
    createdAt: message!.createdAt,
  };
});
