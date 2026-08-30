/**
 * GET /api/admin/messaging/broadcast?audience=...
 *
 * How many members that audience resolves to, and the recent history.
 *
 * The count exists so nobody discovers the size of what they sent
 * afterwards. Writing to four thousand people is a different act from
 * writing to forty, and the interface should say which one is about to
 * happen while it can still be cancelled.
 */
import { desc } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { requireAdminSession } from '~~/utils/adminAuth';
import { parseAudience, resolveAudience } from '~~/utils/messaging/broadcast';

export default defineEventHandler(async (event) => {
  const { user } = await requireAdminSession(event);
  await rateLimit(event, RATE_LIMITS.public);

  const raw = getQuery(event).audience;
  let count: number | null = null;
  if (typeof raw === 'string' && raw) {
    const audience = parseAudience(raw);
    if (!audience) {
      throw createError({ statusCode: 400, message: 'Unknown audience' });
    }
    count = (await resolveAudience(audience, user.id)).length;
  }

  const history = await db
    .select({
      id: schema.messagingBroadcasts.id,
      audience: schema.messagingBroadcasts.audience,
      total: schema.messagingBroadcasts.total,
      sent: schema.messagingBroadcasts.sent,
      createdAt: schema.messagingBroadcasts.createdAt,
      finishedAt: schema.messagingBroadcasts.finishedAt,
      error: schema.messagingBroadcasts.error,
    })
    .from(schema.messagingBroadcasts)
    .orderBy(desc(schema.messagingBroadcasts.createdAt))
    .limit(10);

  return { count, history };
});
