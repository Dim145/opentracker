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
import { reportedMessageFor } from '~~/utils/messaging/moderation';

export default defineEventHandler(async (event) => {
  await requireModeratorSession(event);
  await rateLimit(event, RATE_LIMITS.admin);

  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, message: 'Missing id' });

  const message = await reportedMessageFor(id);
  if (!message) throw createError({ statusCode: 404, message: 'Not found' });

  return message;
});
