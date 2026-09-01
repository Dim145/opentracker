/**
 * POST /api/me/keys/:kind    (kind = `rss` | `api`)
 *
 * Rotate one read key. The old value stops working on the next request — these
 * are read straight from the row, with no cache in front of them, which is the
 * property that makes "revoke" mean revoke.
 *
 * Behind the fresh-auth step-up, like the passkey reset it sits beside: a
 * borrowed session should not be able to lock the real member out of their own
 * feeds by rotating underneath them.
 *
 * Rotating one key leaves the other two alone. That is the entire point of
 * having three — a member who gave their feed URL to a service that turned out
 * to be careless can undo exactly that, without touching a single torrent in
 * their client.
 */
import { z } from 'zod/v4';
import { requireAuthSession, requireFreshAuth } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { rotateKey } from '~~/utils/account/readKeys';
import { validateParam } from '~~/utils/schemas';

const kindSchema = z.enum(['rss', 'api']);

export default defineEventHandler(async (event) => {
  const { user } = await requireAuthSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  await requireFreshAuth(event);

  const kind = validateParam(event, 'kind', kindSchema);
  const key = await rotateKey(user.id, kind);

  return { kind, key };
});
