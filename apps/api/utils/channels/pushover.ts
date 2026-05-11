/**
 * Pushover adapter.
 *
 * Pushover is a paid push-notification service popular with self-
 * hosters. The admin creates an **Application** at pushover.net to
 * get an API token; each user creates their account and finds their
 * **User Key** in the Pushover dashboard.
 *
 * Wire format:
 *   POST https://api.pushover.net/1/messages.json
 *   body: { token, user, title, message, priority?, url? }
 *
 * Admin test: hits /1/users/validate.json with a dummy user key —
 * this validates the app token without needing a real user. User
 * test: a real /messages.json send.
 */
import type { ChannelAdapter, NotificationPayload, TestResult } from './types';

interface PushoverServer {
  apiToken: string;
}

interface PushoverUser {
  userKey: string;
  /** -2..2; 0 = default. */
  priority?: number;
}

async function post(
  endpoint: string,
  body: Record<string, string | number>
): Promise<TestResult> {
  try {
    const formBody = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) formBody.set(k, String(v));
    const res = await fetch(`https://api.pushover.net/1/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody.toString(),
    });
    const data = (await res.json().catch(() => ({}))) as {
      status?: number;
      errors?: string[];
    };
    if (data.status !== 1) {
      return {
        ok: false,
        error: data.errors?.join(', ') || `HTTP ${res.status}`,
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export const pushoverAdapter: ChannelAdapter<PushoverServer, PushoverUser> = {
  type: 'pushover',
  labelKey: 'admin.channels.pushover.label',
  taglineKey: 'admin.channels.pushover.tagline',
  icon: 'ph:device-mobile-bold',
  hasServerConfig: true,
  serverFields: [
    {
      key: 'apiToken',
      labelKey: 'admin.channels.pushover.fields.apiToken',
      hintKey: 'admin.channels.pushover.fields.apiTokenHint',
      type: 'password',
      required: true,
      secret: true,
    },
  ],
  userFields: [
    {
      key: 'userKey',
      labelKey: 'admin.channels.pushover.fields.userKey',
      hintKey: 'admin.channels.pushover.fields.userKeyHint',
      type: 'password',
      required: true,
      secret: true,
    },
    {
      key: 'priority',
      labelKey: 'admin.channels.pushover.fields.priority',
      hintKey: 'admin.channels.pushover.fields.priorityHint',
      type: 'int',
      required: false,
      default: 0,
    },
  ],
  testServer: async (server) => {
    // Pushover doesn't expose a "is this token valid" endpoint, but
    // /messages.json with no recipient returns a token validation
    // error first — we POST with an obviously-invalid user key, then
    // accept either a "user invalid" response (token works) or treat
    // an "application token invalid" message as a test failure.
    try {
      const res = await fetch(
        'https://api.pushover.net/1/users/validate.json',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            token: server.apiToken,
            user: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', // 30 chars, invalid
          }).toString(),
        }
      );
      const data = (await res.json().catch(() => ({}))) as {
        status?: number;
        errors?: string[];
      };
      const tokenInvalid = (data.errors || []).some((e) =>
        /application token/i.test(e)
      );
      if (tokenInvalid) {
        return { ok: false, error: 'Application token is invalid' };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  },
  testUser: async (server, user, payload) =>
    post('messages.json', {
      token: server.apiToken,
      user: user.userKey,
      title: payload.title,
      message: payload.body,
      ...(payload.link ? { url: payload.link, url_title: 'Open in Trackarr' } : {}),
      priority: user.priority ?? 0,
    }),
  send: async (server, user, payload) =>
    post('messages.json', {
      token: server.apiToken,
      user: user.userKey,
      title: payload.title,
      message: payload.body,
      ...(payload.link ? { url: payload.link, url_title: 'Open in Trackarr' } : {}),
      priority: user.priority ?? 0,
    }),
};
