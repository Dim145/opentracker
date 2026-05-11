/**
 * PUT /api/admin/notification-channels/:type
 *
 * Upsert the admin-side row for one channel type. The request body
 * carries:
 *   - `enabled` — explicit boolean. When toggled, any subsequent
 *     publishes through the channel will be allowed (provided the
 *     last test passed).
 *   - `serverConfig` — channel-specific JSON object. Validated
 *     loosely (we trust the adapter's `testServer` to surface bad
 *     configs at test time), then encrypted before persistence.
 *
 * Touching `serverConfig` clears the `lastTest*` fields — the admin
 * has to re-run the test to re-expose the channel to users. That's
 * the "test invalid → canal masqué" rule from the design.
 */
import { requireAdminSession } from '~~/utils/adminAuth';
import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  encryptJson,
  decryptJson,
  assertChannelEncryptionReady,
} from '~~/utils/channelSecrets';
import { getAdapter } from '~~/utils/channels';

const bodySchema = z.object({
  enabled: z.boolean().optional(),
  serverConfig: z.record(z.string(), z.unknown()).optional(),
});

export default defineEventHandler(async (event) => {
  const session = await requireAdminSession(event);
  const type = getRouterParam(event, 'type') ?? '';
  const adapter = getAdapter(type);
  if (!adapter) {
    throw createError({ statusCode: 404, statusMessage: 'Unknown channel' });
  }
  const raw = await readBody(event);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid body' });
  }

  // Refuse to write if encryption isn't ready — saves us from
  // landing plaintext in the DB when the deploy forgot to set
  // NUXT_SESSION_SECRET.
  assertChannelEncryptionReady();

  const existing = await db.query.notificationChannels.findFirst({
    where: eq(schema.notificationChannels.type, type),
  });

  const updates: Partial<typeof schema.notificationChannels.$inferInsert> = {
    updatedAt: new Date(),
    updatedBy: session.user.id,
  };
  if (typeof parsed.data.enabled === 'boolean') {
    updates.enabled = parsed.data.enabled;
  }
  if (parsed.data.serverConfig !== undefined) {
    if (!adapter.hasServerConfig) {
      // The channel doesn't accept a server config — silently
      // drop it rather than confusing the admin.
      updates.serverConfig = '';
    } else {
      // Merge with the existing decrypted config so secret fields
      // the UI omits (admin didn't re-type them) keep their stored
      // value. Non-secret fields are always taken from the request
      // — that's how an optional non-secret field can be cleared
      // (e.g. SMTP user blanked for an anonymous relay). Required
      // non-secret fields are gated by the UI's submit check.
      const incoming: Record<string, unknown> = { ...parsed.data.serverConfig };
      if (existing?.serverConfig) {
        try {
          const old =
            (decryptJson(existing.serverConfig) as Record<string, unknown> | null) ??
            {};
          for (const f of adapter.serverFields) {
            if (f.secret && !(f.key in incoming) && f.key in old) {
              incoming[f.key] = old[f.key];
            }
          }
        } catch {
          // Decrypt failed (key rotated, drift) — treat the request
          // as a full replacement so we don't perma-orphan the row.
        }
      }
      updates.serverConfig = encryptJson(incoming);
    }
    // Force a re-test before users can use the new config.
    updates.lastTestStatus = null;
    updates.lastTestError = null;
    updates.lastTestedAt = null;
  }

  if (existing) {
    await db
      .update(schema.notificationChannels)
      .set(updates)
      .where(eq(schema.notificationChannels.type, type));
  } else {
    await db.insert(schema.notificationChannels).values({
      type,
      enabled: updates.enabled ?? false,
      serverConfig: updates.serverConfig ?? '',
      lastTestStatus: updates.lastTestStatus ?? null,
      lastTestError: updates.lastTestError ?? null,
      lastTestedAt: updates.lastTestedAt ?? null,
      updatedBy: session.user.id,
    });
  }
  return { ok: true };
});
