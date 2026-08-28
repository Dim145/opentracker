/**
 * Shared bits for the scenarios: an HTTP caller with a cookie jar, a check
 * counter, and a way for a scenario to clear the rate-limit counters on the
 * stack it owns.
 */
import { connect } from 'node:net';
import { readFileSync } from 'node:fs';

export const API = process.env.E2E_API ?? 'http://localhost:54000';
export const WEB = process.env.E2E_WEB ?? 'http://localhost:53000';
const REDIS_PORT = Number(process.env.E2E_REDIS_PORT ?? 56379);
const REDIS_PASSWORD = process.env.E2E_REDIS_PASSWORD ?? 'e2e-redis-password';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Sessions written by `seed.mjs`. */
export function sessions(required = []) {
  const s = JSON.parse(
    readFileSync(new URL('./session.json', import.meta.url), 'utf8'),
  );
  for (const who of required) {
    if (!s[who]?.cookie) {
      console.error(`no session for "${who}" — check the seeding output above`);
      process.exit(1);
    }
  }
  return s;
}

// ── Rate limits ──────────────────────────────────────────────────────
//
// A scenario makes a burst of admin writes in a few seconds, which is exactly
// the shape the `mutation` limiter exists to stop: ten per minute, with a
// progressive penalty that pushes the retry-after into the hundreds of seconds
// once tripped. The scenarios stay subject to that middleware — they do not
// disable it and they do not run against a relaxed build — but between PHASES
// they clear their own stack's counters, the same way a fixture resets a
// database between tests. It is a throwaway stack the harness created and will
// destroy; there is no such switch in production.
//
// Spoken straight to Redis over RESP rather than through a client library, to
// keep this harness dependency-free.

function resp(...args) {
  return (
    `*${args.length}\r\n` +
    args.map((a) => `$${Buffer.byteLength(String(a))}\r\n${a}\r\n`).join('')
  );
}

/**
 * Delete the fresh-auth stamps, making every session stale.
 *
 * `requireFreshAuth` gives a session ten minutes after login, so a scenario
 * cannot reach the refusal path by waiting. Clearing the stamp is the precise
 * equivalent and keeps the middleware itself in play — the route still asks, the
 * answer is just no.
 */
export function expireFreshAuth() {
  return sweepKeys(['ot:auth:fresh:*']);
}

/** Delete the rate-limit and ban keys. Resolves even if Redis is unreachable. */
export function resetRateLimits() {
  // `keys` inside EVAL is fine on a test database and saves a SCAN loop.
  return sweepKeys(['ot:ratelimit:*', 'ot:sec:ipban:*'], ['ot:ddos:blacklist']);
}

/** One EVAL to delete by pattern, plus optional exact keys. */
function sweepKeys(patterns, exact = []) {
  const sweep =
    "local n=0 for _,p in ipairs(ARGV) do local k=redis.call('keys',p) " +
    "for i=1,#k do redis.call('del',k[i]) n=n+1 end end return n";

  return new Promise((resolve) => {
    const sock = connect({ host: '127.0.0.1', port: REDIS_PORT });
    let out = '';
    const done = (v) => {
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(3000, () => done(null));
    sock.on('error', () => done(null));
    sock.on('connect', () => {
      sock.write(resp('AUTH', REDIS_PASSWORD));
      sock.write(resp('EVAL', sweep, 0, ...patterns));
      sock.write(resp('DEL', ...(exact.length ? exact : ['ot:__noop__'])));
    });
    sock.on('data', (b) => {
      out += b.toString();
      // AUTH +OK, EVAL :n, DEL :n — three replies is the whole conversation.
      if (out.split('\r\n').filter(Boolean).length >= 3) done(out);
    });
  });
}

// ── Checks ───────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;
const failures = [];

export function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

export function report() {
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

// ── HTTP ─────────────────────────────────────────────────────────────

export function caller(S) {
  return async function req(who, path, { method = 'GET', body, base = API } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(who ? { cookie: S[who].cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, body: json, headers: res.headers };
  };
}
