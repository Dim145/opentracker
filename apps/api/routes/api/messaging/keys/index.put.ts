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

const bodySchema = z
  .object({
    // SPKI for P-256 is 91 bytes; base64url of that is 122 characters.
    // Bounded on both sides so the column cannot be used as storage.
    publicKey: z.string().min(32).max(512),
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
