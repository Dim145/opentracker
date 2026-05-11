/**
 * GET /api/me/notification-channels
 *
 * Returns the set of channels the user can configure. A channel is
 * "available" iff the admin row exists, is enabled, AND the last
 * admin test passed — that's the gate from the design ("section
 * notifications apparait dans /settings if au moins un canal est
 * activé et fonctionnel").
 *
 * For each available channel we include:
 *   - the meta (label, icon, user-side fields the UI renders)
 *   - the user's row state if they already configured it
 *
 * Plus the user's routing rows so the UI can hydrate the per-type
 * picker without a second round-trip.
 *
 * Never returns decrypted user-side config either — same reasoning
 * as the admin route. Editing a value means re-entering it.
 */
import { listChannelMetas, getAdapter } from '~~/utils/channels';
import { decryptJson } from '~~/utils/channelSecrets';
import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);

  const allMeta = listChannelMetas();
  const adminRows = await db.query.notificationChannels.findMany({});
  const byType = new Map(adminRows.map((r) => [r.type, r]));
  const availableMeta = allMeta.filter((m) => {
    const row = byType.get(m.type);
    return row?.enabled && row.lastTestStatus === 'ok';
  });

  const userRows = await db.query.userNotificationChannels.findMany({
    where: eq(schema.userNotificationChannels.userId, user.id),
  });
  const userByType = new Map(userRows.map((r) => [r.channelType, r]));

  const routingRows = await db.query.userNotificationRouting.findMany({
    where: eq(schema.userNotificationRouting.userId, user.id),
  });

  return {
    channels: availableMeta.map((m) => {
      const row = userByType.get(m.type);
      const adapter = getAdapter(m.type);

      // Decrypt the user's stored values so the UI can re-hydrate
      // non-secret fields (ntfy topic, SMTP "to", Gotify priority,
      // …). Secret fields are filtered out — the UI hides them
      // behind a "(unchanged — leave blank)" placeholder so users
      // never see their tokens echoed back.
      let userValues: Record<string, unknown> = {};
      if (row?.userConfig) {
        try {
          const all = (decryptJson(row.userConfig) as Record<string, unknown> | null) ?? {};
          for (const f of m.userFields) {
            if (f.secret) continue;
            if (f.key in all) userValues[f.key] = all[f.key];
          }
        } catch {
          // Decrypt error → leave userValues empty. The UI shows
          // the channel as "needs reconfig" via the lastTest error.
        }
      }

      // Public server info — currently just the ntfy/Gotify base URL,
      // so users can point their mobile app at the right instance.
      // We resolve it best-effort: if the admin row decrypt fails we
      // just omit the block rather than 500-ing the whole response.
      let publicServerInfo: Array<{ labelKey: string; value: string }> = [];
      const adminRow = byType.get(m.type);
      if (adapter?.publicServerInfo && adminRow?.serverConfig) {
        try {
          const cfg = decryptJson(adminRow.serverConfig);
          if (cfg) publicServerInfo = adapter.publicServerInfo(cfg as never);
        } catch {
          // ignore
        }
      }

      return {
        type: m.type,
        labelKey: m.labelKey,
        taglineKey: m.taglineKey,
        icon: m.icon,
        userFields: m.userFields,
        configured: !!row,
        enabled: row?.enabled ?? false,
        lastTestStatus: row?.lastTestStatus ?? null,
        lastTestError: row?.lastTestError ?? null,
        lastTestedAt: row?.lastTestedAt?.toISOString() ?? null,
        userValues,
        publicServerInfo,
      };
    }),
    routing: routingRows.map((r) => ({ type: r.type, channelType: r.channelType })),
  };
});
