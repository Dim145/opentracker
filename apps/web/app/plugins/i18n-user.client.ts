/**
 * i18n-user.client — applies the logged-in user's preferred language.
 *
 * Layers of locale resolution, in priority order:
 *   1. `users.language` — durable, cross-device, the source of truth.
 *      This plugin watches the session and calls `setLocale()` whenever
 *      the user object lands or changes.
 *   2. `tk_locale` cookie — fast-path cache. SSR reads it directly so a
 *      hard reload doesn't have to wait for the auth/status round-trip
 *      to render in the user's language. `setLocale()` keeps it in
 *      sync via @nuxtjs/i18n's own cookie plumbing.
 *   3. `defaultLocale` (`en`) — anonymous fallback.
 *
 * Plugin order: we set `enforce: 'post'` so the i18n module's own
 * client plugin has had a chance to mount `setLocale` / `locale.value`
 * before we touch them. Without this gate, my plugin would run before
 * the i18n module's plugin (alphabetical order: `i18n-user` < `i18n.plugin`)
 * and surface as "SyntaxError: 26" (vue-i18n INVALID_ARGUMENT) at
 * app initialization.
 *
 * The watcher fires on:
 *   - first paint after a hard reload (session was already in cookie)
 *   - after a successful login (session.value goes from null → {…})
 *   - after a settings save in /settings#appearance (status.get refresh)
 *   - on logout (session goes back to null — we leave the locale alone
 *     so the user keeps reading in the language they were just using)
 */
export default defineNuxtPlugin({
  name: 'i18n-user',
  enforce: 'post',
  setup() {
    const { user } = useUserSession();
    let i18n: ReturnType<typeof useI18n>;
    try {
      i18n = useI18n();
    } catch {
      // i18n composable not available — module didn't finish booting
      // for some reason. Bail out silently; the default locale renders.
      return;
    }
    const { locale, setLocale, locales } = i18n;

    watch(
      () => user.value?.language,
      async (next) => {
        if (!next) return;
        // Refuse a code we don't bundle — the user might have a stale
        // value from a removed locale. Falling back to the current
        // active locale is safer than crashing the i18n composable on
        // `setLocale('xx')`.
        const supported = (locales.value as { code: string }[]).some(
          (l) => l.code === next,
        );
        if (!supported) return;
        if (locale.value === next) return;
        try {
          await setLocale(next as 'en' | 'fr');
        } catch (err) {
          // Don't break the app on a locale switch failure — log so the
          // operator sees it in the browser console, but keep going.
          console.warn('[i18n-user] setLocale failed:', err);
        }
      },
      { immediate: true },
    );
  },
});
