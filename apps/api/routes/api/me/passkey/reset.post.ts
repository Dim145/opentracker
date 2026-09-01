/**
 * POST /api/me/passkey/reset
 *
 * Regenerate the caller's own tracker passkey.
 *
 * The passkey travels in the query string of every announce and of every
 * RSS / Torznab poll, by protocol. It therefore ends up in browser history,
 * in the logs of any intermediate proxy, and in any screenshot of a feed URL.
 * The Caddyfile scrubs it from our own access logs, but that only covers our
 * own edge — and until now the only way to rotate a leaked passkey was to ask
 * an administrator, which is a poor answer to a credential the member is
 * responsible for.
 *
 * Rotation invalidates every existing announce and feed URL, so the response
 * says so plainly: the member has to update their client and their *Arr
 * indexers.
 *
 * Gated on the fresh-auth window like the other account-security actions —
 * a borrowed session should not be able to lock the real owner's client out
 * of the tracker.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireAuthSession, requireFreshAuth } from '~~/utils/adminAuth';
import { generatePasskey } from '~~/utils/auth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import {
  carryTorznabBlock,
  retireTorznabPasskey,
} from '~~/utils/torznabStats';
import { notify } from '~~/utils/notify';

export default defineEventHandler(async (event) => {
  const { user } = await requireAuthSession(event);
  await requireFreshAuth(event);
  await rateLimit(event, RATE_LIMITS.mutation);

  const [row] = await db
    .select({ passkey: schema.users.passkey })
    .from(schema.users)
    .where(eq(schema.users.id, user.id))
    .limit(1);

  if (!row) {
    throw createError({ statusCode: 404, message: 'Account not found' });
  }

  const oldPasskey = row.passkey;
  const newPasskey = generatePasskey();

  // Before the row changes. A Torznab access block is keyed by a hash of the
  // passkey, so a rotation that did not carry it over would hand a blocked
  // member the lift for free — this route is self-service, needs no
  // administrator, and would have been the whole restriction's back door.
  // Refuses the rotation if it cannot be sure, rather than freeing the member.
  await carryTorznabBlock(oldPasskey, newPasskey);

  await db
    .update(schema.users)
    .set({ passkey: newPasskey })
    .where(eq(schema.users.id, user.id));

  // The old value belongs to nobody now: its block entry and its per-passkey
  // counters both index a hash no account matches any more, and leaving the
  // counters behind would also leak the rotation.
  await retireTorznabPasskey(oldPasskey);

  // The session cookie carries the passkey, so it now holds a dead one. Write
  // the new value back rather than force a re-login.
  await setUserSession(event, {
    ...(await getUserSession(event)),
    user: { ...user, passkey: newPasskey },
  });

  // A rotation is a security event, and one the member may not have started
  // themselves if a session was borrowed.
  void notify(user.id, 'password_changed', { reason: 'passkey_rotated' }, '/settings');

  return {
    success: true,
    passkey: newPasskey,
    // Said explicitly because the consequence is immediate and total: every
    // announce URL and every feed URL the member holds is now dead.
    warning:
      'Every existing announce and feed URL is now invalid. Re-download your .torrent files or update the announce URL in your client, and refresh the API key in any *Arr indexer.',
  };
});
