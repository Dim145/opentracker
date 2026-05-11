/**
 * Slack incoming-webhook adapter.
 *
 * Same shape as Discord — the user owns the webhook URL, the admin
 * just enables the type. Slack's incoming webhook accepts a JSON
 * body with `text` plus optional `blocks` for rich layout. We send
 * a small block kit message: header (title), section (body), and a
 * context line linking back to Trackarr when a deep link exists.
 */
import type { ChannelAdapter, NotificationPayload, TestResult } from './types';

interface SlackUser {
  webhookUrl: string;
}

const WEBHOOK_RE = /^https:\/\/hooks\.slack\.com\/(?:services|triggers)\/[\w/]+/;

async function postBlocks(
  url: string,
  payload: NotificationPayload
): Promise<TestResult> {
  if (!WEBHOOK_RE.test(url)) {
    return { ok: false, error: 'Invalid Slack webhook URL format' };
  }
  const blocks: unknown[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: payload.title.slice(0, 150) },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: payload.body.slice(0, 3000) },
    },
  ];
  if (payload.link) {
    blocks.push({
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `<${payload.link}|Open in Trackarr>` },
      ],
    });
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: payload.title, // fallback for clients without blocks
        blocks,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        error: `Slack returned ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export const slackAdapter: ChannelAdapter<Record<string, never>, SlackUser> = {
  type: 'slack',
  labelKey: 'admin.channels.slack.label',
  taglineKey: 'admin.channels.slack.tagline',
  icon: 'ph:slack-logo-bold',
  hasServerConfig: false,
  serverFields: [],
  userFields: [
    {
      key: 'webhookUrl',
      labelKey: 'admin.channels.slack.fields.webhookUrl',
      hintKey: 'admin.channels.slack.fields.webhookUrlHint',
      type: 'url',
      required: true,
      secret: true,
    },
  ],
  testUser: async (_server, user, payload) =>
    postBlocks(user.webhookUrl, payload),
  send: async (_server, user, payload) =>
    postBlocks(user.webhookUrl, payload),
};
