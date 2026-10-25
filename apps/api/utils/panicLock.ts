/**
 * Whether panic mode is under way: from the moment the encrypt pass writes its
 * salt until a restore completes — every phase but `idle`, and `is_encrypted`
 * for databases encrypted before phases existed.
 *
 * `is_encrypted` alone is not that. It stays false for the whole `encrypting`
 * phase, and an interrupted pass can sit there indefinitely, so everything that
 * read only the flag — the federation gate first — ran on through a database
 * already half encrypted.
 *
 * Several things stop on this answer: federation (`federationSuspended`), every
 * write that is not part of the panic itself (`middleware/panic-lock`), and the
 * catalogue sweeps, which would otherwise walk past encrypted rows and never come
 * back for them.
 *
 * Read through a short Redis cache because the write lock consults it on every
 * mutating request; the panic routes clear it as they change the state, so the
 * window only covers other replicas. On any Redis error it reads the database
 * rather than failing open: panic must not be defeated by a cache miss.
 */
import { db, schema } from '@trackarr/db';
import { redis } from '~~/utils/server';

const CACHE_KEY = 'panic:active';
const CACHE_TTL_S = 5;

export async function panicActive(): Promise<boolean> {
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached !== null) return cached === '1';
  } catch {
    /* fall through to the database */
  }
  const [row] = await db
    .select({ isEncrypted: schema.panicState.isEncrypted, phase: schema.panicState.phase })
    .from(schema.panicState)
    .limit(1);
  const active = !!row && (row.isEncrypted || row.phase !== 'idle');
  try {
    await redis.setex(CACHE_KEY, CACHE_TTL_S, active ? '1' : '0');
  } catch {
    /* best effort */
  }
  return active;
}

/** Called by the panic routes as they change the state. */
export async function invalidatePanicCache(): Promise<void> {
  try {
    await redis.del(CACHE_KEY);
  } catch {
    /* the TTL bounds it */
  }
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** The writes that are part of the panic itself, and leaving. */
const ALLOWED_DURING_PANIC = new Set([
  '/api/admin/panic/encrypt',
  '/api/admin/panic/restore',
  '/api/auth/logout',
]);

/**
 * Whether a request may run while panic mode stands (`middleware/panic-lock`).
 * Every read may; a write only if it resumes the encrypt pass, restores, or logs
 * out. Fail-closed on the spelling: the path is decoded and lower-cased before
 * the exact comparison, and a write that does not name an allowed route —
 * whatever prefix it claims — is refused. Every writing route lives under
 * `/api/`, so nothing legitimate is lost by not trusting the prefix.
 */
export function allowedDuringPanic(method: string, rawPath: string): boolean {
  if (!WRITE_METHODS.has(method.toUpperCase())) return true;
  let path = rawPath.split('?')[0] ?? '';
  try {
    path = decodeURIComponent(path);
  } catch {
    return false;
  }
  return ALLOWED_DURING_PANIC.has(path.toLowerCase().replace(/\/+$/, ''));
}
