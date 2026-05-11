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
 * SSRF caveat: we deliberately allow any http(s) URL since the user
 * pastes it themselves (the same user owns the destination). We
 * still block `localhost`/`127.0.0.1`/private-range hosts to avoid a
 * user accidentally pointing at internal infra — fail closed.
 */
import { createHmac } from 'crypto';
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

function isPrivateHost(host: string): boolean {
  if (host === 'localhost' || host === '0.0.0.0') return true;
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  // IPv6 loopback + link-local
  if (host === '::1' || /^fe80:/i.test(host) || /^fc/i.test(host)) return true;
  return false;
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
  let parsed: URL;
  try {
    parsed = new URL(user.url);
  } catch {
    return { ok: false, error: 'Invalid URL' };
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    return { ok: false, error: 'URL must be http or https' };
  }
  if (isPrivateHost(parsed.hostname)) {
    return {
      ok: false,
      error: 'Refused: webhook URL points to a private/loopback address',
    };
  }
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
    const res = await fetch(user.url, {
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
