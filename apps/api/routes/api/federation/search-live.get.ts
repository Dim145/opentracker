/**
 * GET /api/federation/search-live?q=<query>  — authenticated, local.
 *
 * The "live" search mode: fan out a signed GET /api/federation/search to every
 * active peer that shares its catalogue with us (`acceptsFromThem.catalog`),
 * aggregate the results, and tag each row with its origin + a local-dup hint.
 * Best-effort and time-bounded (per-peer timeout); a slow or erroring peer is
 * skipped. The "cache" mode (instant, cron-synced) is /api/federation/browse.
 *
 * Like the cache view, a remote torrent links back to its origin instance — we
 * never serve remote `.torrent` bytes with the local passkey.
 */
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import {
  getFederationConfig,
  getPrivateKeyPem,
  isFederationLive,
} from '~~/utils/federation/config';
import { signedGet } from '~~/utils/federation/signing';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { requireAuthSession } from '~~/utils/adminAuth';

const PER_PEER_TIMEOUT_MS = 6000;
const PER_PEER_LIMIT = 30;

function asStr(v: unknown): string | null {
  return typeof v === 'string' && v.length ? v : null;
}
function asNum(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export default defineEventHandler(async (event) => {
  const { user } = await requireAuthSession(event);
  await rateLimit(event, RATE_LIMITS.public);
  const me = await db.query.users.findFirst({
    where: eq(schema.users.id, user.id),
    columns: { showAdultContent: true },
  });
  const showAdult = me?.showAdultContent ?? false;

  const q = getQuery(event);
  const search = typeof q.q === 'string' ? q.q.trim() : '';
  if (search.length < 2) {
    throw createError({ statusCode: 400, message: 'query too short' });
  }

  const config = await getFederationConfig();
  if (!isFederationLive(config)) return { items: [], peers: 0, mode: 'live' };
  const pk = getPrivateKeyPem(config!);
  if (!pk || !config!.instanceId) return { items: [], peers: 0, mode: 'live' };
  const instanceId = config!.instanceId;

  const peers = (
    await db
      .select()
      .from(schema.federationPeers)
      .where(eq(schema.federationPeers.status, 'active'))
  ).filter((p) => p.acceptsFromThem?.catalog);
  if (!peers.length) return { items: [], peers: 0, mode: 'live' };

  const qs = new URLSearchParams({ q: search, limit: String(PER_PEER_LIMIT) });
  const settled = await Promise.allSettled(
    peers.map((peer) =>
      signedGet({
        baseUrl: peer.baseUrl,
        pathname: `/api/federation/search?${qs.toString()}`,
        instanceId,
        privateKeyPem: pk,
        timeoutMs: PER_PEER_TIMEOUT_MS,
      }).then((res) => ({ peer, res })),
    ),
  );

  interface LiveItem {
    infoHash: string;
    contentSignature: string | null;
    name: string;
    size: number;
    categorySlug: string | null;
    categoryType: string | null;
    isAdult: boolean;
    tags: string[];
    imdbId: string | null;
    tmdbId: string | null;
    seeders: number;
    leechers: number;
    uploaderName: string | null;
    detailUrl: string | null;
    peerId: string;
    peerName: string | null;
    peerBaseUrl: string;
  }

  const items: LiveItem[] = [];
  let reached = 0;
  for (const s of settled) {
    if (s.status !== 'fulfilled') continue;
    const { peer, res } = s.value;
    if (res.status !== 200 || !Array.isArray(res.data?.items)) continue;
    reached++;
    for (const raw of res.data.items as Record<string, unknown>[]) {
      const infoHash = asStr(raw.infoHash);
      const name = asStr(raw.name);
      if (!infoHash || !name) continue;
      // Adult gate, mirrored from the origin's category (search.get exports it).
      if (!showAdult && raw.isAdult === true) continue;
      items.push({
        infoHash,
        contentSignature: asStr(raw.contentSignature),
        name: name.slice(0, 1000),
        size: asNum(raw.size),
        categorySlug: asStr(raw.categorySlug),
        categoryType: asStr(raw.categoryType),
        isAdult: raw.isAdult === true,
        tags: Array.isArray(raw.tags)
          ? (raw.tags.filter((t) => typeof t === 'string').slice(0, 50) as string[])
          : [],
        imdbId: asStr(raw.imdbId),
        tmdbId: asStr(raw.tmdbId),
        seeders: asNum(raw.seeders),
        leechers: asNum(raw.leechers),
        uploaderName: asStr(raw.uploaderName),
        detailUrl: asStr(raw.detailUrl),
        peerId: peer.id,
        peerName: peer.displayName,
        peerBaseUrl: peer.baseUrl,
      });
    }
  }

  // Local-dup hint: which of these info hashes already exist locally.
  const hashes = [...new Set(items.map((i) => i.infoHash))];
  const localHashes = new Set<string>();
  if (hashes.length) {
    const localRows = await db
      .select({ infoHash: schema.torrents.infoHash })
      .from(schema.torrents)
      .where(inArray(schema.torrents.infoHash, hashes));
    for (const l of localRows) localHashes.add(l.infoHash);
  }
  // Collapse the same release seen on multiple peers into one item carrying
  // sources[], matching /api/federation/browse. Key = content_signature
  // (cross-seed) || info_hash.
  const groups = new Map<string, LiveItem[]>();
  for (const i of items) {
    const k = i.contentSignature || i.infoHash;
    const arr = groups.get(k);
    if (arr) arr.push(i);
    else groups.set(k, [i]);
  }
  const deduped = [...groups.entries()].map(([key, grp]) => {
    const rep = grp.reduce((a, b) => (b.seeders > a.seeders ? b : a), grp[0]!);
    const sources = grp.map((s) => ({
      id: `live-${s.peerId}-${s.infoHash}`,
      peerId: s.peerId,
      peerName: s.peerName,
      peerBaseUrl: s.peerBaseUrl,
      uploaderName: s.uploaderName,
      categorySlug: s.categorySlug,
      seeders: s.seeders,
      leechers: s.leechers,
      detailUrl: s.detailUrl,
    }));
    return {
      id: `live-${rep.peerId}-${rep.infoHash}`,
      key,
      infoHash: rep.infoHash,
      contentSignature: rep.contentSignature,
      name: rep.name,
      size: rep.size,
      categorySlug: rep.categorySlug,
      categoryType: rep.categoryType,
      isAdult: rep.isAdult,
      tags: rep.tags,
      imdbId: rep.imdbId,
      tmdbId: rep.tmdbId,
      uploaderName: rep.uploaderName,
      remoteCreatedAt: null,
      seeders: grp.reduce((a, s) => a + (s.seeders || 0), 0),
      leechers: grp.reduce((a, s) => a + (s.leechers || 0), 0),
      peerId: rep.peerId,
      peerName: rep.peerName,
      peerBaseUrl: rep.peerBaseUrl,
      detailUrl: rep.detailUrl,
      sourceCount: sources.length,
      sources,
      existsLocally: grp.some((s) => localHashes.has(s.infoHash)),
      sameContentLocally: false,
    };
  });

  return { items: deduped, peers: peers.length, reached, mode: 'live' };
});
