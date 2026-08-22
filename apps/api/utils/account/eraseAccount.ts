/**
 * Erase an account — the GDPR right to erasure, made to coexist with a private
 * tracker's need to keep its catalogue standing.
 *
 * ## Anonymise, don't drop
 *
 * A member's row is the anchor for everything they ever did: the torrents they
 * uploaded, the moderation decisions taken on them, the economy they moved.
 * Hard-deleting the row would either cascade all of that away or, where a
 * foreign key refuses to cascade, be refused outright — the catalogue would be
 * undeletable for as long as one member held one release. So the row survives,
 * and every personal field on it is scrubbed instead: the person is gone, their
 * contributions stay, attributed to a tombstone name nobody can trace back.
 *
 * ## Three things happen, in this order
 *
 *   1. The federated identity is retracted. Every signing key the member holds
 *      is revoked, and the local mirror of who-they-are-elsewhere is dropped.
 *      The revocations and the retirement of their identity assertion then go
 *      out to partners — immediately if federation is live, and otherwise on the
 *      next mint sweep, which reaches the same state from the same rows.
 *   2. The personal rows are deleted: sessions' second factors, passkeys,
 *      trusted devices, notification routes, the social graph, favourites, and
 *      the federated-identity links themselves.
 *   3. The account row is scrubbed and stamped `deleted_at`. The cached auth
 *      gate reads that stamp and refuses the account like a missing one, so a
 *      session cookie still in a browser is dead on its next request.
 *
 * Steps 2 and 3 are one transaction: a half-scrubbed account that could still
 * authenticate is the one outcome worse than not starting.
 */
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { randomBytes, randomUUID } from 'node:crypto';
import { db, schema } from '@trackarr/db';
import { invalidateBanCache } from '~~/utils/adminAuth';
import {
  getFederationConfig,
  getPrivateKeyPem,
  isFederationLive,
} from '~~/utils/federation/config';
import { didKeyFromPublicKey } from '~~/utils/federation/did';
import {
  mintIdentityRecords,
  mintRevocations,
} from '~~/utils/federation/identityRecord';

export interface EraseResult {
  /** Signing keys that were live and are now revoked. */
  keysRevoked: number;
  /** Whether the retraction was pushed out synchronously (else the sweep does). */
  propagatedNow: boolean;
}

/**
 * Erase `userId`. Idempotent: erasing an already-erased account re-scrubs it and
 * changes nothing observable. Safe to call from a request path — the federated
 * push is best-effort and never blocks the local erasure from committing.
 */
export async function eraseAccount(userId: string): Promise<EraseResult> {
  // The member's identifiers, before we touch anything — needed to find the
  // partner-asserted links that mention them.
  const keys = await db
    .select({ did: schema.userSigningKeys.did })
    .from(schema.userSigningKeys)
    .where(eq(schema.userSigningKeys.userId, userId));
  const dids = keys.map((k) => k.did);

  const now = new Date();
  let keysRevoked = 0;

  await db.transaction(async (tx) => {
    // 1a. Revoke every live key. A retired key already carries `revoked_at`;
    // these newly-revoked ones are what the next `mintRevocations` announces.
    const revoked = await tx
      .update(schema.userSigningKeys)
      .set({ revokedAt: now })
      .where(
        and(
          eq(schema.userSigningKeys.userId, userId),
          isNull(schema.userSigningKeys.revokedAt),
        ),
      )
      .returning({ did: schema.userSigningKeys.did });
    keysRevoked = revoked.length;

    // 1b. Drop the local mirror of "this member is also X elsewhere". These are
    // partners' assertions about the member's identifiers; with the member gone
    // we no longer host them. (Their own copies fall when the revocation lands.)
    if (dids.length) {
      await tx
        .delete(schema.remoteIdentityLinks)
        .where(
          or(
            inArray(schema.remoteIdentityLinks.subjectDid, dids),
            inArray(schema.remoteIdentityLinks.aliasDid, dids),
          ),
        );
    }

    // 2. Personal rows. The account row is kept and scrubbed below; everything
    // that is ONLY about the person goes now, because the surviving row means a
    // CASCADE from `users` never fires to take them.
    await tx.delete(schema.federatedIdentities).where(eq(schema.federatedIdentities.localUserId, userId));
    await tx.delete(schema.recoveryCodes).where(eq(schema.recoveryCodes.userId, userId));
    await tx.delete(schema.webauthnCredentials).where(eq(schema.webauthnCredentials.userId, userId));
    await tx.delete(schema.trustedDevices).where(eq(schema.trustedDevices.userId, userId));
    await tx.delete(schema.userNotificationChannels).where(eq(schema.userNotificationChannels.userId, userId));
    await tx.delete(schema.userNotificationRouting).where(eq(schema.userNotificationRouting.userId, userId));
    await tx.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));
    await tx.delete(schema.torrentFavorites).where(eq(schema.torrentFavorites.userId, userId));
    await tx
      .delete(schema.userFollows)
      .where(
        or(
          eq(schema.userFollows.followerId, userId),
          eq(schema.userFollows.followingId, userId),
        ),
      );

    // 3. Scrub the row itself. The passkey is rotated to a fresh unusable value
    // so any announce URL the member kept stops working; the SRP material is
    // replaced with random bytes no client can reproduce; the profile text and
    // the last-seen IP are cleared. `deleted_at` is the gate the rest keys on.
    // The username must stay unique and non-null — the account id is both.
    await tx
      .update(schema.users)
      .set({
        username: `deleted-${userId}`,
        displayName: null,
        bio: null,
        lastIp: null,
        authSalt: randomBytes(24).toString('base64'),
        authVerifier: randomBytes(48).toString('base64'),
        passkey: randomUUID().replace(/-/g, ''),
        totpSecret: null,
        totpEnabled: false,
        trustDevicesEnabled: false,
        panicPasswordHash: null,
        deletedAt: now,
      })
      .where(eq(schema.users.id, userId));
  });

  // The cached gate must forget the old "ok" at once, or the account stays
  // reachable for up to the 60 s TTL behind a live cookie.
  await invalidateBanCache(userId);

  // Push the retraction now if we can. A failure here is not a failure of the
  // erasure — the mint sweep reaches the identical state from the rows we just
  // wrote (keys revoked, identity projections empty), so this is only latency.
  let propagatedNow = false;
  try {
    const config = await getFederationConfig();
    const privateKeyPem = config && getPrivateKeyPem(config);
    if (isFederationLive(config) && privateKeyPem && config!.publicKey) {
      const ctx = {
        privateKeyPem,
        did: didKeyFromPublicKey(config!.publicKey),
        publicUrl: config!.publicUrl ?? null,
      };
      await mintRevocations(ctx);
      await mintIdentityRecords(ctx);
      propagatedNow = true;
    }
  } catch {
    // Deferred to the sweep — intentionally swallowed.
  }

  return { keysRevoked, propagatedNow };
}
