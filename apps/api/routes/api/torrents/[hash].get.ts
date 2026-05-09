import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { getPeers, getStats } from '~~/utils/server';
import { validateParam, infoHashSchema } from '~~/utils/schemas';

export default defineEventHandler(async (event) => {
  const { user: session } = await requireUserSession(event);
  const infoHash = validateParam(event, 'hash', infoHashSchema);

  const torrent = await db.query.torrents.findFirst({
    where: (t, { eq }) => eq(t.infoHash, infoHash),
    with: {
      category: true,
      torrentTags: {
        with: {
          tag: true,
        },
      },
      comments: {
        with: {
          author: {
            columns: {
              id: true,
              username: true,
            },
          },
        },
        orderBy: (c, { desc }) => [desc(c.createdAt)],
      },
    },
  });

  if (!torrent) {
    throw createError({
      statusCode: 404,
      message: 'Torrent not found',
    });
  }

  // Moderation visibility: only `accepted` rows are exposed to the
  // general audience. The uploader keeps access to their own row at
  // every status (so they can read the moderator's note and edit a
  // changes_requested torrent). Staff see everything. Anyone else
  // gets a flat 404 — same response as a non-existent hash so a
  // probe can't even confirm a moderation thread exists.
  if (torrent.moderationStatus !== 'accepted') {
    const isOwner = torrent.uploaderId === session.id;
    const isStaff = !!(session.isAdmin || session.isModerator);
    if (!isOwner && !isStaff) {
      throw createError({ statusCode: 404, message: 'Torrent not found' });
    }
  }

  // Adult gate: if the torrent's category is flagged adult and the
  // viewer hasn't opted in, return a redacted shape instead of the
  // real torrent. The frontend renders a dedicated "content hidden"
  // screen from this signal — we deliberately *don't* 404 so the
  // operator can offer a one-click toggle to reveal.
  if (torrent.category?.isAdult) {
    const me = await db.query.users.findFirst({
      where: eq(schema.users.id, session.id),
      columns: { showAdultContent: true },
    });
    const showAdult = me?.showAdultContent ?? false;
    if (!showAdult) {
      return {
        gatedAdult: true,
        infoHash: torrent.infoHash,
        category: {
          id: torrent.category.id,
          name: torrent.category.name,
          slug: torrent.category.slug,
        },
      };
    }
  }

  const [stats, peers] = await Promise.all([
    getStats(infoHash),
    getPeers(infoHash),
  ]);

  const tags = torrent.torrentTags?.map((tt) => tt.tag) || [];

  return {
    ...torrent,
    tags,
    torrentTags: undefined,
    stats: {
      seeders: stats.seeders,
      leechers: stats.leechers,
      completed: stats.completed,
    },
    // Only expose anonymized peer data - no raw IPs
    peers: peers.map((p) => ({
      id: p.ipHash,
      port: p.port,
      isSeeder: p.isSeeder,
      uploaded: p.uploaded,
      downloaded: p.downloaded,
      lastSeen: new Date(p.updatedAt).toISOString(),
    })),
  };
});
