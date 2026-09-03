/**
 * Saved-search alerts: one accepted upload, every filter that wanted it.
 *
 * ## The direction matters
 *
 * The naive shape is "for each filter, run the catalogue query and see if this
 * torrent comes back" — N queries per upload. This inverts it: one query asks
 * Postgres which stored filters match this one torrent, then the notifications
 * fan out through the same bounded pool the follower fan-out uses.
 *
 * The free-text half is the only part that has to be SQL, because a tsquery is
 * Postgres's to evaluate. Everything else — category, tags, media ids — is
 * plain data already in memory, so it is filtered in TypeScript rather than
 * turned into a join.
 *
 * ## What a match must respect, and why each is not optional
 *
 *   - **The adult gate.** A member who turned adult content off must not be
 *     pushed an adult release by a filter they wrote before that. This is the
 *     one rule whose absence would be actively harmful rather than merely
 *     wrong, so it is applied last and unconditionally.
 *   - **Anonymous uploads.** Same rule the follower fan-out applies: the
 *     uploader asked not to be named, and a notification is a place a name
 *     leaks. The alert says what appeared, never who put it there.
 *   - **The filter's owner is not the uploader.** Nobody needs telling about
 *     their own upload.
 *
 * ## Bounded, and honest about it
 *
 * A cap per member on how many filters may be armed keeps this O(armed
 * filters) with a ceiling somebody chose, rather than one that emerges. The
 * sweep logs its own duration when it exceeds a threshold, so an operator finds
 * out from their logs rather than from members.
 */
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { notify } from './notify';
import { FANOUT_CONCURRENCY, withConcurrency } from './fanout';
import { adultCategoryIds } from './adultContent';

export interface SavedSearchCandidate {
  id: string;
  name: string;
  infoHash: string;
  categoryId: string | null;
  imdbId: string | null;
  tmdbId: string | null;
  tvdbId: string | null;
  uploaderId: string | null;
}

/** Log a warning past this, so a slow sweep is visible before it is a problem. */
const SLOW_SWEEP_MS = 500;

export async function fanoutSavedSearchMatches(
  torrent: SavedSearchCandidate
): Promise<void> {
  try {
    await runFanout(torrent);
  } catch (err) {
    // Its sibling wraps the identical shape, and for the same reason: this is
    // called with `void` from two routes, so without the catch a failure
    // surfaces as an anonymous unhandled rejection instead of a line naming
    // the feature that failed.
    console.warn('[SavedSearch] fan-out failed:', (err as Error).message);
  }
}

async function runFanout(torrent: SavedSearchCandidate): Promise<void> {
  const started = Date.now();

  // The torrent's tag slugs, once. A filter matching on tags needs all of its
  // own to be present — the listing's AND semantics.
  const tagRows = await db
    .select({ slug: schema.tags.slug })
    .from(schema.torrentTags)
    .innerJoin(schema.tags, eq(schema.tags.id, schema.torrentTags.tagId))
    .where(eq(schema.torrentTags.torrentId, torrent.id));
  const torrentTags = new Set(tagRows.map((r) => r.slug));

  /**
   * Every armed filter whose free text matches, or which has none.
   *
   * The tsquery comparison runs in SQL against the torrent's own name, which
   * is the field a member means when they save a search. Description and NFO
   * are deliberately not consulted: the live search offers them because a
   * reader is looking for something, while an alert firing on a word buried in
   * an NFO is a notification nobody can account for.
   */
  const candidates = await db
    .select()
    .from(schema.savedSearches)
    .where(
      and(
        eq(schema.savedSearches.notify, true),
        or(
          sql`${schema.savedSearches.tsquery} IS NULL`,
          sql`to_tsvector('simple', ${torrent.name}) @@ to_tsquery('simple', ${schema.savedSearches.tsquery})`
        )
      )
    );

  if (candidates.length === 0) return;

  // The structured half, in memory.
  const matched = candidates.filter((f) => {
    if (f.userId === torrent.uploaderId) return false;
    if (f.categoryId && f.categoryId !== torrent.categoryId) return false;
    if (f.imdbId && f.imdbId !== torrent.imdbId) return false;
    if (f.tmdbId && f.tmdbId !== torrent.tmdbId) return false;
    if (f.tvdbId && f.tvdbId !== torrent.tvdbId) return false;
    const wanted = f.tags ?? [];
    if (wanted.length && !wanted.every((t) => torrentTags.has(t))) return false;
    // A filter with no free text, no category, no tag and no id would match
    // every upload ever. The write path refuses to store one; this is the
    // second line, in case a row predates that or arrives another way.
    const empty =
      !f.tsquery && !f.categoryId && !f.imdbId && !f.tmdbId && !f.tvdbId && !wanted.length;
    return !empty;
  });

  if (matched.length === 0) return;

  // The adult gate, applied to the recipients rather than to the filters: it
  // is a property of the member, and a member can change it after saving.
  const adultIds = await adultCategoryIds();
  const isAdult = !!torrent.categoryId && adultIds.includes(torrent.categoryId);

  let recipients = matched;
  if (isAdult) {
    const optedIn = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(
        and(
          inArray(
            schema.users.id,
            matched.map((f) => f.userId)
          ),
          eq(schema.users.showAdultContent, true)
        )
      );
    const allowed = new Set(optedIn.map((u) => u.id));
    recipients = matched.filter((f) => allowed.has(f.userId));
  }

  await withConcurrency(recipients, FANOUT_CONCURRENCY, async (filter) => {
    await notify(
      filter.userId,
      'saved_search_match',
      { searchLabel: filter.label, torrentName: torrent.name },
      `/torrents/${torrent.infoHash}`
    );
    await db
      .update(schema.savedSearches)
      .set({
        lastMatchedAt: new Date(),
        matchCount: sql`${schema.savedSearches.matchCount} + 1`,
      })
      .where(eq(schema.savedSearches.id, filter.id));
  });

  const elapsed = Date.now() - started;
  if (elapsed > SLOW_SWEEP_MS) {
    console.warn(
      `[SavedSearch] evaluated ${candidates.length} armed filters in ${elapsed}ms ` +
        `(${recipients.length} notified) — consider lowering saved_search_max_per_user`
    );
  }
}
