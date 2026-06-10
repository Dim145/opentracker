/**
 * PUT /api/me/notification-channels/:type
 *
 * Upsert the user's row for one channel. Body carries:
 *   - `enabled` — optional boolean (default true on create)
 *   - `userConfig` — channel-specific blob, validated loosely and
 *     encrypted before persistence
 *
 * Re-encryption rule: changing the user config clears the
 * `lastTest*` columns so the UI prompts for a re-test, mirroring the
 * admin-side behaviour.
 *
 * The admin row must be enabled + tested-ok before any user row can
 * land. We re-check the gate here rather than trusting the UI.
 */
import { db, schema } from '@trackarr/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import {
  encryptJson,
  decryptJson,
  assertChannelEncryptionReady,
} from '~~/utils/channelSecrets';
import { getAdapter } from '~~/utils/channels';

const bodySchema = z.object({
  enabled: z.boolean().optional(),
  userConfig: z.record(z.string(), z.unknown()).optional(),
});

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  const type = getRouterParam(event, 'type') ?? '';
  const adapter = getAdapter(type);
  if (!adapter) {
    throw createError({ statusCode: 404, statusMessage: 'Unknown channel' });
  }

  const adminRow = await db.query.notificationChannels.findFirst({
    where: eq(schema.notificationChannels.type, type),
  });
  if (!adminRow || !adminRow.enabled || adminRow.lastTestStatus !== 'ok') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Channel is not available right now',
    });
  }

  const raw = await readBody(event);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid body' });
  }

  // Shape + size validation (finding L28). userConfig was stored as a
  // free z.record(z.unknown()), so a user could persist an arbitrarily
  // large blob (bloating the encrypted column) or shape-malformed config
  // that silently breaks their own fan-out. Reject unknown keys, oversize
  // values, and non-primitive types up front.
  if (parsed.data.userConfig !== undefined) {
    const allowedKeys = new Set(adapter.userFields.map((f) => f.key));
    const MAX_VALUE_LEN = 4096;
    const entries = Object.entries(parsed.data.userConfig);
    if (entries.length > allowedKeys.size) {
      throw createError({ statusCode: 400, statusMessage: 'Too many config fields' });
    }
    for (const [key, value] of entries) {
      if (!allowedKeys.has(key)) {
        throw createError({
          statusCode: 400,
          statusMessage: `Unknown config field: ${key}`,
        });
      }
      if (typeof value === 'string' && value.length > MAX_VALUE_LEN) {
        throw createError({
          statusCode: 413,
          statusMessage: `Config field "${key}" exceeds ${MAX_VALUE_LEN} characters`,
        });
      }
      if (
        value !== null &&
        typeof value !== 'string' &&
        typeof value !== 'number' &&
        typeof value !== 'boolean'
      ) {
        throw createError({
          statusCode: 400,
          statusMessage: `Config field "${key}" has an unsupported type`,
        });
      }
    }
  }

  assertChannelEncryptionReady();

  const existing = await db.query.userNotificationChannels.findFirst({
    where: and(
      eq(schema.userNotificationChannels.userId, user.id),
      eq(schema.userNotificationChannels.channelType, type)
    ),
  });

  const updates: Partial<typeof schema.userNotificationChannels.$inferInsert> = {};
  if (typeof parsed.data.enabled === 'boolean') {
    updates.enabled = parsed.data.enabled;
  }
  if (parsed.data.userConfig !== undefined) {
    // Merge with the existing decrypted config so secret fields the
    // UI omits (because the user didn't re-type them) keep their
    // current value. Non-secret fields are taken from the request
    // as-is — that's the only way the user can clear an optional
    // string (e.g. ntfy priority override). Required non-secret
    // fields are gated by the UI's `canSave` check.
    const incoming: Record<string, unknown> = { ...parsed.data.userConfig };
    if (existing?.userConfig) {
      try {
        const old =
          (decryptJson(existing.userConfig) as Record<string, unknown> | null) ??
          {};
        for (const f of adapter.userFields) {
          if (f.secret && !(f.key in incoming) && f.key in old) {
            incoming[f.key] = old[f.key];
          }
        }
      } catch {
        // Decrypt failed (key rotated, drift) — treat the request
        // as a full replacement so the row stops being permanently
        // unrecoverable.
      }
    }
    updates.userConfig = encryptJson(incoming);
    updates.lastTestStatus = null;
    updates.lastTestError = null;
    updates.lastTestedAt = null;
    updates.consecutiveFailures = 0;
  }

  if (existing) {
    await db
      .update(schema.userNotificationChannels)
      .set(updates)
      .where(eq(schema.userNotificationChannels.id, existing.id));
    return { ok: true, id: existing.id };
  }

  // New row: enabled defaults to true, config must be present.
  if (!updates.userConfig) {
    throw createError({
      statusCode: 400,
      statusMessage: 'userConfig is required on first save',
    });
  }
  const id = uuidv4();
  await db.insert(schema.userNotificationChannels).values({
    id,
    userId: user.id,
    channelType: type,
    enabled: updates.enabled ?? true,
    userConfig: updates.userConfig,
  });
  return { ok: true, id };
});
