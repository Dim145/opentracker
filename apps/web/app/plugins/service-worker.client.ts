/**
 * Register the service worker on boot, rather than only when a member
 * turns on push notifications.
 *
 * The worker has always existed — `useWebPush()` registers it at the moment
 * someone enables Web Push. That is too late for the other thing a worker is
 * needed for: a browser decides whether a site is installable at page load,
 * and a site whose worker only appears after a settings toggle is not
 * installable for anyone who never visits that toggle.
 *
 * `register()` is idempotent — a browser that already holds this exact script
 * at this scope keeps its registration and does not re-download. So this and
 * `useWebPush()` can both call it; whichever runs first wins and the other
 * gets the same registration back.
 *
 * Client-only, and deliberately not awaited by the boot: an app that cannot
 * mount because a service worker was slow to register would be a poor trade
 * for an install prompt. Failures are swallowed — the worker is unavailable
 * in a private window, over plain HTTP, and behind some enterprise policies,
 * and none of those are the application's problem to report.
 */
export default defineNuxtPlugin({
  name: 'service-worker',
  parallel: true,
  setup() {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }
    // After load, so registration never competes with the first paint for
    // bandwidth on the one request the reader is actually waiting for.
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* unsupported, blocked, or insecure context — nothing to do */
      });
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  },
});
