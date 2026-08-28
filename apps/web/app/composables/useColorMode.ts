/**
 * useColorMode — the active theme.
 *
 * Named for what it was and kept for what imports it. It no longer holds two
 * values: a theme is `'system'`, one of the two built-ins, or the slug of a
 * theme an admin created.
 *
 * ## Source of truth, and the cookie
 *
 * `users.theme` in Postgres, surfaced on the session by `/api/auth/status` and
 * written by `PATCH /api/me`. Alongside it, a **cookie** — not localStorage.
 *
 * That swap is the whole reason SSR can now render the right theme. localStorage
 * is invisible to the server, so the old design had no choice but to paint the
 * attribute from a blocking inline script after the HTML had already been
 * generated with none. A cookie travels with the request, so
 * `useHead({ htmlAttrs })` can put `data-theme` in the markup itself.
 *
 * The usual objection to a theme cookie is CDN cache fragmentation — `Vary:
 * Cookie` on HTML. It does not apply here: nothing caches this application's
 * HTML. There is no `Cache-Control` on it in `nuxt.config.ts`, none in
 * `server/`, and Caddy is a reverse proxy with no cache. So the cookie is free,
 * and it lets a script come out of `<head>`.
 *
 * ## Why the inline script still exists
 *
 * `apps/web` ships twice. `ssr: !STATIC_BUILD` — the `front` image is a static
 * SPA served by nginx, with no server to render an attribute. There, the boot
 * script is still the only mechanism, and it now reads the cookie rather than
 * localStorage so both builds agree on where the answer lives.
 *
 * ## Where the token values come from
 *
 * Not from here. `<link rel="stylesheet" href="/api/theme.css">` carries every
 * enabled theme, so switching is one attribute write with no request and no
 * flash — exactly as it has always been for the two built-ins.
 */
import { SYSTEM_THEME } from '@trackarr/shared';

/** `'system'` | `'light'` | `'dark'` | an admin theme's slug. */
type Theme = string;

const COOKIE_NAME = 'trackarr-theme';
const DEFAULT_THEME = 'dark';

/**
 * A year. The cookie is a cache of a value the account already owns, so its
 * expiry only decides how long an anonymous visit remembers a choice — and
 * `httpOnly` is deliberately off, because the toggle reads it.
 */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

// Process-scoped so the session watcher is registered exactly once however many
// components call this. Without it every component — layout, page, charts,
// settings — attaches its own and they all fire in lockstep on each refresh.
let sessionWatcherStarted = false;

export function useColorMode() {
  const cookie = useCookie<string | null>(COOKIE_NAME, {
    maxAge: COOKIE_MAX_AGE,
    sameSite: 'lax',
    path: '/',
    // Readable by the client on purpose: the toggle writes it, and it holds no
    // secret — the value is visible in the DOM the moment the page renders.
    httpOnly: false,
  });

  const mode = useState<Theme>('color-mode', () => cookie.value || DEFAULT_THEME);

  // Server-side, this is what puts `data-theme` in the HTML. Client-side it is
  // inert — Vue does not re-render `<html>` attributes on hydration — which is
  // why `paint()` below writes the DOM directly.
  useHead({ htmlAttrs: { 'data-theme': () => mode.value } });

  function paint(value: Theme) {
    mode.value = value;
    cookie.value = value;
    if (import.meta.client) {
      document.documentElement.setAttribute('data-theme', value);
    }
  }

  /** Persist a choice: paint at once, then tell the server. */
  async function apply(value: Theme) {
    paint(value);
    if (import.meta.client) {
      try {
        await $fetch('/api/me', { method: 'PATCH', body: { theme: value } });
      } catch {
        // Non-fatal by design: the cookie and the next `/api/auth/status` poll
        // reconcile, so a network blip does not make the toggle feel broken.
        // A REFUSAL is different — a theme reserved to a role the member does
        // not hold — and the reconciliation below is what corrects it, by
        // painting whatever the server actually stored.
      }
    }
  }

  /**
   * Kept for the callers that still just want the other one of the two.
   *
   * Only meaningful between the built-ins; on a custom theme it falls back to
   * `dark`, because "the opposite of Nocturne" is not a question with an answer.
   */
  function toggle() {
    void apply(mode.value === 'dark' ? 'light' : 'dark');
  }

  if (import.meta.client && !sessionWatcherStarted) {
    sessionWatcherStarted = true;
    onMounted(() => {
      // Reconcile the attribute the boot script painted with the state ref.
      const attr = document.documentElement.getAttribute('data-theme');
      if (attr && attr !== mode.value) mode.value = attr;

      const { user } = useUserSession();
      watch(
        user,
        (u) => {
          const stored = (u as { theme?: string } | null)?.theme;
          if (stored && stored !== mode.value) paint(stored);
        },
        { immediate: true },
      );
    });
  }

  return { mode: readonly(mode), apply, toggle, SYSTEM_THEME };
}
