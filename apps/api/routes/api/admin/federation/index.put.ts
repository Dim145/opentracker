/**
 * PUT /api/admin/federation
 *
 * Owner master switch + identity metadata + default sharing scopes.
 * Enabling for the first time provisions the Ed25519 identity (lazy, so
 * a fresh install carries no key material until opt-in).
 */
import { db, schema } from '@trackarr/db';
import { requireAdminSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';
import { z } from 'zod';
import {
  getFederationConfig,
  ensureFederationIdentity,
} from '~~/utils/federation/config';
import { federationScopesSchema } from '~~/utils/federation/scopes';

const bodySchema = z.object({
  enabled: z.boolean().optional(),
  instanceName: z.string().trim().max(120).optional().nullable(),
  publicUrl: z.string().trim().url().max(255).optional().nullable(),
  defaultScopes: federationScopesSchema.optional(),
});

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const body = await validateBody(event, bodySchema);

  // Build a partial patch with only the provided fields; spread keeps
  // the inferred type clean (no Record<string, unknown> cast).
  const patch = {
    ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    ...(body.instanceName !== undefined
      ? { instanceName: body.instanceName }
      : {}),
    ...(body.publicUrl !== undefined ? { publicUrl: body.publicUrl } : {}),
    ...(body.defaultScopes !== undefined
      ? { defaultScopes: body.defaultScopes }
      : {}),
    updatedAt: new Date(),
  };

  await db
    .insert(schema.federationConfig)
    .values({ id: 'singleton', ...patch })
    .onConflictDoUpdate({ target: schema.federationConfig.id, set: patch });

  // Generate the keypair on first enable.
  if (body.enabled === true) {
    await ensureFederationIdentity();
  }

  const config = await getFederationConfig();
  return {
    ok: true,
    config: {
      enabled: config!.enabled,
      instanceId: config!.instanceId,
      provisioned: !!(config!.instanceId && config!.publicKey),
    },
  };
});
