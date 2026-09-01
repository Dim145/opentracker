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
 *      the federated-identity links themselves. Raw client identifiers kept
 *      elsewhere are cleared in place — an anti-cheat flag keeps the finding and
 *      loses the IP and User-Agent that raised it.
 *   3. The account row is scrubbed and stamped `deleted_at`. The cached auth
 *      gate reads that stamp and refuses the account like a missing one, so a
 *      session cookie still in a browser is dead on its next request.
 *
 * Steps 2 and 3 are one transaction: a half-scrubbed account that could still
 * authenticate is the one outcome worse than not starting.
 *
 * ## The catalogue, which is where this used to stop short
 *
 * The signed records this instance had already published carried the member's
 * `trackarr:uploaderName` and their author DID, and were served verbatim to any
 * partner asking for them by id. So the sentence above — a tombstone nobody can
 * trace back — was true of the database join and false of the catalogue.
 *
 * Three things close that. The projection reads an erased account as anonymous,
 * so a re-mint carries no name and no DID; `ensureUserDid` refuses to mint a
 * fresh key for an erased account, so the re-mint cannot resurrect the
 * identifier; and the member's torrents get their `updated_at` bumped here, so
 * the forward-only mint sweep actually revisits them. The sweep then deletes the
 * generations that carried the name, once their replacement exists.
 *
 * What no amount of this reaches: bytes already handed to a partner. A signed
 * record is immutable and relayable, so the honest statement is that this stops
 * US serving the name and publishes a revocation saying the identifier is
 * retired. It is not a recall.
 *
 * ## What is kept, and on what basis
 *
 * Not everything touching the account goes. `notifications`, `hnr_tracking`,
 * `bonus_events`, `invitations`, `reports` and — where the member was staff —
 * their entries in `audit_log` survive, attached to the scrubbed
 * row. Each is either a record of an obligation between the tracker and other
 * members (a hit-and-run, an invitation tree, a report somebody else filed) or
 * part of the economy's audit trail, and none of them holds a raw identifier
 * once step 2 has run. Stated here because an unstated retention is
 * indistinguishable from an oversight.
 */
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { randomBytes, randomUUID } from 'node:crypto';
import { db, schema } from '@trackarr/db';
import { retireTorznabPasskey } from '~~/utils/torznabStats';
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
import { relinquishOwnership } from '~~/utils/owner';

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
  /**
   * The passkey as it is now, read before the transaction rotates it away.
   *
   * Needed after the commit to clear what is keyed on its hash outside
   * Postgres — see the note further down.
   */
  const [before] = await db
    .select({ passkey: schema.users.passkey })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  const oldPasskey = before?.passkey ?? null;

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
    /**
     * The two personal tables this branch added.
     *
     * Deleted by hand for the reason the whole function exists: the `users` row
     * SURVIVES an erasure, so no `ON DELETE` ever fires. Left behind, the saved
     * filters kept matching uploads and writing notifications to a tombstone
     * for ever, and the login history stayed attributed to the account — and
     * readable through the moderator view — for its full retention period.
     */
    await tx
      .delete(schema.savedSearches)
      .where(eq(schema.savedSearches.userId, userId));
    await tx.delete(schema.loginEvents).where(eq(schema.loginEvents.userId, userId));
    await tx.delete(schema.torrentFavorites).where(eq(schema.torrentFavorites.userId, userId));
    await tx
      .delete(schema.userFollows)
      .where(
        or(
          eq(schema.userFollows.followerId, userId),
          eq(schema.userFollows.followingId, userId),
        ),
      );

    // 2a-bis. If this account owns the instance, it stops. In THIS
    // transaction, because the alternative is a committed erasure that left the
    // instance owned by an account which can no longer sign in — and the only
    // way out of that is a hand-written UPDATE against production.
    await relinquishOwnership(userId, 'erased', tx);

    // 2b. Anything that ties a raw client identifier to the person. An
    // anti-cheat flag carries the IP and the User-Agent of the announce that
    // raised it, which is personal data by any reading and was being kept past
    // the account it described. The flags themselves are moderation history, so
    // the row survives with the identifiers cleared rather than being deleted:
    // "this account was flagged for cross-seeding" stays true and traceable to
    // nobody.
    await tx
      .update(schema.anticheatFlags)
      .set({ ip: null, userAgent: null })
      .where(eq(schema.anticheatFlags.userId, userId));

    // 2c. Move the member's releases forward in the mint sweep's clock.
    //
    // The sweep walks `coalesce(updated_at, created_at)` forward only, so a
    // record already minted is never re-read unless the torrent moves — and
    // erasure changes what the projection SAYS about it (no uploader name, no
    // author DID) without touching the torrent. Without this bump the released
    // catalogue keeps naming the member forever. Same mechanism the panic
    // switch uses, for the same reason.
    await tx
      .update(schema.torrents)
      .set({ updatedAt: now })
      .where(eq(schema.torrents.uploaderId, userId));

    // 2d. Messaging.
    //
    // Erasure keeps the `users` row, so none of the ON DELETE clauses on the
    // messaging tables fire. Every one of them has to be done by hand here,
    // and the split is the one the plan settled on: plaintext is kept and
    // anonymised, ciphertext is destroyed.
    //
    // The published key goes first. It is what a correspondent needs to
    // re-derive the conversation key, so leaving it would leave the erasure
    // reversible for anyone who kept the other half.
    await tx.delete(schema.userMessageKeys).where(eq(schema.userMessageKeys.userId, userId));

    // Then the encrypted conversations, whole — both sides, not just this
    // member's half. A ciphertext nobody can decrypt is not a preserved
    // conversation, it is unreadable bytes retained after an erasure request;
    // and the survivor is better served by an empty thread they can read the
    // reason for than by rows that will never open again. The conversation row
    // itself stays: with no key, no messages and no correspondent left to name,
    // it is what the client turns into "closed at your correspondent's
    // request".
    const encryptedIds = (
      await tx
        .select({ id: schema.conversations.id })
        .from(schema.conversations)
        .innerJoin(
          schema.conversationParticipants,
          eq(schema.conversationParticipants.conversationId, schema.conversations.id),
        )
        .where(
          and(
            eq(schema.conversationParticipants.userId, userId),
            eq(schema.conversations.encrypted, true),
          ),
        )
    ).map((r) => r.id);

    if (encryptedIds.length > 0) {
      await tx.delete(schema.messages).where(inArray(schema.messages.conversationId, encryptedIds));
      // The unread counter is denormalised, so deleting the messages it
      // counted leaves the survivor with a badge pointing at nothing.
      await tx
        .update(schema.conversationParticipants)
        .set({ unreadCount: 0 })
        .where(inArray(schema.conversationParticipants.conversationId, encryptedIds));
    }

    // Blocks are a two-sided personal list and nothing else: both directions go.
    await tx
      .delete(schema.messagingBlocks)
      .where(
        or(
          eq(schema.messagingBlocks.userId, userId),
          eq(schema.messagingBlocks.blockedId, userId),
        ),
      );

    // A room mute is an unenforceable restriction on an account that can no
    // longer sign in. Unlike an anti-cheat flag it records no finding worth
    // keeping — it is a timer against a person — so it goes rather than being
    // blanked.
    await tx.delete(schema.roomMutes).where(eq(schema.roomMutes.userId, userId));

    /*
     * The staff read log keeps its rows, and loses only the pointer.
     *
     * `reader_id` is declared `ON DELETE set null`, and that never fires
     * here — this function UPDATEs the users row rather than deleting it,
     * so every declared cascade on this table is decoration. Done by hand,
     * like every other one.
     *
     * The name column stays. It is the record: an audit trail that becomes
     * a column of nulls in the one case where it matters most — a
     * moderator erasing their own account — is not an audit trail. What
     * goes is the join back to the (anonymised) row, which would otherwise
     * render every past read as `deleted-a1b2c3`.
     */
    await tx
      .update(schema.messageReadLog)
      .set({ readerId: null })
      .where(eq(schema.messageReadLog.readerId, userId));

    /*
     * Tickets keep the staff's record and lose the member's name.
     *
     * The opposite call from the read log two blocks up, and for the
     * opposite reason. There the name IS the record — a moderator erasing
     * themselves must not erase who looked. Here the name is the person
     * asking to be forgotten, and the thing worth keeping is the staff's
     * record of a decision, which a ticket may well be an appeal against.
     *
     * So the ticket survives, anonymised, exactly like a plaintext direct
     * message does. Deleting it outright would let anyone erase the
     * record of what they were told by deleting their account.
     */
    const erasedName = `deleted-${randomBytes(6).toString('hex')}`;
    await tx
      .update(schema.tickets)
      .set({ openedById: null, openedByName: erasedName })
      .where(eq(schema.tickets.openedById, userId));
    // Their own lines. Staff lines on the same ticket are untouched: a
    // moderator's answer is the moderator's, not the member's.
    await tx
      .update(schema.ticketMessages)
      .set({ authorId: null, authorName: erasedName })
      .where(
        and(
          eq(schema.ticketMessages.authorId, userId),
          eq(schema.ticketMessages.fromStaff, false)
        )
      );
    // And where they were staff: the assignment and the closure are acts,
    // and an act with no author is indefensible — same rule as the read
    // log. The pointer goes, the name stays.
    await tx
      .update(schema.tickets)
      .set({ assignedToId: null })
      .where(eq(schema.tickets.assignedToId, userId));
    await tx
      .update(schema.tickets)
      .set({ closedById: null })
      .where(eq(schema.tickets.closedById, userId));
    await tx
      .update(schema.ticketMessages)
      .set({ authorId: null })
      .where(
        and(
          eq(schema.ticketMessages.authorId, userId),
          eq(schema.ticketMessages.fromStaff, true)
        )
      );

    // The staff audit log, on exactly the rule above: the pointer goes, the
    // name stays. Banning a member is an act taken under authority, and an act
    // under authority with no author is indefensible — an ex-moderator must not
    // be able to un-sign their own decisions by closing their account.
    //
    // Done by hand rather than left to the FK: the row in `users` SURVIVES an
    // erasure (that is the whole design — the catalogue hangs off it), so no
    // ON DELETE ever fires and every reference has to be cleared here.
    //
    // What this costs, and it is the honest reading: the audit log keeps a
    // username after erasure. It is kept on the same basis as the invitation
    // tree and the reports the erasure already keeps — a record of an
    // obligation between the tracker and OTHER members, which the person on
    // one side of it cannot unilaterally erase.
    await tx
      .update(schema.auditLog)
      .set({ actorId: null })
      .where(eq(schema.auditLog.actorId, userId));
    // Where they were the TARGET, though, the pointer and the label both go:
    // being banned is not an act they took, it is a thing recorded about them.
    await tx
      .update(schema.auditLog)
      .set({ targetId: null, targetLabel: erasedName })
      .where(
        and(
          eq(schema.auditLog.targetType, 'user'),
          eq(schema.auditLog.targetId, userId)
        )
      );

    // 3. Scrub the row itself. The passkey is rotated to a fresh unusable value
    // so any announce URL the member kept stops working; the SRP material is
    // replaced with random bytes no client can reproduce; the profile text and
    // the last-seen IP are cleared. `deleted_at` is the gate the rest keys on.
    //
    // The username must stay unique and non-null, and it used to be
    // `deleted-<account id>` — which published the internal primary key as a
    // public username, for no gain: a random suffix satisfies the same
    // constraint and identifies nothing.
    await tx
      .update(schema.users)
      .set({
        username: `deleted-${randomBytes(12).toString('hex')}`,
        displayName: null,
        bio: null,
        lastIp: null,
        authSalt: randomBytes(24).toString('base64'),
        authVerifier: randomBytes(48).toString('base64'),
        passkey: randomUUID().replace(/-/g, ''),
      // The two read keys go entirely rather than being rotated to an unusable
      // value: unlike the passkey they are nullable, so "no key" is a state the
      // schema already has a word for, and an erased account has nothing to
      // read. Cleared by hand because the row survives an erasure — no ON
      // DELETE ever fires here.
      rssKey: null,
      apiKey: null,
        totpSecret: null,
        totpEnabled: false,
        trustDevicesEnabled: false,
        panicPasswordHash: null,
        deletedAt: now,
      })
      .where(eq(schema.users.id, userId));
  });

  /**
   * The Torznab residue of the passkey we just rotated away.
   *
   * Keyed by a hash of the OLD value, so nothing in the transaction above
   * touches it: an access block against an account that no longer exists, and
   * up to seven days of request logs carrying an IP hash and a user agent. On
   * the one route whose job is to leave nothing behind.
   */
  if (oldPasskey) {
    await retireTorznabPasskey(oldPasskey).catch((err) => {
      console.warn('[erase] torznab residue survived:', (err as Error).message);
    });
  }

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
