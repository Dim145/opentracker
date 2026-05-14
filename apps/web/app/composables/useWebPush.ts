/**
 * Browser Web Push lifecycle.
 *
 * Wraps the browser ceremonies (feature detection → permission
 * prompt → service worker registration → push subscription) so the
 * settings UI only deals with a tiny `{ status, enable, disable }`
 * surface. The actual transport is the `web_push` notification
 * channel — this composable just keeps the user-channel row in
 * sync with what the browser holds.
 *
 * `status` is the source of truth the UI binds to:
 *
 *   - `unsupported` — no Service Worker / PushManager / Notification API
 *   - `blocked`     — the user explicitly denied permission
 *   - `disabled`    — subscribable but not yet enabled here
 *   - `enabling`    — request in flight
 *   - `enabled`     — subscription is live in this browser
 *   - `error`       — last enable / disable attempt failed; the
 *                     `error` ref carries the message
 *
 * The subscription endpoint is identity for the row, so a second
 * browser on the same account simply overwrites the previous
 * subscription via PUT — that mirrors how the other channels behave
 * (one config per `(user, channel)` tuple). A future iteration could
 * fan out N subscriptions per user if multi-browser delivery becomes
 * a real ask.
 */

export type WebPushStatus =
  | 'unsupported'
  | 'blocked'
  | 'disabled'
  | 'enabling'
  | 'enabled'
  | 'error';

const SW_PATH = '/sw.js';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(normalised);
  const out = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) out[i] = rawData.charCodeAt(i);
  return out;
}

function arrayBufferToBase64Url(buffer: ArrayBuffer | null): string {
  if (!buffer) return '';
  const bytes = new Uint8Array(buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function isWebPushSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function useWebPush() {
  const status = useState<WebPushStatus>('webpush-status', () => 'disabled');
  const error = useState<string | null>('webpush-error', () => null);

  /**
   * Probe the current state without prompting. Safe to call on
   * mount — never triggers a user-visible browser dialog.
   */
  async function refresh() {
    if (!isWebPushSupported()) {
      status.value = 'unsupported';
      return;
    }
    if (Notification.permission === 'denied') {
      status.value = 'blocked';
      return;
    }
    try {
      const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
      if (!reg) {
        status.value = 'disabled';
        return;
      }
      const sub = await reg.pushManager.getSubscription();
      status.value = sub ? 'enabled' : 'disabled';
    } catch {
      status.value = 'disabled';
    }
  }

  /**
   * Ask the browser for permission, register the worker, subscribe
   * to the push service, and POST the resulting subscription to the
   * `web_push` channel row.
   *
   * `vapidPublicKey` comes from the admin-saved channel config
   * (surfaced through `publicServerInfo` on the channels API). We
   * don't store it on the FE; the caller fetches it fresh whenever
   * it kicks the enable flow.
   */
  async function enable(vapidPublicKey: string): Promise<boolean> {
    if (!isWebPushSupported()) {
      status.value = 'unsupported';
      return false;
    }
    error.value = null;
    status.value = 'enabling';

    try {
      // Prompt sequence: permission first, then SW, then subscribe.
      // Doing it in this order keeps the prompt close to the click,
      // which is the only way Safari and Firefox allow the API to
      // run without "user gesture lost" warnings.
      const perm = await Notification.requestPermission();
      if (perm === 'denied') {
        status.value = 'blocked';
        return false;
      }
      if (perm !== 'granted') {
        status.value = 'disabled';
        return false;
      }

      const reg =
        (await navigator.serviceWorker.getRegistration(SW_PATH)) ??
        (await navigator.serviceWorker.register(SW_PATH));
      await navigator.serviceWorker.ready;

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        });
      }

      const json = sub.toJSON();
      const userConfig = {
        endpoint: json.endpoint,
        expirationTime: json.expirationTime ?? null,
        keys: {
          // Some browsers populate `keys` already; fall back to raw
          // getKey() for the ones that don't (older Firefox).
          p256dh:
            json.keys?.p256dh ??
            arrayBufferToBase64Url(sub.getKey('p256dh')),
          auth:
            json.keys?.auth ?? arrayBufferToBase64Url(sub.getKey('auth')),
        },
      };

      await $fetch('/api/me/notification-channels/web_push', {
        method: 'PUT',
        body: { enabled: true, userConfig },
      });

      status.value = 'enabled';
      return true;
    } catch (err: any) {
      status.value = 'error';
      error.value =
        err?.data?.message ?? err?.message ?? 'Failed to enable web push.';
      return false;
    }
  }

  /**
   * Unsubscribe from the push service AND delete the user-channel
   * row server-side so future notifications stop targeting this
   * browser. Either side can fail independently — we keep going so
   * the user isn't trapped with one half-deleted.
   */
  async function disable(): Promise<boolean> {
    if (!isWebPushSupported()) {
      status.value = 'unsupported';
      return false;
    }
    error.value = null;
    status.value = 'enabling';
    try {
      const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        try {
          await sub.unsubscribe();
        } catch {
          /* push service hiccup — we still drop the row server-side */
        }
      }
      await $fetch('/api/me/notification-channels/web_push', {
        method: 'DELETE',
      });
      status.value = 'disabled';
      return true;
    } catch (err: any) {
      status.value = 'error';
      error.value =
        err?.data?.message ?? err?.message ?? 'Failed to disable web push.';
      return false;
    }
  }

  return { status, error, refresh, enable, disable };
}
