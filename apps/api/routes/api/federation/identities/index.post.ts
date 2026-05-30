/**
 * POST /api/federation/identities  — authenticated.
 *
 * Start linking the caller's account to a remote username on a partner.
 * Returns a one-time `code` the user must drop into their remote profile
 * bio; then they call .../verify. Re-linking resets to pending + new code.
 *
 * Body: { peerId, remoteUsername }
 */
import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { requireAuthSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';
import { generateToken } from '~~/utils/crypto';

const bodySchema = z.object({
  peerId: z.string().min(1).max(64),
  remoteUsername: z.string().trim().min(1).max(120),
});

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const body = await validateBody(event, bodySchema);

  const [peer] = await db
    .select({
      id: schema.federationPeers.id,
      status: schema.federationPeers.status,
      acceptsFromThem: schema.federationPeers.acceptsFromThem,
    })
    .from(schema.federationPeers)
    .where(eq(schema.federationPeers.id, body.peerId))
    .limit(1);
  if (!peer) throw createError({ statusCode: 404, message: 'Unknown peer' });
  if (peer.status !== 'active') {
    throw createError({ statusCode: 400, message: 'Peer is not active' });
  }
  if (!peer.acceptsFromThem?.accounts) {
    throw createError({
      statusCode: 400,
      message: 'Accounts scope not accepted from this peer',
    });
  }

  const code = `trackarr-verify-${generateToken(6)}`; // 12 hex chars
  const [row] = await db
    .insert(schema.federatedIdentities)
    .values({
      id: uuid(),
      localUserId: session.user.id,
      peerId: body.peerId,
      remoteUsername: body.remoteUsername,
      status: 'pending',
      verifyCode: code,
    })
    .onConflictDoUpdate({
      target: [
        schema.federatedIdentities.localUserId,
        schema.federatedIdentities.peerId,
        schema.federatedIdentities.remoteUsername,
      ],
      set: { status: 'pending', verifyCode: code, verifiedAt: null },
    })
    .returning({
      id: schema.federatedIdentities.id,
      code: schema.federatedIdentities.verifyCode,
    });

  return { ok: true, id: row!.id, code: row!.code };
});
