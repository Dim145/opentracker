/**
 * Federation tombstones — record when a torrent stops being federatable so
 * partners can purge their mirror (`remote_torrents`) row. The catalogue sync
 * is append-forward and never re-reads old rows, so a delete / moderation pull
 * / uploader ban would otherwise leave orphaned mirror rows (dead links) on
 * every peer. See `federationCatalogRemovals` in the schema.
 *
 * Best-effort: a failure here must never break the delete/ban/moderation op
 * that triggered it. Skipped entirely when federation isn't live (no point
 * growing the table on a standalone instance).
 */
import { v4 as uuid } from 'uuid';
import { db, schema } from '@trackarr/db';
import { getFederationConfig, isFederationLive } from './config';

export type RemovalReason = 'deleted' | 'moderation' | 'uploader_banned';

export interface RemovedTorrent {
  torrentId: string; // local torrent id = partner's remote_torrents.remote_id
  infoHash: string;
  contentSignature?: string | null;
}

export async function recordFederationRemoval(
  torrents: RemovedTorrent | RemovedTorrent[],
  reason: RemovalReason,
): Promise<void> {
  const rows = Array.isArray(torrents) ? torrents : [torrents];
  if (!rows.length) return;
  try {
    const config = await getFederationConfig();
    if (!isFederationLive(config)) return;
    await db.insert(schema.federationCatalogRemovals).values(
      rows.map((r) => ({
        id: uuid(),
        torrentId: r.torrentId,
        infoHash: r.infoHash,
        contentSignature: r.contentSignature ?? null,
        reason,
      })),
    );
  } catch (err) {
    console.warn(
      '[Federation] recordFederationRemoval failed:',
      (err as Error)?.message,
    );
  }
}
