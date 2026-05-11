/**
 * Telegram bot adapter.
 *
 * Workflow:
 *   1. Admin creates a bot through @BotFather, pastes the bot token.
 *   2. Each user sends a message to the bot, then uses the `getUpdates`
 *      endpoint (or @userinfobot) to find their `chat_id`. They paste
 *      that into the user-side form.
 *   3. We POST to `bot<token>/sendMessage` with parse_mode=HTML for
 *      basic formatting.
 *
 * The bot token is the only real secret — it's stored in the admin
 * row, encrypted at rest. `chat_id` is more like a routing key but
 * we still encrypt it: anyone with the token + the id can DM the
 * user impersonating Trackarr.
 *
 * Admin test: `getMe` — proves the token is valid without spamming
 * a user. User test: `sendMessage` to the configured chat_id.
 */
import type { ChannelAdapter, NotificationPayload, TestResult } from './types';

interface TelegramServer {
  botToken: string;
}

interface TelegramUser {
  chatId: string;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function renderHtml(payload: NotificationPayload): string {
  const lines = [`<b>${escapeHtml(payload.title)}</b>`, '', escapeHtml(payload.body)];
  if (payload.link) {
    lines.push('', `<a href="${escapeHtml(payload.link)}">Open in Trackarr</a>`);
  }
  return lines.join('\n');
}

async function api<T>(token: string, method: string, body: Record<string, unknown>): Promise<{ ok: true; result: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: T };
    if (!data.ok) {
      return { ok: false, error: data.description || `HTTP ${res.status}` };
    }
    return { ok: true, result: data.result as T };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export const telegramAdapter: ChannelAdapter<TelegramServer, TelegramUser> = {
  type: 'telegram',
  labelKey: 'admin.channels.telegram.label',
  taglineKey: 'admin.channels.telegram.tagline',
  icon: 'ph:telegram-logo-bold',
  hasServerConfig: true,
  serverFields: [
    {
      key: 'botToken',
      labelKey: 'admin.channels.telegram.fields.botToken',
      hintKey: 'admin.channels.telegram.fields.botTokenHint',
      type: 'password',
      required: true,
      secret: true,
    },
  ],
  userFields: [
    {
      key: 'chatId',
      labelKey: 'admin.channels.telegram.fields.chatId',
      hintKey: 'admin.channels.telegram.fields.chatIdHint',
      type: 'string',
      required: true,
      secret: true,
    },
  ],
  testServer: async (server) => {
    const r = await api<{ username?: string }>(server.botToken, 'getMe', {});
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  },
  testUser: async (server, user, payload) => {
    const r = await api(server.botToken, 'sendMessage', {
      chat_id: user.chatId,
      text: renderHtml(payload),
      parse_mode: 'HTML',
      disable_web_page_preview: false,
    });
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  },
  send: async (server, user, payload) => {
    const r = await api(server.botToken, 'sendMessage', {
      chat_id: user.chatId,
      text: renderHtml(payload),
      parse_mode: 'HTML',
      disable_web_page_preview: false,
    });
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  },
};
