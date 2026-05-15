/**
 * User presence — keeps `users.last_seen` fresh while a user is
 * navigating, not just when they log in.
 *
 * Background:
 *   Before this helper, `users.last_seen` was only stamped inside
 *   `POST /api/auth/login`. Anyone who'd logged in earlier and was
 *   actively browsing showed up as offline (`last_seen + 5 min < now`)
 *   in the admin's "EN LIGNE" tile. The fix is to refresh the
 *   timestamp every time we authenticate a request, with a Redis-
 *   backed throttle so we don't slam Postgres with one UPDATE per
 *   API call.
 *
 * Mechanism:
 *   `touchPresence(userId)` runs a Redis `SET NX EX 60`. If the key
 *   didn't exist (returns "OK"), we won the race and write `last_seen
 *   = NOW()` to Postgres. If it already existed (returns null), some
 *   other request from the same user touched the timestamp within
 *   the last minute and we skip the DB write. The cap is 1 UPDATE
 *   per user per minute — bounded irrespective of traffic.
 *
 *   Errors on either side are swallowed. Presence is best-effort:
 *   a transient Redis or DB hiccup must not break the request the
 *   user actually came for.
 *
 *   Cross-replica safety: SET NX is atomic on a single Redis node,
 *   which is what we run. With Sentinel/cluster it remains atomic
 *   per shard; the userId-keyed slot lands on a single shard so the
 *   "at most once per minute" invariant holds across Nitro replicas.
 */
import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { redis } from './server';

const TOUCH_INTERVAL_S = 60;
const KEY_PREFIX = 'presence:touched:';

export async function touchPresence(userId: string): Promise<void> {
  if (!userId) return;
  try {
    // SET NX EX returns "OK" when the key was created, `null` when
    // it already existed. Only the winning caller writes to Postgres.
    const res = await redis.set(
      `${KEY_PREFIX}${userId}`,
      '1',
      'EX',
      TOUCH_INTERVAL_S,
      'NX',
    );
    if (res !== 'OK') return;
    await db
      .update(schema.users)
      .set({ lastSeen: new Date() })
      .where(eq(schema.users.id, userId));
  } catch (err: any) {
    // Best-effort: log + move on. The user's request is not the
    // place to surface a presence-tracking outage.
    console.warn('[presence] touch failed:', err?.message);
  }
}
