import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';

// Public health summary that the homepage badge reads. Hits the
// tracker's `/health` endpoint over the internal Docker network and
// caches the answer for a few seconds so a viral spike on /index.html
// doesn't translate into a thundering herd against the tracker.
//
// We deliberately don't surface the per-component (db / redis) breakdown
// here — that's an admin-only diagnostic. The badge only cares whether
// the tracker is reachable AND able to answer health checks at all.

interface TrackerHealth {
  online: boolean;
  // unix millis of the last successful probe; lets the UI show a
  // "checked Xs ago" tooltip without triggering its own clock.
  checkedAt: number;
}

const CACHE_TTL_MS = 10_000;
const PROBE_TIMEOUT_MS = 1_500;

let cached: { value: TrackerHealth; expiresAt: number } | null = null;

function trackerHealthUrl(): string {
  const base =
    process.env.TRACKER_INTERNAL_URL ||
    process.env.TRACKER_HEALTH_URL ||
    'http://tracker:8080';
  return base.replace(/\/+$/, '') + '/health';
}

async function probe(): Promise<TrackerHealth> {
  const url = trackerHealthUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    // Tracker returns 200 only when DB + Redis pings both succeed; any
    // 5xx means at least one dependency is down.
    return { online: res.ok, checkedAt: Date.now() };
  } catch {
    return { online: false, checkedAt: Date.now() };
  } finally {
    clearTimeout(timer);
  }
}

export default defineEventHandler(async (event) => {
  await rateLimit(event, RATE_LIMITS.public);

  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const value = await probe();
  cached = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
});
