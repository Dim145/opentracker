/**
 * The catalogue listing's ordering. Rendered to SQL text through the same
 * dialect the query builder uses, so these assertions read the statement
 * Postgres would actually receive rather than a mock of it.
 */
import { describe, it, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { TORRENT_SORT_KEYS } from '@trackarr/shared';
import type { SortDirection, TorrentSortKey } from '@trackarr/shared';
import { buildTorrentOrderBy } from '../utils/torrentSort';

const dialect = new PgDialect();

function render(sortBy: TorrentSortKey, order: SortDirection): string[] {
  return buildTorrentOrderBy(sortBy, order).map(
    (chunk) => dialect.sqlToQuery(chunk).sql
  );
}

describe('buildTorrentOrderBy', () => {
  it('defaults to the availability date, newest first', () => {
    const [primary, ...rest] = render('age', 'desc');
    expect(primary).toMatch(/coalesce/i);
    expect(primary).toContain('moderated_at');
    expect(primary).toContain('created_at');
    expect(primary).toContain('DESC');
    // `age` is its own tiebreaker, so it must not be repeated.
    expect(rest).toHaveLength(0);
  });

  it('carries a stable tiebreaker on every other key', () => {
    for (const key of TORRENT_SORT_KEYS.filter((k) => k !== 'age')) {
      const clauses = render(key, 'desc');
      expect(clauses).toHaveLength(2);
      // Ties resolve on availability date, descending, whatever the primary
      // direction is — otherwise rows with equal values can swap between pages.
      expect(clauses[1]).toMatch(/coalesce/i);
      expect(clauses[1]).toContain('DESC');
    }
  });

  it('flips the primary direction and the null placement together', () => {
    const [desc] = render('size', 'desc');
    expect(desc).toContain('DESC');
    expect(desc).toContain('NULLS LAST');

    const [asc] = render('size', 'asc');
    expect(asc).toContain('ASC');
    // Ascending puts the unknowns first, so "smallest" and "never measured"
    // stay adjacent rather than sitting at opposite ends of the listing.
    expect(asc).toContain('NULLS FIRST');
  });

  it('compares names case-insensitively', () => {
    const [primary] = render('name', 'asc');
    // Without lower(), every capitalised release sorts ahead of every lowercase
    // one and an A-to-Z listing reads as nonsense.
    expect(primary).toContain('lower');
    expect(primary).toContain('name');
  });

  it('reads the swarm columns from the collector snapshot, not Redis', () => {
    for (const key of ['seeders', 'leechers', 'completed'] as const) {
      const [primary] = render(key, 'desc');
      expect(primary).toContain('torrent_stats');
      expect(primary).toContain(key);
      // Correlated on info_hash: a join would change the query's projection.
      expect(primary).toContain('info_hash');
    }
  });

  it('covers every key the API accepts', () => {
    // A key added to the shared list without a mapping would render as
    // `undefined` here rather than failing loudly at request time.
    for (const key of TORRENT_SORT_KEYS) {
      const [primary] = render(key, 'desc');
      expect(primary).toBeTruthy();
      expect(primary).not.toContain('undefined');
    }
  });
});
