/**
 * Prometheus metrics server.
 *
 * Bound to its own port (`METRICS_PORT`, default 9090) instead of riding on
 * Nitro's main HTTP listener. Reasons:
 *
 *   1. Operators want to firewall the metrics surface separately from the
 *      public API. A dedicated port makes that one-line in any firewall /
 *      kube NetworkPolicy / docker-compose mapping.
 *   2. The /metrics endpoint must stay reachable even when the API is
 *      behind a strict reverse proxy with auth, so co-tenanting it inside
 *      the same router would defeat the point.
 *   3. Prometheus scrape budgets are independent from API request budgets.
 *
 * Activation is opt-in via `METRICS_ENABLED=true`. If unset/false the
 * server never binds, so no surface area is added in default deployments.
 *
 * If `METRICS_AUTH_TOKEN` is set, scrapes must present
 * `Authorization: Bearer <token>` (constant-time-compared). This is for
 * shared-secret scenarios where you can't isolate the port at the network
 * layer; pure firewall isolation is still the recommended approach.
 *
 * Filename starts after `00.redis.ts` so the redis client is connected by
 * the time the metrics server takes its first scrape.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { getMetricsText } from '~~/utils/metrics';
import { registry } from '~~/utils/metrics';

function envFlag(name: string): boolean {
  const v = process.env[name];
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function safeCompare(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export default defineNitroPlugin((nitroApp) => {
  if (!envFlag('METRICS_ENABLED')) {
    return;
  }

  const port = parseInt(process.env.METRICS_PORT || '9090', 10);
  // Default to loopback so a one-flag `METRICS_ENABLED=true` doesn't
  // silently publish the endpoint to the whole network (finding L10).
  // Operators who scrape from another host set METRICS_HOST explicitly
  // — and should pair it with METRICS_AUTH_TOKEN (warned below).
  const host = process.env.METRICS_HOST || '127.0.0.1';
  const authToken = process.env.METRICS_AUTH_TOKEN || '';
  const path = process.env.METRICS_PATH || '/metrics';

  const loopback = host === '127.0.0.1' || host === '::1' || host === 'localhost';
  if (!authToken && !loopback) {
    console.warn(
      `[metrics] Listening on ${host}:${port} with NO METRICS_AUTH_TOKEN — the metrics endpoint is exposed unauthenticated beyond loopback. Set METRICS_AUTH_TOKEN or bind METRICS_HOST to 127.0.0.1.`
    );
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // Liveness probe — useful for orchestrators that hit the metrics port
    // for both health and scrape.
    if (req.url === '/healthz' || req.url === '/-/healthy') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }

    if (!req.url || (req.url.split('?')[0] !== path)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain', Allow: 'GET, HEAD' });
      res.end('Method Not Allowed');
      return;
    }

    if (authToken) {
      const header = req.headers.authorization || '';
      const presented = header.startsWith('Bearer ')
        ? header.slice('Bearer '.length).trim()
        : '';
      if (!presented || !safeCompare(presented, authToken)) {
        res.writeHead(401, {
          'Content-Type': 'text/plain',
          'WWW-Authenticate': 'Bearer realm="metrics"',
        });
        res.end('Unauthorized');
        return;
      }
    }

    try {
      const body = await getMetricsText();
      res.writeHead(200, {
        'Content-Type': registry.contentType,
        'Cache-Control': 'no-store',
      });
      if (req.method === 'HEAD') {
        res.end();
      } else {
        res.end(body);
      }
    } catch (err) {
      console.error('[metrics] scrape failed:', err);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  });

  server.on('error', (err) => {
    console.error(`[metrics] server error on ${host}:${port}:`, err);
  });

  server.listen(port, host, () => {
    console.log(
      `[metrics] Prometheus scrape endpoint listening on ${host}:${port}${path}` +
        (authToken ? ' (bearer-token required)' : '')
    );
  });

  // Hook into Nitro's shutdown so we don't leave the port hanging during
  // graceful restarts.
  nitroApp.hooks.hook('close', async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
