/**
 * GET /api/federation/partners  — authenticated.
 *
 * Lightweight list of active partner instances for user-facing pickers
 * (e.g. linking a federated identity). Exposes name/URL + which scopes the
 * partner is reachable for — never keys or internal state.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireAuthSession } from '~~/utils/adminAuth';

export default defineEventHandler(async (event) => {
  await requireAuthSession(event);

  const rows = await db
    .select({
      id: schema.federationPeers.id,
      name: schema.federationPeers.displayName,
      baseUrl: schema.federationPeers.baseUrl,
      acceptsFromThem: schema.federationPeers.acceptsFromThem,
    })
    .from(schema.federationPeers)
    .where(eq(schema.federationPeers.status, 'active'));

  return {
    partners: rows.map((r) => ({
      id: r.id,
      name: r.name,
      baseUrl: r.baseUrl,
      accountsEnabled: !!r.acceptsFromThem?.accounts,
    })),
  };
});
