/**
 * useColorMode — light / dark theme toggle.
 *
 * Source of truth is the user's `users.theme` column in PostgreSQL,
 * surfaced via `/api/auth/status` on the session and updated via
 * `PATCH /api/me`. localStorage is kept as a *cache only* so the FOUC
 * mitigation in app.vue can pick a sensible theme synchronously before
 * the session is fetched on first paint.
 *
 * The theme is written to `data-theme` on <html>, matching:
 *   - the Tailwind config (`darkMode: ['selector', '[data-theme="dark"]']`)
 *   - the CSS variable scopes in `assets/css/main.css`
 *
 * On boot:
 *   1. app.vue's inline script seeds <html data-theme=…> from
 *      localStorage (or 'dark' if absent — the defined default).
 *   2. The auth/status fetch in the global middleware fills the user
 *      session, including `theme`. The watcher below picks that up and
 *      reconciles the DOM if the cache differed.
 *
 * On user toggle:
 *   - `apply(value)` updates the DOM + localStorage cache immediately
 *     (no perceptible flicker), then PATCHes /api/me so the choice
 *     follows the user across devices and browsers.
 */
type Mode = 'light' | 'dark';

const STORAGE_KEY = 'trackarr.theme';
const DEFAULT_MODE: Mode = 'dark';

export function useColorMode() {
  const mode = useState<Mode>('color-mode', () => DEFAULT_MODE);

  function paint(value: Mode) {
    mode.value = value;
    if (import.meta.client) {
      document.documentElement.setAttribute('data-theme', value);
      try {
        localStorage.setItem(STORAGE_KEY, value);
      } catch {
        /* private mode / disabled storage — silently ignore */
      }
    }
  }

  /** Persist a new theme: paint immediately, then push to the API. */
  async function apply(value: Mode) {
    paint(value);
    if (import.meta.client) {
      try {
        await $fetch('/api/me', {
          method: 'PATCH',
          body: { theme: value },
        });
      } catch {
        // Non-fatal: the local cache + session refresh will reconcile
        // on the next /api/auth/status poll. Avoiding throw here keeps
        // the toggle snappy when the network blips.
      }
    }
  }

  function toggle() {
    void apply(mode.value === 'dark' ? 'light' : 'dark');
  }

  if (import.meta.client) {
    onMounted(() => {
      // Catch any drift between the cache-painted attr and the state ref.
      const attr = document.documentElement.getAttribute('data-theme');
      const observed: Mode =
        attr === 'light' || attr === 'dark' ? attr : DEFAULT_MODE;
      if (observed !== mode.value) mode.value = observed;

      // Reconcile against the server-stored theme as soon as the
      // session lands. The session is populated by the global auth
      // middleware on first nav; we react to its arrival via a watcher.
      const { user } = useUserSession();
      watch(
        user,
        (u) => {
          const serverTheme = (u as { theme?: Mode } | null)?.theme;
          if (serverTheme && serverTheme !== mode.value) {
            paint(serverTheme);
          }
        },
        { immediate: true }
      );
    });
  }

  return { mode: readonly(mode), apply, toggle };
}
