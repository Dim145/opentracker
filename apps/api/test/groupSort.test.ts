/**
 * Ordering for the grouped catalogue.
 *
 * A group is many releases, so every column has to decide what it means across
 * them. These assertions pin the decisions down: totals for the swarm columns,
 * both ends of the age span, and the lead name for alphabetical order.
 */
import { describe, it, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { TORRENT_SORT_KEYS } from '@trackarr/shared';
import type { SortDirection, TorrentSortKey } from '@trackarr/shared';
import { buildGroupOrderBy } from '../utils/torrentGroups';

const dialect = new PgDialect();

const render = (sortBy: TorrentSortKey, order: SortDirection) =>
  dialect.sqlToQuery(buildGroupOrderBy(sortBy, order)).sql;

describe('buildGroupOrderBy', () => {
  it('reads the newest release descending and the oldest ascending', () => {
    // Anything else makes "oldest first" rank works by their most recent
    // upload, which is not what the phrase means.
    expect(render('age', 'desc')).toBe('latest DESC');
    expect(render('age', 'asc')).toBe('oldest ASC');
  });

  it('sorts the swarm columns on the group total, not on any one release', () => {
    expect(render('seeders', 'desc')).toContain('seed_total');
    expect(render('leechers', 'desc')).toContain('leech_total');
    expect(render('completed', 'desc')).toContain('completed_total');
    // A span is what the row displays; the totals are what it sorts by, so
    // neither min nor max may leak into the ORDER BY.
    for (const key of ['seeders', 'leechers'] as const) {
      expect(render(key, 'desc')).not.toContain('_min');
      expect(render(key, 'desc')).not.toContain('_max');
    }
  });

  it('sorts size on the weight of the whole group', () => {
    expect(render('size', 'desc')).toContain('total_size');
  });

  it('sorts names case-insensitively on the lead release', () => {
    const sql = render('name', 'asc');
    expect(sql).toContain('lower(lead_name)');
    expect(sql).toContain('ASC');
  });

  it('carries a recency tiebreaker on every key but age', () => {
    for (const key of TORRENT_SORT_KEYS.filter((k) => k !== 'age')) {
      // Ties are unordered in Postgres, and an unordered tie means a work can
      // appear on two pages, or on none, while a member pages through.
      expect(render(key, 'desc')).toContain('latest DESC');
    }
    // `age` needs no second key: it already is the tiebreaker.
    expect(render('age', 'desc')).not.toContain(',');
  });

  it('flips direction and null placement together', () => {
    expect(render('seeders', 'desc')).toContain('NULLS LAST');
    expect(render('seeders', 'asc')).toContain('NULLS FIRST');
  });

  it('maps every key the API accepts', () => {
    for (const key of TORRENT_SORT_KEYS) {
      const sql = render(key, 'desc');
      expect(sql).toBeTruthy();
      expect(sql).not.toContain('undefined');
    }
  });
});
