/**
 * Object-key derivation, shared by every storage driver.
 *
 * Both drivers take the same untrusted string — the tail of a `/uploads/...`
 * URL — and both have to end up addressing the same object. The filesystem
 * driver turns the key into a path under `UPLOADS_DIR`; the S3 driver
 * concatenates it onto a bucket prefix. If the two normalised differently, a
 * file written under one driver would be unreachable under the other, and
 * worse, only one of them would be traversal-safe.
 *
 * So normalisation lives here, once, and both drivers call it before they
 * touch anything.
 *
 * Why `..` is REJECTED rather than resolved:
 *
 *   - On a filesystem, resolving is defensible — `resolve()` collapses it and
 *     a prefix check catches the escape. The catch-all read route did exactly
 *     that, and still does as a second layer.
 *   - On S3 it is not. An S3 key is an opaque byte string and the server never
 *     collapses `..`. But `fetch()` does: WHATWG URL parsing rewrites
 *     `/bucket/uploads/../secrets` to `/bucket/secrets` before the request
 *     leaves the process, and any proxy on the way may normalise again. A `..`
 *     that looks inert in the key becomes a real prefix escape at the wire, in
 *     a component we do not control.
 *
 * A legitimate upload URL never contains `..` — filenames are server-generated
 * (`logo-<hex>.png`). Rejecting outright is safe under every driver and hard to
 * get subtly wrong.
 *
 * Note on percent-encoding, verified against the running API rather than
 * assumed:
 *
 *   - h3 decodes the path BEFORE routing (`_decodePath`), so `%2e%2e` reaches
 *     a route param as `..`. `/api/uploads/logo%2Epng` really does serve
 *     `logo.png`.
 *   - Encoded SEPARATORS are the exception: `decodePath` rewrites `%2F` out of
 *     harm's way before decoding, so `a%2Fb` stays one segment and never
 *     becomes `a/b`.
 *
 * This function nonetheless does no decoding of its own, and must not: it is
 * called with strings that have already been through that pass, and decoding
 * again is how a `%252e%252e` becomes a live `..`. It only has to be correct
 * about the separators and dots actually present in what it is handed.
 *
 * For URL-borne keys it is the second layer anyway — `middleware/security.ts`
 * rejects any path containing `..` with a 400 before a route handler runs. It
 * is the ONLY layer for the keys that never touch a URL: the branding routes
 * derive one from the `site_logo_image` / `site_favicon` setting when deleting
 * the file they are replacing, and nothing filters a settings row.
 */

/** The deepest we let a key nest. More than anything we write needs. */
const MAX_SEGMENTS = 16;
/** S3 caps keys at 1024 UTF-8 bytes; most filesystems cap a name at 255. */
const MAX_KEY_LENGTH = 512;
const MAX_SEGMENT_LENGTH = 200;

/** C0/C1 controls and DEL. A NUL truncates a path in the C layer under the
 *  filesystem driver, and none of the rest belong in a key we generated. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * Normalise an untrusted upload path into a canonical, driver-agnostic key.
 *
 * Returns `null` when the input cannot be made safe — the caller answers 400.
 * A returned key is always relative, slash-separated, free of `.` and `..`
 * segments, and safe to append to either a directory or a bucket prefix.
 */
export function resolveObjectKey(requested: string): string | null {
  if (typeof requested !== 'string' || requested.length === 0) return null;
  if (requested.length > MAX_KEY_LENGTH) return null;
  if (CONTROL_CHARS.test(requested)) return null;

  // Backslash is a legal S3 key character but a path separator on Windows, and
  // `..\..\etc` is the classic way past a check that only knows about `/`.
  // Treat it as a separator so it is caught below rather than smuggled through
  // inside a segment.
  const parts = requested.split(/[\\/]+/);

  const segments: string[] = [];
  for (const part of parts) {
    // Leading, trailing and doubled separators produce empty parts. Dropping
    // them is what makes `/logo.png` and `logo.png` the same object.
    if (part === '' || part === '.') continue;
    if (part === '..') return null;
    if (part.length > MAX_SEGMENT_LENGTH) return null;
    segments.push(part);
  }

  if (segments.length === 0) return null;
  if (segments.length > MAX_SEGMENTS) return null;

  return segments.join('/');
}

/**
 * Normalise a configured bucket prefix: no leading slash, exactly one trailing
 * slash, or the empty string for "objects live at the bucket root".
 */
export function normalizePrefix(prefix: string | undefined): string {
  if (!prefix) return '';
  const trimmed = prefix.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!trimmed) return '';
  // The prefix is operator configuration rather than user input, but a `..` in
  // it would escape at the wire exactly like one in a key. Refuse to start.
  if (trimmed.split('/').some((s) => s === '..' || s === '.')) {
    throw new Error(
      `S3_PREFIX must not contain "." or ".." segments (got "${prefix}")`
    );
  }
  return `${trimmed}/`;
}

/**
 * A configured URL, safe to print.
 *
 * `S3_ENDPOINT` is operator-supplied and nothing stops it being written
 * `https://KEY:SECRET@host` — a shape that would not authenticate against S3
 * anyway, but would land in the logs and in error messages the moment anything
 * described the driver. The contract on `ObjectStorage.describe()` says no
 * secrets; this is what makes that true rather than trusted.
 *
 * Defensive about parsing on purpose: the callers that most want this are the
 * ones reporting that the value is NOT a valid URL.
 */
export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (!url.username && !url.password) return raw; // nothing to hide
    url.username = '';
    url.password = '';
    // `toString()` rather than `raw` here: the point is to print the value
    // WITHOUT what was stripped, and it normalises the URL in passing, which
    // matters not at all next to that.
    return `${url.toString()} (credentials removed)`;
  } catch {
    // Unparseable. Strip anything shaped like userinfo and say so.
    return raw.replace(/\/\/[^/@\s]*@/, '//<redacted>@');
  }
}
