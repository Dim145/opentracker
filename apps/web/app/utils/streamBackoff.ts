/**
 * How long to wait before reopening a dropped stream.
 *
 * `EventSource` reconnects on its own after a fixed delay, which is
 * precisely the wrong behaviour when a relay node dies: every client it
 * held comes back at the same instant, each asking the API for a token and
 * a catch-up. The failure of one node turns into a correlated spike on the
 * two components the split exists to protect.
 *
 * So the delay is a random point inside a widening window. Spreading a
 * thousand reconnections over a few seconds costs a few seconds; not
 * spreading them costs the next node.
 */

/** Milliseconds. The last window repeats for every further attempt. */
export const BACKOFF_WINDOWS: ReadonlyArray<readonly [number, number]> = [
  [1_000, 5_000],
  [5_000, 15_000],
  [15_000, 60_000],
];

/**
 * `random` is injected so this is testable: a backoff whose spread is
 * never checked is a backoff that quietly becomes a constant.
 */
export function backoffDelay(attempt: number, random = Math.random): number {
  const index = Math.min(Math.max(attempt, 0), BACKOFF_WINDOWS.length - 1);
  const [lo, hi] = BACKOFF_WINDOWS[index]!;
  return lo + Math.floor(random() * (hi - lo));
}
