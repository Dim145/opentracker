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
import { servedObjectHeaders } from '~~/utils/storage/served';

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

  // Content type, nosniff and the SVG sandbox, from one place shared with the
  // `/uploads/:name` sibling — the two used to keep their own copies and had
  // drifted on both the map and the fallback.
  for (const [name, value] of Object.entries(servedObjectHeaders(key))) {
    setHeader(event, name, value);
  }
  if (object.size !== undefined) {
    setHeader(event, 'Content-Length', object.size);
  }
  setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable');

  return sendStream(event, object.body);
});
