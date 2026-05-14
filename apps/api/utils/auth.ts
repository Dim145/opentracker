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

  // No key configured → admin routes are unavailable, regardless of
  // NODE_ENV. The previous behaviour passed-through in development /
  // staging, which silently opened admin routes whenever an operator
  // forgot to set the env var (or whenever NODE_ENV happened to read
  // as `development` / `test` — e.g. on a CI box where the env was
  // never propagated). 503 is the right answer everywhere: a route
  // that requires an unconfigured credential is simply not available.
  if (!ADMIN_API_KEY) {
    throw createError({
      statusCode: 503,
      message:
        'Admin API not configured — set ADMIN_API_KEY in the environment to enable header-auth admin routes.',
    });
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
