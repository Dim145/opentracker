/**
 * GET /api/mod/messages/read-log
 *
 * Who read a reported private message, and when.
 *
 * Visible to every moderator rather than to admins alone, and that is the
 * point rather than an oversight: a log the watched cannot see is
 * surveillance, and a log they can see is a norm. Everybody who can open
 * one of these messages can see every time anyone did.
 *
 * It carries no message bodies. Reading the log is not a second way to
 * read the mail — it answers "was this looked at, by whom" and stops
 * there.
 */
import { db, schema } from '@trackarr/db';
import { desc, sql } from 'drizzle-orm';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';

const MAX_LIMIT = 100;

export default defineEventHandler(async (event) => {
  await requireModeratorSession(event);
  await rateLimit(event, RATE_LIMITS.public);

  const query = getQuery(event);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(String(query.limit ?? '50'), 10) || 50)
  );
  const page = Math.max(1, parseInt(String(query.page ?? '1'), 10) || 1);

  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: schema.messageReadLog.id,
        readerId: schema.messageReadLog.readerId,
        readerName: schema.messageReadLog.readerName,
        messageId: schema.messageReadLog.messageId,
        conversationId: schema.messageReadLog.conversationId,
        reportId: schema.messageReadLog.reportId,
        disclosed: schema.messageReadLog.disclosed,
        createdAt: schema.messageReadLog.createdAt,
      })
      .from(schema.messageReadLog)
      .orderBy(desc(schema.messageReadLog.createdAt))
      .limit(limit)
      .offset((page - 1) * limit),
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(schema.messageReadLog),
  ]);

  return {
    entries: rows,
    pagination: {
      page,
      limit,
      total: total?.value ?? 0,
      totalPages: Math.max(1, Math.ceil((total?.value ?? 0) / limit)),
    },
  };
});
