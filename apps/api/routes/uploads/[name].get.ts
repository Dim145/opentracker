import { resolve, sep } from 'path';
import { realpath, stat } from 'fs/promises';
import { createReadStream } from 'fs';

/**
 * GET /uploads/[name]
 *
 * Serve uploaded files directly from the persistent storage. Unlike
 * the catch-all sibling at /api/uploads/[...path], this route only
 * accepts a single filename (no nesting). We still apply realpath
 * containment as defense-in-depth in case a symlink lands in the
 * uploads dir.
 */
export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name');

  if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid filename',
    });
  }

  const uploadsDir =
    process.env.UPLOADS_DIR ||
    (process.env.NODE_ENV === 'production'
      ? '/app/data/uploads'
      : resolve(process.cwd(), 'public', 'uploads'));
  const baseReal = await realpath(uploadsDir);
  const candidate = resolve(baseReal, name);
  const finalPath = await realpath(candidate);
  if (finalPath !== baseReal && !finalPath.startsWith(baseReal + sep)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid filename' });
  }

  try {
    const stats = await stat(finalPath);

    if (!stats.isFile()) {
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

    setHeader(event, 'Content-Length', stats.size);
    setHeader(event, 'Cache-Control', 'public, max-age=86400, immutable');

    return sendStream(event, createReadStream(finalPath));
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw createError({
        statusCode: 404,
        statusMessage: 'File not found',
      });
    }
    throw error;
  }
});
