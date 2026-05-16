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

export async function fanoutFollowedUserUpload(
  input: FanoutInput,
): Promise<void> {
  try {
    const followers = await db
      .select({ followerId: schema.userFollows.followerId })
      .from(schema.userFollows)
      .where(eq(schema.userFollows.followingId, input.uploaderId));

    if (followers.length === 0) return;

    // Sequential notify calls would serialize the fan-out and
    // stretch a 200-follower upload into 200 round-trips. They run
    // in parallel; each is independently best-effort (the
    // `notify` implementation already swallows its own errors).
    await Promise.all(
      followers.map((f) =>
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
