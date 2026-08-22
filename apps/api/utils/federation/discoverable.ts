/**
 * The gate in front of the public ActivityStreams surface.
 *
 * One helper rather than three copies of the same four lines, because the
 * three public endpoints have to agree exactly on when they exist: an actor
 * that answers while the outbox 404s is a broken advertisement, and an outbox
 * that answers after the operator turned discovery off is a leak.
 *
 * Returns 404 rather than 403 when it is off. There is nothing here to be
 * forbidden from — the surface simply does not exist on an instance that has
 * not opted in, and saying "forbidden" would confirm it could exist.
 */
import { createError, type H3Event } from 'h3';
import type { FederationConfig } from '@trackarr/db/schema';
import { getFederationConfig, isFederationLive } from './config';
import { rateLimit, RATE_LIMITS } from '../rateLimit';

/** Why the surface is absent, when it is. Never returned to a caller. */
export type Absence = 'off' | 'not-live' | 'no-public-url' | null;

/**
 * Whether the public surface exists, as a decision with no h3 in it.
 *
 * Split out because three endpoints depend on this answer being the same, and
 * because the interesting cases — federation enabled but discovery off,
 * discovery on but no public URL configured — are states of a row, not states
 * of a request. Asserting them needed a running server before, which in
 * practice meant nobody asserted them.
 */
export function absentBecause(config: FederationConfig | null): Absence {
  if (!isFederationLive(config)) return 'not-live';
  if (!config?.discoverable) return 'off';
  // Every id in these documents is absolute, and an actor whose own id is
  // `/api/federation/actor` is an actor nobody can come back to. Better to be
  // absent than to publish links that resolve to nothing.
  if (!config.publicUrl) return 'no-public-url';
  return null;
}

export async function requireDiscoverable(
  event: H3Event,
): Promise<FederationConfig> {
  await rateLimit(event, RATE_LIMITS.public);

  const config = await getFederationConfig();
  if (absentBecause(config)) {
    // The reason stays here. Telling a stranger WHICH of the three it is would
    // describe an instance that has not agreed to be described.
    throw createError({ statusCode: 404, message: 'Not found' });
  }
  return config!;
}
