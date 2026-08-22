/**
 * HTTP message signatures for federation server-to-server requests.
 *
 * Every S2S call carries four headers:
 *   x-trackarr-instance   — sender instanceId (the keyId to look up)
 *   x-trackarr-date       — ISO timestamp, anti-replay window
 *   x-trackarr-digest     — sha256=<base64> of the raw body, binds it
 *   x-trackarr-signature  — Ed25519 over the canonical signing string
 *
 * Signing string (newline-joined, order fixed):
 *   METHOD \n PATHNAME \n DATE \n DIGEST
 *
 * The receiver re-derives the digest from the bytes it actually read,
 * checks the clock window, looks the sender up in its allow-list (or, on
 * the very first handshake, trusts the body-supplied key — TOFU), and
 * verifies the signature against that public key. A wrong key, a tampered
 * body, or a stale timestamp all fail closed.
 *
 * Outbound calls go through `safeFetch` so a partner URL can't be used to
 * pivot at an internal address (SSRF).
 */
import { createHash } from 'node:crypto';
import { safeFetch } from '../safeFetch';
import { signPayload, verifyPayload } from './keys';

/** Accept timestamps within ±5 min of now. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

function digestOf(body: string): string {
  return 'sha256=' + createHash('sha256').update(body, 'utf8').digest('base64');
}

function signingString(
  method: string,
  pathname: string,
  date: string,
  digest: string,
): string {
  return `${method.toUpperCase()}\n${pathname}\n${date}\n${digest}`;
}

/**
 * Signing string v2 — same fields plus the AUDIENCE, i.e. the instanceId of
 * the partner the request is addressed to.
 *
 * v1 binds the method, the path, the clock and the body, but says nothing
 * about *who the request was for*. A signed request received by peer B can
 * therefore be replayed verbatim to peer C within the ±5 min window, as long
 * as C also trusts the sender — the anti-replay nonce store is local to each
 * instance, so C has never seen it. The impact is modest (the scoped
 * endpoints are reads the sender is already entitled to), but binding the
 * audience is the standard fix and RFC 9421 names the same component
 * (`@authority`).
 *
 * Rolled out without a flag day: the sender emits BOTH signatures, the
 * receiver prefers v2 when present. Until every peer in a mesh emits v2, an
 * attacker can still strip the v2 header and downgrade to v1 — which is why
 * `FEDERATION_REQUIRE_AUDIENCE=true` exists. Turn it on once all partners run
 * this version or newer; after that a v1-only request is refused.
 */
function signingStringV2(
  method: string,
  pathname: string,
  date: string,
  digest: string,
  audience: string,
): string {
  return `${method.toUpperCase()}\n${pathname}\n${date}\n${digest}\n${audience}`;
}

/** Refuse a request that carries only the audience-less v1 signature. */
const REQUIRE_AUDIENCE = process.env.FEDERATION_REQUIRE_AUDIENCE === 'true';

export type SignedHeaders = Record<string, string>;

export function buildSignedHeaders(opts: {
  method: string;
  pathname: string;
  body: string;
  instanceId: string;
  privateKeyPem: string;
  /** Recipient's instanceId. Unknown during the handshake, which is the one
   *  exchange that bootstraps it — v1 only there. */
  audienceInstanceId?: string;
}): SignedHeaders {
  const date = new Date().toISOString();
  const digest = digestOf(opts.body);
  const headers: SignedHeaders = {
    'content-type': 'application/json',
    'x-trackarr-instance': opts.instanceId,
    'x-trackarr-date': date,
    'x-trackarr-digest': digest,
    'x-trackarr-signature': signPayload(
      opts.privateKeyPem,
      signingString(opts.method, opts.pathname, date, digest),
    ),
  };
  if (opts.audienceInstanceId) {
    headers['x-trackarr-signature-v2'] = signPayload(
      opts.privateKeyPem,
      signingStringV2(
        opts.method,
        opts.pathname,
        date,
        digest,
        opts.audienceInstanceId,
      ),
    );
  }
  return headers;
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
  /** Sender instanceId from the header, present even on some failures
   *  so the caller can log who tried. */
  instanceId?: string;
}

/**
 * Verify an inbound signed request against a known public key.
 * `rawBody` MUST be the exact bytes the digest was computed over.
 */
