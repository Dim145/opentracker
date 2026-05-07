/**
 * useColorMode — light / dark theme toggle, persisted in localStorage.
 *
 * The theme is written to `data-theme` on <html>, matching:
 *   - the Tailwind config (`darkMode: ['selector', '[data-theme="dark"]']`)
 *   - the CSS variable scopes in `assets/css/main.css`
 *
 * To prevent a flash of mismatched theme on first paint, app.vue injects a
 * tiny inline <script> that reads localStorage / prefers-color-scheme and
 * writes the attribute synchronously, before Vue hydration runs.
 */
type Mode = 'light' | 'dark';

const STORAGE_KEY = 'trackarr.theme';

export function useColorMode() {
  const mode = useState<Mode>('color-mode', () => 'dark');

  function apply(value: Mode) {
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

  function toggle() {
    apply(mode.value === 'dark' ? 'light' : 'dark');
  }

  if (import.meta.client) {
    onMounted(() => {
      const attr = document.documentElement.getAttribute('data-theme');
      const observed: Mode =
        attr === 'light' || attr === 'dark' ? attr : 'dark';
      if (observed !== mode.value) mode.value = observed;
    });
  }

  return { mode: readonly(mode), apply, toggle };
}
