// Admin API-key gate. The session-based path lives in adminAuth.ts; this
// file is for header-based access only (X-Admin-Key or `Authorization:
// Bearer …`). Constant-time comparison prevents key recovery via timing.

import { randomBytes } from 'crypto';

const ADMIN_API_KEY = process.env.ADMIN_API_KEY || '';

export function generatePasskey(): string {
  return randomBytes(20).toString('hex');
}

export function requireAdmin(event: any): void {
  const apiKey =
    getHeader(event, 'x-admin-key') ||
    getHeader(event, 'authorization')?.replace('Bearer ', '');

  if (!ADMIN_API_KEY) {
    // Refuse to gate anything in production without a configured key —
    // returning 200 there would silently expose admin routes.
    if (process.env.NODE_ENV === 'production') {
      throw createError({
        statusCode: 503,
        message: 'Admin API not configured',
      });
    }
    console.warn(
      '[Security] Admin endpoint accessed without ADMIN_API_KEY configured'
    );
    return;
  }

  if (!apiKey) {
    throw createError({
      statusCode: 401,
      message: 'Authentication required',
    });
  }

  if (!secureCompare(apiKey, ADMIN_API_KEY)) {
    throw createError({
      statusCode: 403,
      message: 'Invalid credentials',
    });
  }
}

export function isAdmin(event: any): boolean {
  try {
    requireAdmin(event);
    return true;
  } catch {
    return false;
  }
}
