/**
 * GET /api/federation/peers?infoHash=  — inbound, S2S.
 *
 * Exposes the active peers (ip, port, isSeeder ONLY — no peer_id, no ipHash,
 * no user) of one of OUR torrents to a partner we share `swarm` with, but
 * ONLY if that torrent opted in (`federate_swarm = true`). This is the
 * sensitive one: it hands peer IPs to the partner, so it's gated on BOTH the
 * per-peer swarm scope AND the per-torrent opt-in. Signed like the catalogue.
 */
import { eq, and } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { redis } from '~~/utils/server';
import { isBlockedIp } from '~~/utils/safeFetch';
import { verifyInboundS2S } from '~~/utils/federation/inbound';

// Match the tracker's activeListWindow (peers.go) so we only expose peers
// that are actually live.
const ACTIVE_WINDOW_MS = 60 * 60 * 1000;
const MAX_PEERS = 200;

export default defineEventHandler(async (event) => {
  await verifyInboundS2S(event, 'swarm');

  const q = getQuery(event);
  const infoHash =
    typeof q.infoHash === 'string' ? q.infoHash.toLowerCase().trim() : '';
  if (!/^[0-9a-f]{40}$/.test(infoHash)) {
    throw createError({ statusCode: 400, message: 'valid infoHash required' });
  }

  // Torrent must be accepted + active AND opted in to swarm federation.
  const [torrent] = await db
    .select({
      id: schema.torrents.id,
      federateSwarm: schema.torrents.federateSwarm,
    })
    .from(schema.torrents)
    .where(
      and(
        eq(schema.torrents.infoHash, infoHash),
        eq(schema.torrents.moderationStatus, 'accepted'),
        eq(schema.torrents.isActive, true),
      ),
    )
    .limit(1);
  if (!torrent || !torrent.federateSwarm) {
    return { ok: true, peers: [] };
  }

  // Read the tracker's swarm hash. ioredis applies REDIS_KEY_PREFIX, so the
  // physical key matches the Go tracker's `{prefix}peers:{infoHash}`.
  let hash: Record<string, string> = {};
  try {
    hash = await redis.hgetall(`peers:${infoHash}`);
  } catch {
    hash = {};
  }

  const now = Date.now();
  const peers: { ip: string; port: number; isSeeder: boolean }[] = [];
  for (const raw of Object.values(hash)) {
    try {
      const p = JSON.parse(raw) as {
        ip?: string;
        port?: number;
        isSeeder?: boolean;
        updatedAt?: number;
      };
      if (!p.ip || !p.port) continue;
      // Never expose internal / private / loopback peer IPs to a partner.
      if (isBlockedIp(p.ip)) continue;
      if (typeof p.updatedAt === 'number' && now - p.updatedAt > ACTIVE_WINDOW_MS) {
        continue;
      }
      peers.push({ ip: p.ip, port: p.port, isSeeder: !!p.isSeeder });
      if (peers.length >= MAX_PEERS) break;
    } catch {
      /* skip malformed peer */
    }
  }

  return { ok: true, peers };
});
