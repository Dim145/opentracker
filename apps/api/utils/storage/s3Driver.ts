/**
 * The S3 driver — any S3-compatible object store: AWS S3, RustFS, MinIO,
 * Ceph RGW, Garage, R2, Backblaze B2.
 *
 * It exists so that more than one API replica can serve the same uploads
 * without a ReadWriteMany volume underneath them. See doc/guide/scaling.md.
 *
 * ## Reads stream through the API; they are not presigned redirects
 *
 * Both were on the table. Streaming won, for three reasons that are specific
 * to this application rather than general preferences:
 *
 *  1. **The store is usually not reachable by the browser.** The whole point
 *     of the Helm wiring is an in-cluster RustFS on a ClusterIP Service. A
 *     302 to `http://trackarr-rustfs-svc:9000/...` resolves to nothing from
 *     the visitor's machine. Making redirects work would mean publishing the
 *     object store on its own public hostname with its own TLS — a second
 *     ingress and a second certificate, to save the API from copying 40 KB.
 *  2. **The response headers are a security control.** `/uploads/*` can serve
 *     an admin-uploaded SVG, and the routes answer with
 *     `X-Content-Type-Options: nosniff` plus a `default-src 'none'; sandbox`
 *     CSP precisely so a hostile SVG cannot execute if someone opens the file
 *     URL directly. Redirect to the object store and those headers come from
 *     the object store instead — which will not set them.
 *  3. **Auth stays where it is.** Today the routes are open, but a private
 *     tracker gating uploads behind a session is a plausible next step, and a
 *     presigned URL is a bearer token that outlives the request: shareable,
 *     un-revocable until it expires, and invisible to the API.
 *
 * The cost is real and small: the bytes cross the API. These are branding
 * images capped at 5 MB with a one-year immutable `Cache-Control`, so the
 * traffic is a rounding error next to announces.
 *
 * ## Not `safeFetch`
 *
 * `utils/safeFetch.ts` refuses private and loopback addresses, which is right
 * for URLs a *member* supplies. The S3 endpoint is operator configuration, and
 * an in-cluster object store is a private address by definition — routing
 * these calls through safeFetch would block every sane deployment. Plain
 * `fetch` with a timeout is correct here.
 */

import { normalizePrefix, redactUrl } from './keys';
import {
  EMPTY_PAYLOAD_SHA256,
  encodeObjectPath,
  hexSha256,
  signRequest,
  type SigV4Credentials,
} from './sigv4';
import type { ObjectStorage, StoredObject } from './types';

export interface S3StorageConfig {
  /** e.g. `https://s3.eu-west-3.amazonaws.com` or `http://rustfs-svc:9000`. */
  endpoint: string;
  region: string;
  bucket: string;
  credentials: SigV4Credentials;
  /**
   * Path-style (`endpoint/bucket/key`) rather than virtual-hosted
   * (`bucket.endpoint/key`). Required by MinIO, RustFS and Ceph RGW unless
   * they have been given a wildcard DNS domain; AWS deprecated it but still
   * serves it.
   */
  forcePathStyle: boolean;
  /** Optional key prefix, so one bucket can hold more than one thing. */
  prefix: string;
  /** Create the bucket on the first write if it is missing. */
  createBucket: boolean;
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
}

/** Errors we raise ourselves carry the S3 error code when there was one. */
export class S3StorageError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string
  ) {
    super(message);
    this.name = 'S3StorageError';
  }
}

/** Pull `<Code>NoSuchBucket</Code>` out of an S3 error document. */
function parseErrorCode(body: string): string | undefined {
  return /<Code>([^<]+)<\/Code>/.exec(body)?.[1];
}

export class S3Storage implements ObjectStorage {
  readonly driver = 's3' as const;

  private readonly base: URL;
  private readonly prefix: string;
  /** Set once the bucket is known to exist, so we probe at most once. */
  private bucketReady = false;

  constructor(private readonly config: S3StorageConfig) {
    this.prefix = normalizePrefix(config.prefix);

    const endpoint = new URL(config.endpoint);
    if (endpoint.search || endpoint.hash) {
      throw new Error('S3_ENDPOINT must not carry a query string or fragment');
    }

    if (config.forcePathStyle) {
      // Keep any path the endpoint already has (some gateways live under a
      // sub-path) and append the bucket.
      const root = endpoint.pathname.replace(/\/+$/, '');
      this.base = new URL(
        `${root}/${encodeURIComponent(config.bucket)}/`,
        endpoint
      );
    } else {
      endpoint.host = `${config.bucket}.${endpoint.host}`;
      this.base = new URL('/', endpoint);
    }
  }

