/**
 * GET /api/fonts/:id — serve an uploaded face.
 *
 * Public and uncredentialled, because a font has to load for every visitor of a
 * theme that uses it, including one who is not signed in.
 *
 * Cached for a year and marked immutable, which is safe because the object is
 * addressed by the SHA-256 of its own bytes: the file behind an id can never
 * change. Deleting the row and re-uploading the same file returns the same
 * content under a new id.
 *
 * `Content-Type` is fixed rather than derived, and `nosniff` goes with it: the
 * bytes were checked to start with `wOF2` at upload, and nothing should be able
 * to talk a browser into reading them as anything else.
 */
import { z } from 'zod';
import { fontKey } from '~~/utils/fonts';
import { getStorage } from '~~/utils/storage';

const paramsSchema = z.object({ id: z.string().uuid() });

export default defineEventHandler(async (event) => {
  const parsed = paramsSchema.safeParse(getRouterParams(event));
  if (!parsed.success) {
    throw createError({ statusCode: 404, message: 'Not found' });
  }

  const key = await fontKey(parsed.data.id);
  if (!key) throw createError({ statusCode: 404, message: 'Not found' });

  const object = await getStorage().get(key);
  if (!object) {
    // The row survived its object. Not a 500: from a browser's point of view the
    // face is simply not there, and the stack's next entry renders.
    throw createError({ statusCode: 404, message: 'Not found' });
  }

  setResponseHeaders(event, {
    'Content-Type': 'font/woff2',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'public, max-age=31536000, immutable',
    ...(object.size ? { 'Content-Length': String(object.size) } : {}),
  });
  return sendStream(event, object.body);
});
