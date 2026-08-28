import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { makeUser } from './helpers';
import {
  currentOwnerId,
  relinquishOwnership,
  transferOwnership,
} from '../../utils/owner';
import { eraseAccount } from '../../utils/account/eraseAccount';

// Who owns the instance.
//
// The flag matters because several decisions are reserved to it — federation
// governance today, raw CSS and font installation later — so the question these
// tests answer is not "does the boolean flip" but "can the instance ever end up
// unable to take those decisions". Two ways that happens: the holder becomes
// unable to act, or somebody takes the flag who should not have it.

/** An admin, created at a controlled time so "oldest" is decidable. */
function admin(minutesAgo: number, over: Parameters<typeof makeUser>[0] = {}) {
  return makeUser({
    isAdmin: true,
    createdAt: new Date(Date.now() - minutesAgo * 60_000),
    ...over,
  });
}

async function isOwner(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ isOwner: schema.users.isOwner })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  return !!row?.isOwner;
}

describe('ownership moves when the holder can no longer act', () => {
  it('hands the instance to the oldest eligible admin', async () => {
    const owner = await admin(10, { isOwner: true });
    const older = await admin(60);
    await admin(5); // younger, should not win

    expect(await relinquishOwnership(owner, 'banned')).toBe(older);
    expect(await isOwner(owner)).toBe(false);
    expect(await isOwner(older)).toBe(true);
  });

  it('skips a banned, an erased and a non-admin candidate', async () => {
    // The point of "eligible": handing the instance to somebody who cannot sign
    // in is handing it to nobody, and the fallback would immediately have to run
    // again.
    const owner = await admin(10, { isOwner: true });
    await admin(90, { isBanned: true });
    await admin(80, { deletedAt: new Date() });
    await makeUser({ createdAt: new Date(Date.now() - 70 * 60_000) }); // member
    const eligible = await admin(20);

    expect(await relinquishOwnership(owner, 'banned')).toBe(eligible);
  });

  it('keeps the flag where it is when nobody is eligible', async () => {
    // Deliberately not "clears it". An unreachable owner is recoverable — unban
    // them, promote somebody, transfer. An instance with NO owner has nobody who
    // can appoint one, and the only way out is an UPDATE against production.
    const owner = await admin(10, { isOwner: true });
    await makeUser(); // a member, not eligible

    expect(await relinquishOwnership(owner, 'banned')).toBeNull();
    expect(await isOwner(owner)).toBe(true);
  });

  it('is a cheap no-op for somebody who does not own it', async () => {
    const owner = await admin(10, { isOwner: true });
    const other = await admin(20);

    expect(await relinquishOwnership(other, 'banned')).toBeUndefined();
    expect(await isOwner(owner)).toBe(true);
  });

  it('never leaves two owners behind', async () => {
    const owner = await admin(10, { isOwner: true });
    const heir = await admin(60);

    await relinquishOwnership(owner, 'erased');

    const owners = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.isOwner, true));
    expect(owners.map((o) => o.id)).toEqual([heir]);
  });

  it('the database refuses a second owner outright', async () => {
    // The partial unique index, not application code, is what makes two owners
    // unrepresentable. Worth pinning: every guard above could be bypassed by a
    // future codepath, and this one cannot.
    await admin(10, { isOwner: true });
    await expect(admin(20, { isOwner: true })).rejects.toThrow();
  });

  it('erasure hands the instance on in the same transaction', async () => {
    // The case that made this necessary: `eraseAccount` keeps the row and stamps
    // `deleted_at`, so an erased owner would have kept the flag while being
    // refused at the door.
    const owner = await admin(10, { isOwner: true });
    const heir = await admin(60);

    await eraseAccount(owner);

    expect(await isOwner(owner)).toBe(false);
    expect(await isOwner(heir)).toBe(true);
  });
});

describe('handing the instance over deliberately', () => {
  it('moves it to another admin', async () => {
    const owner = await admin(10, { isOwner: true });
    const heir = await admin(20);

    expect(await transferOwnership(owner, heir)).toEqual({ ok: true });
    expect(await currentOwnerId()).toBe(heir);
  });

  it('refuses somebody who is not an admin', async () => {
    // An owner who cannot reach the admin console is an owner in name only, and
    // the automatic fallback would take it straight back off them.
    const owner = await admin(10, { isOwner: true });
    const member = await makeUser();

    const r = await transferOwnership(owner, member);
    expect(r.ok).toBe(false);
    expect(await isOwner(owner)).toBe(true);
  });

  it('refuses a banned or an erased recipient', async () => {
    const owner = await admin(10, { isOwner: true });
    const banned = await admin(20, { isBanned: true });
    const erased = await admin(30, { deletedAt: new Date() });

    expect((await transferOwnership(owner, banned)).ok).toBe(false);
    expect((await transferOwnership(owner, erased)).ok).toBe(false);
    expect(await isOwner(owner)).toBe(true);
  });

  it('refuses a transfer to itself', async () => {
    const owner = await admin(10, { isOwner: true });
    expect((await transferOwnership(owner, owner)).ok).toBe(false);
    expect(await isOwner(owner)).toBe(true);
  });

  it('refuses an actor who does not own the instance', async () => {
    // The route gate would already have refused, but the helper is the thing
    // that writes — so it checks the fact it depends on rather than trusting a
    // caller to have checked it.
    const owner = await admin(10, { isOwner: true });
    const impostor = await admin(20);
    const target = await admin(30);

    const r = await transferOwnership(impostor, target);
    expect(r.ok).toBe(false);
    expect(await currentOwnerId()).toBe(owner);
  });
});

describe('an instance with no owner at all', () => {
  it('reports null rather than inventing one', async () => {
    await admin(10);
    expect(await currentOwnerId()).toBeNull();
  });

  it('is what a fresh database looks like before the first registration', async () => {
    // The migration backfills the oldest eligible admin; on an empty database it
    // updates nothing, and `register.post.ts` sets the flag on the first account
    // under the same advisory lock that decides `is_admin`. So "no owner" is a
    // real, expected state for exactly as long as "no users" is.
    expect(await currentOwnerId()).toBeNull();
  });
});
