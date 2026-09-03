import { describe, it, expect } from 'vitest';
import {
  busiestDay,
  dailyDeltas,
  dailyPoints,
  selectableYears,
  yearWindow,
  type Snapshot,
} from '../utils/publicStats';

/**
 * The four derivations behind the public stats, tested without a database.
 *
 * `site_stats` holds hourly readings of cumulative counters, and every figure a
 * member reads is derived from them. Each of these has a failure mode that
 * looks like data rather than a bug — a gap in the snapshots, a counter that
 * goes backwards, a year the site did not exist for — so this is where they are
 * pinned down.
 */

const snap = (iso: string, uploaded: number, extra: Partial<Snapshot> = {}): Snapshot => ({
  // The day label comes from Postgres in the real query (`to_char`), because a
  // JS Date reads a zone-less timestamp in the process's zone. Mirrored here.
  day: iso.slice(0, 10),
  at: new Date(iso),
  users: 10,
  torrents: 100,
  peers: 5,
  seeders: 4,
  uploaded,
  ...extra,
});

describe('dailyPoints', () => {
  it('keeps the last reading of each day, not the first or an average', () => {
    const points = dailyPoints([
      snap('2026-03-01T01:00:00Z', 100),
      snap('2026-03-01T23:00:00Z', 180),
      snap('2026-03-02T12:00:00Z', 240),
    ]);
    expect(points.map((p) => [p.day, p.uploaded])).toEqual([
      ['2026-03-01', 180],
      ['2026-03-02', 240],
    ]);
  });

  it('sorts by day even when the rows arrive out of order', () => {
    const points = dailyPoints([
      snap('2026-03-03T10:00:00Z', 300),
      snap('2026-03-01T10:00:00Z', 100),
    ]);
    expect(points.map((p) => p.day)).toEqual(['2026-03-01', '2026-03-03']);
  });

  it('leaves a day with no snapshot absent rather than zero', () => {
    // An instance that was down for a day must not draw a cliff to zero on a
    // chart of a counter that never moved.
    const points = dailyPoints([
      snap('2026-03-01T10:00:00Z', 100),
      snap('2026-03-03T10:00:00Z', 150),
    ]);
    expect(points).toHaveLength(2);
    expect(points.some((p) => p.uploaded === 0)).toBe(false);
  });
});

describe('dailyDeltas', () => {
  it('reports the movement between consecutive points', () => {
    const deltas = dailyDeltas(
      dailyPoints([
        snap('2026-03-01T10:00:00Z', 1_000),
        snap('2026-03-02T10:00:00Z', 3_500),
        snap('2026-03-03T10:00:00Z', 4_000),
      ]),
    );
    expect(deltas.map((d) => [d.day, d.bytes])).toEqual([
      ['2026-03-02', 2_500],
      ['2026-03-03', 500],
    ]);
  });

  it('drops the first day instead of comparing it against zero', () => {
    // Otherwise the site's entire history is reported as one day's traffic.
    const deltas = dailyDeltas(dailyPoints([snap('2026-03-01T10:00:00Z', 9_000_000)]));
    expect(deltas).toEqual([]);
  });

  it('clamps a counter that goes backwards', () => {
    // `total_uploaded_bytes` is SUM(users.uploaded): erasing an account lowers
    // it, and so does a moderator resetting a cheater. "-4.2 TB on Tuesday" is
    // a figure a reader would try to explain.
    const deltas = dailyDeltas(
      dailyPoints([
        snap('2026-03-01T10:00:00Z', 5_000),
        snap('2026-03-02T10:00:00Z', 1_000),
        snap('2026-03-03T10:00:00Z', 1_200),
      ]),
    );
    expect(deltas.map((d) => d.bytes)).toEqual([0, 200]);
  });

  it('clamps the torrent and member counters too', () => {
    const deltas = dailyDeltas(
      dailyPoints([
        snap('2026-03-01T10:00:00Z', 10, { torrents: 500, users: 50 }),
        snap('2026-03-02T10:00:00Z', 20, { torrents: 480, users: 49 }),
      ]),
    );
    expect(deltas[0]).toMatchObject({ torrents: 0, users: 0 });
  });
});

describe('dailyDeltas across a gap', () => {
  it('does not attribute an outage to the day it ended', () => {
    // Five days down, then a snapshot. The naive difference makes that one day
    // look like the busiest of the year — every time, on every instance that
    // ever restarted — and draws a bar that flattens the rest of the chart.
    const deltas = dailyDeltas(
      dailyPoints([
        snap('2026-03-01T10:00:00Z', 1_000),
        snap('2026-03-02T10:00:00Z', 2_000),
        snap('2026-03-08T10:00:00Z', 9_000),
        snap('2026-03-09T10:00:00Z', 9_500),
      ]),
    );
    expect(deltas.map((d) => d.day)).toEqual(['2026-03-02', '2026-03-09']);
    expect(deltas.map((d) => d.bytes)).toEqual([1_000, 500]);
  });

  it('and therefore does not let a gap win busiestDay', () => {
    const points = dailyPoints([
      snap('2026-03-01T10:00:00Z', 0),
      snap('2026-03-02T10:00:00Z', 5_000),
      snap('2026-03-20T10:00:00Z', 900_000),
      snap('2026-03-21T10:00:00Z', 906_000),
    ]);
    expect(busiestDay(dailyDeltas(points))?.day).toBe('2026-03-21');
  });
});

describe('busiestDay', () => {
  it('picks the largest day', () => {
    const best = busiestDay([
      { day: '2026-03-02', bytes: 10, torrents: 0, users: 0 },
      { day: '2026-03-03', bytes: 90, torrents: 0, users: 0 },
    ]);
    expect(best?.day).toBe('2026-03-03');
  });

  it('has no busiest day when nothing moved', () => {
    // A clamped run of zeroes is not a record, and "busiest day: 0 B" on a
    // year in review reads as a bug in the page.
    expect(busiestDay([{ day: '2026-03-02', bytes: 0, torrents: 0, users: 0 }])).toBeNull();
    expect(busiestDay([])).toBeNull();
  });
});

describe('yearWindow', () => {
  it('is half-open and in UTC', () => {
    const { start, end } = yearWindow(2026);
    expect(start.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('excludes the last instant of the year from the next one', () => {
    // The boundary that decides which review a New Year's Eve upload lands in.
    const y2026 = yearWindow(2026);
    const y2027 = yearWindow(2027);
    const lastMoment = new Date('2026-12-31T23:59:59.999Z');
    expect(lastMoment >= y2026.start && lastMoment < y2026.end).toBe(true);
    expect(lastMoment < y2027.start).toBe(true);
  });
});

describe('selectableYears', () => {
  it('runs from the current year back to the first snapshot', () => {
    expect(
      selectableYears(new Date('2024-06-01T00:00:00Z'), new Date('2026-09-01T00:00:00Z')),
    ).toEqual([2026, 2025, 2024]);
  });

  it('offers the current year alone on an instance with no history', () => {
    // A selector that offered 2019 on a site installed last week would produce
    // an empty review, which reads as a broken page rather than an empty year.
    expect(selectableYears(null, new Date('2026-09-01T00:00:00Z'))).toEqual([2026]);
  });
});
