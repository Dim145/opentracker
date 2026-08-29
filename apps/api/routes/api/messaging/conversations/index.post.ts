/**
 * POST /api/messaging/conversations
 *
 * Open a conversation with a member, or return the one that already
 * exists — a pair has at most one DM, so this is idempotent by design and
 * pressing "message" twice is not an error.
 *
 * `encrypted` is accepted **only here**. The flag is immutable after
 * creation: a conversation half of which is encrypted is unreadable to
 * render, to export and to report on, and impossible to explain to the
 * person using it.
 */
import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';
import { requireDmAccess } from '~~/utils/messaging/guard';
import { findOrCreateDirectConversation } from '~~/utils/messaging/conversations';

const bodySchema = z
  .object({
    username: z.string().trim().min(1).max(64),
    encrypted: z.boolean().optional(),
  })
  .strict();

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await requireDmAccess(user);
  await rateLimit(event, RATE_LIMITS.mutation);

  const body = await validateBody(event, bodySchema);

  const target = await db.query.users.findFirst({
    where: eq(schema.users.username, body.username),
    columns: { id: true, username: true, displayName: true },
  });
  if (!target) {
    throw createError({ statusCode: 404, message: 'No such member' });
  }

  const { conversation, created } = await findOrCreateDirectConversation(
    user.id,
    target.id,
    { encrypted: body.encrypted }
  );

  return {
    id: conversation.id,
    encrypted: conversation.encrypted,
    created,
    with: target,
  };
});
