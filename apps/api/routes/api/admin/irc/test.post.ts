/**
 * POST /api/admin/irc/test
 *
 * Say one line in the channel, so an operator can see the bot works without
 * waiting for somebody to upload something.
 *
 * The line is fixed text plus the admin's name. It is not operator-supplied,
 * which is the point: a route that let staff put arbitrary text in a channel
 * would be a broadcast surface with an audit entry and no rate limit worth the
 * name. Announcing is what the bot is for.
 *
 * Refuses rather than queues when the bot is not connected. Queuing would
 * return "sent" for a line that leaves at the next reconnection, minutes later,
 * to an operator who is trying to find out whether the connection works.
 */
import { requireAdminSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { ircStatus, saySomething } from '~~/utils/irc/announcer';

export default defineEventHandler(async (event) => {
  const { user } = await requireAdminSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);

  // Only refuse on what this instance can be sure of. Since the line travels
  // through Redis to whichever instance holds the socket, an admin talking to a
  // non-leader can still test the bot — which is the common case in a fleet.
  const status = ircStatus();
  if (status.leader && status.state !== 'ready') {
    throw createError({
      statusCode: 409,
      message: `The bot is not in the channel (${status.state}${
        status.lastError ? `: ${status.lastError}` : ''
      }).`,
    });
  }

  const line = `Test line from ${user.username} — the announce bot is connected.`;
  if (!(await saySomething(line))) {
    throw createError({
      statusCode: 409,
      message: 'Nothing is listening for lines — the bot is not connected.',
    });
  }
  return { sent: true, line };
});
