/**
 * Mattermost incoming-webhook adapter.
 *
 * Mattermost re-uses Slack's incoming-webhook contract almost
 * verbatim: same JSON shape (`text` + optional `attachments` for
 * rich messages). We send a single attachment with the title as
 * the fallback + a colour + the body in plain text, and the deep
 * link as the attachment URL when present.
 */
import type { ChannelAdapter, NotificationPayload, TestResult } from './types';

interface MattermostUser {
  webhookUrl: string;
}

// Mattermost can be self-hosted, so the URL host varies. We just
// require an `/hooks/` path segment — adequate as a sanity check.
const WEBHOOK_RE = /^https?:\/\/[^/]+\/hooks\/[\w-]+/;

async function postAttachment(
  url: string,
  payload: NotificationPayload
): Promise<TestResult> {
  if (!WEBHOOK_RE.test(url)) {
    return { ok: false, error: 'Invalid Mattermost webhook URL format' };
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: payload.title,
        attachments: [
          {
            color: '#d4a734',
            title: payload.title,
            ...(payload.link ? { title_link: payload.link } : {}),
            text: payload.body,
            footer: 'Trackarr',
            ts: Math.floor(Date.now() / 1000),
          },
        ],
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        error: `Mattermost returned ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export const mattermostAdapter: ChannelAdapter<Record<string, never>, MattermostUser> = {
  type: 'mattermost',
  labelKey: 'admin.channels.mattermost.label',
  taglineKey: 'admin.channels.mattermost.tagline',
  icon: 'simple-icons:mattermost',
  hasServerConfig: false,
  serverFields: [],
  userFields: [
    {
      key: 'webhookUrl',
      labelKey: 'admin.channels.mattermost.fields.webhookUrl',
      hintKey: 'admin.channels.mattermost.fields.webhookUrlHint',
      type: 'url',
      required: true,
      secret: true,
    },
  ],
  testUser: async (_server, user, payload) =>
    postAttachment(user.webhookUrl, payload),
  send: async (_server, user, payload) =>
    postAttachment(user.webhookUrl, payload),
};