export function verifySignedRequest(opts: {
  method: string;
  pathname: string;
  rawBody: string;
  headers: Record<string, string | undefined>;
  publicKeyPem: string;
  /** OUR instanceId. Never read from the request — the audience is only
   *  meaningful because the receiver supplies it from its own config. */
  expectedAudience?: string;
}): VerifyResult {
  const instanceId = opts.headers['x-trackarr-instance'];
  const date = opts.headers['x-trackarr-date'];
  const digest = opts.headers['x-trackarr-digest'];
  const signature = opts.headers['x-trackarr-signature'];

  if (!instanceId || !date || !digest || !signature) {
    return { ok: false, reason: 'missing signature headers', instanceId };
  }
  const ts = Date.parse(date);
  if (Number.isNaN(ts) || Math.abs(Date.now() - ts) > CLOCK_SKEW_MS) {
    return { ok: false, reason: 'stale or invalid date', instanceId };
  }
  if (digestOf(opts.rawBody) !== digest) {
    return { ok: false, reason: 'digest mismatch', instanceId };
  }
  const signatureV2 = opts.headers['x-trackarr-signature-v2'];

  if (signatureV2 && opts.expectedAudience) {
    const valid = verifyPayload(
      opts.publicKeyPem,
      signingStringV2(
        opts.method,
        opts.pathname,
        date,
        digest,
        opts.expectedAudience,
      ),
      signatureV2,
    );
    // A v2 signature that does not verify is a hard failure, never a reason
    // to fall back to v1: that fallback would be the downgrade itself.
    if (!valid) {
      return { ok: false, reason: 'bad signature (audience)', instanceId };
    }
    return { ok: true, instanceId };
  }

  if (REQUIRE_AUDIENCE) {
    return {
      ok: false,
      reason: 'audience-bound signature required (FEDERATION_REQUIRE_AUDIENCE)',
      instanceId,
    };
  }

  const valid = verifyPayload(
    opts.publicKeyPem,
    signingString(opts.method, opts.pathname, date, digest),
    signature,
  );
  if (!valid) return { ok: false, reason: 'bad signature', instanceId };
  return { ok: true, instanceId };
}

export interface SignedResponse {
  status: number;
  data: any;
}

/**
 * How much of a partner's response we will read into memory.
 *
 * `res.text()` is unbounded: a hostile — or merely buggy — partner can answer
 * with a multi-gigabyte stream and the only thing standing between that and an
 * out-of-memory crash is the abort timeout, which on a fast link is far too
 * late. A reconcile answer is a few hundred KB, a records batch of 200 is a
 * megabyte or two; 16 MB is orders of magnitude above either and still a hard
 * ceiling. Over it, the read aborts and the caller sees a thrown error, mapped
 * to the peer's `last_error` like any other failed exchange.
 */
export const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

/**
 * Read a response body, refusing to buffer more than `MAX_RESPONSE_BYTES`.
 *
 * Reads the stream in chunks and counts bytes rather than trusting
 * `Content-Length`, which a peer controls and may omit (a chunked response
 * carries none at all). No body — a bare status — reads as the empty string.
 */
export async function readCappedText(res: { body: ReadableStream<Uint8Array> | null; text: () => Promise<string> }): Promise<string> {
  const stream = res.body;
  if (!stream) return res.text();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
          throw new Error('peer response exceeds size limit');
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

/**
 * Signed POST to a partner instance. JSON in, JSON out. Hardened against
 * SSRF (safeFetch) and hangs (AbortController timeout). Network / parse
 * failures surface as a thrown error for the caller to map to a peer
 * `last_error`.
 */
export async function signedPost(opts: {
  baseUrl: string;
  pathname: string;
  body: unknown;
  instanceId: string;
  privateKeyPem: string;
  audienceInstanceId?: string;
  timeoutMs?: number;
}): Promise<SignedResponse> {
  const bodyStr = JSON.stringify(opts.body ?? {});
  const headers = buildSignedHeaders({
    method: 'POST',
    pathname: opts.pathname,
    body: bodyStr,
    instanceId: opts.instanceId,
    privateKeyPem: opts.privateKeyPem,
    audienceInstanceId: opts.audienceInstanceId,
  });
  const url = new URL(opts.pathname, opts.baseUrl).toString();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await safeFetch(url, {
      method: 'POST',
      headers,
      body: bodyStr,
      signal: controller.signal,
    });
    const text = await readCappedText(res);
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    return { status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Signed GET to a partner instance. The `pathname` MUST include the query
 * string — it's signed verbatim so a man-in-the-middle can't tamper with
 * the params. The receiver verifies against its own request path. Empty
 * body → the digest covers the empty string.
 */
export async function signedGet(opts: {
  baseUrl: string;
  pathname: string;
  instanceId: string;
  privateKeyPem: string;
  /** Recipient's instanceId, forwarded to `buildSignedHeaders` for the v2
   *  audience binding. Every caller already passed it; the type did not
   *  declare it, so nothing checked that they kept doing so. */
  audienceInstanceId?: string;
  timeoutMs?: number;
}): Promise<SignedResponse> {
  const headers = buildSignedHeaders({
    method: 'GET',
    pathname: opts.pathname,
    body: '',
    instanceId: opts.instanceId,
    privateKeyPem: opts.privateKeyPem,
    audienceInstanceId: opts.audienceInstanceId,
  });
  const url = new URL(opts.pathname, opts.baseUrl).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  try {
    const res = await safeFetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    const text = await readCappedText(res);
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    return { status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}
