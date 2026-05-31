/**
 * Shared scope helpers. `FederationScopes` lives in the DB schema (it's
 * a jsonb column type); here we add the Zod validator used on every
 * inbound boundary and a canonical empty value.
 */
import { z } from 'zod';
import type { FederationScopes } from '@trackarr/db/schema';

export const SCOPE_KEYS = ['catalog', 'social', 'accounts', 'swarm'] as const;

export const EMPTY_SCOPES: FederationScopes = {
  catalog: false,
  social: false,
  accounts: false,
  swarm: false,
};

/** Coerces any partial/garbage input into a full, boolean-typed scope
 *  object — missing keys default to false (deny by default). */
export const federationScopesSchema = z
  .object({
    catalog: z.boolean().optional(),
    social: z.boolean().optional(),
    accounts: z.boolean().optional(),
    swarm: z.boolean().optional(),
  })
  .transform(
    (s): FederationScopes => ({
      catalog: !!s.catalog,
      social: !!s.social,
      accounts: !!s.accounts,
      swarm: !!s.swarm,
    }),
  );

/**
 * Intersection of two scope sets — true only where BOTH are true. Used to
 * clamp what we end up sharing with a peer to what our owner actually offered:
 * a handshake callback carries the scopes the peer says it accepts from us, but
 * it must never WIDEN our share beyond the owner's original offer.
 */
export function intersectScopes(
  a: FederationScopes,
  b: FederationScopes,
): FederationScopes {
  return {
    catalog: !!a.catalog && !!b.catalog,
    social: !!a.social && !!b.social,
    accounts: !!a.accounts && !!b.accounts,
    swarm: !!a.swarm && !!b.swarm,
  };
}
