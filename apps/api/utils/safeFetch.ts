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
 * IPv6 blocks. We compare against the lowercase canonical form
 * (Node's `dns.lookup` returns the canonical text).
 *
 *   - `::1/128` / `::/128` — loopback + unspecified
 *   - `fc00::/7`           — unique local (first byte fc or fd)
 *   - `fe80::/10`          — link-local (first byte fe + bits 8/9/a/b)
 *   - `ff00::/8`           — multicast
 *   - `::ffff:x.x.x.x`     — IPv4-mapped; delegate to the IPv4 check
 *   - `64:ff9b::/96`       — NAT64 — block to avoid an indirect path
 *                            into a private IPv4 destination
 */
function isBlockedIPv6(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === '::1' || v === '::' || v === '0:0:0:0:0:0:0:1' || v === '0:0:0:0:0:0:0:0') {
    return true;
  }
  // IPv4-mapped — strip the `::ffff:` prefix and check as IPv4.
  const mapped = v.match(/^(?:0:0:0:0:0:ffff|::ffff):([0-9.]+)$/);
  if (mapped) return isBlockedIPv4(mapped[1]!);
  // NAT64 well-known prefix.
  if (v.startsWith('64:ff9b:') || v.startsWith('64:ff9b::')) return true;
  // Loopback / link-local / unique-local / multicast.
  if (/^fe[89ab]:/.test(v)) return true; // fe80::/10
  if (/^f[cd]/.test(v)) return true;     // fc00::/7
  if (v.startsWith('ff')) return true;   // ff00::/8 multicast
  return false;
}

function isBlockedAddress(address: string, family: number): boolean {
  return family === 6 ? isBlockedIPv6(address) : isBlockedIPv4(address);
}

/**
 * Resolve a hostname through DNS and verify EVERY answer falls
 * outside the blocked ranges above. Throws a SafeFetchError on
 * any blocked address — caller treats the URL as off-limits.
 *
 * An IP literal short-circuits the DNS step but still goes through
 * the range check.
 */
async function validateHost(hostname: string): Promise<void> {
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
