import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { personalizeTorrent } from '~~/utils/torrentBytes';
import { personalAnnounceUrls, trackerUdpEnabled } from '~~/utils/announceUrls';
import { recordDownloadClick } from '~~/utils/hnr';

export default defineEventHandler(async (event) => {
  // Require authentication
  const { user } = await requireUserSession(event);
  const config = useRuntimeConfig();

  const hash = getRouterParam(event, 'hash');

  if (!hash || !/^[a-fA-F0-9]{40}$/.test(hash)) {
    throw createError({
      statusCode: 400,
      message: 'Invalid info hash format',
    });
  }

  const infoHash = hash.toLowerCase();

  // Get torrent from DB. We pull the row id here so we can stamp a
  // download-history row immediately after — this lets the /downloads
  // page surface a torrent the moment the user clicked "Download",
  // before the BitTorrent client has even announced.
  //
  // Moderation gate: only `accepted` rows are served to plain users;
  // staff and the original uploader can still pull pending /
  // changes_requested rows so they can verify the file from within
  // the moderation thread. Rejected rows are never served. Without
  // this gate, knowing a pending hash (e.g. via `/api/torrents/check`)
  // would have let a non-owner pull the `.torrent` directly.
  const torrents = await db
    .select({
      id: schema.torrents.id,
      name: schema.torrents.name,
      torrentData: schema.torrents.torrentData,
      moderationStatus: schema.torrents.moderationStatus,
      uploaderId: schema.torrents.uploaderId,
      isActive: schema.torrents.isActive,
    })
    .from(schema.torrents)
    .where(eq(schema.torrents.infoHash, infoHash))
    .limit(1);

  const torrent = torrents[0];

  if (!torrent || !torrent.torrentData) {
    throw createError({
      statusCode: 404,
      message: 'Torrent not found',
    });
  }

  const isStaff = !!(user.isAdmin || user.isModerator);
  const isOwner = torrent.uploaderId === user.id;
  // `!torrent.isActive` compte autant que le statut de modération.
  //
  // `is_active` est l'interrupteur qu'un opérateur bascule pour retirer une
  // release — le tracker Go refuse alors de l'annoncer, RSS et Torznab la
  // taisent — mais le `.torrent` restait servi ici. Retirer une release et
  // continuer à distribuer son fichier est le contraire d'un retrait.
  if (
    (torrent.moderationStatus !== 'accepted' || !torrent.isActive) &&
    !isStaff &&
    !isOwner
  ) {
    // 404 (not 403) so a probe can't distinguish "doesn't exist"
    // from "exists but not accepted". Mirrors the gate on the
    // detail route + the new gate in `/api/torrents/check`.
    throw createError({
      statusCode: 404,
      message: 'Torrent not found',
    });
  }

  // Stamp the download history. Best-effort: if the insert fails we
  // still serve the .torrent because the user came here for the file,
  // not the bookkeeping. The helper is idempotent via ON CONFLICT so
  // repeated clicks don't pile up duplicate rows.
  try {
    await recordDownloadClick(user.id, torrent.id);
  } catch (err) {
    console.warn('[download] failed to record download click', err);
  }

  // The announce passkey as it stands now. The session cookie holds the one
  // the member had at sign-in: rotated since on another device, that copy is
  // dead, and every `.torrent` downloaded here would announce with it.
  const [owner] = await db
    .select({ passkey: schema.users.passkey })
    .from(schema.users)
    .where(eq(schema.users.id, user.id))
    .limit(1);
  if (!owner?.passkey) {
    throw createError({ statusCode: 401, message: 'Unauthorized' });
  }

  // The member's announce URLs, written into the stored bytes without
  // decoding them: `utils/torrentBytes` says why a decode → encode round trip
  // corrupted every v2 torrent's piece layers.
  const { announce, tiers } = personalAnnounceUrls(owner.passkey, {
    httpUrl: config.public.trackerHttpUrl as string,
    udpUrl: (config.public.trackerUdpUrl as string) || '',
    udpEnabled: trackerUdpEnabled(),
  });
  let personalizedData: Buffer;
  try {
    personalizedData = personalizeTorrent(Buffer.from(torrent.torrentData), announce, tiers);
  } catch {
    throw createError({
      statusCode: 500,
      message: 'Failed to decode torrent file',
    });
  }

  // Sanitize filename
  const filename = torrent.name.replace(/[^a-zA-Z0-9._-]/g, '_') + '.torrent';

  // Set headers for download
  setHeader(event, 'Content-Type', 'application/x-bittorrent');
  setHeader(event, 'Content-Disposition', `attachment; filename="${filename}"`);
  setHeader(event, 'Content-Length', personalizedData.length);

  return personalizedData;
});
