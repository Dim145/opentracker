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

export async function requireDiscoverable(
  event: H3Event,
): Promise<FederationConfig> {
  await rateLimit(event, RATE_LIMITS.public);

  const config = await getFederationConfig();
  if (!isFederationLive(config) || !config?.discoverable) {
    throw createError({ statusCode: 404, message: 'Not found' });
  }
  if (!config.publicUrl) {
    // Every id in these documents is absolute, and an actor whose own id is
    // `/api/federation/actor` is an actor nobody can come back to. Better to
    // be absent than to publish links that resolve to nothing.
    throw createError({ statusCode: 404, message: 'Not found' });
  }
  return config;
}
