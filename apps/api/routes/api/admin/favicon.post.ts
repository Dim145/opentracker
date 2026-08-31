import { requireAdminSession } from '~~/utils/adminAuth';
import { setSetting, SETTINGS_KEYS } from '~~/utils/server';
import { randomBytes } from 'crypto';
import {
  assertImageType,
  imageDimensions,
  manifestIconSizes,
} from '~~/utils/imageSniff';
import { getStorage } from '~~/utils/storage';
import { resolveObjectKey } from '~~/utils/storage/keys';

/**
 * POST /api/admin/favicon
 * Upload a custom favicon (admin only)
 */
export default defineEventHandler(async (event) => {
  await requireAdminSession(event);

  const formData = await readMultipartFormData(event);
  if (!formData || formData.length === 0) {
    console.error('[Favicon Upload] No form data received');
    throw createError({
      statusCode: 400,
      statusMessage: 'No file uploaded',
    });
  }

  const file = formData.find((f) => f.name === 'favicon');
  if (!file || !file.data) {
    console.error('[Favicon Upload] No favicon file found in form data');
    throw createError({
      statusCode: 400,
      statusMessage: 'No favicon file found in upload',
    });
  }

  // Validate file type
  const allowedTypes = [
    'image/png',
    'image/x-icon',
    'image/vnd.microsoft.icon',
    'image/svg+xml',
    'image/webp',
  ];
  const mimeType = file.type || '';
  if (!allowedTypes.includes(mimeType)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Invalid file type: ${mimeType}. Allowed: PNG, ICO, SVG, WebP`,
    });
  }

  // Validate file size (max 1MB for favicons)
  const maxSize = 1 * 1024 * 1024;
  if (file.data.length > maxSize) {
    throw createError({
      statusCode: 400,
      statusMessage: 'File too large. Maximum size: 1MB',
    });
  }

  // Get file extension
  const extMap: Record<string, string> = {
    'image/png': 'png',
    'image/x-icon': 'ico',
    'image/vnd.microsoft.icon': 'ico',
    'image/svg+xml': 'svg',
    'image/webp': 'webp',
  };
  // Same reasoning as the logo route: trust the bytes, not the declared type.
  const actualType = assertImageType(file.data, [
    'image/png',
    'image/x-icon',
    'image/svg+xml',
    'image/webp',
  ]);
  const ext = extMap[actualType] || 'png';

  // Generate unique filename
  const filename = `favicon-${randomBytes(8).toString('hex')}.${ext}`;

  // Whichever backend STORAGE_DRIVER selected: the filesystem under
  // UPLOADS_DIR (default, unchanged behaviour) or an S3-compatible bucket.
  const storage = getStorage();

  // Get current favicon to delete old one
  const { getSiteFavicon } = await import('~~/utils/server');
  const currentFavicon = await getSiteFavicon();

  // Save file
  await storage.put(filename, file.data, actualType);

  // File URL (relative to public folder)
  const fileUrl = `/uploads/${filename}`;

  // Save to settings
  await setSetting(SETTINGS_KEYS.SITE_FAVICON, fileUrl);
  // Measured, not assumed — see the note in the sibling logo route.
  await setSetting(
    SETTINGS_KEYS.SITE_FAVICON_SIZE,
    manifestIconSizes(imageDimensions(file.data))
  );

  // Delete old favicon if it exists and is in uploads folder. The setting is
  // written by this route, so the value should always be a plain filename —
  // resolveObjectKey is what makes that an assertion rather than a hope.
  if (currentFavicon && currentFavicon.startsWith('/uploads/')) {
    const oldKey = resolveObjectKey(currentFavicon.replace(/^\/uploads\//, ''));
    if (oldKey) {
      try {
        await storage.delete(oldKey);
      } catch {
        // Ignore deletion errors
      }
    }
  }

  return {
    success: true,
    url: fileUrl,
  };
});
