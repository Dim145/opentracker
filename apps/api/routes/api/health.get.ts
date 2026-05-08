/**
 * GET /api/health
 *
 * Public health probe used by load balancers / Caddy / k8s. Returns a
 * coarse `healthy | unhealthy` status with latency hints for the two
 * external dependencies (Postgres + Redis).
 *
 * Privacy: error *messages* from the underlying drivers (which can
 * contain hostnames, connection strings or driver internals) are
 * suppressed for anonymous callers and surfaced only when the request
 * carries an admin session. Anonymous callers see `error: 'unreachable'`
 * — enough to fire a probe alert without leaking infra detail.
 */
import { db } from '@trackarr/db';
import { redis } from '~~/utils/server';

export default defineEventHandler(async (event) => {
  const startTime = Date.now();

  // Best-effort admin detection — never throws. Plain users + anonymous
  // see redacted error messages; admins see the full driver output.
  let isAdmin = false;
  try {
    const session = await getUserSession(event);
    isAdmin = !!session?.user?.isAdmin;
  } catch {
    // No session, no problem
  }

  const checks: Record<
    string,
    { status: 'ok' | 'error'; latency?: number; error?: string }
  > = {};

  try {
    const dbStart = Date.now();
    await db.execute('SELECT 1');
    checks.postgres = { status: 'ok', latency: Date.now() - dbStart };
  } catch (error) {
    checks.postgres = {
      status: 'error',
      error: isAdmin
        ? error instanceof Error
          ? error.message
          : 'Unknown error'
        : 'unreachable',
    };
  }

  try {
    const redisStart = Date.now();
    await redis.ping();
    checks.redis = { status: 'ok', latency: Date.now() - redisStart };
  } catch (error) {
    checks.redis = {
      status: 'error',
      error: isAdmin
        ? error instanceof Error
          ? error.message
          : 'Unknown error'
        : 'unreachable',
    };
  }

  const allHealthy = Object.values(checks).every((c) => c.status === 'ok');
  setResponseStatus(event, allHealthy ? 200 : 503);

  return {
    status: allHealthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    totalLatency: Date.now() - startTime,
    checks,
  };
});
