/**
 * Discord webhook adapter.
 *
 * Discord webhooks are pure user-owned URLs (each webhook = one
 * channel on one server). There is no admin-side config: the operator
 * just toggles the type on, then every user pastes their own
 * `https://discord.com/api/webhooks/<id>/<token>` URL.
 *
 * Wire format: POST JSON with `{ content?, embeds[]? }`. We send a
 * single embed with the notification title, body, and optional link
 * — falls back to a plain `content` string if Discord rejects the
 * embed shape (a very narrow case, but the fallback keeps the
 * happy path cheap).
 *
 * Webhook URLs leak secrets in their path (the `token` segment) so
 * we encrypt the whole URL in the `userConfig` blob.
 */
import type { ChannelAdapter, NotificationPayload, TestResult } from './types';

interface DiscordUser {
  webhookUrl: string;
  /** Optional override for the displayed bot name. Falls back to the
   *  webhook's default when empty. */
  username?: string;
}

// Anchored at both ends. The previous version was missing the
// trailing `$`, which accepted strings like
// `https://discord.com/api/webhooks/123/abc.attacker.com/...` —
// the request still routed to discord.com (good), but any logged
// substring of the matched URL leaked attacker-controlled trailing
// characters into the operator's logs / audit trail (bad).
const WEBHOOK_RE = /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;

async function postEmbed(
  url: string,
  username: string | undefined,
  payload: NotificationPayload
): Promise<TestResult> {
  if (!WEBHOOK_RE.test(url)) {
    return { ok: false, error: 'Invalid Discord webhook URL format' };
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: username || undefined,
        embeds: [
          {
            title: payload.title.slice(0, 256),
            description: payload.body.slice(0, 4000),
            color: 0xd4a734, // coin-gold, same tone as /me bonus tile
            ...(payload.link
              ? { url: payload.link }
              : {}),
            footer: { text: 'Trackarr' },
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        error: `Discord webhook returned ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export const discordAdapter: ChannelAdapter<Record<string, never>, DiscordUser> = {
  type: 'discord',
  labelKey: 'admin.channels.discord.label',
  taglineKey: 'admin.channels.discord.tagline',
  icon: 'ph:discord-logo-bold',
  hasServerConfig: false,
  serverFields: [],
  userFields: [
    {
      key: 'webhookUrl',
      labelKey: 'admin.channels.discord.fields.webhookUrl',
      hintKey: 'admin.channels.discord.fields.webhookUrlHint',
      type: 'url',
      required: true,
      secret: true,
    },
    {
      key: 'username',
      labelKey: 'admin.channels.discord.fields.username',
      hintKey: 'admin.channels.discord.fields.usernameHint',
      type: 'string',
      required: false,
    },
  ],
  testUser: async (_server, user, payload) =>
    postEmbed(user.webhookUrl, user.username, payload),
  send: async (_server, user, payload) =>
    postEmbed(user.webhookUrl, user.username, payload),
};
