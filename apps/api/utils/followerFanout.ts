/**
 * Follower fan-out — notify every user that follows an uploader
 * when one of their torrents goes live.
 *
 * "Goes live" has two trigger points:
 *
 *   1. Upload endpoint, when a torrent is auto-accepted (auto-
 *      moderation off, or the uploader holds an exempt role). The
 *      row's first persisted status is already `accepted`.
 *
 *   2. Moderation transition, when a torrent moves from `pending`
 *      or `changes_requested` to `accepted`. The fan-out runs from
 *      `transitionStatus` in `utils/torrentModeration.ts`.
 *
 * Both callsites invoke this helper in a fire-and-forget wrapper
 * (`void (async () => …)()`) so the announce / moderation hot path
 * never blocks on the notification fan-out. Errors are swallowed
 * and logged — a follower missing a single ping must never cascade
 * into a failed upload.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { notify } from './notify';

interface FanoutInput {
  uploaderId: string;
  uploaderUsername: string;
  torrentId: string;
  torrentInfoHash: string;
  torrentName: string;
}

/** Pool size for per-follower notify dispatch. 20 is high
 *  enough that a few hundred followers finish in roughly one
 *  notify round-trip's worth of wall time, low enough that an
 *  uploader with 50k+ followers can't open 50k+ concurrent
 *  connections to Postgres and Redis at upload time. */
const FANOUT_CONCURRENCY = 20;

/**
 * Worker-pool concurrency limiter. Spins up `concurrency`
 * workers that pop items from a shared queue. Each task's
 * failure is swallowed — the fan-out is best-effort and a
 * single recipient's notify glitch must not skip the rest.
 */
async function withConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
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

export async function fanoutFollowedUserUpload(
  input: FanoutInput,
): Promise<void> {
  try {
    const followers = await db
      .select({ followerId: schema.userFollows.followerId })
      .from(schema.userFollows)
      .where(eq(schema.userFollows.followingId, input.uploaderId));

    if (followers.length === 0) return;

    // Capped concurrency pool. Unbounded `Promise.all` was a
    // real DoS risk: an uploader with 50k followers opened 50k
    // parallel notify calls (DB insert + Redis publish + maybe
    // an external channel dispatch each) at every upload. 20
    // workers finish a 200-follower upload in 10 round-trip
    // batches and keep the connection pool from collapsing
    // even on a 50k-follower hot account.
    await withConcurrency(followers, FANOUT_CONCURRENCY, (f) =>
      notify(
        f.followerId,
        'followed_user_upload',
        {
          uploaderId: input.uploaderId,
          uploaderUsername: input.uploaderUsername,
          torrentName: input.torrentName,
        },
        `/torrents/${input.torrentInfoHash}`,
      ),
    );
  } catch (err) {
    console.warn(
      '[Follow] fan-out failed for uploader',
      input.uploaderId,
      (err as Error).message,
    );
  }
}
