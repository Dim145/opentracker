/**
 * GET /api/messaging/search?q=
 *
 * Search your own conversations.
 *
 * Plaintext only, and that is not a limitation to work around: an
 * encrypted conversation is bytes the server cannot read, so there is
 * nothing here to match against. The response says how many encrypted
 * conversations were skipped rather than silently returning less than the
 * member expected — "no results" and "no results I am able to look at" are
 * different answers.
 */
import { db, schema } from '@trackarr/db';
import { and, desc, eq, ilike, inArray, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateQuery } from '~~/utils/schemas';
import { escapeLike } from '~~/utils/sql';
import { requireDmAccess } from '~~/utils/messaging/guard';

const querySchema = z.object({
  q: z.string().trim().min(2).max(120),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await requireDmAccess(user);
  await rateLimit(event, RATE_LIMITS.search);

  const query = validateQuery(event, querySchema);

  const seats = await db
    .select({
      conversationId: schema.conversationParticipants.conversationId,
      encrypted: schema.conversations.encrypted,
    })
    .from(schema.conversationParticipants)
    .innerJoin(
      schema.conversations,
      eq(schema.conversations.id, schema.conversationParticipants.conversationId)
    )
    .where(
      and(
        eq(schema.conversationParticipants.userId, user.id),
        ne(schema.conversationParticipants.state, 'blocked'),
        eq(schema.conversations.kind, 'dm')
      )
    );

  const readable = seats.filter((s) => !s.encrypted).map((s) => s.conversationId);
  const skippedEncrypted = seats.length - readable.length;

  if (readable.length === 0) {
    return { results: [], skippedEncrypted };
  }

  const rows = await db
    .select({
      id: schema.messages.id,
      conversationId: schema.messages.conversationId,
      body: schema.messages.body,
      createdAt: schema.messages.createdAt,
      authorId: schema.messages.authorId,
      authorName: schema.users.username,
    })
    .from(schema.messages)
    .leftJoin(
      schema.users,
      and(eq(schema.users.id, schema.messages.authorId), isNull(schema.users.deletedAt))
    )
    .where(
      and(
        inArray(schema.messages.conversationId, readable),
        isNull(schema.messages.deletedAt),
        ilike(schema.messages.body, `%${escapeLike(query.q)}%`)
      )
    )
    .orderBy(desc(schema.messages.createdAt))
    .limit(query.limit);

  return {
    skippedEncrypted,
    results: rows.map((row) => ({
      id: row.id,
      conversationId: row.conversationId,
      body: row.body,
      createdAt: row.createdAt,
      author: row.authorName
        ? { id: row.authorId, username: row.authorName }
        : null,
    })),
  };
});
