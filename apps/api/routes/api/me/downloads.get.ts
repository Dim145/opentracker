/**
 * GET /api/me/downloads
 *
 * Returns the logged-in user's download history — every hnr_tracking
 * row keyed on (user.id), ordered by `downloadedAt` desc so the most
 * recent first-snatch lands on top.
 *
 * Each row carries the per-(user, torrent) byte counters the tracker
 * persists on every announce (see apps/tracker/internal/server/handler.go
 * step 6). Old rows that pre-date that change carry `uploaded = 0,
 * downloaded = 0` and the FE renders "—" so the user knows the figure
 * isn't available rather than silently treating the data as zero.
 *
 * Pagination: default 25, max 100. Auth: any logged-in user.
 */
import { db, schema } from '@trackarr/db';
import { count, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  const params = querySchema.parse(getQuery(event));

  const where = eq(schema.hnrTracking.userId, user.id);

  // Two parallel reads: the page slice itself plus a total count for
  // the pager. We deliberately don't enrich with live swarm stats —
  // this is a *historical* listing, not the active-seeds page.
  const [rows, [{ value: total } = { value: 0 }]] = await Promise.all([
    db.query.hnrTracking.findMany({
      where,
      with: {
        torrent: {
          with: { category: true },
        },
      },
      orderBy: [desc(schema.hnrTracking.downloadedAt)],
      limit: params.pageSize,
      offset: (params.page - 1) * params.pageSize,
    }),
    db
      .select({ value: count() })
      .from(schema.hnrTracking)
      .where(where),
  ]);

  // Project to a clean public shape — the FE doesn't need the seed-
  // time bookkeeping fields the HnR job writes, just the identity
  // (torrent + category) and the user-facing counters. We surface
  // the stored external ids (TMDb for movies/TV, IGDB for games)
  // alongside the category's `type` hint so the page can show a
  // poster next to each entry — same composable pattern as the
  // grouped /torrents view.
  const items = rows.map((row) => ({
    id: row.id,
    infoHash: row.torrent.infoHash,
    name: row.torrent.name,
    size: row.torrent.size,
    imdbId: row.torrent.imdbId,
    tmdbId: row.torrent.tmdbId,
    tvdbId: row.torrent.tvdbId,
    igdbId: row.torrent.igdbId,
    openlibraryId: row.torrent.openlibraryId,
    category: row.torrent.category
      ? {
          id: row.torrent.category.id,
          name: row.torrent.category.name,
          slug: row.torrent.category.slug,
          type: row.torrent.category.type,
        }
      : null,
    downloadedAt: row.downloadedAt,
    completedAt: row.completedAt,
    isHnr: row.isHnr,
    isExempt: row.isExempt,
    uploaded: row.uploaded,
    downloaded: row.downloaded,
  }));

  return {
    items,
    total,
    page: params.page,
    pageSize: params.pageSize,
  };
});
