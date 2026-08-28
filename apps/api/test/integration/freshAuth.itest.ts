import { beforeAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { connectRedis, redis } from '../../redis/client';
import {
  clearFreshAuth,
  isFreshAuth,
  markFreshAuth,
} from '../../utils/twoFactor';

// The fresh-auth window, which eight routes use as a standalone gate.
//
// What this file can and cannot assert. `requireFreshAuth` takes an `H3Event`
// and reads the session id off it, and this suite has no HTTP layer — there is
// no way to construct "a freshly registered session" here. So the fact that
// REGISTERING opens the window is asserted end-to-end, in `tests/e2e/freshauth.mjs`,
// where a real registration produces a real cookie.
//
// What is pinned here is the contract `requireFreshAuth` reads through: the
// three primitives, their TTL, and the default. Those are what a caller depends
// on, and the default in particular is the one worth a test — `isFreshAuth`
// returning true for a session nobody stamped would silently open every gated
// route to every session.

const KEY = (sid: string) => `auth:fresh:${sid}`;

// The client is `lazyConnect` with `enableOfflineQueue: false` — a deliberate
// choice so a Redis outage fails a hot request fast instead of queueing it. The
// consequence for a test file is that the FIRST command has to wait for the
// connection rather than being buffered: without this, the first assertion here
// failed with "Stream isn't writeable", which reads like a broken test and is
// really an unconnected client. Other suites get away with it because they
// reach Redis through `getSetting`, which connects on the way past.
beforeAll(async () => {
  await connectRedis();
});

describe('the fresh-auth window', () => {
  it('is closed for a session nobody stamped', async () => {
    // The failure-open case. Worth its own test because it is the one that
    // would be catastrophic and silent.
    expect(await isFreshAuth(randomUUID())).toBe(false);
  });

  it('opens on a stamp and closes on a clear', async () => {
    const sid = randomUUID();
    await markFreshAuth(sid);
    expect(await isFreshAuth(sid)).toBe(true);
    await clearFreshAuth(sid);
    expect(await isFreshAuth(sid)).toBe(false);
  });

  it('expires on its own, and within ten minutes', async () => {
    // The window is a Redis TTL rather than a timestamp comparison, so nothing
    // in the application has to remember to close it. A stamp that never
    // expired would turn a ten-minute step-up into a permanent one.
    const sid = randomUUID();
    await markFreshAuth(sid);
    const ttl = await redis.ttl(KEY(sid));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(600);
    await clearFreshAuth(sid);
  });

  it('keys on the session, so one session cannot vouch for another', async () => {
    const mine = randomUUID();
    const theirs = randomUUID();
    await markFreshAuth(mine);
    expect(await isFreshAuth(theirs)).toBe(false);
    await clearFreshAuth(mine);
  });

  it('treats a hand-edited value as closed', async () => {
    // The stamp is a literal `'1'`, and the key is reachable by anyone with the
    // Redis connection. Anything else must read as "not fresh" rather than as
    // truthy.
    const sid = randomUUID();
    await redis.setex(KEY(sid), 60, 'yes');
    expect(await isFreshAuth(sid)).toBe(false);
    await redis.del(KEY(sid));
  });
});
