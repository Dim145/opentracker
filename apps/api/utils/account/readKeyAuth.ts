/**
 * Authenticating a read surface — RSS, Torznab, the programmatic API.
 *
 * One resolver for all of them, because the three used to disagree in ways
 * that were invisible until somebody hit one: the Torznab gate lowercased the
 * key and shape-checked it, the RSS gate did neither, so the same key could
 * work on one surface and fail on the other. That is fixed here by there being
 * one place.
 *
 * ## Order
 *
 * 1. **The session cookie**, if there is one. A member browsing the site gets
 *    their own feed without a key in the URL.
 * 2. **The surface's own key** — `rssKey` for feeds and Torznab, `apiKey` for
 *    programmatic calls.
 * 3. **The announce passkey**, while `legacy_passkey_read_access` allows it.
 *
 * Step 3 is a migration path, not a design. The passkey was the only key these
 * surfaces ever took, so it is in every feed URL a member has configured
 * anywhere; removing it on the day of the split would break all of them at once
 * — the exact breakage the split exists to prevent. An operator turns the
 * setting off when their members have moved over, and the member-facing keys
 * page says so.
 */
import type { H3Event } from 'h3';
import { requireAuthSession } from '~~/utils/adminAuth';
import { isLegacyPasskeyReadAllowed } from '~~/utils/settings';
import { findByReadKey, type ReadKeyHolder, type ReadKeyKind } from './readKeys';
import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';

/** How the caller proved who they are — used only for logging and headers. */
export type ReadAuthVia = 'session' | 'key' | 'legacy-passkey';

export interface ReadAuthResult {
  user: ReadKeyHolder;
  via: ReadAuthVia;
}

/**
 * The passkey lookup, kept beside the key one so both apply the same
 * post-conditions (not banned, not erased) rather than each remembering.
 */
async function findByPasskey(raw: string): Promise<ReadKeyHolder | null> {
  const value = raw.toLowerCase();
  // 32 or 40: the codebase has minted both lengths over time. New keys are 40;
  // this gate stays permissive because it is looking at a legacy credential.
  if (!/^[a-f0-9]{32}$/.test(value) && !/^[a-f0-9]{40}$/.test(value)) return null;

  const [row] = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      passkey: schema.users.passkey,
      isAdmin: schema.users.isAdmin,
      isModerator: schema.users.isModerator,
      isBanned: schema.users.isBanned,
      uploaded: schema.users.uploaded,
      downloaded: schema.users.downloaded,
      showAdultContent: schema.users.showAdultContent,
      deletedAt: schema.users.deletedAt,
    })
    .from(schema.users)
    .where(eq(schema.users.passkey, value))
    .limit(1);

  if (!row || row.isBanned || row.deletedAt) return null;
  return row;
}

/**
 * Resolve the caller of a read surface, or throw 401.
 *
 * `kind` decides which dedicated key is accepted: a member's RSS key must not
 * open the programmatic API and vice versa, or the split has bought nothing.
 */
export async function requireReadAccess(
  event: H3Event,
  kind: ReadKeyKind
): Promise<ReadAuthResult> {
  // 1. A live session, if the request carries one.
  try {
    const session = await requireAuthSession(event);
    const [row] = await db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        passkey: schema.users.passkey,
        isAdmin: schema.users.isAdmin,
        isModerator: schema.users.isModerator,
        isBanned: schema.users.isBanned,
        uploaded: schema.users.uploaded,
        downloaded: schema.users.downloaded,
        showAdultContent: schema.users.showAdultContent,
        deletedAt: schema.users.deletedAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, session.user.id))
      .limit(1);
    // Read from the row rather than the cookie: the sealed session is seven
    // days old at worst, and `showAdultContent` in particular decides what a
    // feed contains.
    if (row && !row.isBanned && !row.deletedAt) {
      return { user: row, via: 'session' };
    }
  } catch {
    // No session — fall through to the key paths.
  }

  const query = getQuery(event);
  const supplied =
    (typeof query.apikey === 'string' && query.apikey) ||
    (typeof query.passkey === 'string' && query.passkey) ||
    (typeof query.rsskey === 'string' && query.rsskey) ||
    null;

  if (supplied) {
    // 2. The surface's own key.
    const byKey = await findByReadKey(kind, supplied);
    if (byKey) return { user: byKey, via: 'key' };

    // 3. The announce passkey, while it is still allowed here.
    if (await isLegacyPasskeyReadAllowed()) {
      const byPasskey = await findByPasskey(supplied);
      if (byPasskey) return { user: byPasskey, via: 'legacy-passkey' };
    }
  }

  throw createError({ statusCode: 401, message: 'Authentication required' });
}
