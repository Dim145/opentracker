/**
 * A name of their own, for every uploader.
 *
 * A record has always said who uploaded it. Until now it said so with a
 * display name, which is a fine thing to print and a useless thing to reason
 * with: two instances can both have a `Nova`, a member can rename themselves,
 * and once a record has been relayed twice the instance that could resolve the
 * name is not in the conversation any more. Attribution that cannot survive
 * the instance is not attribution, it is a caption.
 *
 * So each uploader gets an Ed25519 keypair and is named by its `did:key`. The
 * identifier IS the public key, so anybody holding a record can name its author
 * without asking anyone, forever, including after this instance is gone.
 *
 * ## What this is not
 *
 * It is not proof of authorship. The private key is held here, by the server,
 * which means a signature made with it asserts exactly what the server was
 * already asserting and not one thing more. Treating a server-held key as
 * evidence of what a member did is the mistake that makes signed-data systems
 * feel secure while being nothing of the kind.
 *
 * At this stage the DID is a **stable name**: unforgeable by other instances,
 * portable across relays, meaningless as a claim about the human. It becomes
 * evidence only when the member holds the key and this server does not — a
 * later step, and one that has to start from a fresh key, because a key the
 * server has held can never afterwards become the member's private property.
 *
 * ## Provisioned on first use
 *
 * Nothing is generated until a member's work is actually published. A fresh
 * install federating nothing carries no key material at all, which is the same
 * rule the instance identity follows and for the same reason: key material you
 * did not need is key material you have to protect anyway.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { encryptJson, decryptJson } from '../channelSecrets';
import { generateInstanceKeypair } from './keys';
import { didKeyFromPublicKey } from './did';

/**
 * The DID for one member, creating the key the first time it is asked for.
 *
 * Races are resolved by a unique index rather than by a lock, and it has to be
 * the RIGHT one. Two concurrent mints generate two different keypairs, so they
 * have two different DIDs and never collide on the primary key — the arbiter
 * this used to name. What actually stops them is `user_signing_keys_current`,
 * the partial unique index over `(user_id) WHERE revoked_at IS NULL`, which
 * says a member has at most one live key.
 *
 * So the conflict clause names no target: either arbiter means the same thing
 * here — somebody else got there first — and the caller re-reads rather than
 * assuming its own key won.
 *
 * Worth stating because both halves were wrong at once. The index is one of
 * the fifteen `drizzle-kit push` never created, so on every push-maintained
 * database it did not exist and a race left a member holding two live keys,
 * silently. Restoring it under the migration chain would then have turned that
 * into a thrown unique violation, because a conflict clause naming `did`
 * cannot absorb a violation of a different index.
 *
 * ## Null for an erased account, and why that is the important line here
 *
 * Erasure revokes every key the member held and publishes the revocations. It
 * does not, and cannot, stop somebody EDITING one of their still-published
 * releases afterwards — and that edit bumps `updated_at`, so the mint sweep
 * picks the torrent up, asks for the uploader's DID, finds no live key, and
 * used to mint a fresh keypair against the erased account. The member had a
 * live federated identifier again, their records were republished under it, and
 * no `Undo` was ever published for it because nothing knew it existed.
 *
 * So this refuses. The caller treats the absence the same way it treats an
 * anonymous upload: the record goes out with no author.
 */
