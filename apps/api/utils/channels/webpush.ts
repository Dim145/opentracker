/**
 * Web Push (browser push) adapter.
 *
 * Unlike the other transports — which all boil down to "fire an HTTP
 * call to a public endpoint" — Web Push has two ceremonies on top of
 * the actual send:
 *
 *   1. The tracker needs a VAPID key pair (RFC 8292). The public half
 *      identifies us to the push services (FCM, Mozilla, Apple), the
 *      private half signs the JWT that authenticates each push. We
 *      generate the pair once via `serverDefaults` and store both
 *      halves encrypted on the channel row — the admin never has to
 *      type a key.
 *
 *   2. Every subscribing browser performs a key exchange with the
 *      push service and hands the resulting endpoint URL + ECDH keys
 *      back to the page. The FE then POSTs that blob to
 *      `PUT /api/me/notification-channels/web_push` so it lands as
 *      the user-config — there's no manual form to fill, the
 *      "subscription" IS the config.
 *
 * The send path uses the `web-push` npm package which takes care of
 * AES-128-GCM payload encryption (RFC 8291) + the VAPID JWT. We pass
 * a JSON payload the service worker decodes and feeds to
 * `registration.showNotification`.
 *
 * Common failure cases handled here:
 *
 *   - Subscription expired (`410 Gone`): the user's browser revoked
 *     the push permission or cleared site data. We surface the error
 *     so the dispatcher's circuit breaker disables the user-channel
 *     row after enough failures, prompting them to re-subscribe.
 *   - Server keys not generated yet (admin opened the row but never
 *     saved): `sendWebPush` short-circuits with a clear message.
 */
import webpush from 'web-push';
import { validateHost, SafeFetchError } from '../safeFetch';
import type { ChannelAdapter, NotificationPayload, TestResult } from './types';

/**
 * Allow-list of real browser push-service hosts. The endpoint is fully
 * user-controlled and the `web-push` lib re-resolves DNS at connect time
 * with no private-range guard, so a `validateHost` check alone is a
 * check-time-only defence that DNS rebinding defeats (finding M10).
 * Pinning to the known push services closes the SSRF entirely: an
 * attacker can't substitute an internal target because they don't
 * control these hosts' DNS. Covers Chromium/Edge/Opera/Brave (FCM),
 * Firefox (Mozilla autopush), Safari (Apple), and legacy Windows (WNS).
 */
function isAllowedPushHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === 'fcm.googleapis.com' ||
    h === 'web.push.apple.com' ||
    h === 'updates.push.services.mozilla.com' ||
    h.endsWith('.push.services.mozilla.com') ||
    h.endsWith('.notify.windows.com')
  );
}

/**
 * Persisted server config. The public key is exposed to users (it
 * has to be — they pass it to `pushManager.subscribe`). The private
 * key never leaves the API process.
 */
interface WebPushServer {
  /** VAPID JWT `sub` field. RFC 8292 requires `mailto:` or `https:`. */
  subject: string;
  /** Base64-url-encoded uncompressed P-256 public key. ~87 chars. */
  publicKey: string;
  /** Base64-url-encoded P-256 private scalar. ~43 chars. */
  privateKey: string;
}

/**
 * Persisted user config — exactly the JSON the browser hands back
 * from `pushManager.subscribe()`. The `expirationTime` field is
 * optional and currently unused by every major push service.
 */
