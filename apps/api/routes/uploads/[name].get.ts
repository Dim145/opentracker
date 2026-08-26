import { getStorage } from '~~/utils/storage';
import { resolveObjectKey } from '~~/utils/storage/keys';

/**
 * GET /uploads/[name]
 *
 * Serve an uploaded file from the configured storage driver — the filesystem
 * under `UPLOADS_DIR`, or an S3-compatible bucket (see `utils/storage/`).
 *
 * Unlike the catch-all sibling at /api/uploads/[...path], this route only
 * accepts a single filename: no nesting, so anything with a separator in it is
 * refused before the key is derived. `resolveObjectKey` then applies the same
 * normalisation both drivers use, and the filesystem driver additionally
 * re-checks containment after `realpath`, in case a symlink lands in the
 * uploads directory.
 */
export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name');

  if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid filename',
    });
  }

  const key = resolveObjectKey(name);
  if (!key) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid filename' });
  }

  const object = await getStorage().get(key);
  if (!object) {
    throw createError({ statusCode: 404, statusMessage: 'File not found' });
  }

  // Set appropriate headers
  const ext = name.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    svg: 'image/svg+xml',
    webp: 'image/webp',
  };

  if (ext && mimeTypes[ext]) {
    setHeader(event, 'Content-Type', mimeTypes[ext]);
  }

  // Never let the browser sniff a different (e.g. HTML) type.
  setHeader(event, 'X-Content-Type-Options', 'nosniff');
  // SVGs are uploaded by admins as raw XML and served same-origin;
  // a hostile SVG can carry inline <script>/onload that would run
  // if a victim navigates to the file URL directly. Lock such a
  // document down so it can render as a picture but can never
  // execute script or load anything external (finding: SVG XSS).
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
  setHeader(event, 'Cache-Control', 'public, max-age=86400, immutable');

  return sendStream(event, object.body);
});
