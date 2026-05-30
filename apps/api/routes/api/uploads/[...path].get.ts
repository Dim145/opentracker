/**
 * GET /api/uploads/[...path]
 *
 * Serve uploaded files from `/app/data/uploads` in prod, or
 * `public/uploads` in dev. Path-traversal mitigation uses
 * `path.resolve` + a relative-prefix check + `realpathSync` so:
 *   - URL-decoded `..` segments collapse correctly
 *   - Absolute paths in the URL ("/etc/passwd") get rebased
 *   - Symlinks pointing outside the uploads dir are caught after
 *     resolving the link
 *
 * The earlier substring check (`path.includes('..')`) was incomplete
 * — `path.join('/app/data/uploads', '/etc/passwd')` collapses the
 * left side and returns `/etc/passwd`, which would have been served.
 */
import { createReadStream, existsSync, realpathSync, statSync } from 'fs';
import { resolve, sep } from 'path';

export default defineEventHandler(async (event) => {
  const requested = getRouterParam(event, 'path');
  if (!requested) {
    throw createError({ statusCode: 400, message: 'File path required' });
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const baseDir = isProduction
    ? '/app/data/uploads'
    : resolve(process.cwd(), 'public', 'uploads');
  const baseReal = realpathSync.native(baseDir);

  // Strip a leading separator so `resolve(baseReal, requested)`
  // doesn't switch to the absolute-path semantics of the second arg.
  const safeRequested = requested.replace(/^[\\/]+/, '');
  const candidate = resolve(baseReal, safeRequested);

  // First containment check before touching the filesystem — a
  // requested path that resolves outside `baseReal` already screams
  // traversal.
  if (
    candidate !== baseReal &&
    !candidate.startsWith(baseReal + sep)
  ) {
    throw createError({ statusCode: 400, message: 'Invalid file path' });
  }

  if (!existsSync(candidate)) {
    throw createError({ statusCode: 404, message: 'File not found' });
  }

  // Second containment check after resolving symlinks — an upload
  // dir might contain a `latest -> ../secret` style trap. realpath
  // dereferences it and we re-assert the prefix.
  const finalPath = realpathSync.native(candidate);
  if (
    finalPath !== baseReal &&
    !finalPath.startsWith(baseReal + sep)
  ) {
    throw createError({ statusCode: 400, message: 'Invalid file path' });
  }

  const stats = statSync(finalPath);
  if (stats.isDirectory()) {
    throw createError({ statusCode: 400, message: 'Cannot serve directory' });
  }

  const ext = requested.split('.').pop()?.toLowerCase();
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
  setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable');

  return sendStream(event, createReadStream(finalPath));
});
