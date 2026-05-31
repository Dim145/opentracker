/**
 * PATCH /api/admin/federation/peers/:id — owner governance of an existing link.
 *
 * Lets the owner change a peer's lifecycle status (suspend / block / revoke /
 * reactivate) and/or edit the granular scopes after the fact ("cut social
 * without cutting catalog"). Every inbound S2S endpoint gates on
 * `status === 'active'`, so suspending/blocking/revoking immediately stops all
 * exchange; an edited scope takes effect on the next request (no cache).
 *
 * Status changes apply only to an ESTABLISHED link (active | suspended |
 * blocked | revoked). A pending handshake must be approved or deleted instead.
 *
 * Body: { status?, sharesWithThem?, acceptsFromThem? } — at least one.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { requireAdminSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';
import { federationScopesSchema } from '~~/utils/federation/scopes';
import { canGovernanceTransition } from '~~/utils/federation/peerLifecycle';

const bodySchema = z
  .object({
    status: z.enum(['active', 'suspended', 'blocked', 'revoked']).optional(),
    sharesWithThem: federationScopesSchema.optional(),
    acceptsFromThem: federationScopesSchema.optional(),
  })
  .refine(
    (b) =>
      b.status !== undefined ||
      b.sharesWithThem !== undefined ||
      b.acceptsFromThem !== undefined,
    { message: 'Nothing to update' },
  );

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const peerId = getRouterParam(event, 'id');
  if (!peerId) throw createError({ statusCode: 400, message: 'Missing peer id' });
  const body = await validateBody(event, bodySchema);

  const [peer] = await db
    .select()
    .from(schema.federationPeers)
    .where(eq(schema.federationPeers.id, peerId))
    .limit(1);
  if (!peer) throw createError({ statusCode: 404, message: 'Peer not found' });

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (body.status !== undefined) {
    // Enforced via the shared transition table — notably forbids resurrecting a
    // revoked peer and changing the status of a pending handshake.
    if (!canGovernanceTransition(peer.status, body.status)) {
      throw createError({
        statusCode: 409,
        message: `Illegal status transition ${peer.status} → ${body.status} (approve/delete a pending handshake; revoked is terminal)`,
      });
    }
    set.status = body.status;
  }
  if (body.sharesWithThem !== undefined) set.sharesWithThem = body.sharesWithThem;
  if (body.acceptsFromThem !== undefined) {
    set.acceptsFromThem = body.acceptsFromThem;
  }

  await db
    .update(schema.federationPeers)
    .set(set)
    .where(eq(schema.federationPeers.id, peerId));

  return { ok: true, status: (set.status as string) ?? peer.status };
});
