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
