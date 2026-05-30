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

export type SignedHeaders = Record<string, string>;

export function buildSignedHeaders(opts: {
  method: string;
  pathname: string;
  body: string;
  instanceId: string;
  privateKeyPem: string;
}): SignedHeaders {
  const date = new Date().toISOString();
  const digest = digestOf(opts.body);
  const signature = signPayload(
    opts.privateKeyPem,
    signingString(opts.method, opts.pathname, date, digest),
  );
  return {
    'content-type': 'application/json',
    'x-trackarr-instance': opts.instanceId,
    'x-trackarr-date': date,
    'x-trackarr-digest': digest,
    'x-trackarr-signature': signature,
  };
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
  timeoutMs?: number;
}): Promise<SignedResponse> {
  const bodyStr = JSON.stringify(opts.body ?? {});
  const headers = buildSignedHeaders({
    method: 'POST',
    pathname: opts.pathname,
    body: bodyStr,
    instanceId: opts.instanceId,
    privateKeyPem: opts.privateKeyPem,
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
    const text = await res.text();
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
  timeoutMs?: number;
}): Promise<SignedResponse> {
  const headers = buildSignedHeaders({
    method: 'GET',
    pathname: opts.pathname,
    body: '',
    instanceId: opts.instanceId,
    privateKeyPem: opts.privateKeyPem,
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
    const text = await res.text();
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
