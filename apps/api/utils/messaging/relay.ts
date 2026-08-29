import { redis } from '~~/utils/server';

/**
 * The bridge to the relay: publish, and tell the fleet how to behave.
 *
 * Nothing here reaches a relay node directly. The API publishes to Valkey
 * and the nodes are listening — which is what lets the same code serve one
 * container on a single machine and a dozen pods across a cluster, with no
 * service discovery and no inbound path to the nodes.
 */

/** A member listens on their own channel, and on no other. */
export const userChannel = (userId: string) => `messaging:user:${userId}`;

export const NODE_KEY_PREFIX = 'messaging:node:';
export const CONFIG_CHANNEL = 'messaging:config';

/**
 * Hand a message to whoever is listening.
 *
 * Deliberately fire-and-forget, and deliberately after the write has
 * committed. A publish that failed must never fail the send: the message
 * is in Postgres, the reader's client will find it on its next fetch or on
 * reconnect. Losing the live copy is a degraded experience; losing the
 * message is a bug.
 */
export async function publishToUsers(userIds: string[], payload: unknown) {
  const body = JSON.stringify(payload);
  await Promise.all(
    userIds.map((id) =>
      redis.publish(userChannel(id), body).catch(() => undefined)
    )
  );
}

export interface FleetConfig {
  maxConnections: number;
  queueDepth: number;
  coalesceWindowMs: number;
}

/**
 * How many relay nodes are alive right now.
 *
 * Each node writes a key with a TTL and refreshes it; a dead node needs no
 * probe, its key simply expires. `SCAN` rather than `KEYS` because this
 * runs on the same Valkey the tracker and the rate limiter use, and `KEYS`
 * blocks it for the duration.
 */
export async function countLiveNodes(): Promise<number> {
  let cursor = '0';
  let total = 0;
  do {
    const [next, keys] = await redis.scan(
      cursor,
      'MATCH',
      `${NODE_KEY_PREFIX}*`,
      'COUNT',
      100
    );
    cursor = next;
    total += keys.length;
  } while (cursor !== '0');
  return total;
}

/**
 * The per-node ceiling, and the one rule the fleet depends on.
 *
 * When a node dies its connections move to the survivors. If the ceiling
 * stays computed on the old fleet size, the survivors refuse the
 * reconnections and the loss of one node takes down two — the guard meant
 * to protect amplifies instead. So the divisor is the CURRENT count, and
 * the margin is generous: a node briefly over its share is better than a
 * node slamming the door.
 */
export const CONNECTION_TARGET = Number(
  process.env.MESSAGING_CONNECTION_TARGET ?? 20_000
);
const MARGIN = 1.5;

export function fleetConfigFor(liveNodes: number): FleetConfig {
  const nodes = Math.max(1, liveNodes);
  return {
    maxConnections: Math.ceil((CONNECTION_TARGET / nodes) * MARGIN),
    queueDepth: 64,
    coalesceWindowMs: 150,
  };
}

export async function broadcastFleetConfig(): Promise<FleetConfig> {
  const config = fleetConfigFor(await countLiveNodes());
  await redis.publish(CONFIG_CHANNEL, JSON.stringify(config));
  return config;
}
