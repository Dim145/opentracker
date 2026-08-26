/**
 * GET /api/uploads/[...path]
 *
 * Serve an uploaded file from whichever storage driver is configured — the
 * filesystem under `UPLOADS_DIR`, or an S3-compatible bucket. See
 * `utils/storage/` for the driver selection and for why S3 reads stream
 * through the API rather than redirecting to a presigned URL.
 *
 * Path-traversal mitigation is now `resolveObjectKey()`, which is shared with
 * the write routes and with the S3 driver so both backends address the same
 * object and neither can be walked out of. It rejects `..` outright instead of
 * resolving it — a `..` is inert on a filesystem after a prefix check but not
 * on S3, where `fetch()` collapses it in the URL before the request is sent.
 *
 * In front of this, `middleware/security.ts` already answers 400 to any path
 * containing `..`, and h3 decodes the path before routing, so the encoded
 * spellings are caught there too. Both were checked against a running API.
 * This is the layer that still has to hold if that middleware is ever
 * narrowed.
 *
 * The filesystem driver keeps the two containment checks that were here: a
 * `resolve()` prefix test, and a `realpath()` prefix test that catches a
 * symlink inside the uploads directory pointing out of it. Neither an earlier
 * substring check (`path.includes('..')`) nor `resolveObjectKey()` alone would
 * catch that one.
 */
import { getStorage } from '~~/utils/storage';
import { resolveObjectKey } from '~~/utils/storage/keys';

export default defineEventHandler(async (event) => {
  const requested = getRouterParam(event, 'path');
  if (!requested) {
    throw createError({ statusCode: 400, message: 'File path required' });
  }

  const key = resolveObjectKey(requested);
  if (!key) {
    throw createError({ statusCode: 400, message: 'Invalid file path' });
  }

  const object = await getStorage().get(key);
  if (!object) {
    throw createError({ statusCode: 404, message: 'File not found' });
  }

  // Content type comes from the extension, never from what the backend
  // reports. It is what the SVG sandbox below keys off, so it has to be
  // derived from the same string the URL carries.
  const ext = key.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    gif: 'image/gif',
  };
  const contentType = mimeTypes[ext || ''] || 'application/octet-stream';
  setHeader(event, 'Content-Type', contentType);
  // Block content sniffing, and sandbox SVGs so a hostile inline
  // <script>/onload cannot execute if the file URL is opened
  // directly as a same-origin document (finding: SVG XSS).
  setHeader(event, 'X-Content-Type-Options', 'nosniff');
  if (ext === 'svg') {
    setHeader(
      event,
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; sandbox"
    );
  }
  if (object.size !== undefined) {
    setHeader(event, 'Content-Length', object.size);
  }
  setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable');

  return sendStream(event, object.body);
});
