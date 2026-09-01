/**
 * GET /api/stats/year?year=YYYY
 *
 * The site's year: what was added, what moved, who joined, and what everybody
 * was grabbing.
 *
 * A tracker's year in review is a retention feature rather than an analytics
 * one — it is the page members link to each other in January — so it is written
 * to be readable rather than complete. Every figure on it can be traced to one
 * of four tables, and the ones that cannot be computed honestly are absent
 * rather than approximated.
 *
 * ## Two figures that are not the same, and are both here
 *
 * `bytesAdded` is the size of the releases catalogued during the year. It is a
 * property of the catalogue, and it is exact.
 *
 * `trafficBytes` is how much was actually transferred, taken as the difference
 * between the first and last `site_stats` snapshot inside the year. It is
 * approximate BY CONSTRUCTION: the counter behind it drops when an account is
 * erased or a cheater's stats are reset, so it is a floor rather than a total,
 * and it is null for a year the collector has no snapshots for. Presenting it
 * as exact would be the lie; the guide says so and so does the page.
 *
 * Past years never change, so they are cached for a day. The current one is
 * cached for a minute, like the rest of the stats.
 */
import { z } from 'zod/v4';
import { requireAuthSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateQuery } from '~~/utils/schemas';
import { hiddenCategoryIds, siteYear } from '~~/utils/publicStats';

const querySchema = z.object({
  // 2000 is not a guess: BitTorrent was published in 2001, so a tracker with
  // data before that is a clock problem rather than a year.
  year: z.coerce.number().int().min(2000).max(2100),
});

const FRESH_TTL_MS = 60_000;
const SETTLED_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; ttl: number; value: unknown }>();

export default defineEventHandler(async (event) => {
  const { user } = await requireAuthSession(event);
  await rateLimit(event, RATE_LIMITS.public);

  const { year } = validateQuery(event, querySchema);
  const showAdult = !!user.showAdultContent;
  const key = `${year}:${showAdult ? 'all' : 'safe'}`;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;

  const value = await siteYear(year, await hiddenCategoryIds(showAdult));
  const ttl = year < new Date().getUTCFullYear() ? SETTLED_TTL_MS : FRESH_TTL_MS;
  cache.set(key, { at: Date.now(), ttl, value });
  // Bounded: one entry per year per visibility, and a long-lived instance would
  // otherwise accumulate one a year forever.
  if (cache.size > 40) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  return value;
});