export async function ensureUserDid(userId: string): Promise<string | null> {
  const [existing] = await db
    .select({ did: schema.userSigningKeys.did })
    .from(schema.userSigningKeys)
    .where(
      and(
        eq(schema.userSigningKeys.userId, userId),
        isNull(schema.userSigningKeys.revokedAt),
      ),
    )
    .limit(1);
  if (existing) return existing.did;

  // No key, and none may be made: an erased account does not acquire a new
  // federated identity as a side effect of somebody touching its old work.
  const [account] = await db
    .select({ deletedAt: schema.users.deletedAt })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!account || account.deletedAt) return null;

  const kp = generateInstanceKeypair();
  const did = didKeyFromPublicKey(kp.publicKeyPem);
  const [row] = await db
    .insert(schema.userSigningKeys)
    .values({
      userId,
      did,
      publicKey: kp.publicKeyPem,
      privateKeyEnc: encryptJson({ pem: kp.privateKeyPem }),
    })
    .onConflictDoNothing()
    .returning({ did: schema.userSigningKeys.did });
  if (row) return row.did;

  // Somebody else won the race. Theirs is the real one.
  const [winner] = await db
    .select({ did: schema.userSigningKeys.did })
    .from(schema.userSigningKeys)
    .where(
      and(
        eq(schema.userSigningKeys.userId, userId),
        isNull(schema.userSigningKeys.revokedAt),
      ),
    )
    .limit(1);
  return winner?.did ?? null;
}

/**
 * DIDs for a batch of uploaders, minting the ones that do not exist yet.
 *
 * The read is one query; only the genuinely new members cost an insert. A
 * sweep over a catalogue nobody has published before pays once per uploader
 * and never again.
 */
export async function ensureUserDids(
  userIds: Array<string | null>,
): Promise<Map<string, string>> {
  const wanted = [...new Set(userIds.filter((id): id is string => !!id))];
  if (!wanted.length) return new Map();

  const rows = await db
    .select({
      userId: schema.userSigningKeys.userId,
      did: schema.userSigningKeys.did,
    })
    .from(schema.userSigningKeys)
    .where(
      and(
        inArray(schema.userSigningKeys.userId, wanted),
        isNull(schema.userSigningKeys.revokedAt),
      ),
    );

  const out = new Map(rows.map((r) => [r.userId, r.did]));
  for (const id of wanted) {
    if (out.has(id)) continue;
    // Absent from the map is how "no identifier" travels: the projection reads
    // it as an anonymous upload. An erased account gets no key minted for it,
    // so it lands here and stays absent.
    const did = await ensureUserDid(id);
    if (did) out.set(id, did);
  }
  return out;
}

/**
 * The member's private key, decrypted.
 *
 * Only the export path has any business calling this, and only for the member
 * who owns it. Null when they have never published anything, which is the
 * honest answer rather than provisioning a key as a side effect of somebody
 * asking whether one exists.
 */
export async function getUserPrivateKeyPem(
  userId: string,
): Promise<{ did: string; publicKeyPem: string; privateKeyPem: string } | null> {
  const [row] = await db
    .select()
    .from(schema.userSigningKeys)
    .where(
      and(
        eq(schema.userSigningKeys.userId, userId),
        isNull(schema.userSigningKeys.revokedAt),
      ),
    )
    .limit(1);
  // No stored private key means the member holds it. Saying so with `null` is
  // the honest answer: there is nothing here to hand over, and a caller that
  // needed one has to take the custody path instead.
  if (!row || row.privateKeyEnc === null) return null;
  const dec = decryptJson<{ pem: string }>(row.privateKeyEnc);
  if (!dec?.pem) return null;
  return { did: row.did, publicKeyPem: row.publicKey, privateKeyPem: dec.pem };
}

/**
 * Retire a member's key and give them a new one.
 *
 * The recourse for a member whose exported identity file got out. Nothing here
 * can un-leak the old key — anybody holding it can still sign with it forever
 * — so a rotation does not try to. It says the old identifier is no longer
 * this person, and lets that statement travel: every instance that hears it
 * drops what was proven with the old key and refuses it thereafter.
 *
 * The new key does NOT inherit the old one's links. It would be the obvious
 * convenience and it is exactly wrong: the account that proved the old
 * identifier somewhere else might be the very person who stole the file, and
 * carrying the link forward would hand them the new name too. The member
 * re-proves, with an export only they can now obtain.
 *
 * `succeededBy` is recorded all the same. It does not transfer anything; it
 * lets a reader see that a person continued rather than vanished, and it is
 * the hinge a future move to a member-held key turns on.
 */
