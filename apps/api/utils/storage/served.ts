/**
 * The response headers for a stored object, as one function.
 *
 * Both read routes — `/uploads/:name` and `/api/uploads/*` — set the same four
 * things and each had its own copy. They had already drifted: the older route
 * set no `Content-Type` at all for an extension it did not recognise while the
 * newer one fell back to `application/octet-stream`, and their MIME maps
 * differed, so `.gif` and the `.ico` that `favicon.post.ts` writes landed in the
 * hole on one and not the other. `nosniff` is set either way so the practical
 * impact was small — but two tables that must agree, written twice, do not stay
 * agreed, and neither route was tested.
 *
 * Kept as a pure function of the key for exactly that reason: the routes need
 * an h3 event, a storage backend and a running Nitro to exercise, and this needs
 * a string.
 *
 * Cache-Control is deliberately NOT here. The two routes disagree about it
 * (a day versus a year) and that is a caching decision per surface, not a
 * safety one.
 */

/**
 * Content type by extension, and never from what the backend reported.
 *
 * An object store echoes whatever was set when the object was written, which on
 * this path is our own upload code — but trusting it would mean a stored
 * `text/html` decides how a browser treats the response, and the SVG sandbox
 * below keys off the same value. Deriving both from the string in the URL keeps
 * them in step.
 */
const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  gif: 'image/gif',
  ico: 'image/x-icon',
  avif: 'image/avif',
  torrent: 'application/x-bittorrent',
  // Owner-uploaded faces live in the same object store. The font route sets the
  // type explicitly rather than deriving it, because it accepts exactly one
  // format and a fixed string cannot be talked into anything else — but a key
  // ending `.woff2` must not fall through to `application/octet-stream` if
  // anything else ever reads it back.
  woff2: 'font/woff2',
};

/**
 * SVGs are uploaded by admins as raw XML and served same-origin, so a hostile
 * one carrying inline `<script>`/`onload` would run if a victim navigated to the
 * file URL directly. This lets it render as a picture and nothing else.
 */
const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

export function extensionOf(nameOrKey: string): string {
  return nameOrKey.split('.').pop()?.toLowerCase() ?? '';
}

export function contentTypeFor(nameOrKey: string): string {
  return MIME_TYPES[extensionOf(nameOrKey)] ?? 'application/octet-stream';
}

/** Every header a served object gets, keyed by name. */
export function servedObjectHeaders(nameOrKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': contentTypeFor(nameOrKey),
    // Never let a browser sniff a different (e.g. HTML) type out of the bytes.
    'X-Content-Type-Options': 'nosniff',
  };
  if (extensionOf(nameOrKey) === 'svg') {
    headers['Content-Security-Policy'] = SVG_CSP;
  }
  return headers;
}
