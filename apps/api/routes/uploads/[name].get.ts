import { getStorage } from '~~/utils/storage';
import { resolveObjectKey } from '~~/utils/storage/keys';
import { servedObjectHeaders } from '~~/utils/storage/served';

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

  // Content type, nosniff and the SVG sandbox, from one place shared with the
  // `/api` sibling — the two used to keep their own copies and had drifted.
  for (const [name_, value] of Object.entries(servedObjectHeaders(name))) {
    setHeader(event, name_, value);
  }

  if (object.size !== undefined) {
    setHeader(event, 'Content-Length', object.size);
  }
  setHeader(event, 'Cache-Control', 'public, max-age=86400, immutable');

  return sendStream(event, object.body);
});
