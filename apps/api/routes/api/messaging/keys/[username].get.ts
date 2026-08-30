/**
 * GET /api/messaging/keys/:username
 *
 * A member's public key, so somebody can seal a conversation to them.
 *
 * The absence is a first-class answer rather than a 404, because the
 * interface has something to say about it: an encrypted conversation can
 * only be started with somebody who has already published a key, and the
 * composer offers a plain conversation instead of failing. That is a real
 * limit of one-key-per-account, not an implementation detail to hide.
 */
import { db, schema } from '@trackarr/db';
import { and, eq, isNull } from 'drizzle-orm';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { requireDmAccess } from '~~/utils/messaging/guard';

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await requireDmAccess(user);
  await rateLimit(event, RATE_LIMITS.public);

  const username = getRouterParam(event, 'username');
  if (!username) throw createError({ statusCode: 400, message: 'Missing username' });

  // Erasure blanks the row rather than dropping it, so the account is
  // still findable by the random name it was left with. Handing out its
  // key would outlive the erasure that was supposed to take it.
  const target = await db.query.users.findFirst({
    where: and(eq(schema.users.username, username), isNull(schema.users.deletedAt)),
    columns: { id: true },
  });
  if (!target) throw createError({ statusCode: 404, message: 'No such member' });

  const key = await db.query.userMessageKeys.findFirst({
    where: eq(schema.userMessageKeys.userId, target.id),
  });

  return key
    ? { available: true, publicKey: key.publicKey, alg: key.alg }
    : { available: false };
});
