/**
 * Apprise sidecar adapter.
 *
 * Apprise (https://github.com/caronc/apprise-api) is a Python service
 * that unifies 100+ notification services behind URL strings like
 * `tgram://botToken/chatId` or `mailto://user:pass@server`. Trackarr's
 * native channels cover the common 10 — this adapter is the escape
 * hatch for users who want the long tail (KakaoTalk, LINE, Twilio
 * voice, IFTTT-by-URL, etc.).
 *
 * The admin runs `caronc/apprise` as a Docker sidecar and pastes the
 * service URL (e.g. `http://apprise:8000`). Each user pastes an
 * Apprise-flavoured URL into their user-side config. The dispatcher
 * POSTs to `${apiUrl}/notify` with `{ urls, title, body, type }`.
 *
 * Stateless mode: we never use Apprise's stash storage — secrets stay
 * in our DB (encrypted), Apprise just delivers.
 */
import type { ChannelAdapter, NotificationPayload, TestResult } from './types';

interface AppriseServer {
  apiUrl: string;
}

interface AppriseUser {
  appriseUrl: string;
}

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

async function sendApprise(
  server: AppriseServer,
  user: AppriseUser,
  payload: NotificationPayload
): Promise<TestResult> {
  if (!/^https?:\/\//.test(server.apiUrl)) {
    return { ok: false, error: 'Apprise API URL must start with http(s)://' };
  }
  if (!user.appriseUrl.trim()) {
    return { ok: false, error: 'Missing Apprise destination URL' };
  }
  try {
    const res = await fetch(`${stripTrailingSlash(server.apiUrl)}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        urls: user.appriseUrl,
        title: payload.title,
        body: payload.link
          ? `${payload.body}\n\n→ ${payload.link}`
          : payload.body,
        type: 'info',
        format: 'text',
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        error: `Apprise returned ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export const appriseAdapter: ChannelAdapter<AppriseServer, AppriseUser> = {
  type: 'apprise',
  labelKey: 'admin.channels.apprise.label',
  taglineKey: 'admin.channels.apprise.tagline',
  // No simple-icons entry for Apprise. The service is a fan-out
  // router by nature — `tree-structure` reads as "one input, many
  // outputs" which captures Apprise's role in the channel registry.
  icon: 'ph:tree-structure-bold',
  hasServerConfig: true,
  serverFields: [
    {
      key: 'apiUrl',
      labelKey: 'admin.channels.apprise.fields.apiUrl',
      hintKey: 'admin.channels.apprise.fields.apiUrlHint',
      type: 'url',
      required: true,
    },
  ],
  userFields: [
    {
      key: 'appriseUrl',
      labelKey: 'admin.channels.apprise.fields.appriseUrl',
      hintKey: 'admin.channels.apprise.fields.appriseUrlHint',
      type: 'string',
      required: true,
      secret: true,
    },
  ],
  testServer: async (server) => {
    if (!/^https?:\/\//.test(server.apiUrl)) {
      return { ok: false, error: 'Apprise API URL must start with http(s)://' };
    }
    try {
      const res = await fetch(
        `${stripTrailingSlash(server.apiUrl)}/status`,
        { method: 'GET' }
      );
      // Older apprise-api releases don't expose /status; fall back to
      // a HEAD on the root which always responds when the server is
      // up.
      if (res.ok) return { ok: true };
      const head = await fetch(stripTrailingSlash(server.apiUrl), {
        method: 'HEAD',
      });
      if (head.ok) return { ok: true };
      return { ok: false, error: `Server returned ${res.status}` };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  },
  testUser: sendApprise,
  send: sendApprise,
};
