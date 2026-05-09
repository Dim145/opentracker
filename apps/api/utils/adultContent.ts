/**
 * Adult-content gate helpers.
 *
 * Categories carry an `isAdult` flag (set by the seeder for the XXX
 * subtree). Each user has a `showAdultContent` toggle — false by
 * default. When the toggle is off we filter adult categories out of
 * the categories listing, the torrents listing, search, RSS, and
 * Torznab; and we redact the torrent detail to a "gated" placeholder.
 *
 * The lookups are tiny (≤ a dozen rows) and read-mostly, so we cache
 * the adult-category id list in process for 60s. Cache TTL is short
 * enough that a re-seed propagates within a minute without restart.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';

interface CachedIds {
  ids: string[];
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000;
let cached: CachedIds | null = null;

export async function adultCategoryIds(): Promise<string[]> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.ids;

  const rows = await db
    .select({ id: schema.categories.id })
    .from(schema.categories)
    .where(eq(schema.categories.isAdult, true));

  cached = {
    ids: rows.map((r) => r.id),
    expiresAt: now + CACHE_TTL_MS,
  };
  return cached.ids;
}

/** Force-clear the cache (call from the seeder after re-seeding). */
export function invalidateAdultCategoryCache(): void {
  cached = null;
}
