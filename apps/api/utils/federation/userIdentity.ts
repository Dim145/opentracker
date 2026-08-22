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
 * Races are resolved by the primary key rather than by a lock: two concurrent
 * mints for the same uploader would both generate a keypair, and the loser's
 * insert does nothing. Whichever key lands first is the one that stands, and
 * the caller re-reads rather than assuming its own.
 */
export async function ensureUserDid(userId: string): Promise<string> {
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
    .onConflictDoNothing({ target: schema.userSigningKeys.did })
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
  return winner!.did;
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
    if (!out.has(id)) out.set(id, await ensureUserDid(id));
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
        // Re-adopting a key they already had here: clear the retirement rather
        // than fail, so a member who rotated back is not stuck.
        set: { userId, publicKey: publicKeyPem, privateKeyEnc: null, revokedAt: null, succeededBy: null },
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
