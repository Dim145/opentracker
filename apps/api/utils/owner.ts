/**
 * Who owns this instance, and what happens when they stop being able to.
 *
 * `users.is_owner` names one account: the person whose instance this is. It is
 * not a rank above admin and not a permission bundle — it exists because parts
 * of this codebase already assumed it did. The federation console is described
 * as "owner-controlled" in the schema comments, in `doc/guide/federation.md`
 * and in its own governance docstrings, while the code behind it only ever
 * checked `is_admin`. An admin appointed to moderate uploads could therefore
 * handshake with another instance on the operator's behalf.
 *
 * ## Why ownership moves on its own
 *
 * The flag is transferable by hand, and it also moves without being asked. An
 * owner who is erased, banned, or stripped of `is_admin` is an owner who cannot
 * act — and the decisions reserved to them are exactly the ones an instance
 * cannot get on without: who it federates with, whether raw CSS is allowed,
 * which fonts are installed. Leaving the flag on a paralysed account would mean
 * a single ban locking the instance out of its own governance permanently.
 *
 * So three write paths call `relinquishOwnership`: erasure, banning, and losing
 * admin. Each of them already had a reason to touch the row; none of them
 * previously had a reason to think about ownership.
 *
 * ## Why it never becomes nobody
 *
 * If no eligible admin remains, the flag STAYS where it is rather than being
 * cleared. That looks wrong at first glance and is the safer of the two
 * failures: an unreachable owner is recoverable — unban them, restore them,
 * promote someone and transfer — whereas an instance with no owner at all has
 * no one who can appoint one, and the only way out is a hand-written UPDATE
 * against production. The comment is here because the next reader will want to
 * "fix" it.
 */
import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { invalidateRoleCache } from './liveRoles';

/** A database handle, or the transaction standing in for one. */
type Writer = Pick<typeof db, 'select' | 'update'>;

/** Why ownership is moving. Logged, so an operator can find out afterwards. */
export type OwnerFallbackReason = 'erased' | 'banned' | 'demoted';

/**
 * An admin who could hold the flag: not this one, not banned, not erased.
 *
 * `created_at` then `id`, so the answer is the same on every replica — two
 * accounts registered in the same millisecond must not resolve differently
 * depending on which one Postgres happened to return first.
 */
async function oldestEligibleAdmin(
  tx: Writer,
  excludeUserId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(
      and(
        eq(schema.users.isAdmin, true),
        eq(schema.users.isBanned, false),
        isNull(schema.users.deletedAt),
        ne(schema.users.id, excludeUserId),
      ),
    )
    .orderBy(asc(schema.users.createdAt), asc(schema.users.id))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Move ownership off `userId` if it holds it. Safe to call unconditionally.
 *
 * Returns the new owner's id, `null` when nobody eligible remains (the flag
 * stays put — see the module header), and `undefined` when `userId` was not the
 * owner, which is the overwhelmingly common case and costs one indexed read.
 *
 * Pass the caller's transaction whenever the reason for the move is itself
 * transactional. Erasure does: a half-applied erasure that cleared the account
 * but left it owning the instance is the one outcome worse than not starting.
 */
export async function relinquishOwnership(
  userId: string,
  reason: OwnerFallbackReason,
  tx: Writer = db,
): Promise<string | null | undefined> {
  const [holder] = await tx
    .select({ isOwner: schema.users.isOwner })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!holder?.isOwner) return undefined;

  const heir = await oldestEligibleAdmin(tx, userId);
  if (!heir) {
    console.warn(
      `[Owner] ${userId} is ${reason} but no eligible admin remains; ownership stays with them. Promote an admin and transfer it.`,
    );
    return null;
  }

  // Cleared before it is granted. The partial unique index makes two owners
  // unrepresentable, so the other order would fail the constraint rather than
  // produce a wrong state — but relying on a constraint to sequence two
  // statements is relying on it for the wrong thing.
  await tx
    .update(schema.users)
    .set({ isOwner: false })
    .where(eq(schema.users.id, userId));
  await tx
    .update(schema.users)
    .set({ isOwner: true })
    .where(eq(schema.users.id, heir));

  console.log(`[Owner] ${userId} is ${reason}; ownership moved to ${heir}.`);
  return heir;
}

/**
 * Hand ownership to another admin, deliberately.
 *
 * Separate from `relinquishOwnership` because the checks are different: this
 * one refuses rather than falling back, since a transfer names its recipient
 * and picking somebody else instead would be answering a question nobody asked.
 *
 * Runs in one transaction under an advisory lock on the ownership itself. Two
 * concurrent transfers would otherwise both read the current owner, both clear
 * it and both grant — and the partial unique index would fail one of them with
 * a constraint violation rather than a message anyone can act on.
 */
export async function transferOwnership(
  fromUserId: string,
  toUserId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (fromUserId === toUserId) {
    return { ok: false, reason: 'That account already owns this instance' };
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(7414)`);

    const [current] = await tx
      .select({ isOwner: schema.users.isOwner })
      .from(schema.users)
      .where(eq(schema.users.id, fromUserId))
      .limit(1);
    if (!current?.isOwner) {
      return { ok: false as const, reason: 'You no longer own this instance' };
    }

    const [heir] = await tx
      .select({
        isAdmin: schema.users.isAdmin,
        isBanned: schema.users.isBanned,
        deletedAt: schema.users.deletedAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, toUserId))
      .limit(1);
    if (!heir) return { ok: false as const, reason: 'No such account' };
    if (heir.deletedAt) {
      return { ok: false as const, reason: 'That account has been erased' };
    }
    if (heir.isBanned) {
      return { ok: false as const, reason: 'That account is banned' };
    }
    // Owner implies admin. Handing the instance to somebody who cannot reach
    // the admin console would be handing it to nobody, and the automatic
    // fallback would take it straight back off them.
    if (!heir.isAdmin) {
      return {
        ok: false as const,
        reason: 'Make them an admin first — an owner has to be one',
      };
    }

    await tx
      .update(schema.users)
      .set({ isOwner: false })
      .where(eq(schema.users.id, fromUserId));
    await tx
      .update(schema.users)
      .set({ isOwner: true })
      .where(eq(schema.users.id, toUserId));

    return { ok: true as const };
  }).then(async (result) => {
    // Outside the transaction: the cache is not transactional, and evicting it
    // before the commit would let a concurrent request re-cache the old value.
    if (result.ok) {
      await invalidateRoleCache(fromUserId);
      await invalidateRoleCache(toUserId);
    }
    return result;
  });
}

/** The current owner's id, or null on an instance that has none. */
export async function currentOwnerId(): Promise<string | null> {
  const [row] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.isOwner, true))
    .limit(1);
  return row?.id ?? null;
}
