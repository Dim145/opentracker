/**
 * PUT /api/messaging/keys
 *
 * Publish this browser's public key. Replaces whatever was there.
 *
 * Replacing is the destructive act in this feature, and the server is
 * deliberately not the place that warns about it: by the time a key
 * arrives here the member has already been told, in a dialog that named
 * how many conversations they were about to make unreadable. The API's
 * job is to accept it and to make the consequence real.
 */
import { db, schema } from '@trackarr/db';
import { z } from 'zod';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';
import { requireDmAccess } from '~~/utils/messaging/guard';

/**
 * A well-formed uncompressed P-256 SPKI, and nothing else.
 *
 * A length check is not enough, and the gap was not theoretical: any 122
 * characters were accepted, so a member could publish rubbish — by
 * accident, from a broken client, or on purpose — and every correspondent
 * who opened a conversation with them hit an unhandled DOMException from
 * `importKey` and saw a page that did nothing. One member could break the
 * feature for everyone who talks to them.
 *
 * The bytes are checked rather than the shape of the string:
 *   - 91 bytes exactly, the size of an uncompressed P-256 SPKI
 *   - the fixed 26-byte AlgorithmIdentifier prefix for id-ecPublicKey +
 *     prime256v1, which is what says "this is a P-256 key" and not some
 *     other curve the client would then fail to import
 *   - 0x04, the uncompressed-point marker, at the start of the key body
 *
 * That leaves the coordinates unchecked — verifying the point is on the
 * curve needs the maths, and the client's `importKey` does it anyway. The
 * point here is to reject what is obviously not a key, not to duplicate
 * WebCrypto.
 */
const P256_SPKI_PREFIX = Buffer.from(
  '3059301306072a8648ce3d020106082a8648ce3d030107034200',
  'hex'
);

const publicKeySchema = z.string().superRefine((value, ctx) => {
  const fail = (message: string) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, message });

  // `Buffer.from` never throws on bad base64url — it decodes what it can
  // and drops the rest — so the length check below is what rejects a
  // malformed string, not a parse error.
  const raw = Buffer.from(value, 'base64url');
  if (raw.length !== 91) {
    return fail('publicKey must be a 91-byte P-256 SPKI');
  }
  if (!raw.subarray(0, P256_SPKI_PREFIX.length).equals(P256_SPKI_PREFIX)) {
    return fail('publicKey must be an uncompressed P-256 SPKI');
  }
});

const bodySchema = z
  .object({
    publicKey: publicKeySchema,
    deviceLabel: z.string().trim().max(64).optional(),
  })
  .strict();

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await requireDmAccess(user);
  await rateLimit(event, RATE_LIMITS.mutation);

  const body = await validateBody(event, bodySchema);

  await db
    .insert(schema.userMessageKeys)
    .values({
      userId: user.id,
      publicKey: body.publicKey,
      alg: 'ECDH-P256',
      deviceLabel: body.deviceLabel ?? null,
      createdAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.userMessageKeys.userId,
      set: {
        publicKey: body.publicKey,
        deviceLabel: body.deviceLabel ?? null,
        createdAt: new Date(),
      },
    });

  return { ok: true };
});
