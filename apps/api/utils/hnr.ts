import { db, schema } from '@trackarr/db';
import { eq, and, lt, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import {
  isHnrEnabled,
  getHnrRequiredSeedTime,
  getHnrGracePeriod,
} from './settings';

export async function createHnrEntry(
  userId: string,
  torrentId: string
): Promise<void> {
  const enabled = await isHnrEnabled();
  if (!enabled) return;

  const requiredSeedTime = await getHnrRequiredSeedTime();

  // Check if entry already exists
  const existing = await db.query.hnrTracking.findFirst({
    where: and(
      eq(schema.hnrTracking.userId, userId),
      eq(schema.hnrTracking.torrentId, torrentId)
    ),
  });

  if (existing) return;

  await db.insert(schema.hnrTracking).values({
    id: randomUUID(),
    userId,
    torrentId,
    downloadedAt: new Date(),
    seedTime: 0,
    requiredSeedTime,
    isHnr: false,
    isExempt: false,
  });
}

/**
 * Record a "download click" — fire-and-forget on /api/torrents/:hash/download
 * so the user's `/downloads` history reflects every torrent they've fetched
 * the .torrent file for, even if their client never announces. Idempotent
 * via ON CONFLICT (user_id, torrent_id) so re-downloading the same file
 * doesn't create dup rows.
 *
 * Unconditional — unlike `createHnrEntry`, this does NOT consult the HnR
 * feature flag. The Downloads page is a personal log, independent of
 * whether the operator has enabled HnR enforcement.
 */
export async function recordDownloadClick(
  userId: string,
  torrentId: string
): Promise<void> {
  const requiredSeedTime = await getHnrRequiredSeedTime();
  await db
    .insert(schema.hnrTracking)
    .values({
      id: randomUUID(),
      userId,
      torrentId,
      downloadedAt: new Date(),
      seedTime: 0,
      requiredSeedTime,
      isHnr: false,
      isExempt: false,
      uploaded: 0,
      downloaded: 0,
    })
    .onConflictDoNothing({
      target: [schema.hnrTracking.userId, schema.hnrTracking.torrentId],
    });
}

export async function updateSeedTime(
  userId: string,
  torrentId: string,
  additionalSeconds: number
): Promise<void> {
  const entry = await db.query.hnrTracking.findFirst({
    where: and(
      eq(schema.hnrTracking.userId, userId),
      eq(schema.hnrTracking.torrentId, torrentId)
    ),
  });

  if (!entry || entry.isExempt || entry.completedAt) return;

  const newSeedTime = entry.seedTime + additionalSeconds;

  // Check if requirement is now met
  if (newSeedTime >= entry.requiredSeedTime) {
    await db
      .update(schema.hnrTracking)
      .set({
        seedTime: newSeedTime,
        isHnr: false,
        completedAt: new Date(),
      })
      .where(eq(schema.hnrTracking.id, entry.id));
  } else {
    await db
      .update(schema.hnrTracking)
      .set({ seedTime: newSeedTime })
      .where(eq(schema.hnrTracking.id, entry.id));
  }
}

export async function checkAndMarkHnrs(): Promise<number> {
  const enabled = await isHnrEnabled();
  if (!enabled) return 0;

  const gracePeriod = await getHnrGracePeriod();
  const cutoffDate = new Date(Date.now() - gracePeriod * 1000);

  // Mark as HnR if:
  // - Downloaded before grace period cutoff
  // - Not yet completed
  // - Not exempt
  // - Not already marked as HnR
  const result = await db
    .update(schema.hnrTracking)
    .set({ isHnr: true })
    .where(
      and(
        eq(schema.hnrTracking.isHnr, false),
        eq(schema.hnrTracking.isExempt, false),
        sql`${schema.hnrTracking.completedAt} IS NULL`,
        lt(schema.hnrTracking.downloadedAt, cutoffDate)
      )
    )
    .returning();

  return result.length;
}

export async function getUserHnrCount(userId: string): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.hnrTracking)
    .where(
      and(
        eq(schema.hnrTracking.userId, userId),
        eq(schema.hnrTracking.isHnr, true)
      )
    );

  return result[0]?.count || 0;
}

export async function getUserHnrEntries(userId: string) {
  return db.query.hnrTracking.findMany({
    where: eq(schema.hnrTracking.userId, userId),
    with: {
      torrent: {
        columns: { id: true, name: true, infoHash: true },
      },
    },
    orderBy: (hnr, { desc }) => [desc(hnr.downloadedAt)],
  });
}

export async function exemptHnr(entryId: string): Promise<boolean> {
  const result = await db
    .update(schema.hnrTracking)
    .set({ isExempt: true, isHnr: false })
    .where(eq(schema.hnrTracking.id, entryId))
    .returning();

  return result.length > 0;
}

export async function clearHnr(entryId: string): Promise<boolean> {
  const result = await db
    .update(schema.hnrTracking)
    .set({ isHnr: false, completedAt: new Date() })
    .where(eq(schema.hnrTracking.id, entryId))
    .returning();

  return result.length > 0;
}
