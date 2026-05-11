/**
 * GET /api/me/notifications/stream
 *
 * Server-Sent Events stream for the user's notifications. Each
 * `notify(userId, …)` call publishes the new row to a Redis
 * channel (`notifications:user:<id>`); this handler subscribes to
 * that channel for the duration of the connection and forwards
 * every received row to the client as an SSE `data:` frame.
 *
 * Per-instance state:
 *   - One ioredis subscriber per Nitro process (duplicated from
 *     the shared client). We don't open one per connection because
 *     ioredis multiplexes channels over a single TCP socket — every
 *     SSE handler just calls `sub.subscribe(channel)` and shares.
 *
 *   - A `Map<userId, Set<EventStreamWriter>>` tracks the open
 *     streams. When a Redis message lands for `userId`, we iterate
 *     the matching set and call `send()` on each writer.
 *
 *   - On client disconnect (the request signal aborts), we remove
 *     the writer from the set and unsubscribe the channel if the
 *     set becomes empty. Same channel can be re-subscribed cheaply
 *     when another tab opens later.
 *
 * Reverse-proxy notes:
 *   - Caddy needs `flush_interval -1` on the reverse-proxy block
 *     for the SSE upstream so heartbeat bytes aren't buffered.
 *   - We emit a `:` comment line every 30s as a heartbeat so the
 *     connection stays warm through aggressive idle timeouts.
 */
import { redis } from '~~/redis/client';
import { channelFor, NOTIFY_CHANNEL_PREFIX } from '~~/utils/notify';

// ── Per-process subscriber + writer registry ─────────────────────
//
// Hoisted to module scope so every request reuses the same Redis
// subscriber socket. The first SSE connection opens it; further
// connections piggy-back. We never close it — process lifetime
// matches the API container's lifetime.
type Writer = (data: string) => void;
const writersByUser = new Map<string, Set<Writer>>();
let subscriber: ReturnType<typeof redis.duplicate> | null = null;

function ensureSubscriber(): void {
  if (subscriber) return;
  subscriber = redis.duplicate({
    lazyConnect: false,
    // SUBSCRIBE has to queue across a reconnect, so we override the
    // shared client's default of `enableOfflineQueue: false`. Same
    // pattern as the settings invalidation subscriber.
    enableOfflineQueue: true,
  });
  subscriber.on('message', (channel, message) => {
    if (!channel.startsWith(NOTIFY_CHANNEL_PREFIX)) return;
    const userId = channel.slice(NOTIFY_CHANNEL_PREFIX.length);
    const writers = writersByUser.get(userId);
    if (!writers || writers.size === 0) return;
    for (const w of writers) {
      try {
        w(message);
      } catch {
        // A writer that throws is dead — the cleanup in the handler
        // will purge it from the set on disconnect.
      }
    }
  });
  subscriber.on('error', (err) => {
    const code = (err as any)?.code;
    if (code !== 'ECONNRESET' && code !== 'EPIPE') {
      console.warn('[NotifySSE] subscriber error:', err.message);
    }
  });
}

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  ensureSubscriber();

  // Headers — explicit because some proxies strip the implicit ones.
  // `X-Accel-Buffering: no` defangs nginx's response buffer which
  // would otherwise hold every event for ~4 KB worth of payload.
  setResponseHeader(event, 'Content-Type', 'text/event-stream');
  setResponseHeader(event, 'Cache-Control', 'no-cache, no-transform');
  setResponseHeader(event, 'Connection', 'keep-alive');
  setResponseHeader(event, 'X-Accel-Buffering', 'no');

  const res = event.node.res;
  // Flush headers before the first `:` heartbeat so the browser's
  // EventSource transitions to OPEN immediately.
  res.writeHead(200);

  const send: Writer = (data: string) => {
    res.write(`data: ${data}\n\n`);
  };

  // Register the writer for this user — additive, multiple tabs
  // of the same user share the same subscribe but get independent
  // writes. The Set handles dedupe of accidental duplicates.
  let writers = writersByUser.get(user.id);
  if (!writers) {
    writers = new Set();
    writersByUser.set(user.id, writers);
    // First writer for this user — subscribe to their channel.
    await subscriber!.subscribe(channelFor(user.id)).catch((err: Error) => {
      console.warn('[NotifySSE] subscribe failed:', err.message);
    });
  }
  writers.add(send);

  // Initial frame so the browser knows the stream is up. The
  // payload doesn't matter — clients ignore the `:` comment lines
  // but treat them as keep-alive for both their internal state and
  // proxy idle counters.
  res.write(': open\n\n');

  // Heartbeat every 30s. Browsers' EventSource will reconnect on
  // its own if the socket drops, so we don't need a watchdog —
  // just keep the upstream proxy happy.
  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      // Write failure means the socket is closed; the `close`
      // listener will run shortly and clean up.
    }
  }, 30_000);

  // Cleanup on disconnect. EventSource doesn't expose a graceful
  // close from the client; the server learns by the TCP read end
  // closing or by the request signal aborting.
  const cleanup = () => {
    clearInterval(heartbeat);
    const set = writersByUser.get(user.id);
    if (set) {
      set.delete(send);
      if (set.size === 0) {
        writersByUser.delete(user.id);
        subscriber!
          .unsubscribe(channelFor(user.id))
          .catch(() => {
            // Best-effort — the next subscribe() for this user will
            // re-establish if needed.
          });
      }
    }
    try {
      res.end();
    } catch {
      // already closed
    }
  };
  event.node.req.on('close', cleanup);
  event.node.req.on('error', cleanup);

  // h3 expects us to return something. Returning `null` keeps the
  // response alive (we're writing to `res` directly above).
  // Without this, h3 would call `res.end()` after this function
  // resolves.
  return new Promise<void>(() => {
    // Intentionally never resolve — the response is kept open by
    // the handler until the client disconnects. The cleanup above
    // closes the socket from our side.
  });
});
