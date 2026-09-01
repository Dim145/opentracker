/**
 * GET /api/stats/site?window=30|90|365
 *
 * The state of the site, for the people who are on it.
 *
 * `/api/stats/public` already answers the homepage's four counters to anybody
 * who loads the page. This is the rest of it — history, the shape of the
 * catalogue, what is being seeded and by whom — and it is behind a session
 * because half of it names releases and members. A private tracker publishing
 * its catalogue to whoever asks would be a strange thing to build carefully in
 * the feed and then hand out here.
 *
 * Cached per (window, adult visibility) for a minute. The aggregates are a
 * handful of indexed group-bys, but this is a page members will refresh, and a
 * minute of staleness on a chart of the last 90 days is not a number anyone can
 * perceive.
 */
import { z } from 'zod/v4';
import { requireAuthSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateQuery } from '~~/utils/schemas';
import {
  categoryBreakdown,
  dailyDeltas,
  dailyPoints,
  firstSnapshotAt,
  hiddenCategoryIds,
  selectableYears,
  siteNow,
  snapshots,
  topTorrents,
  topUploaders,
} from '~~/utils/publicStats';

const querySchema = z.object({
  // A closed set rather than a number: the window is the cache key and the
  // series length, and "365" is already a thousand rows before bucketing.
  window: z.enum(['30', '90', '365']).default('90'),
});

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: unknown }>();

export default defineEventHandler(async (event) => {
  const { user } = await requireAuthSession(event);
  await rateLimit(event, RATE_LIMITS.public);

  const { window } = validateQuery(event, querySchema);
  const days = Number(window);
  const showAdult = !!user.showAdultContent;
  const key = `${days}:${showAdult ? 'all' : 'safe'}`;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const adultIds = await hiddenCategoryIds(showAdult);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [now, rows, categories, mostSnatched, biggestSwarms, uploaders, firstAt] =
    await Promise.all([
      siteNow(adultIds),
      snapshots(since),
      categoryBreakdown(adultIds),
      topTorrents('snatches', adultIds, 10),
      topTorrents('seeders', adultIds, 10),
      topUploaders(adultIds, 10),
      firstSnapshotAt(),
    ]);

  const points = dailyPoints(rows);
  const value = {
    now,
    days,
    // The series is what it is: if the collector has only been running a week,
    // the chart shows a week rather than 83 empty days. Padding it would draw a
    // flat line at zero and call it history.
    points,
    deltas: dailyDeltas(points),
    categories,
    mostSnatched,
    biggestSwarms,
    topUploaders: uploaders,
    years: selectableYears(firstAt, new Date()),
  };

  cache.set(key, { at: Date.now(), value });
  // Two windows times two visibilities is four entries; the bound is here so a
  // future third dimension cannot turn this into a leak.
  if (cache.size > 12) {
    for (const [k, v] of cache) {
      if (Date.now() - v.at > CACHE_TTL_MS) cache.delete(k);
    }
  }
  return value;
});
