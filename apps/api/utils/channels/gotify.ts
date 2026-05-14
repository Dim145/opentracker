/**
 * Gotify adapter.
 *
 * Gotify is a self-hosted push-notification server. The admin
 * configures the base URL of their instance; each user creates an
 * **Application** in Gotify (per-user) and pastes the resulting
 * Application token here.
 *
 * Wire format:
 *   POST {baseUrl}/message?token={appToken}
 *   body: { title, message, priority }
 *
 * Admin test: GET /version on the base URL. User test: POST a hello
 * message with priority 5 (default) so the user sees it pop.
 */
import { safeFetch, SafeFetchError } from '../safeFetch';
import type { ChannelAdapter, NotificationPayload, TestResult } from './types';

interface GotifyServer {
  baseUrl: string;
}

interface GotifyUser {
  appToken: string;
  priority?: number;
}

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

async function sendGotify(
  server: GotifyServer,
  user: GotifyUser,
  payload: NotificationPayload
): Promise<TestResult> {
  if (!/^https?:\/\//.test(server.baseUrl)) {
    return { ok: false, error: 'Base URL must start with http(s)://' };
  }
  if (!user.appToken) return { ok: false, error: 'Missing app token' };
  const url = `${stripTrailingSlash(server.baseUrl)}/message?token=${encodeURIComponent(user.appToken)}`;
  try {
    const res = await safeFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: payload.title,
        // Gotify renders message as Markdown when `extras` flagged;
        // we stay on plain text + an optional link footer so older
        // clients render correctly too.
        message: payload.link
          ? `${payload.body}\n\n→ ${payload.link}`
          : payload.body,
        priority: user.priority ?? 5,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        error: `Gotify returned ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    return { ok: true };
  } catch (err) {
    if (err instanceof SafeFetchError) return { ok: false, error: err.message };
    return { ok: false, error: (err as Error).message };
  }
}

export const gotifyAdapter: ChannelAdapter<GotifyServer, GotifyUser> = {
  type: 'gotify',
  labelKey: 'admin.channels.gotify.label',
  taglineKey: 'admin.channels.gotify.tagline',
  // No simple-icons entry for Gotify. `ph:broadcast-bold` is a
  // pragmatic stand-in — Gotify is a push-broadcast server, and the
  // transmission-tower glyph reads as "fan out to devices" without
  // pretending to be the real brand mark.
  icon: 'ph:broadcast-bold',
  hasServerConfig: true,
  serverFields: [
    {
      key: 'baseUrl',
      labelKey: 'admin.channels.gotify.fields.baseUrl',
      hintKey: 'admin.channels.gotify.fields.baseUrlHint',
      type: 'url',
      required: true,
    },
  ],
  userFields: [
    {
      key: 'appToken',
      labelKey: 'admin.channels.gotify.fields.appToken',
      hintKey: 'admin.channels.gotify.fields.appTokenHint',
      type: 'password',
      required: true,
      secret: true,
    },
    {
      key: 'priority',
      labelKey: 'admin.channels.gotify.fields.priority',
      hintKey: 'admin.channels.gotify.fields.priorityHint',
      type: 'int',
      required: false,
      default: 5,
    },
  ],
  // Users point their Gotify mobile app at the same server URL the
  // admin configured — surface it so they don't have to guess.
  publicServerInfo: (server) => [
    { labelKey: 'admin.channels.gotify.publicServer', value: server.baseUrl },
  ],
  testServer: async (server) => {
    if (!/^https?:\/\//.test(server.baseUrl)) {
      return { ok: false, error: 'Base URL must start with http(s)://' };
    }
    try {
      const res = await safeFetch(
        `${stripTrailingSlash(server.baseUrl)}/version`,
        { method: 'GET' }
      );
      if (!res.ok) {
        return { ok: false, error: `Gotify returned ${res.status}` };
      }
      return { ok: true };
    } catch (err) {
      if (err instanceof SafeFetchError) return { ok: false, error: err.message };
      return { ok: false, error: (err as Error).message };
    }
  },
  testUser: sendGotify,
  send: sendGotify,
};
