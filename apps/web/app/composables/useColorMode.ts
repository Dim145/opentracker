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

/**
 * The last-resort theme, for the one moment nothing better is known: no cookie,
 * no session, and the branding payload not back yet.
 *
 * It is NOT the site default. The site default is a setting the owner controls,
 * and this composable used to use this constant in its place — which is exactly
 * why that setting did nothing for anonymous visitors or for members who had
 * never chosen. `siteDefault()` below is the real answer; this is what stands in
 * for one paint while it arrives.
 */
const FALLBACK_THEME = 'dark';

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

  /**
   * What the member chose, or `null` for "follows the site default".
   *
   * Null is a value here, not an absence: the picker offers it, the account
   * stores it, and a member on it moves when the owner changes the default.
   */
  const choice = useState<Theme | null>('color-mode', () => cookie.value || null);

  /**
   * The site default, read from the branding payload WITHOUT fetching it.
   *
   * `useBranding()` is async and writes into this same `useState` key, and the
   * layout already awaits it on every page. Reading the state rather than
   * calling the composable is what keeps this synchronous: making `app.vue`'s
   * setup await branding would put a Suspense boundary at the root of the
   * application to answer a question that is only needed at head-render time.
   */
  const branding = useState<{ themeDefault?: string } | null>('branding', () => null);
  const siteDefault = () => branding.value?.themeDefault || FALLBACK_THEME;

  /** What actually goes on `<html>`. */
  const mode = computed<Theme>(() => choice.value ?? siteDefault());

  // Server-side, this is what puts `data-theme` in the HTML. The getter is
  // evaluated at head-render time, which is AFTER the layout has awaited
  // branding — so an anonymous visitor is served the owner's default in the
  // markup, with nothing to correct on arrival.
  //
  // Client-side it is inert (Vue does not re-render `<html>` attributes on
  // hydration), which is why `paint()` below writes the DOM directly.
  useHead({ htmlAttrs: { 'data-theme': () => mode.value } });

  // And when branding lands after the first paint — the static SPA build, where
  // no server ran — the attribute has to follow it.
  if (import.meta.client) {
    watch(
      () => (choice.value === null ? siteDefault() : null),
      (resolved) => {
        if (resolved) document.documentElement.setAttribute('data-theme', resolved);
      },
    );
  }

  function paint(value: Theme | null) {
    choice.value = value;
    // The cookie caches the CHOICE, so an empty cookie and "follows the site
    // default" are the same state — which is what a first-time visitor already
    // has, and what a member gets back by picking `Site default`.
    cookie.value = value;
    if (import.meta.client) {
      document.documentElement.setAttribute(
        'data-theme',
        value ?? siteDefault(),
      );
    }
  }

  /** Persist a choice: paint at once, then tell the server. `null` = follow. */
  async function apply(value: Theme | null) {
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
      // Reconcile the attribute the boot script painted with the state ref. Only
      // when it disagrees with a real choice: an attribute matching the site
      // default must NOT be written back as a choice, or a member who follows
      // the default would silently be pinned to today's value by their first
      // page load.
      const attr = document.documentElement.getAttribute('data-theme');
      if (attr && choice.value !== null && attr !== choice.value) {
        choice.value = attr;
      }

      const { user } = useUserSession();
      watch(
        user,
        (u) => {
          if (!u) return;
          // `undefined` means this session predates the nullable column and has
          // no opinion; `null` is an opinion — follow the site default.
          const stored = (u as { theme?: string | null }).theme;
          if (stored === undefined) return;
          if (stored !== choice.value) paint(stored);
        },
        { immediate: true },
      );
    });
  }

  return {
    /** What is on `<html>` — a choice, or the site default resolved. */
    mode: readonly(mode),
    /** What the member picked, `null` when they follow the site default. */
    choice: readonly(choice),
    apply,
    toggle,
    SYSTEM_THEME,
  };
}