  describe(): string {
    const style = this.config.forcePathStyle ? 'path-style' : 'virtual-hosted';
    const prefix = this.prefix ? ` prefix=${this.prefix}` : '';
    return `s3 ${redactUrl(this.config.endpoint)} bucket=${this.config.bucket} region=${this.config.region} ${style}${prefix}`;
  }

  /**
   * Turn a normalised key into the request URL, then check that the URL the
   * runtime actually produced still points inside the bucket and prefix.
   *
   * `resolveObjectKey()` has already rejected `..`, so this assertion should
   * be unreachable. It is here because the failure it guards against is
   * silent: WHATWG URL parsing collapses `..` during construction, so a key
   * that slipped through would not error — it would quietly address a
   * different object, possibly in a different prefix.
   */
  private urlFor(key: string): URL {
    const url = new URL(encodeObjectPath(this.prefix + key), this.base);
    if (url.origin !== this.base.origin) {
      throw new S3StorageError(`Key "${key}" changed the request origin`);
    }
    if (!url.pathname.startsWith(this.base.pathname)) {
      throw new S3StorageError(`Key "${key}" escaped the bucket path`);
    }
    const expectedPrefix = this.base.pathname + encodeObjectPath(this.prefix);
    if (!url.pathname.startsWith(expectedPrefix)) {
      throw new S3StorageError(`Key "${key}" escaped the configured prefix`);
    }
    return url;
  }

