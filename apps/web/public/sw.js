/*
 * Service worker — Web Push receiver.
 *
 * Stays intentionally tiny. The page registers this script once
 * via `useWebPush()`; from then on the browser keeps a copy alive
 * to handle `push` events even when no tab is open.
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

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/';
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
