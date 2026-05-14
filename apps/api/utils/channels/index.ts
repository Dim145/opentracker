/**
 * Channel registry + dispatcher.
 *
 * Single source of truth for every supported external transport.
 * Routes (admin + user) and the dispatcher loop never branch on
 * channel type — they look up the adapter here and call its methods
 * uniformly.
 *
 * Adding a new channel is one file under `./<type>.ts` exporting a
 * `ChannelAdapter` plus one entry in `ADAPTERS` below. Everything
 * else (admin form, user form, test endpoints, dispatcher) picks it
 * up automatically.
 */
import { db } from '@trackarr/db';
import {
  notificationChannels,
  userNotificationChannels,
} from '@trackarr/db/schema';
import { and, eq } from 'drizzle-orm';
import { decryptJson } from '../channelSecrets';
import { appriseAdapter } from './apprise';
import { discordAdapter } from './discord';
import { gotifyAdapter } from './gotify';
import { mattermostAdapter } from './mattermost';
import { ntfyAdapter } from './ntfy';
import { pushoverAdapter } from './pushover';
import { slackAdapter } from './slack';
import { smtpAdapter } from './smtp';
import { telegramAdapter } from './telegram';
import { webhookAdapter } from './webhook';
import { webpushAdapter } from './webpush';
import type {
  ChannelAdapter,
  ChannelMeta,
  NotificationPayload,
  TestResult,
} from './types';

export const ADAPTERS = {
  smtp: smtpAdapter,
  telegram: telegramAdapter,
  discord: discordAdapter,
  slack: slackAdapter,
  mattermost: mattermostAdapter,
  ntfy: ntfyAdapter,
  gotify: gotifyAdapter,
  pushover: pushoverAdapter,
  webhook: webhookAdapter,
  apprise: appriseAdapter,
  web_push: webpushAdapter,
} as const satisfies Record<string, ChannelAdapter<any, any>>;

export type ChannelType = keyof typeof ADAPTERS;

export const ALL_CHANNEL_TYPES = Object.keys(ADAPTERS) as ChannelType[];

export function getAdapter(type: string): ChannelAdapter<any, any> | null {
  if (!(type in ADAPTERS)) return null;
  return ADAPTERS[type as ChannelType];
}

/**
 * Lightweight metadata about every channel — shape the admin + user
 * UIs need to render their forms. No secrets, no DB state.
 */
export function listChannelMetas(): ChannelMeta[] {
  return ALL_CHANNEL_TYPES.map((type) => {
    const a = ADAPTERS[type];
    return {
      type,
      labelKey: a.labelKey,
      taglineKey: a.taglineKey,
      icon: a.icon,
      hasServerConfig: a.hasServerConfig,
      serverFields: a.serverFields,
      userFields: a.userFields,
    };
  });
}

/**
 * Decrypt the server config for a channel, or null if the row exists
 * but has no config (Discord/Slack/Mattermost) or the type isn't
 * known. Throws on auth-tag mismatch — callers should catch and mark
 * the channel as broken.
 */
async function loadServerConfig(type: string): Promise<unknown | null> {
  const row = await db.query.notificationChannels.findFirst({
    where: eq(notificationChannels.type, type),
  });
  if (!row || !row.enabled) return null;
  if (!row.serverConfig) return {};
  return decryptJson(row.serverConfig);
}

async function loadUserConfig(
  userId: string,
  type: string
): Promise<unknown | null> {
  const row = await db.query.userNotificationChannels.findFirst({
    where: and(
      eq(userNotificationChannels.userId, userId),
      eq(userNotificationChannels.channelType, type)
    ),
  });
  if (!row || !row.enabled) return null;
  return decryptJson(row.userConfig);
}

/**
 * Send a real (non-test) notification through `channelType` for
 * `userId`. Loads + decrypts both configs, dispatches to the adapter,
 * and returns the adapter's result. Failures are surfaced — the
 * dispatcher in `notify.ts` records them against the user-channel row
 * for the circuit breaker.
 */
export async function sendThroughChannel(
  userId: string,
  channelType: string,
  payload: NotificationPayload
): Promise<TestResult> {
  const adapter = getAdapter(channelType);
  if (!adapter) {
    return { ok: false, error: `Unknown channel type: ${channelType}` };
  }
  let server: unknown;
  let user: unknown;
  try {
    server = await loadServerConfig(channelType);
    if (server === null && adapter.hasServerConfig) {
      return { ok: false, error: 'Channel disabled or not configured by admin' };
    }
    user = await loadUserConfig(userId, channelType);
    if (user === null) {
      return { ok: false, error: 'User channel disabled or missing' };
    }
  } catch (err) {
    return {
      ok: false,
      error: `Config decrypt failed: ${(err as Error).message}`,
    };
  }
  try {
    return await adapter.send(
      server ?? {},
      user,
      payload
    );
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// Types live in ./types — import them from there directly. Re-
// exporting here would have Nitro's auto-import scanner register
// the same name from two files and emit a "Duplicated imports"
// warning at build time.
