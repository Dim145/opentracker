/**
 * POST /api/me/identity/adopt — the member takes custody of their key.
 *
 * They generate a keypair in their browser and send the public half; this
 * instance retires whatever key it was holding for them, endorses the new one,
 * and never sees the private half.
 *
 * ## What changes, and what does not
 *
 * What changes: this server can no longer produce a subject proof for that
 * member. Until now it could — it held the key — which meant every "I am Nova"
 * a partner accepted was, strictly, this instance's word twice over. After
 * this, the subject proof is theirs and the endorsement is ours, and the two
 * are genuinely two parties.
 *
 * What does not: the endorsement is still ours to give or withhold, and we can
 * still mint a DIFFERENT key and endorse it as Nova. Custody stops us forging
 * a proof for the key she actually uses; it does not stop us inventing a rival
 * Nova. A third instance tells them apart only if it has already seen her
 * work. Worth saying plainly, because "the instance cannot impersonate me" is
 * the thing people will assume this bought.
 *
 * ## Proof of possession is not optional
 *
 * Anybody can send us a public key. Without a signature made by it, a member
 * could register somebody else's identifier as their own, and we would endorse
 * a claim that a key they do not hold belongs to them — handing them every
 * proof its real owner ever makes. The signature is over the DID itself, which
 * is derived from the key: self-referential on purpose, so there is nothing to
 * replay it onto.
 */
import { createPublicKey, verify as edVerify } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { requireAuthSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';
import { didKeyFromPublicKey, publicKeyFromDidKey } from '~~/utils/federation/did';
import { adoptUserKey } from '~~/utils/federation/userIdentity';

const bodySchema = z.object({
  /** SPKI PEM of the Ed25519 public key the member generated. */
  publicKeyPem: z.string().min(64).max(2000),
  /** Base64url signature by that key over its own `did:key`. */
  possession: z.string().min(16).max(200),
});

export default defineEventHandler(async (event) => {
  const { user } = await requireAuthSession(event);
  await rateLimit(event, RATE_LIMITS.auth);
  const body = await validateBody(event, bodySchema);

  let did: string;
  try {
    // Round-tripped through our own parser rather than trusted as text: a PEM
    // that does not describe an Ed25519 key, or describes one of the wrong
    // length, must fail here and not three steps later inside a signature.
    createPublicKey(body.publicKeyPem);
    did = didKeyFromPublicKey(body.publicKeyPem);
  } catch {
    throw createError({ statusCode: 400, message: 'Not an Ed25519 public key' });
  }

  const held = edVerify(
    null,
    Buffer.from(did, 'utf8'),
    publicKeyFromDidKey(did),
    Buffer.from(body.possession, 'base64url'),
  );
  if (!held) {
    throw createError({
      statusCode: 400,
      message: 'That signature was not made by the key you sent',
    });
  }

  const taken = await db
    .select({ userId: schema.userSigningKeys.userId })
    .from(schema.userSigningKeys)
    .where(eq(schema.userSigningKeys.did, did))
    .limit(1);
  if (taken.length && taken[0]!.userId !== user.id) {
    throw createError({ statusCode: 409, message: 'That key is already in use here' });
  }

  const { previous } = await adoptUserKey(user.id, did, body.publicKeyPem);
  return { ok: true, did, previous, custody: 'member' as const };
});
