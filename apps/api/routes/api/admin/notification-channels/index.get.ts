/**
 * GET /api/admin/notification-channels
 *
 * Lists every channel adapter known to the registry, hydrated with
 * its current admin row state (enabled flag, last test result). The
 * UI uses this to render the configuration page with one card per
 * channel — the cards know whether each channel needs a server-side
 * form, when it was last tested, and the error text from the last
 * failed test if any.
 *
 * **Never** returns the decrypted server config — that stays on the
 * server. The UI only shows whether a config is present (the
 * `configured` flag) and re-asks the admin to type secrets when
 * they want to update.
 */
import { requireAdminSession } from '~~/utils/adminAuth';
import {
  ALL_CHANNEL_TYPES,
  listChannelMetas,
  getAdapter,
} from '~~/utils/channels';
import { decryptJson } from '~~/utils/channelSecrets';
import { db, schema } from '@trackarr/db';
import { inArray } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);

  const metas = listChannelMetas();
  const rows = await db.query.notificationChannels.findMany({
    where: inArray(schema.notificationChannels.type, ALL_CHANNEL_TYPES),
  });
  const byType = new Map(rows.map((r) => [r.type, r]));

  return {
    channels: metas.map((m) => {
      const row = byType.get(m.type);
      const adapter = getAdapter(m.type);

      // Same approach as the user-side endpoint: decrypt the stored
      // server config so the admin UI can re-hydrate non-secret
      // fields (SMTP host/port/from, ntfy baseUrl, …). Secret
      // fields (SMTP password, Telegram bot token, webhook HMAC
      // secret, …) are stripped — the form falls back to the
      // "(unchanged — leave blank)" placeholder so passwords are
      // never echoed back over the wire.
      let serverValues: Record<string, unknown> = {};
      if (row?.serverConfig) {
        try {
          const all = (decryptJson(row.serverConfig) as Record<string, unknown> | null) ?? {};
          for (const f of m.serverFields) {
            if (f.secret) continue;
            if (f.key in all) serverValues[f.key] = all[f.key];
          }
        } catch {
          // Decrypt failed (key rotated, ciphertext drift) — show
          // an empty form. The admin retypes everything.
        }
      }

      return {
        type: m.type,
        labelKey: m.labelKey,
        taglineKey: m.taglineKey,
        icon: m.icon,
        hasServerConfig: m.hasServerConfig,
        serverFields: m.serverFields,
        userFields: m.userFields,
        enabled: row?.enabled ?? false,
        configured: !!row?.serverConfig,
        lastTestStatus: row?.lastTestStatus ?? null,
        lastTestError: row?.lastTestError ?? null,
        lastTestedAt: row?.lastTestedAt?.toISOString() ?? null,
        defaults: adapter?.serverDefaults?.() ?? {},
        serverValues,
      };
    }),
  };
});
