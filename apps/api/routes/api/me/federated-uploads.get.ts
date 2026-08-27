/**
 * GET /api/me/federated-uploads — authenticated.
 *
 * Everything mirrored from partners that is attributed to any identifier the
 * caller answers to: the one this instance gave them, the ones they proved
 * they held elsewhere, and anything the partners' own assertions chain onto.
 *
 * This is what the identity work is for. A member who moves keeps a name, and
 * a name that nothing is filed under is a name. Here their work on the old
 * instance is still their work, listed under the account they have now — and
 * it stays listed after that instance is gone, because the records live in
 * every partner's mirror and say who wrote them.
 *
 * Read-only and per-member. Nothing is merged into the local catalogue: these
 * are releases somewhere else, and the links point there.
 */
import { desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireAuthSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { identitiesOfUser } from '~~/utils/federation/identityRecord';

const MAX_ROWS = 200;

export default defineEventHandler(async (event) => {
  const { user } = await requireAuthSession(event);
  await rateLimit(event, RATE_LIMITS.public);

  const identities = [...(await identitiesOfUser(user.id))];
  if (!identities.length) return { identities: [], uploads: [], count: 0 };

  const rows = await db
    .select({
      recordId: schema.remoteTorrents.recordId,
      name: schema.remoteTorrents.name,
      size: schema.remoteTorrents.size,
      infoHash: schema.remoteTorrents.infoHash,
      authorDid: schema.remoteTorrents.authorDid,
      seeders: schema.remoteTorrents.seeders,
      detailUrl: schema.remoteTorrents.remoteDetailUrl,
      remoteCreatedAt: schema.remoteTorrents.remoteCreatedAt,
      peerName: schema.federationPeers.displayName,
      peerStatus: schema.federationPeers.status,
    })
    .from(schema.remoteTorrents)
    .innerJoin(
      schema.federationPeers,
      // The mirror keeps a suspended partner's rows rather than purging them,
      // so the gate is applied at read time — the same rule every federated
      // view follows.
      eq(schema.federationPeers.id, schema.remoteTorrents.peerId),
    )
    .where(inArray(schema.remoteTorrents.authorDid, identities))
    .orderBy(desc(schema.remoteTorrents.remoteCreatedAt))
    .limit(MAX_ROWS + 1);

  const active = rows.filter((r) => r.peerStatus === 'active');
  const page = active.slice(0, MAX_ROWS);

  return {
    identities,
    uploads: page.map(({ peerStatus: _s, ...r }) => r),
    count: page.length,
    truncated: active.length > MAX_ROWS,
  };
});
