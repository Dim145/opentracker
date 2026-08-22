/**
 * Ordering for the catalogue listing.
 *
 * Lives apart from the route so the mapping from a sort key to SQL is testable
 * without standing up a request, a session and a database.
 */
import { sql, type SQL } from 'drizzle-orm';
import { schema } from '@trackarr/db';
import type { SortDirection, TorrentSortKey } from '@trackarr/shared';

/**
 * "When the torrent became available", which is what a member reads as its age:
 * the moderation date when there is one, the upload date otherwise. For an
 * auto-approved upload the two are identical — the handler sets both to `now` —
 * so this only differs for releases that sat in the queue, and there it is the
 * approval that matters. Ordering by upload date would bury a release that was
 * just approved because the moderator took their time over it.
 */
const availableAt = sql`COALESCE(${schema.torrents.moderatedAt}, ${schema.torrents.createdAt})`;

/**
 * Swarm columns read the `torrent_stats` snapshot the stats collector keeps, not
 * Redis: the live counts are one key per torrent, and a listing cannot fan out
 * a read per candidate row before it knows which page it is serving. Displayed
 * counts stay live — it is only the ordering that is as of the last collection
 * pass.
 *
 * A correlated subquery rather than a join, so the relational query keeps its
 * shape and its projection.
 */
function swarmColumn(column: 'seeders' | 'leechers' | 'completed'): SQL {
  return sql`(SELECT s.${sql.raw(column)} FROM torrent_stats s WHERE s.info_hash = ${schema.torrents.infoHash})`;
}

const SORT_KEYS: Record<TorrentSortKey, SQL> = {
  age: availableAt,
  // Case-insensitive: otherwise every capitalised release sorts ahead of every
  // lowercase one and "A to Z" reads as nonsense.
  name: sql`lower(${schema.torrents.name})`,
  size: sql`${schema.torrents.size}`,
  seeders: swarmColumn('seeders'),
  leechers: swarmColumn('leechers'),
  completed: swarmColumn('completed'),
  category: sql`(SELECT lower(c.name) FROM categories c WHERE c.id = ${schema.torrents.categoryId})`,
};

/**
 * Order clauses for one (key, direction) pair.
 *
 * Anything other than `age` gets `age DESC` as a second key. Without it two rows
 * sharing a sort value can swap places between requests — Postgres makes no
 * promise about ties — and a member paging through a listing sees the same
 * release twice, or never sees it at all.
 *
 * `NULLS LAST` on a descending sort keeps torrents the collector has never seen
 * at the bottom where they belong, rather than heading the list.
 */
export function buildTorrentOrderBy(
  sortBy: TorrentSortKey,
  order: SortDirection
): SQL[] {
  const direction = order === 'asc' ? sql`ASC` : sql`DESC`;
  const nulls = order === 'asc' ? sql`NULLS FIRST` : sql`NULLS LAST`;
  const primary = sql`${SORT_KEYS[sortBy]} ${direction} ${nulls}`;
  return sortBy === 'age' ? [primary] : [primary, sql`${availableAt} DESC`];
}
