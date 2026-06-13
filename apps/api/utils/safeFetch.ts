/**
 * Hardened `fetch` for any HTTP call where the URL is operator- /
 * user-controlled (notification channel destinations, future
 * metadata-source URLs, …).
 *
 * Closes the standard SSRF surface that a bare `fetch()` leaves
 * open:
 *
 *   1. Resolves the hostname through `dns.lookup({ all: true })`
 *      and refuses any result that lands in a private / loopback /
 *      link-local / metadata / CGNAT range. Both IPv4 and IPv6 are
 *      checked (including the `::ffff:` IPv4-mapped form, the
 *      `fc00::/7` unique-local block, `fe80::/10` link-local).
 *   2. Disables automatic redirect following (`redirect: 'manual'`).
 *      Every hop is re-resolved + re-validated through the same
 *      gate, so a public host can't 30x us at `169.254.169.254` or
 *      `localhost`.
 *   3. Caps the redirect chain at `maxRedirects` (default 5) so a
 *      malicious upstream can't ping-pong us indefinitely.
 *
 * Known limitation — DNS rebinding race: between the lookup and
 * the actual TCP connect (Node's undici opens its own resolver), a
 * DNS server can hand us a different answer. The race window is
 * sub-millisecond and shrinks the SSRF surface from "trivially
 * exploitable" to "needs a DNS server you control + cooperating
 * timing". Acceptable for an operator-curated webhook target; if
 * we ever expose this on user-supplied URLs without admin review
 * (we don't today), revisit.
 */
import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';

export interface SafeFetchOptions extends RequestInit {
  maxRedirects?: number;
}

/**
 * Operator-declared hosts allowed to bypass the private/loopback range block.
 *
 * The SSRF guard refuses private/loopback/link-local targets, which also
 * blocks legitimate federation with a peer reachable only over a private
 * network — a LAN, a VPN (Tailscale/WireGuard), or a docker-compose service
 * name. `SAFE_FETCH_ALLOW_HOSTS` is a comma-separated list of EXACT hostnames
 * (the URL host, e.g. `b-api` or `tracker.internal`) that skip the range
 * check. Empty by default, so the SSRF posture is unchanged unless an operator
 * explicitly opts specific, trusted peers in. Match is on the literal host, so
 * a DNS-rebinding answer for a *different* host is still blocked.
 */
const ALLOWED_HOSTS = new Set(
  (process.env.SAFE_FETCH_ALLOW_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
);

/**
 * IPv4 ranges that should never see outbound traffic from an
 * SSRF-hardened fetch. Order is most-frequent first for the cheap
 * fast paths.
 *
 *   - `0.0.0.0/8`      — "this network" wildcard
 *   - `127.0.0.0/8`    — loopback
 *   - `10.0.0.0/8`     — RFC 1918 private
 *   - `100.64.0.0/10`  — CGNAT (RFC 6598)
 *   - `169.254.0.0/16` — link-local (AWS / GCP / Azure metadata!)
 *   - `172.16.0.0/12`  — RFC 1918 private
 *   - `192.0.0.0/24`   — IETF protocol assignments
 *   - `192.0.2.0/24`   — TEST-NET-1
 *   - `192.168.0.0/16` — RFC 1918 private
 *   - `198.18.0.0/15`  — benchmark
 *   - `198.51.100.0/24`— TEST-NET-2
 *   - `203.0.113.0/24` — TEST-NET-3
 *   - `224.0.0.0/4`    — multicast (also catches reserved + broadcast)
 */
function isBlockedIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)
  ) {
    return true; // malformed → fail closed
  }
  const [a, b, c] = parts as [number, number, number, number];
  if (a === 0) return true;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  return false;
}

/**
 * Fully expand an IPv6 literal into its 8 16-bit groups, so range checks
 * operate on numeric prefixes rather than fragile text patterns. Handles
 * `::` compression, an embedded IPv4 tail (`::ffff:1.2.3.4`), and a `%zone`
 * suffix. Returns null on anything malformed → caller fails closed.
 *
 * This replaces the previous text-pattern approach, which only matched the
 * dotted-decimal IPv4-mapped form (`::ffff:127.0.0.1`) and let the
 * hex-grouped form (`::ffff:7f00:1`) — and every real `fe80::…` literal —
 * slip through as "not blocked" (full SSRF bypass).
 */
function expandIPv6(input: string): number[] | null {
  let v = input.toLowerCase();
  const pct = v.indexOf('%');
  if (pct !== -1) v = v.slice(0, pct); // strip zone id
  // Embedded IPv4 tail → fold into two hex groups.
  const v4m = v.match(/^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4m) {
    const o = v4m[2]!.split('.').map(Number);
    if (o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    v = `${v4m[1]}${(((o[0]! << 8) | o[1]!) >>> 0).toString(16)}:${(((o[2]! << 8) | o[3]!) >>> 0).toString(16)}`;
  }
  const parts = v.split('::');
  if (parts.length > 2) return null;
  const head = parts[0] === '' ? [] : parts[0]!.split(':');
  const tail = parts.length === 2 ? (parts[1] === '' ? [] : parts[1]!.split(':')) : [];
  let groups: string[];
  if (parts.length === 1) {
    groups = head;
  } else {
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null; // `::` must stand for at least one zero group
    groups = [...head, ...Array(missing).fill('0'), ...tail];
  }
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) {
    return null;
  }
  return groups.map((g) => parseInt(g, 16));
}

