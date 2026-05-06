/**
 * Global auth middleware
 * Protects all routes except auth pages
 * Redirects to setup if no users exist
 *
 * Perf: only hits /api/auth/status when state is uninitialized (SSR / first nav)
 * or after a configured refresh window. Internal SPA navigations rely on the
 * already-known session state to avoid one round-trip per route change.
 * Stats can still be refreshed on demand via the header refresh button.
 */
const REFRESH_WINDOW_MS = 60_000;

export default defineNuxtRouteMiddleware(async (to) => {
  // useState must be called inside the middleware (Nuxt context). Hoisting
  // these to the module scope breaks SSR with "[nuxt] instance unavailable".
  const lastRefresh = useState<number>('user-session-last-refresh', () => 0);
  const cachedNeedsSetup = useState<boolean | null>(
    'user-session-needs-setup',
    () => null
  );
  const session = useState<{ user: any | null }>('user-session', () => ({
    user: null,
  }));

  const publicRoutes = ['/auth/login', '/auth/register'];
  const isPublicRoute = publicRoutes.includes(to.path);

  const now = Date.now();
  const stateUninitialized =
    cachedNeedsSetup.value === null && session.value.user === null;
  const stale = now - lastRefresh.value > REFRESH_WINDOW_MS;
  // Always refetch when landing on an auth page so a freshly-banned user
  // can be redirected (and so that login/register reflect current setup state).
  const shouldRefresh = stateUninitialized || isPublicRoute || stale;

  if (shouldRefresh) {
    try {
      const status = await $fetch('/api/auth/status');
      cachedNeedsSetup.value = !!status?.needsSetup;
      session.value = { user: status?.user ?? null };
      lastRefresh.value = now;
    } catch {
      // Network error — keep current state, fail open to existing routing.
    }
  }

  const loggedIn = session.value.user !== null;

  if (cachedNeedsSetup.value) {
    if (to.path !== '/auth/register') {
      return navigateTo('/auth/register');
    }
    return;
  }

  if (!loggedIn && !isPublicRoute) {
    return navigateTo('/auth/login');
  }

  if (loggedIn && isPublicRoute) {
    return navigateTo('/');
  }
});
