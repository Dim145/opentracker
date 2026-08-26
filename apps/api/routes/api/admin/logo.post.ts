import { requireAdminSession } from '~~/utils/adminAuth';
import { setSetting, SETTINGS_KEYS } from '~~/utils/server';
import { randomBytes } from 'crypto';
import { assertImageType } from '~~/utils/imageSniff';
import { getStorage } from '~~/utils/storage';
import { resolveObjectKey } from '~~/utils/storage/keys';

/**
 * POST /api/admin/logo
 * Upload a custom logo image (admin only)
 */
export default defineEventHandler(async (event) => {
  await requireAdminSession(event);

  const formData = await readMultipartFormData(event);
  if (!formData || formData.length === 0) {
    console.error('[Logo Upload] No form data received');
    throw createError({
      statusCode: 400,
      statusMessage: 'No file uploaded',
    });
  }

  const file = formData.find((f) => f.name === 'logo');
  if (!file || !file.data) {
    console.error('[Logo Upload] No logo file found in form data');
    throw createError({
      statusCode: 400,
      statusMessage: 'No logo file found in upload',
    });
  }

  // Validate file type
  const allowedTypes = [
    'image/png',
    'image/jpeg',
    'image/svg+xml',
    'image/webp',
  ];
  const mimeType = file.type || '';
  if (!allowedTypes.includes(mimeType)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Invalid file type: ${mimeType}. Allowed: PNG, JPEG, SVG, WebP`,
    });
  }

  // Validate file size (max 5MB)
  const maxSize = 5 * 1024 * 1024;
  if (file.data.length > maxSize) {
    throw createError({
      statusCode: 400,
      statusMessage: 'File too large. Maximum size: 5MB',
    });
  }

  // Get file extension
  const extMap: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/svg+xml': 'svg',
    'image/webp': 'webp',
  };
  // The declared type got us this far; the BYTES decide the extension. A part
  // labelled `image/png` carrying something else would otherwise be stored
  // under `.png`, i.e. an extension that disagrees with its content.
  const actualType = assertImageType(file.data, [
    'image/png',
    'image/jpeg',
    'image/svg+xml',
    'image/webp',
  ]);
  const ext = extMap[actualType] || 'png';

  // Generate unique filename
  const filename = `logo-${randomBytes(8).toString('hex')}.${ext}`;

  // Whichever backend STORAGE_DRIVER selected: the filesystem under
  // UPLOADS_DIR (default, unchanged behaviour) or an S3-compatible bucket.
  const storage = getStorage();

  // Get current logo to delete old one
  const { getSiteLogoImage } = await import('~~/utils/server');
  const currentLogo = await getSiteLogoImage();

  // Save file
  await storage.put(filename, file.data, actualType);

  // File URL (relative to public folder)
  const fileUrl = `/uploads/${filename}`;

  // Save to settings
  await setSetting(SETTINGS_KEYS.SITE_LOGO_IMAGE, fileUrl);

  // Delete old logo if it exists and is in uploads folder. The setting is
  // written by this route, so the value should always be a plain filename —
  // resolveObjectKey is what makes that an assertion rather than a hope.
  if (currentLogo && currentLogo.startsWith('/uploads/')) {
    const oldKey = resolveObjectKey(currentLogo.replace(/^\/uploads\//, ''));
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
