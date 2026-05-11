/**
 * POST /api/admin/notification-channels/:type/test
 *
 * Runs the adapter's `testServer` against the current admin row.
 * Stores the result in `lastTestStatus` / `lastTestError` so the UI
 * can show it without a re-fetch.
 *
 * For channels without admin-side config (Discord/Slack/Mattermost
 * webhooks), the adapter's `testServer` is omitted; we treat that
 * as an automatic "ok" so the gate that exposes the channel to
 * users opens immediately once the admin toggles it on.
 */
import { requireAdminSession } from '~~/utils/adminAuth';
import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { decryptJson } from '~~/utils/channelSecrets';
import { getAdapter } from '~~/utils/channels';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  const type = getRouterParam(event, 'type') ?? '';
  const adapter = getAdapter(type);
  if (!adapter) {
    throw createError({ statusCode: 404, statusMessage: 'Unknown channel' });
  }

  const row = await db.query.notificationChannels.findFirst({
    where: eq(schema.notificationChannels.type, type),
  });
  if (!row) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Channel has no configuration yet',
    });
  }

  let result: { ok: true } | { ok: false; error: string };
  if (!adapter.hasServerConfig || !adapter.testServer) {
    // Pure user-owned channels (Discord/Slack/Mattermost): nothing
    // to validate server-side. Accept as OK so users get access.
    result = { ok: true };
  } else {
    try {
      const config = row.serverConfig ? decryptJson(row.serverConfig) : {};
      result = await adapter.testServer(config);
    } catch (err) {
      result = { ok: false, error: (err as Error).message };
    }
  }

  await db
    .update(schema.notificationChannels)
    .set({
      lastTestStatus: result.ok ? 'ok' : 'error',
      lastTestError: result.ok ? null : result.error.slice(0, 500),
      lastTestedAt: new Date(),
    })
    .where(eq(schema.notificationChannels.type, type));

  return result;
});
