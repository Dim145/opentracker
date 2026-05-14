/**
 * ntfy.sh adapter.
 *
 * ntfy is the simplest of the bunch: PUT/POST to
 * `https://<server>/<topic>` with the body as the message text. Title
 * goes in the `Title` header; deep links in `Click`.
 *
 * Admin sets the base URL (defaults to `https://ntfy.sh`, can be
 * pointed at a self-hosted instance). User chooses a topic name —
 * ntfy topics are public by default, so we don't even encrypt the
 * topic field too aggressively; admins who care about confidentiality
 * should host their own server with auth and put the credentials in
 * a custom URL.
 *
 * Admin test: HEAD on the base URL to confirm it responds.
 * User test: POST a "hello" notification to the user's topic.
 */
import { safeFetch, SafeFetchError } from '../safeFetch';
import type { ChannelAdapter, NotificationPayload, TestResult } from './types';

interface NtfyServer {
  baseUrl: string;
  /** Optional auth header (e.g. `Bearer …` or `Basic …`) — passed
   *  verbatim by the admin for protected ntfy instances. */
  authHeader?: string;
}

interface NtfyUser {
  topic: string;
  /** 1..5; defaults to 3 (default). Lets the user tag urgent traffic
   *  (e.g. moderation HnR) with higher priority. */
  priority?: number;
}

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

function buildUrl(baseUrl: string, topic: string): string | null {
  const base = stripTrailingSlash(baseUrl);
  if (!/^https?:\/\//.test(base)) return null;
  if (!/^[\w-]+$/.test(topic)) return null;
  return `${base}/${topic}`;
}

async function sendNtfy(
  server: NtfyServer,
  user: NtfyUser,
  payload: NotificationPayload
): Promise<TestResult> {
  const url = buildUrl(server.baseUrl, user.topic);
  if (!url) return { ok: false, error: 'Invalid base URL or topic name' };
  const headers: Record<string, string> = {
    Title: payload.title.slice(0, 250),
    Priority: String(user.priority ?? 3),
    Tags: 'bell',
  };
  if (payload.link) headers.Click = payload.link;
  if (server.authHeader) headers.Authorization = server.authHeader;
  try {
    const res = await safeFetch(url, {
      method: 'POST',
      headers,
      body: payload.body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        error: `ntfy returned ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    return { ok: true };
  } catch (err) {
    if (err instanceof SafeFetchError) return { ok: false, error: err.message };
    return { ok: false, error: (err as Error).message };
  }
}

export const ntfyAdapter: ChannelAdapter<NtfyServer, NtfyUser> = {
  type: 'ntfy',
  labelKey: 'admin.channels.ntfy.label',
  taglineKey: 'admin.channels.ntfy.tagline',
  icon: 'simple-icons:ntfy',
  hasServerConfig: true,
  serverFields: [
    {
      key: 'baseUrl',
      labelKey: 'admin.channels.ntfy.fields.baseUrl',
      hintKey: 'admin.channels.ntfy.fields.baseUrlHint',
      type: 'url',
      required: true,
      default: 'https://ntfy.sh',
    },
    {
      key: 'authHeader',
      labelKey: 'admin.channels.ntfy.fields.authHeader',
      hintKey: 'admin.channels.ntfy.fields.authHeaderHint',
      type: 'password',
      required: false,
      secret: true,
    },
  ],
  userFields: [
    {
      key: 'topic',
      labelKey: 'admin.channels.ntfy.fields.topic',
      hintKey: 'admin.channels.ntfy.fields.topicHint',
      type: 'string',
      required: true,
    },
    {
      key: 'priority',
      labelKey: 'admin.channels.ntfy.fields.priority',
      hintKey: 'admin.channels.ntfy.fields.priorityHint',
      type: 'int',
      required: false,
      default: 3,
    },
  ],
  serverDefaults: () => ({ baseUrl: 'https://ntfy.sh' }),
  // Expose the server URL so users know which instance to point
  // their mobile ntfy app at. Subscribing on the wrong server is
  // the #1 confusion with self-hosted setups, so the user UI
  // displays this prominently next to the topic field.
  publicServerInfo: (server) => [
    { labelKey: 'admin.channels.ntfy.publicInstance', value: server.baseUrl },
  ],
  testServer: async (server) => {
    if (!/^https?:\/\//.test(server.baseUrl)) {
      return { ok: false, error: 'Base URL must start with http(s)://' };
    }
    try {
      const res = await safeFetch(stripTrailingSlash(server.baseUrl) + '/v1/health', {
        method: 'GET',
        headers: server.authHeader
          ? { Authorization: server.authHeader }
          : undefined,
      });
      if (res.ok) return { ok: true };
      // ntfy.sh has the endpoint; self-hosted instances may not — fall
      // back to a HEAD on the root which always answers if the
      // server is up.
      const head = await safeFetch(stripTrailingSlash(server.baseUrl), {
        method: 'HEAD',
      });
      return head.ok
        ? { ok: true }
        : { ok: false, error: `Server returned ${head.status}` };
    } catch (err) {
      if (err instanceof SafeFetchError) return { ok: false, error: err.message };
      return { ok: false, error: (err as Error).message };
    }
  },
  testUser: sendNtfy,
  send: sendNtfy,
};
