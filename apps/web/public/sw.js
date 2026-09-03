/*
 * Service worker — Web Push receiver, and the installability gate.
 *
 * Stays intentionally tiny. A boot plugin registers this script on
 * every load (`plugins/service-worker.client.ts`) and `useWebPush()`
 * reuses the same registration when a member turns push on; from then
 * on the browser keeps a copy alive to handle `push` events even when
 * no tab is open.
 *
 * Payload shape (kept in sync with apps/api/utils/channels/webpush.ts):
 *
 *   { title, body, link, type, tag }
 *
 * Any future field bump needs a coordinated SW deploy — the browser
 * caches this script and only re-fetches on update.
 */

self.addEventListener('install', (event) => {
  // Take over right away so a freshly subscribed browser doesn't
  // have to wait for a tab close to receive its first push.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  // Claim every open client so a SW update applies to currently-
  // open tabs without a reload.
  event.waitUntil(self.clients.claim());
});

/*
 * A fetch handler that handles nothing, on purpose.
 *
 * Chrome will not offer to install a site whose service worker has no
 * `fetch` listener — the check is for the listener's existence, not for
 * what it does. So this exists to satisfy that, and deliberately never
 * calls `event.respondWith()`: without it the browser goes to the
 * network exactly as it would with no service worker at all.
 *
 * What it is NOT is an offline cache, and that omission is a decision
 * rather than a gap. Every page here is a live view of a swarm — seeder
 * counts, ratios, a moderation queue, an inbox. A cache-first worker
 * would serve yesterday's numbers with no way for the reader to tell,
 * and on a private tracker the wrong ratio is not a cosmetic problem.
 * An offline shell is worth building the day there is something worth
 * reading offline; a stale one is worth nothing.
 */
self.addEventListener('fetch', () => {});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data = {};
  try {
    data = event.data.json();
  } catch {
    // Fall back to a plain-text payload — push services sometimes
    // ship a heartbeat with no body.
    data = { title: 'Trackarr', body: event.data.text() };
  }

  const title = data.title || 'Trackarr';
  const options = {
    body: data.body || '',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    // `tag` collapses repeats so the OS overlay doesn't stack a
    // dozen "new comment" notifications. The server picks a tag
    // based on the event type by default.
    tag: data.tag || data.type || 'trackarr',
    renotify: true,
    data: { link: data.link || '/', type: data.type || null },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Coerce a server-supplied `link` to a same-origin URL before
// handing it to `client.navigate` / `openWindow`. Without this guard
// a malicious / compromised push payload could navigate every
// open tab to an off-origin phishing page, since both APIs accept
// any string. Anything off-origin (or unparseable) collapses to
// '/'.
function sameOriginOrRoot(link) {
  try {
    const u = new URL(link, self.location.origin);
    return u.origin === self.location.origin ? u.pathname + u.search + u.hash : '/';
  } catch {
    return '/';
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.link) || '/';
  const link = sameOriginOrRoot(raw);
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      // Reuse an existing tab on our origin if there is one — saves
      // the user from opening a 12th Trackarr window.
      for (const client of all) {
        try {
          const url = new URL(client.url);
          if (url.origin === self.location.origin) {
            await client.focus();
            if ('navigate' in client) {
              await client.navigate(link);
            } else {
              await client.postMessage({ type: 'navigate', link });
            }
            return;
          }
        } catch {
          /* ignore unparseable client URL */
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(link);
      }
    })()
  );
});