/**
 * IPv6 range check on the expanded numeric form.
 *   - `::/128` / `::1/128`  — unspecified + loopback
 *   - `::ffff:x.x.x.x` / `::x.x.x.x` — IPv4-mapped/compatible → IPv4 check
 *   - `fc00::/7`            — unique-local
 *   - `fe80::/10`           — link-local
 *   - `ff00::/8`            — multicast
 *   - `64:ff9b::/96`        — NAT64 (indirect path to private IPv4)
 * Malformed input fails closed (blocked).
 */
function isBlockedIPv6(ip: string): boolean {
  const g = expandIPv6(ip);
  if (!g) return true; // fail closed
  // IPv4-mapped (::ffff:a.b.c.d) / IPv4-compatible (::a.b.c.d): low 32 bits
  // are an IPv4 address — but `::`/`::1` themselves are handled separately.
  const lowIsV4Holder =
    g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 &&
    (g[5] === 0xffff || g[5] === 0);
  const isUnspecOrLoopback =
    g[5] === 0 && g[6] === 0 && (g[7] === 0 || g[7] === 1);
  if (lowIsV4Holder && !isUnspecOrLoopback) {
    const v4 = `${(g[6]! >> 8) & 0xff}.${g[6]! & 0xff}.${(g[7]! >> 8) & 0xff}.${g[7]! & 0xff}`;
    return isBlockedIPv4(v4);
  }
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  const first = g[0]!;
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8
  if (first === 0x0064 && g[1] === 0xff9b) return true; // 64:ff9b::/96
  return false;
}

function isBlockedAddress(address: string, family: number): boolean {
  return family === 6 ? isBlockedIPv6(address) : isBlockedIPv4(address);
}

/**
 * Synchronous range check on an IP literal: true for private / loopback /
 * link-local / CGNAT / metadata / etc. ranges (and for any non-IP string).
 * Used to filter peer IPs before exposing or relaying them over federation.
 */
export function isBlockedIp(ip: string): boolean {
  const fam = isIP(ip);
  if (!fam) return true; // not a valid IP literal → treat as unsafe
  return isBlockedAddress(ip, fam);
}

/**
 * Resolve a hostname through DNS and verify EVERY answer falls
 * outside the blocked ranges above. Throws a SafeFetchError on
 * any blocked address — caller treats the URL as off-limits.
 *
 * An IP literal short-circuits the DNS step but still goes through
 * the range check.
 */
export async function validateHost(hostname: string): Promise<void> {
  // Operator-trusted peer (private LAN/VPN/docker host) — skip the range gate.
  if (ALLOWED_HOSTS.has(hostname.toLowerCase())) return;
  const literal = isIP(hostname);
  if (literal) {
    if (isBlockedAddress(hostname, literal)) {
      throw new SafeFetchError(
        `Refused: ${hostname} is in a private / loopback / link-local range`
      );
    }
    return;
  }
  let answers: Array<{ address: string; family: number }>;
  try {
    answers = await dns.lookup(hostname, { all: true });
  } catch (err) {
    throw new SafeFetchError(
      `DNS resolution failed for ${hostname}: ${(err as Error).message}`
    );
  }
  if (answers.length === 0) {
    throw new SafeFetchError(`DNS returned no addresses for ${hostname}`);
  }
  for (const ans of answers) {
    if (isBlockedAddress(ans.address, ans.family)) {
      throw new SafeFetchError(
        `Refused: ${hostname} resolves to a blocked address (${ans.address})`
      );
    }
  }
}

export class SafeFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SafeFetchError';
  }
}

/**
 * Hardened replacement for `fetch()` whenever the URL is user-
 * controlled. The contract matches `fetch` minus automatic redirect
 * handling — we resolve manually and re-validate every hop.
 */
export async function safeFetch(
  input: string,
  init?: SafeFetchOptions
): Promise<Response> {
  const maxRedirects = init?.maxRedirects ?? 5;
  // Strip the option so it doesn't leak into RequestInit.
  const { maxRedirects: _drop, ...fetchInit } = init ?? {};

  let url = input;
  let method = (fetchInit.method ?? 'GET').toUpperCase();
  let body = fetchInit.body;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new SafeFetchError('Invalid URL');
    }
    if (!/^https?:$/.test(parsed.protocol)) {
      throw new SafeFetchError(`Unsupported protocol: ${parsed.protocol}`);
    }
    await validateHost(parsed.hostname);

    const res = await fetch(url, {
      ...fetchInit,
      method,
      body,
      // Manual mode so we get a chance to re-validate every hop.
      redirect: 'manual',
    });

    // `redirect: 'manual'` makes fetch return the bare 3xx; not a
    // synthetic "opaqueredirect" like the browser version.
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return res; // weird, but defer to caller
      // Resolve against the current URL so relative paths work.
      url = new URL(loc, url).toString();
      // RFC 7231 §6.4.4 — 303 redirects always become GET. 301/302
      // historically did the same in browsers for POST→GET; we
      // follow that for safety + sanity (a webhook POST 30x'd to a
      // login form shouldn't replay the body).
      if (res.status === 303 || method === 'POST') {
        method = 'GET';
        body = undefined;
      }
      continue;
    }
    return res;
  }
  throw new SafeFetchError(`Too many redirects (>${maxRedirects})`);
}