export async function rotateUserKey(
  userId: string,
): Promise<{ previous: string | null; did: string }> {
  const previous = await currentDid(userId);

  const kp = generateInstanceKeypair();
  const did = didKeyFromPublicKey(kp.publicKeyPem);

  await db.transaction(async (tx) => {
    if (previous) {
      await tx
        .update(schema.userSigningKeys)
        .set({ revokedAt: new Date(), succeededBy: did })
        .where(eq(schema.userSigningKeys.did, previous));
    }
    await tx.insert(schema.userSigningKeys).values({
      did,
      userId,
      publicKey: kp.publicKeyPem,
      privateKeyEnc: encryptJson({ pem: kp.privateKeyPem }),
    });
  });

  // Whatever this member proved elsewhere was proven with a key that no longer
  // speaks for them. Leaving the links standing would mean a rotation changed
  // nothing for the one thing it exists to undo.
  await db
    .delete(schema.federatedIdentities)
    .where(eq(schema.federatedIdentities.localUserId, userId));

  return { previous, did };
}

/** The member's live identifier, or null if they have never had one. */
export async function currentDid(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ did: schema.userSigningKeys.did })
    .from(schema.userSigningKeys)
    .where(
      and(
        eq(schema.userSigningKeys.userId, userId),
        isNull(schema.userSigningKeys.revokedAt),
      ),
    )
    .limit(1);
  return row?.did ?? null;
}

/**
 * Take a key the member generated, and stop holding one for them.
 *
 * The same shape as a rotation, and for the same reasons: the old identifier
 * is retired with a succession so their catalogue stays connected, and every
 * link they proved elsewhere comes down, because those were proven with a key
 * this server could sign with. Re-proving from a key only they hold is the
 * point of the exercise, not an inconvenience on the way to it.
 *
 * The row is stored with a NULL private key. That null IS the custody: a key
 * this server never generated and cannot sign with is one it cannot use to
 * speak as the member.
 */
export async function adoptUserKey(
  userId: string,
  did: string,
  publicKeyPem: string,
): Promise<{ previous: string | null; did: string }> {
  const previous = await currentDid(userId);
  if (previous === did) return { previous: null, did };

  // A revoked identifier is not adoptable. Revocation exists for the leaked
  // key, and a member (or whoever holds their session AND the leaked file)
  // must not be able to bring it back to life — a resurrected key would go
  // live locally while every partner keeps refusing it, because the `Undo`
  // that retired it has already propagated and is never un-said. A member who
  // wants a key again generates a fresh one; reusing a retired identifier has
  // no legitimate need and is exactly the hole revocation closes.
  const [existing] = await db
    .select({ revokedAt: schema.userSigningKeys.revokedAt })
    .from(schema.userSigningKeys)
    .where(eq(schema.userSigningKeys.did, did))
    .limit(1);
  if (existing?.revokedAt) {
    throw new Error('this identifier has been revoked and cannot be re-adopted');
  }

  await db.transaction(async (tx) => {
    if (previous) {
      await tx
        .update(schema.userSigningKeys)
        .set({ revokedAt: new Date(), succeededBy: did })
        .where(eq(schema.userSigningKeys.did, previous));
    }
    await tx
      .insert(schema.userSigningKeys)
      .values({ did, userId, publicKey: publicKeyPem, privateKeyEnc: null })
      .onConflictDoUpdate({
        target: schema.userSigningKeys.did,
        // A live key re-adopted is a no-op; a revoked one was refused above.
        set: { userId, publicKey: publicKeyPem, privateKeyEnc: null },
      });
  });

  await db
    .delete(schema.federatedIdentities)
    .where(eq(schema.federatedIdentities.localUserId, userId));

  return { previous, did };
}

/** True when this instance no longer holds the member's private key. */
export async function hasCustody(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ enc: schema.userSigningKeys.privateKeyEnc })
    .from(schema.userSigningKeys)
    .where(
      and(
        eq(schema.userSigningKeys.userId, userId),
        isNull(schema.userSigningKeys.revokedAt),
      ),
    )
    .limit(1);
  return !!row && row.enc === null;
}
