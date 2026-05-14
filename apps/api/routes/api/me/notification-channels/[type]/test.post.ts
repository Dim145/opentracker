/**
 * POST /api/me/notification-channels/:type/test
 *
 * Sends a synthetic notification through the channel using the
 * current admin + user configs. Used by the "Test" button in
 * /settings so users can confirm the round-trip without waiting for
 * a real event.
 *
 * Resets `consecutiveFailures` on success so a previously-tripped
 * channel re-opens after the user fixes their config.
 */
import { db, schema } from '@trackarr/db';
import { and, eq } from 'drizzle-orm';
import { decryptJson } from '~~/utils/channelSecrets';
import { getAdapter } from '~~/utils/channels';
import { renderNotification, buildTestPayload } from '~~/utils/notifyRenderer';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  // Every test is a real send. Without a budget, a signed-in user
  // could flood SMTP / Telegram / a third-party webhook URL they
  // own — abusing the upstream's rate limits at our IP's expense,
  // and exfiltrating internal probe results via the `lastTestError`
  // field the UI surfaces back to them.
  await rateLimit(event, RATE_LIMITS.mutation);
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
  const userRow = await db.query.userNotificationChannels.findFirst({
    where: and(
      eq(schema.userNotificationChannels.userId, user.id),
      eq(schema.userNotificationChannels.channelType, type)
    ),
  });
  if (!userRow) {
    throw createError({ statusCode: 400, statusMessage: 'Not configured yet' });
  }

  let result: { ok: true } | { ok: false; error: string };
  try {
    const server = adminRow.serverConfig
      ? decryptJson(adminRow.serverConfig)
      : {};
    const userCfg = decryptJson(userRow.userConfig);
    if (!userCfg) throw new Error('User config is empty');

    // Locale-aware rendering for the synthetic payload — gives the
    // user a preview that matches what they'll actually receive.
    const userRec = await db.query.users.findFirst({
      where: eq(schema.users.id, user.id),
      columns: { language: true },
    });
    const payload = buildTestPayload();
    const rendered = renderNotification(
      'upload_accepted',
      payload,
      userRec?.language ?? 'en'
    );

    result = await adapter.testUser(server, userCfg, {
      type: 'upload_accepted',
      title: rendered.title,
      body: rendered.body,
      link: null,
      meta: payload,
    });
  } catch (err) {
    result = { ok: false, error: (err as Error).message };
  }

  await db
    .update(schema.userNotificationChannels)
    .set({
      lastTestStatus: result.ok ? 'ok' : 'error',
      lastTestError: result.ok ? null : result.error.slice(0, 500),
      lastTestedAt: new Date(),
      ...(result.ok ? { consecutiveFailures: 0 } : {}),
    })
    .where(eq(schema.userNotificationChannels.id, userRow.id));

  return result;
});
