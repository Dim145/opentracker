import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import bencode from 'bencode';
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
  if (
    torrent.moderationStatus !== 'accepted' &&
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

  // Inject passkey into torrent data
  let decoded: any;
  try {
    decoded = bencode.decode(torrent.torrentData);
  } catch (err) {
    throw createError({
      statusCode: 500,
      message: 'Failed to decode torrent file',
    });
  }

  // Personalize announce URL(s).
  //
  // HTTP (always present): `…/announce?passkey=…` — the canonical form
  // every BT client understands.
  //
  // UDP (BEP 15, only if NUXT_PUBLIC_TRACKER_UDP_URL is set): we encode
  // the passkey as a trailing path segment — `udp://host:6969/announce/PASSKEY`
  // — because BEP 15 has no native passkey field and the UDP tracker
  // pulls it out of the BEP 41 URL_DATA option that libtorrent /
  // qBittorrent / Transmission send for the path. Embedding the
  // passkey straight into the URL means the user never has to copy-
  // paste it into qBittorrent's tracker list manually.
  const httpUrl = new URL(config.public.trackerHttpUrl as string);
  httpUrl.searchParams.set('passkey', user.passkey);
  const personalizedHttpUrl = httpUrl.toString();

  // Only emit the UDP entry when the tracker is *actually* serving
  // UDP. Two conditions must both hold:
  //   1. `NUXT_PUBLIC_TRACKER_UDP_URL` is configured (otherwise we
  //      have no idea what host:port to advertise).
  //   2. `TRACKER_UDP_ENABLED` isn't explicitly set to `false` —
  //      same env the tracker process reads in `internal/config`.
  //      Both processes share the same env in our compose setup,
  //      so this is authoritative without an internal RPC.
  //
  // Without this guard, an operator who disabled UDP would still
  // ship `.torrent` files pointing clients at a dead udp:// endpoint;
  // BT clients that prefer UDP would then back off the working HTTP
  // tracker for a while every announce, breaking ratio in subtle ways.
  let personalizedUdpUrl: string | null = null;
  const udpEnabled = process.env.TRACKER_UDP_ENABLED !== 'false';
  const rawUdpUrl = (config.public.trackerUdpUrl as string) || '';
  if (udpEnabled && rawUdpUrl) {
    try {
      const udpUrl = new URL(rawUdpUrl);
      // Strip any trailing slash on the configured path so the
      // passkey segment doesn't double up.
      const basePath = udpUrl.pathname.replace(/\/+$/, '') || '/announce';
      udpUrl.pathname = `${basePath}/${user.passkey}`;
      personalizedUdpUrl = udpUrl.toString();
    } catch {
      // A misconfigured tracker URL shouldn't tank the .torrent
      // download. Log and fall back to HTTP-only.
      console.warn('[download] invalid trackerUdpUrl, skipping UDP announce-list entry:', rawUdpUrl);
    }
  }

  // BEP 12 announce-list — each tier is a list of equivalent trackers
  // tried in order. We put HTTP and UDP in their own tiers so a client
  // hammers both independently rather than treating them as fallbacks
  // of each other; that mirrors how every tracker we've cribbed off of
  // (opentrackr, AnimeBytes, etc.) advertises a multi-protocol setup.
  decoded.announce = Buffer.from(personalizedHttpUrl);
  const tiers: Buffer[][] = [[Buffer.from(personalizedHttpUrl)]];
  if (personalizedUdpUrl) {
    tiers.push([Buffer.from(personalizedUdpUrl)]);
  }
  decoded['announce-list'] = tiers;

  // Set private flag to 1
  if (decoded.info) {
    decoded.info.private = 1;
  }

  const personalizedData = bencode.encode(decoded);

  // Sanitize filename
  const filename = torrent.name.replace(/[^a-zA-Z0-9._-]/g, '_') + '.torrent';

  // Set headers for download
  setHeader(event, 'Content-Type', 'application/x-bittorrent');
  setHeader(event, 'Content-Disposition', `attachment; filename="${filename}"`);
  setHeader(event, 'Content-Length', personalizedData.length);

  return personalizedData;
});
