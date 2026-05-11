/**
 * GET /api/me/notifications
 *
 * Paginated list of the user's notifications, newest first. Cursor
 * pagination on `createdAt` so a long inbox doesn't pay for the
 * usual `OFFSET` cost (same pattern as the bonus-history endpoint).
 *
 * Query params:
 *   - limit: 1–100, default 30 (the dropdown asks for 10; the
 *     /notifications page asks for 50)
 *   - cursor: ISO timestamp — fetch rows strictly older than this
 *   - unreadOnly: `true` filters to read_at IS NULL
 *
 * Returns `{ items, hasMore, nextCursor, unreadCount }`. The
 * unread count travels alongside the page so the bell badge can
 * stay in sync without a second round-trip.
 */
import { and, desc, eq, isNull, lt } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { getUnreadCount } from '~~/utils/notify';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().datetime().optional(),
  unreadOnly: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .optional()
    .transform((v) => v === 'true' || v === true),
});

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  const { limit, cursor, unreadOnly } = await getValidatedQuery(
    event,
    querySchema.parse,
  );

  const cursorDate = cursor ? new Date(cursor) : null;

  // Over-fetch by one row so we can accurately set `hasMore` without
  // running a second COUNT. Cheaper than a `… AS has_more` window
  // function and avoids the cursor edge case where the boundary row
  // appears twice across pages.
  const whereClauses = [eq(schema.notifications.userId, user.id)];
  if (cursorDate) {
    whereClauses.push(lt(schema.notifications.createdAt, cursorDate));
  }
  if (unreadOnly) {
    whereClauses.push(isNull(schema.notifications.readAt));
  }

  const rows = await db
    .select({
      id: schema.notifications.id,
      type: schema.notifications.type,
      payload: schema.notifications.payload,
      link: schema.notifications.link,
      readAt: schema.notifications.readAt,
      createdAt: schema.notifications.createdAt,
    })
    .from(schema.notifications)
    .where(and(...whereClauses))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map((r) => ({
    id: r.id,
    type: r.type,
    payload: r.payload,
    link: r.link,
    readAt: r.readAt ? r.readAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));
  const nextCursor = hasMore ? items[items.length - 1].createdAt : null;
  const unreadCount = await getUnreadCount(user.id);

  return { items, hasMore, nextCursor, unreadCount };
});
