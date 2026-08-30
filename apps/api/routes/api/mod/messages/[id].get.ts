/**
 * GET /api/mod/messages/:id
 *
 * The one way staff read a private message, and it opens only on a
 * message that has been reported.
 *
 * A moderator does not browse an inbox. The private conversations of the
 * membership are not a surface anyone holds a key to by role — a report
 * opens exactly one message, and this endpoint answers 404 for anything
 * that has not been reported, so it cannot be used to walk ids.
 *
 * An encrypted conversation yields nothing whatever the role. The server
 * holds ciphertext and no key. Saying that plainly is the honest answer,
 * and it is what the report form has to warn about before somebody files
 * expecting otherwise.
 */
import { requireModeratorSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import {
  logReportedMessageRead,
  reportedMessageFor,
} from '~~/utils/messaging/moderation';

export default defineEventHandler(async (event) => {
  const { user } = await requireModeratorSession(event);
  await rateLimit(event, RATE_LIMITS.admin);

  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, message: 'Missing id' });

  const message = await reportedMessageFor(id);
  if (!message) throw createError({ statusCode: 404, message: 'Not found' });

  /*
   * Logged before it is handed over, and awaited.
   *
   * This is the one route in the application through which somebody reads
   * another member's private correspondence, and it used to leave no
   * trace at all. Writing after the response, or not waiting for it,
   * would make the trace the part that gets dropped under load — which is
   * exactly when it is worth having.
   *
   * `disclosed` distinguishes the two outcomes. An encrypted conversation
   * yields nothing whatever the role, and that attempt is still recorded:
   * "a moderator tried to read this and could not" is a fact about the
   * moderator rather than about the message.
   */
  await logReportedMessageRead({
    readerId: user.id,
    readerName: user.username,
    messageId: message.id,
    conversationId: message.conversationId,
    reportId: message.reportId,
    disclosed: message.body !== null,
  });

  return message;
});
