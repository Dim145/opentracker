/**
 * Generic JSON webhook adapter.
 *
 * Escape hatch for everything we don't natively support — n8n,
 * Zapier, IFTTT, a homegrown server, etc. The user pastes a URL and
 * optionally a few custom headers; we POST a stable JSON envelope:
 *
 *   {
 *     "type": "upload_accepted",
 *     "title": "…",
 *     "body": "…",
 *     "link": "https://…" | null,
 *     "meta": { ... },          // original notif payload bag
 *     "timestamp": "2026-05-11T…"
 *   }
 *
 * Admin side has no config by default but exposes an optional shared
 * HMAC secret. When set, requests carry an `X-Trackarr-Signature`
 * header containing the hex SHA-256 HMAC of the body — receivers
 * can verify the request really came from this Trackarr instance.
 *
 * SSRF surface is closed by routing every outbound call through
 * `safeFetch`, which resolves the hostname, refuses every private
 * / loopback / link-local / metadata / CGNAT range, and re-checks
 * every redirect hop. A user pasting a public domain that resolves
 * to (or 30x-redirects to) 169.254.169.254 / 127.0.0.1 / 10.0.0.0/8
 * gets a clean "Refused" instead of silently exfiltrating to
 * internal infra.
 */
import { createHmac } from 'crypto';
import { safeFetch, SafeFetchError } from '../safeFetch';
import type { ChannelAdapter, NotificationPayload, TestResult } from './types';

interface WebhookServer {
  hmacSecret?: string;
}

interface WebhookUser {
  url: string;
  /** Pasted as `Key: Value` lines. Parsed at send time, capped at
   *  16 entries. Surface the parsing error to the user on test. */
  headers?: string;
}

function parseHeaders(raw: string | undefined): Record<string, string> | string {
  if (!raw || !raw.trim()) return {};
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length > 16) return 'Too many headers (max 16)';
  const out: Record<string, string> = {};
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx <= 0) return `Malformed header line: "${line}"`;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (!k || !v) return `Empty key or value in: "${line}"`;
    if (/[\r\n]/.test(v)) return `Header value contains newline: "${k}"`;
    out[k] = v;
  }
  return out;
}

async function sendWebhook(
  server: WebhookServer,
  user: WebhookUser,
  payload: NotificationPayload
): Promise<TestResult> {
  const headers = parseHeaders(user.headers);
  if (typeof headers === 'string') return { ok: false, error: headers };

  const body = JSON.stringify({
    type: payload.type,
    title: payload.title,
    body: payload.body,
    link: payload.link,
    meta: payload.meta,
    timestamp: new Date().toISOString(),
  });

  const reqHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Trackarr-Notify/1',
    ...headers,
  };
  if (server.hmacSecret) {
    reqHeaders['X-Trackarr-Signature'] = createHmac('sha256', server.hmacSecret)
      .update(body)
      .digest('hex');
  }

  try {
    const res = await safeFetch(user.url, {
      method: 'POST',
      headers: reqHeaders,
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        error: `Webhook returned ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    return { ok: true };
  } catch (err) {
    if (err instanceof SafeFetchError) return { ok: false, error: err.message };
    return { ok: false, error: (err as Error).message };
  }
}

export const webhookAdapter: ChannelAdapter<WebhookServer, WebhookUser> = {
  type: 'webhook',
  labelKey: 'admin.channels.webhook.label',
  taglineKey: 'admin.channels.webhook.tagline',
  icon: 'ph:webhooks-logo-bold',
  hasServerConfig: true,
  serverFields: [
    {
      key: 'hmacSecret',
      labelKey: 'admin.channels.webhook.fields.hmacSecret',
      hintKey: 'admin.channels.webhook.fields.hmacSecretHint',
      type: 'password',
      required: false,
      secret: true,
    },
  ],
  userFields: [
    {
      key: 'url',
      labelKey: 'admin.channels.webhook.fields.url',
      hintKey: 'admin.channels.webhook.fields.urlHint',
      type: 'url',
      required: true,
    },
    {
      key: 'headers',
      labelKey: 'admin.channels.webhook.fields.headers',
      hintKey: 'admin.channels.webhook.fields.headersHint',
      type: 'string',
      required: false,
    },
  ],
  // No real server-side check — HMAC secret is just a string. Mark
  // the channel as OK once enabled so users can configure their URL.
  testServer: async () => ({ ok: true }),
  testUser: sendWebhook,
  send: sendWebhook,
};
