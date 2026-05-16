/**
 * Lazy-unban gate.
 *
 * Sits at every auth boundary that needs to honour `bannedUntil`:
 * the web login, the Torznab API, the announce path (Go calls a
 * sibling helper). Each surface invokes `liftExpiredBan(user)` on
 * the freshly-fetched user row before its own `isBanned` rejection;
 * if the ban has expired the row is unbanned in place, the cache is
 * invalidated, and the caller can treat the user as healthy.
 *
 * The 5-minute cron in `plugins/ban-expiry.ts` is the primary
 * unbanner — it handles users who never come back AND fires the
 * `account_unbanned` notification. The lazy path here is a
 * latency safety-net: it makes sure a user who tries to sign in
 * 1 second after their ban expires isn't bounced because the cron
 * hasn't ticked yet. The cron and the lazy path are idempotent
 * relative to each other (the cron filters on `is_banned = true`).
 */
import { eq } from 'drizzle-orm';
import { db } from '@trackarr/db';
import { users } from '@trackarr/db/schema';
import { invalidateBanCache } from './adminAuth';

/**
 * Minimal user shape this helper needs. Callers pass either a
 * full `User` row or a tighter projection (Torznab uses one) —
 * either works as long as these three fields are present.
 */
export interface BanCheckable {
  id: string;
  isBanned: boolean;
  bannedUntil: Date | string | null;
}

/**
 * Mutates the provided row in-place and writes the unban back to
 * the DB when applicable. Returns `true` if the row is currently
 * effectively banned (caller should reject), `false` if the
 * caller can proceed.
 *
 * Rules:
 *   - not banned        → returns false (caller proceeds)
 *   - banned, no until  → returns true  (permanent ban)
 *   - banned, future    → returns true  (active timed ban)
 *   - banned, past/now  → unban inline + returns false
 */
export async function liftExpiredBan(user: BanCheckable): Promise<boolean> {
  if (!user.isBanned) return false;
  if (!user.bannedUntil) return true; // permanent
  const expired = new Date(user.bannedUntil).getTime() <= Date.now();
  if (!expired) return true;

  // Clear the ban in the DB. We deliberately keep `bannedById` /
  // `bannedByRole` / `banReason` / `bannedUntil` untouched so the
  // audit trail survives; the active flag is what gates access.
  await db
    .update(users)
    .set({ isBanned: false })
    .where(eq(users.id, user.id));
  await invalidateBanCache(user.id);

  // Mutate the caller's copy so they don't trip the rejection
  // path that runs right after this call.
  user.isBanned = false;
  return false;
}
