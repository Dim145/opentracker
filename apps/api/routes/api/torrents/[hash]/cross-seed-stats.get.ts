/**
 * GET /api/torrents/:hash/cross-seed-stats
 *
 * KPIs the detail page renders next to the seeders / leechers /
 * uploaded tiles:
 *
 *   - `otherTorrentCount`   how many *other* torrents share this
 *                            content signature.
 *   - `seederCount`         how many of the current swarm's seeders
 *                            are also seeding (or leeching) one of
 *                            those siblings *right now*.
 *   - `leecherCount`        same for the leecher side.
 *   - `uploadedShareBytes`  bytes uploaded to *this* torrent by
 *                            users who also have any peer activity
 *                            on a sibling. The numerator of the
 *                            "X% x-seed" volume KPI.
 *   - `totalUploadedBytes`  bytes uploaded to *this* torrent across
 *                            all users. The denominator.
 *
 * Returns zeros when the torrent has no signature yet (the backfill
 * plugin hasn't picked it up) or no siblings — the FE just hides
 * the qualifier in that case.
 *
 * Moderation gate mirrors the parent endpoint: pending / rejected /
 * changes_requested rows are only visible to the uploader or staff.
 */
import { db, schema } from '@trackarr/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getPeers } from '~~/redis/cache';
import { validateParam, infoHashSchema } from '~~/utils/schemas';

const MAX_SIBLINGS_SCANNED = 50;

interface CrossSeedStats {
  otherTorrentCount: number;
  seederCount: number;
  leecherCount: number;
  uploadedShareBytes: string;
  totalUploadedBytes: string;
}

export default defineEventHandler(async (event): Promise<CrossSeedStats> => {
  const { user: session } = await requireUserSession(event);
  const infoHash = validateParam(event, 'hash', infoHashSchema);

  const source = await db.query.torrents.findFirst({
    where: (t, { eq }) => eq(t.infoHash, infoHash),
    columns: {
      id: true,
      uploaderId: true,
      moderationStatus: true,
      contentSignature: true,
    },
  });
  if (!source) {
    throw createError({ statusCode: 404, message: 'Torrent not found' });
  }
  if (source.moderationStatus !== 'accepted') {
    const isOwner = source.uploaderId === session.id;
    const isStaff = !!(session.isAdmin || session.isModerator);
    if (!isOwner && !isStaff) {
      throw createError({ statusCode: 404, message: 'Torrent not found' });
    }
  }

  const empty: CrossSeedStats = {
    otherTorrentCount: 0,
    seederCount: 0,
    leecherCount: 0,
    uploadedShareBytes: '0',
    totalUploadedBytes: '0',
  };

  if (!source.contentSignature) {
    return empty;
  }

  // ── 1. Find sibling torrents (cap to keep the Redis scan bounded) ──
  const siblings = await db
    .select({
      id: schema.torrents.id,
      infoHash: schema.torrents.infoHash,
    })
    .from(schema.torrents)
    .where(
      and(
        eq(schema.torrents.contentSignature, source.contentSignature),
        sql`${schema.torrents.id} != ${source.id}`,
      ),
    )
    .limit(MAX_SIBLINGS_SCANNED);

  if (siblings.length === 0) {
    // Even without siblings, surfacing the source torrent's total
    // uploaded byte count lets the FE render the volume tile
    // consistently — the share just stays at zero.
    const totals = await db
      .select({
        total: sql<string>`COALESCE(SUM(${schema.hnrTracking.uploaded}), 0)::text`,
      })
      .from(schema.hnrTracking)
      .where(eq(schema.hnrTracking.torrentId, source.id));
    return {
      ...empty,
      totalUploadedBytes: totals[0]?.total ?? '0',
    };
  }

  // ── 2. Gather every userId currently active in a sibling swarm ──
  //
  // We fetch the peer hashes in parallel so the wall-clock cost
  // stays sub-100 ms even on a torrent with the full 50 siblings.
  // `getPeers` already filters out stale entries on read.
  const siblingPeerLists = await Promise.all(
    siblings.map((s) => getPeers(s.infoHash).catch(() => [])),
  );
  const siblingActiveUserIds = new Set<string>();
  for (const peers of siblingPeerLists) {
    for (const peer of peers) {
      if (peer.userId) siblingActiveUserIds.add(peer.userId);
    }
  }

  // ── 3. Count cross-seed peers in the **current** swarm ──
  let seederCount = 0;
  let leecherCount = 0;
  const currentPeers = await getPeers(infoHash).catch(() => []);
  for (const peer of currentPeers) {
    if (!peer.userId || !siblingActiveUserIds.has(peer.userId)) continue;
    if (peer.isSeeder) seederCount += 1;
    else leecherCount += 1;
  }

  // ── 4. Volume contribution from cross-seed users ──
  //
  // SUMs come back as strings to preserve precision past 2^53 bytes
  // (≈9 PiB). The FE either parses them with BigInt or just renders
  // the bytes through `formatSize`.
  const totalUploadedQuery = await db
    .select({
      total: sql<string>`COALESCE(SUM(${schema.hnrTracking.uploaded}), 0)::text`,
    })
    .from(schema.hnrTracking)
    .where(eq(schema.hnrTracking.torrentId, source.id));
  const totalUploadedBytes = totalUploadedQuery[0]?.total ?? '0';

  let uploadedShareBytes = '0';
  if (siblingActiveUserIds.size > 0) {
    const shareQuery = await db
      .select({
        total: sql<string>`COALESCE(SUM(${schema.hnrTracking.uploaded}), 0)::text`,
      })
      .from(schema.hnrTracking)
      .where(
        and(
          eq(schema.hnrTracking.torrentId, source.id),
          inArray(schema.hnrTracking.userId, Array.from(siblingActiveUserIds)),
        ),
      );
    uploadedShareBytes = shareQuery[0]?.total ?? '0';
  }

  return {
    otherTorrentCount: siblings.length,
    seederCount,
    leecherCount,
    uploadedShareBytes,
    totalUploadedBytes,
  };
});