interface WebPushUser {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

function generateVapidPair(): { publicKey: string; privateKey: string } {
  return webpush.generateVAPIDKeys();
}

function applyVapid(server: WebPushServer): boolean {
  if (!server?.publicKey || !server?.privateKey || !server?.subject) {
    return false;
  }
  try {
    webpush.setVapidDetails(
      server.subject,
      server.publicKey,
      server.privateKey
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Payload the service worker reads in `event.data.json()`. Keep the
 * shape stable — bumping it without a coordinated SW deploy would
 * silently break every existing subscription.
 */
interface SwPayload {
  title: string;
  body: string;
  link: string | null;
  type: string;
  // Tag lets the SW collapse repeats (e.g. several "comment_on_my_upload"
  // for the same row replace each other instead of stacking).
  tag?: string;
}

async function sendWebPush(
  server: WebPushServer,
  user: WebPushUser,
  payload: NotificationPayload
): Promise<TestResult> {
  if (!applyVapid(server)) {
    return {
      ok: false,
      error:
        'Web Push server keys are missing or invalid. Open the admin panel and re-save the channel to regenerate the VAPID pair.',
    };
  }
  if (!user?.endpoint || !user?.keys?.p256dh || !user?.keys?.auth) {
    return { ok: false, error: 'User push subscription is incomplete.' };
  }
  // The endpoint is whatever the browser's pushManager.subscribe()
  // returned and was POSTed verbatim into the user-config — i.e.
  // attacker-controllable. The `web-push` lib does a bare
  // https.request to it with NO private-IP guard, so without this
  // check it is an SSRF primitive (the status/body are reflected
  // below). Validate the host through the same DNS/private-range
  // gate safeFetch uses before handing the URL to the library
  // (finding M10).
  try {
    const endpointUrl = new URL(user.endpoint);
    if (endpointUrl.protocol !== 'https:') {
      return { ok: false, error: 'Push endpoint must be https.' };
    }
    if (!isAllowedPushHost(endpointUrl.hostname)) {
      return {
        ok: false,
        error: 'Push endpoint host is not a recognised push service.',
      };
    }
    // Belt-and-braces: still range-check the resolved IP. The host
    // allow-list already makes rebinding impossible (attacker can't
    // control these hosts' DNS), but this stays as defence in depth.
    await validateHost(endpointUrl.hostname);
  } catch (err) {
    if (err instanceof SafeFetchError) return { ok: false, error: err.message };
    return { ok: false, error: 'Invalid push endpoint URL.' };
  }
  const swPayload: SwPayload = {
    title: payload.title.slice(0, 250),
    body: payload.body.slice(0, 2000),
    link: payload.link,
    type: payload.type,
    tag: typeof payload.meta?.tag === 'string'
      ? (payload.meta.tag as string)
      : payload.type,
  };
  try {
    const res = await webpush.sendNotification(
      {
        endpoint: user.endpoint,
        keys: { p256dh: user.keys.p256dh, auth: user.keys.auth },
      },
      JSON.stringify(swPayload),
      {
        // 24h TTL — if the push service can't deliver within a day
        // we don't care anymore; the in-app notif is the source of
        // truth, this is just a system-level reminder.
        TTL: 24 * 60 * 60,
        urgency: 'normal',
      }
    );
    if (res.statusCode >= 200 && res.statusCode < 300) {
      return { ok: true };
    }
    // Don't reflect the upstream response body — only the status code,
    // which is all the UI needs and avoids echoing a remote body back to
    // the user (finding M10).
    return {
      ok: false,
      error: `Push service returned ${res.statusCode}`,
    };
  } catch (err) {
    // `web-push` throws a `WebPushError` with `statusCode` for any
    // non-2xx response. 404 / 410 mean the subscription is gone for
    // good — surface that so the breaker shuts the user row off.
    const e = err as {
      statusCode?: number;
      body?: string;
      message?: string;
    };
    const status = e.statusCode ?? 0;
    if (status === 404 || status === 410) {
      return {
        ok: false,
        error: `Subscription gone (${status}). The user needs to re-enable browser notifications.`,
      };
    }
    // Status code only on a service error; the library's own message
    // (not the upstream body) on a transport error.
    return {
      ok: false,
      error: status
        ? `Push service returned ${status}`
        : (e.message ?? 'Unknown push error'),
    };
  }
}

export const webpushAdapter: ChannelAdapter<WebPushServer, WebPushUser> = {
  type: 'web_push',
  labelKey: 'admin.channels.web_push.label',
  taglineKey: 'admin.channels.web_push.tagline',
  icon: 'ph:bell-ringing-bold',
  hasServerConfig: true,
  serverFields: [
    {
      key: 'subject',
      labelKey: 'admin.channels.web_push.fields.subject',
      hintKey: 'admin.channels.web_push.fields.subjectHint',
      type: 'string',
      required: true,
      default: 'mailto:admin@example.com',
    },
    // The VAPID keys are exposed as read-only metadata only — the
    // admin form renders them as informational text (via
    // `publicServerInfo`) and never as editable inputs. We keep
    // them in `serverFields` so the form-validation layer accepts
    // them as part of the config blob when the row is saved.
    {
      key: 'publicKey',
      labelKey: 'admin.channels.web_push.fields.publicKey',
      hintKey: 'admin.channels.web_push.fields.publicKeyHint',
      type: 'string',
      required: false,
    },
    {
      key: 'privateKey',
      labelKey: 'admin.channels.web_push.fields.privateKey',
      hintKey: 'admin.channels.web_push.fields.privateKeyHint',
      type: 'password',
      required: false,
      secret: true,
    },
  ],
  // User-facing form is intentionally empty — the subscription JSON
  // is captured automatically when the browser grants permission.
  // The settings page renders a "Enable in this browser" button
  // instead of a form.
  userFields: [],
  serverDefaults: () => {
    const { publicKey, privateKey } = generateVapidPair();
    return {
      subject: 'mailto:admin@example.com',
      publicKey,
      privateKey,
    };
  },
  // Surface the public key so the FE can fetch it (it's needed in
  // the `applicationServerKey` argument to `pushManager.subscribe`).
  // Private key is omitted — it stays on the server.
  publicServerInfo: (server) => {
    const out: Array<{ labelKey: string; value: string }> = [];
    if (server.subject) {
      out.push({
        labelKey: 'admin.channels.web_push.publicSubject',
        value: server.subject,
      });
    }
    if (server.publicKey) {
      out.push({
        labelKey: 'admin.channels.web_push.publicKey',
        value: server.publicKey,
      });
    }
    return out;
  },
  testServer: async (server) => {
    if (!server.subject) {
      return { ok: false, error: 'VAPID subject is required.' };
    }
    if (!/^(mailto:|https:\/\/)/i.test(server.subject)) {
      return {
        ok: false,
        error: 'Subject must be a mailto: or https:// URL (RFC 8292).',
      };
    }
    if (!server.publicKey || !server.privateKey) {
      return {
        ok: false,
        error: 'VAPID keys missing — clear the row and re-save to regenerate.',
      };
    }
    // We can't actually round-trip a push without a subscription, so
    // the server test is purely a config sanity check.
    return applyVapid(server)
      ? { ok: true }
      : { ok: false, error: 'VAPID keys are malformed.' };
  },
  testUser: sendWebPush,
  send: sendWebPush,
};