  private async send(
    method: string,
    url: URL,
    options: { body?: Buffer; contentType?: string } = {}
  ): Promise<Response> {
    const payloadHash = options.body
      ? hexSha256(options.body)
      : EMPTY_PAYLOAD_SHA256;

    // S3 requires the payload hash as a header on every request, signed. It is
    // set here rather than inside signRequest because it is an S3 rule, not a
    // SigV4 one.
    const headers: Record<string, string> = {
      'x-amz-content-sha256': payloadHash,
    };
    if (options.contentType) headers['content-type'] = options.contentType;
    if (options.body) {
      headers['content-length'] = String(options.body.length);
    }

    const signed = signRequest({
      method,
      url,
      headers,
      payloadHash,
      region: this.config.region,
      service: 's3',
      credentials: this.config.credentials,
    });

    // `S3_TIMEOUT_MS` is a deadline on the REQUEST, and it has to stop being
    // one the moment the headers are in.
    //
    // `AbortSignal.timeout()` attached to the fetch stays attached to the
    // response BODY, and `get()` hands that body straight to the client. So the
    // deadline was really being applied to the download: a visitor on a slow
    // connection fetching a 5 MB image had the stream aborted at 30 s through
    // backpressure — after the 200 and the headers were already flushed, so it
    // could not even degrade to an error. Below ~170 KB/s no large object was
    // reachable at all, and nothing in the logs said why.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      return await fetch(url, {
        method,
        headers: {
          ...signed,
          // Not signed (added after `signRequest`, so it is not in
          // `SignedHeaders`): a proxy rewriting it must not invalidate the
          // signature. See `get()` for why we ask for no encoding at all.
          'accept-encoding': 'identity',
        },
        body: options.body as BodyInit | undefined,
        signal: controller.signal,
        // Sign one URL and send that URL. A redirect would be re-issued against
        // a host the signature does not cover, so it would fail anyway — better
        // to say so than to emit a confusing 403 from somewhere else.
        redirect: 'error',
      });
    } finally {
      // Headers are in, or the fetch threw. Either way the request is over and
      // whatever happens to the body next is not this timeout's business.
      clearTimeout(timer);
    }
  }

  private async fail(
    action: string,
    key: string,
    response: Response
  ): Promise<never> {
    // The request deadline is cleared once the headers arrive (see `send`), so
    // this read needs its own bound — otherwise a store that answers 500 and
    // then dribbles the body holds a request handler open indefinitely. Five
    // seconds is generous for an error document; past that the status code is
    // the whole of the diagnosis.
    const body = await Promise.race([
      response.text(),
      new Promise<string>((resolve) => setTimeout(() => resolve(''), 5_000)),
    ]).catch(() => '');
    await response.body?.cancel().catch(() => {});
    const code = parseErrorCode(body);
    throw new S3StorageError(
      `S3 ${action} of "${key}" failed: ${response.status} ${response.statusText}${
        code ? ` (${code})` : ''
      }`,
      response.status,
      code
    );
  }

  async get(key: string): Promise<StoredObject | null> {
    const response = await this.send('GET', this.urlFor(key));

    if (response.status === 404) {
      // Drain so the connection returns to the pool.
      await response.body?.cancel();
      return null;
    }
    if (!response.ok || !response.body) {
      return this.fail('read', key, response);
    }

    // `content-length` is only the size of what the caller will receive when
    // the body was not compressed in transit.
    //
    // undici adds `accept-encoding: gzip, deflate` of its own accord and then
    // transparently decompresses, leaving the COMPRESSED length in the header —
    // which the read routes echo as their outgoing `Content-Length`. Measured:
    // a 4046-byte SVG served gzipped reports `content-length: 86`, and the
    // client gets 86 bytes with a 200 and a year of `immutable` caching over the
    // top. Any gzipping proxy in front of the store does it, and so does an
    // object stored with `Content-Encoding: gzip`.
    //
    // `send()` asks for `identity` to stop it happening; this ignores the
    // header if it happened anyway. A missing size is handled everywhere —
    // the route simply omits `Content-Length` and the response is chunked.
    const encoding = response.headers.get('content-encoding');
    const encoded = !!encoding && encoding.toLowerCase() !== 'identity';
    const length = encoded ? null : response.headers.get('content-length');
    return {
      body: response.body,
      size: length ? Number(length) : undefined,
      contentType: response.headers.get('content-type') ?? undefined,
    };
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    const url = this.urlFor(key);
    let response = await this.send('PUT', url, { body: data, contentType });

    // A missing bucket answers 404 NoSuchBucket. When the operator asked for
    // it, create the bucket and try once more — this is what makes the
    // bundled RustFS subchart work with no manual step after `helm install`.
    if (
      response.status === 404 &&
      this.config.createBucket &&
      !this.bucketReady
    ) {
      const errorBody = await response.text().catch(() => '');
      if (parseErrorCode(errorBody) === 'NoSuchBucket') {
        await this.createBucket();
        response = await this.send('PUT', url, { body: data, contentType });
      } else {
        throw new S3StorageError(
          `S3 write of "${key}" failed: 404 ${response.statusText}`,
          404,
          parseErrorCode(errorBody)
        );
      }
    }

    if (!response.ok) return this.fail('write', key, response);
    await response.body?.cancel();
    this.bucketReady = true;
  }

  async delete(key: string): Promise<void> {
    const response = await this.send('DELETE', this.urlFor(key));
    // S3 answers 204 for a delete of something that was never there, which is
    // the semantics we want. Treat an explicit 404 the same way.
    if (!response.ok && response.status !== 404) {
      return this.fail('delete', key, response);
    }
    await response.body?.cancel();
  }

  private async createBucket(): Promise<void> {
    // Outside us-east-1, AWS requires the region in the body. Every
    // S3-compatible server we care about tolerates the element being present.
    const body =
      this.config.region && this.config.region !== 'us-east-1'
        ? Buffer.from(
            '<?xml version="1.0" encoding="UTF-8"?>' +
              '<CreateBucketConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">' +
              `<LocationConstraint>${this.config.region}</LocationConstraint>` +
              '</CreateBucketConfiguration>'
          )
        : undefined;

    const response = await this.send('PUT', new URL(this.base), {
      body,
      contentType: body ? 'application/xml' : undefined,
    });

    // Someone else (another replica racing us) already made it.
    if (response.ok || response.status === 409) {
      await response.body?.cancel();
      this.bucketReady = true;
      return;
    }
    const text = await response.text().catch(() => '');
    const code = parseErrorCode(text);
    if (code === 'BucketAlreadyOwnedByYou' || code === 'BucketAlreadyExists') {
      this.bucketReady = true;
      return;
    }
    throw new S3StorageError(
      `Could not create bucket "${this.config.bucket}": ${response.status} ${response.statusText}${
        code ? ` (${code})` : ''
      }`,
      response.status,
      code
    );
  }
}
