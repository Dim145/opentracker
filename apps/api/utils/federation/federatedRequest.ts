/**
 * The request→fill bridge (M1), factored out of the HTTP layer so the parts that
 * carry the logic — category resolution, dedup, who-to-notify, and the content
 * proof — are testable against a real database.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { resolveRemoteSlugs } from './categoryMap';

/**
 * The best local category for a mirrored release: an explicit override, then the
 * operator's taxonomy mapping (§5.5), then any local category of the same coarse
 * type. Null when nothing fits — the caller then asks the member to choose.
 */
export async function resolveLocalCategoryForRemote(
  categorySlug: string | null,
  categoryType: string | null,
  override?: string,
): Promise<string | null> {
  if (override) {
    const c = await db.query.categories.findFirst({
      where: eq(schema.categories.id, override),
      columns: { id: true },
    });
    return c?.id ?? null;
  }
  if (categorySlug) {
    const mapped = (await resolveRemoteSlugs([categorySlug])).get(categorySlug);
    if (mapped) return mapped.categoryId;
  }
  if (categoryType) {
    const byType = await db.query.categories.findFirst({
      where: eq(schema.categories.type, categoryType),
      columns: { id: true },
    });
    if (byType) return byType.id;
  }
  return null;
}

/**
 * An already-open request for the same federated content, if any — so a second
 * "Request here" on the same release hands back the first bounty instead of
 * splitting attention (and any reward) across duplicates.
 */
export async function openFederatedRequestId(
  infoHash: string,
  /**
   * Run inside a caller's transaction when the answer has to be trusted.
   *
   * Outside one this is a hint: by the time the caller acts on it another
   * request may have been raised. The bounty route therefore re-asks under an
   * advisory lock, in its own transaction, and passes it here.
   */
  tx: Pick<typeof db, 'query'> = db,
): Promise<string | null> {
  const existing = await tx.query.uploadRequests.findFirst({
    where: and(
      eq(schema.uploadRequests.federatedInfoHash, infoHash),
      inArray(schema.uploadRequests.status, ['requested', 'filled']),
    ),
    columns: { id: true },
  });
  return existing?.id ?? null;
}

/**
 * The members to notify first: those with a proven account on the origin partner
 * — the people most likely to already hold the content. Excludes the requester
 * and deduplicates across several identities on the same peer.
 */
export async function fillersForPeer(
  peerId: string,
  excludeUserId: string,
): Promise<string[]> {
  const holders = await db
    .select({ uid: schema.federatedIdentities.localUserId })
    .from(schema.federatedIdentities)
    .where(
      and(
        eq(schema.federatedIdentities.peerId, peerId),
        eq(schema.federatedIdentities.status, 'verified'),
      ),
    );
  return [...new Set(holders.map((h) => h.uid))].filter(
    (uid) => uid !== excludeUserId,
  );
}
