/**
 * AWS Signature Version 4, the subset S3 object operations need.
 *
 * Why this is hand-rolled instead of `@aws-sdk/client-s3`:
 *
 *   - The API's Docker build installs with `--frozen-lockfile`, and the Nitro
 *     bundle inlines every dependency. The v3 S3 client plus its presigner
 *     pulls in ~90 packages for what, here, is four verbs against one bucket.
 *   - Nothing we do needs the parts that make the SDK worth its size:
 *     no multipart (the largest object is a 5 MB branding image), no
 *     cross-region redirect handling, no streaming checksums, no
 *     credential-provider chain — credentials come from `readSecret()` like
 *     every other secret in this codebase.
 *   - SigV4 for a single-shot request is a deterministic ~100 lines with an
 *     official test vector, which is a smaller thing to get wrong than a
 *     dependency upgrade path.
 *
 * The result is verified two ways: `test/storageSigv4.test.ts` checks the
 * canonical request and signature against AWS's published example, and the
 * driver was exercised against a real RustFS server (see
 * doc/guide/object-storage.md).
 */

import { createHash, createHmac } from 'crypto';

export const EMPTY_PAYLOAD_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const ALGORITHM = 'AWS4-HMAC-SHA256';

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  /** Present when the credentials came from STS / IRSA. */
  sessionToken?: string;
}

export interface SignRequestInput {
  method: string;
  /** Absolute request URL. Its path and query are canonicalised. */
  url: URL;
  /** Headers to sign. `host` is added from the URL if absent. */
  headers: Record<string, string>;
  /** Hex SHA-256 of the body, or `EMPTY_PAYLOAD_SHA256`. */
  payloadHash: string;
  region: string;
  service: string;
  credentials: SigV4Credentials;
  /** Injectable so the test can pin AWS's example timestamp. */
  date?: Date;
}

/**
 * RFC 3986 unreserved-set encoding, which is stricter than
 * `encodeURIComponent`: the latter leaves `!'()*` alone and AWS expects them
 * percent-encoded. Getting this wrong only shows up on keys containing those
 * characters, which is exactly the kind of bug that hides for a year.
 */
export function uriEncode(value: string, encodeSlash = true): string {
  const encoded = encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return encodeSlash ? encoded : encoded.replace(/%2F/g, '/');
}

/** Percent-encode a key for use as a URL path, keeping `/` as a separator. */
export function encodeObjectPath(key: string): string {
  return key
    .split('/')
    .map((segment) => uriEncode(segment))
    .join('/');
}

function hexSha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

/** `20130524T000000Z` and `20130524`, the two forms SigV4 wants. */
function formatDate(date: Date): { amzDate: string; dateStamp: string } {
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

export function buildCanonicalRequest(input: {
  method: string;
  url: URL;
  headers: Record<string, string>;
  payloadHash: string;
}): { canonicalRequest: string; signedHeaders: string } {
  // The path arrives already percent-encoded (the driver built it with
  // `encodeObjectPath`), so it is canonical as-is. `url.pathname` is what
  // will actually be sent, which is the property that matters: signing a
  // different string than the wire carries is the classic SigV4 failure.
  const canonicalUri = input.url.pathname || '/';

  const params = [...input.url.searchParams.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  );
  const canonicalQuery = params
    .map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`)
    .join('&');

  const normalized = Object.entries(input.headers)
    .map(([name, value]) => [
      name.toLowerCase(),
      // Sequential spaces collapse and the value is trimmed, per the spec.
      String(value).trim().replace(/\s+/g, ' '),
    ])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const canonicalHeaders =
    normalized.map(([n, v]) => `${n}:${v}\n`).join('') || '';
  const signedHeaders = normalized.map(([n]) => n).join(';');

  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join('\n');

  return { canonicalRequest, signedHeaders };
}

export function deriveSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string
): Buffer {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

/**
 * Sign a request and return the complete header set to send — the caller's
 * headers plus `host`, `x-amz-date`, `x-amz-content-sha256`, the optional
 * security token, and `Authorization`.
 */
export function signRequest(input: SignRequestInput): Record<string, string> {
  const { amzDate, dateStamp } = formatDate(input.date ?? new Date());
  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;

  // Only what SigV4 itself mandates is added here. `x-amz-content-sha256` is
  // an S3 requirement rather than a signing one, so the driver sets it — which
  // is also what lets the AWS-published IAM test vector run through this
  // function unmodified.
  const headers: Record<string, string> = {
    ...input.headers,
    host: input.url.host,
    'x-amz-date': amzDate,
  };
  if (input.credentials.sessionToken) {
    headers['x-amz-security-token'] = input.credentials.sessionToken;
  }

  const { canonicalRequest, signedHeaders } = buildCanonicalRequest({
    method: input.method,
    url: input.url,
    headers,
    payloadHash: input.payloadHash,
  });

  const stringToSign = [
    ALGORITHM,
    amzDate,
    scope,
    hexSha256(canonicalRequest),
  ].join('\n');

  const signature = createHmac(
    'sha256',
    deriveSigningKey(
      input.credentials.secretAccessKey,
      dateStamp,
      input.region,
      input.service
    )
  )
    .update(stringToSign, 'utf8')
    .digest('hex');

  headers.authorization =
    `${ALGORITHM} Credential=${input.credentials.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return headers;
}

export { hexSha256 };
