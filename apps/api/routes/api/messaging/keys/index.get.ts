/**
 * GET /api/messaging/keys
 *
 * This member's own key, or its absence. Feeds the settings panel, which
 * is where somebody who has lost the device comes looking — and has to
 * find a straight answer: the key is gone and so are those conversations.
 */
import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { requireDmAccess } from '~~/utils/messaging/guard';

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await requireDmAccess(user);
  await rateLimit(event, RATE_LIMITS.public);

  const key = await db.query.userMessageKeys.findFirst({
    where: eq(schema.userMessageKeys.userId, user.id),
  });

  return key
    ? {
        published: true,
        alg: key.alg,
        deviceLabel: key.deviceLabel,
        createdAt: key.createdAt,
      }
    : { published: false };
});
