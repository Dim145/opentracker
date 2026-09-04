/**
 * Shared bits for the scenarios: an HTTP caller with a cookie jar, a check
 * counter, and a way for a scenario to clear the rate-limit counters on the
 * stack it owns.
 */
import { connect } from 'node:net';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const API = process.env.E2E_API ?? 'http://localhost:54000';
export const WEB = process.env.E2E_WEB ?? 'http://localhost:53000';
/** The static SPA shape of the same application. See the `spa` service. */
export const SPA = process.env.E2E_SPA ?? 'http://localhost:53001';
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
  //
  // `ot:ddos:detect:*` matters as much as the blacklist itself. The flood
  // detector counts every `/api/` request per IP over a ten-second window and
  // blacklists at 100 — and this harness fires requests back to back with no
  // think time, so a long scenario reaches that in a way no human admin does.
  // Clearing only `ot:ddos:blacklist` un-blocks the IP while leaving the
  // counter that just blacklisted it sitting at 100, so the very next request
  // blacklists it again. The counter expires on its own after ten seconds,
  // which is why that bug looked like flakiness rather than a reset that does
  // not reset.
  return sweepKeys(
    ['ot:ratelimit:*', 'ot:sec:ipban:*', 'ot:ddos:detect:*'],
    ['ot:ddos:blacklist'],
  );
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

// ── Le tracker ───────────────────────────────────────────────────────
//
// Aucun scénario n'annonce, mais deux scripts de remplissage le font, et une
// deuxième copie de ces trente lignes aurait dérivé de la première. Le tracker
// est un service de la pile depuis que `docker-compose.yml` le monte.

export const TRACKER = process.env.E2E_TRACKER ?? 'http://localhost:54200';

/**
 * Percent-encodage des octets bruts.
 *
 * `info_hash` et `peer_id` sont vingt octets binaires sur le fil, pas du
 * texte : `encodeURIComponent` les corromprait en les traitant comme de
 * l'UTF-8.
 */
export function pctEncodeBytes(buf) {
  let s = '';
  for (const b of buf) {
    const unreserved =
      (b >= 0x30 && b <= 0x39) ||
      (b >= 0x41 && b <= 0x5a) ||
      (b >= 0x61 && b <= 0x7a) ||
      b === 0x2d ||
      b === 0x2e ||
      b === 0x5f ||
      b === 0x7e;
    s += unreserved ? String.fromCharCode(b) : `%${b.toString(16).padStart(2, '0')}`;
  }
  return s;
}

/**
 * Un peer_id crédible, et STABLE pour une même graine.
 *
 * Le préfixe compte : `anticheat.Inspect` lève un drapeau quand un pair
 * téléverse sous un préfixe BEP 20 inconnu ET un User-Agent qui ne ressemble
 * à rien. On annonce donc comme qBittorrent, ce qui est aussi ce que fait un
 * vrai pair.
 *
 * La stabilité est ce qui rend les scripts rejouables : la même graine
 * réannonce le MÊME pair, donc l'essaim ne double pas à chaque relance.
 */
export function peerIdFor(seed) {
  return Buffer.concat([
    Buffer.from('-qB4650-', 'ascii'),
    createHash('sha1').update(seed).digest().subarray(0, 12),
  ]);
}

/**
 * Une annonce, telle qu'un client l'émet.
 *
 * Renvoie `{ status, failure, text }`. `failure` est renseigné quand le
 * tracker répond un échec — ce qu'il fait en bencode AVEC un 200
 * (`d14:failure reason…e`), donc un appelant qui ne regarde que le code HTTP
 * compte ses refus comme des réussites.
 */
export async function announce(
  passkey,
  infoHashHex,
  seed,
  { left, uploaded = 0, downloaded = 0, event, port = 6881 },
) {
  const q = [
    `passkey=${passkey}`,
    `info_hash=${pctEncodeBytes(Buffer.from(infoHashHex, 'hex'))}`,
    `peer_id=${pctEncodeBytes(peerIdFor(seed))}`,
    `port=${port}`,
    `uploaded=${uploaded}`,
    `downloaded=${downloaded}`,
    `left=${left}`,
    'compact=1',
    'numwant=50',
    ...(event ? [`event=${event}`] : []),
  ].join('&');
  const res = await fetch(`${TRACKER}/announce?${q}`, {
    headers: { 'user-agent': 'qBittorrent/4.6.5' },
  });
  const text = await res.text();
  const at = text.indexOf('14:failure reason');
  const failure = at < 0 ? null : text.slice(at + 17).replace(/^\d+:/, '').slice(0, 70);
  return { status: res.status, failure, text: text.slice(0, 120) };
}

/** La passkey d'annonce d'un membre, par le même appel que la page /me. */
export async function passkeyOf(cookie) {
  const res = await fetch(`${API}/api/auth/passkey`, { headers: { cookie } });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  return body?.passkey ?? null;
}
