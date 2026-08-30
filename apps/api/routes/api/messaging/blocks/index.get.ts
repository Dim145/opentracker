/**
 * GET /api/messaging/blocks
 *
 * Everyone this member is refusing.
 */
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { requireDmAccess } from '~~/utils/messaging/guard';
import { blocksOf } from '~~/utils/messaging/moderation';

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await requireDmAccess(user);
  await rateLimit(event, RATE_LIMITS.public);
  return { blocks: await blocksOf(user.id) };
});
