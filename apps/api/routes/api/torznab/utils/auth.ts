/**
 * Torznab Authentication Utilities
 * Handles passkey-based authentication for Torznab API
 */

import { H3Event, createError } from 'h3';
import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { buildErrorXml, TORZNAB_ERRORS } from './xml';
import { liftExpiredBan } from '~~/utils/banExpiry';
import { isLegacyPasskeyReadAllowed } from '~~/utils/settings';

export interface TorznabUser {
  id: string;
  username: string;
  passkey: string;
  isBanned: boolean;
  isAdmin: boolean;
  isModerator: boolean;
  // Adult-content opt-in flag, surfaced here so search handlers can
  // filter the XXX tree without a separate user round-trip.
  showAdultContent: boolean;
}

/**
 * Authenticate user via Torznab API key (passkey)
 * Returns user if valid, throws error otherwise
 */
export async function authenticateTorznab(
  event: H3Event
): Promise<TorznabUser> {
  const query = getQuery(event);
  const apikey = query.apikey as string | undefined;

  if (!apikey) {
    throw createTorznabError(
      event,
      TORZNAB_ERRORS.MISSING_PARAMETER,
      'Missing apikey parameter'
    );
  }

  // Validate key format (32 or 40 hex chars — an RSS key is always 40, the
  // announce passkey may be either depending on when the account was made)
  if (!/^[a-f0-9]{32}$/i.test(apikey) && !/^[a-f0-9]{40}$/i.test(apikey)) {
    throw createTorznabError(
      event,
      TORZNAB_ERRORS.INCORRECT_CREDENTIALS,
      `Invalid API key format. Expected 32 or 40 hex characters, got ${apikey.length} characters`
    );
  }

  const supplied = apikey.toLowerCase();

  /**
   * The member's RSS key first, then the announce passkey while an operator
   * still allows it here.
   *
   * Torznab is the surface members hand to Prowlarr, so it is the one most
   * likely to leave the machine — which is exactly why it should not be
   * carrying the credential that announces on their behalf. The passkey stays
   * accepted by default because every feed already configured anywhere carries
   * it; `legacy_passkey_read_access` is how an operator closes that door once
   * their members have moved over.
   *
   * `bannedUntil` is projected so `liftExpiredBan` can flip the row back to
   * healthy when a timed ban has elapsed — without it we would block users
   * whose ban just expired but whom the 5-minute cron has not swept yet.
   */
  const projection = {
    id: schema.users.id,
    username: schema.users.username,
    passkey: schema.users.passkey,
    isBanned: schema.users.isBanned,
    bannedUntil: schema.users.bannedUntil,
    isAdmin: schema.users.isAdmin,
    isModerator: schema.users.isModerator,
    showAdultContent: schema.users.showAdultContent,
  };

  let users = await db
    .select(projection)
    .from(schema.users)
    .where(eq(schema.users.rssKey, supplied))
    .limit(1);

  if (users.length === 0 && (await isLegacyPasskeyReadAllowed())) {
    users = await db
      .select(projection)
      .from(schema.users)
      .where(eq(schema.users.passkey, supplied))
      .limit(1);
  }

  const user = users[0];

  if (!user) {
    throw createTorznabError(event, TORZNAB_ERRORS.INCORRECT_CREDENTIALS);
  }

  const stillBanned = await liftExpiredBan(user);
  if (stillBanned) {
    throw createTorznabError(event, TORZNAB_ERRORS.ACCOUNT_SUSPENDED);
  }

  // Strip the helper-only field before returning the user to the
  // rest of the Torznab pipeline — it doesn't need it.
  const { bannedUntil: _bannedUntil, ...torznabUser } = user;
  return torznabUser;
}

/**
 * Create a Torznab-compliant error response
 * The error contains XML in the 'data' field which should be extracted by the caller
 */
export function createTorznabError(
  event: H3Event,
  error: { code: number; description: string },
  customMessage?: string
): never {
  const httpStatus = error.code === 100 || error.code === 101 ? 401 : 400;
  const xml = buildErrorXml({
    code: error.code,
    description: customMessage ?? error.description,
  });

  const err = createError({
    statusCode: httpStatus,
    statusMessage: 'Torznab Error',
    message: customMessage ?? error.description,
    data: xml,
  });
  // Mark this as a Torznab error so we can handle it specially
  (err as any).isTorznab = true;

  throw err;
}

/**
 * Send XML error response
 */
export function sendTorznabError(
  event: H3Event,
  error: { code: number; description: string },
  customMessage?: string
): string {
  setHeader(event, 'Content-Type', 'application/xml; charset=utf-8');
  return buildErrorXml({
    code: error.code,
    description: customMessage ?? error.description,
  });
}
