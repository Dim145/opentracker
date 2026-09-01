/**
 * A bounded worker pool for notification fan-outs.
 *
 * Lived in `followerFanout.ts` until the reseed request became its second
 * caller. The reasoning is unchanged and worth keeping in front of whoever
 * adds a third: an unbounded `Promise.all` over recipients is a denial of
 * service you write yourself. Each task is a database insert plus a Redis
 * publish plus — for anyone who configured one — an outbound HTTP request to
 * Telegram, Discord or a webhook. A release followed by two thousand members
 * would open two thousand of those at once, against a connection pool sized
 * for tens.
 *
 * Failures are swallowed per item on purpose. A fan-out is best-effort, and one
 * recipient whose webhook is refusing connections must not cost the other
 * nineteen hundred their notification.
 */
/**
 * 20 is high enough that a few hundred recipients finish in roughly one notify
 * round-trip's worth of wall time, and low enough that an uploader with 50 000
 * followers cannot open 50 000 concurrent connections to Postgres and Redis at
 * upload time.
 */
export const FANOUT_CONCURRENCY = 20;

export async function withConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  const queue = items.slice();
  const workers = Array(Math.min(concurrency, items.length))
    .fill(0)
    .map(async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (item === undefined) return;
        try {
          await fn(item);
        } catch {
          // best-effort: don't let one bad recipient sink the rest
        }
      }
    });
  await Promise.all(workers);
}
