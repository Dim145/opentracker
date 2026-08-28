<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>

<script setup lang="ts">
/**
 * Two things happen here, and both are about the first paint.
 *
 * **The stylesheet.** `/api/theme.css` carries every theme an admin has enabled,
 * plus the two `system` blocks. A `<link>` in `<head>` is render-blocking, so the
 * page waits for it rather than flashing an unthemed frame — and because it holds
 * every theme, switching afterwards is one attribute write with no request. It is
 * served by the API rather than inlined because `apps/web` also ships as a static
 * SPA with no server to inline anything (`ssr: !STATIC_BUILD`), and `/api/*` is
 * same-origin through Caddy in both shapes. `style-src 'self'` covers it: no
 * nonce, no `'unsafe-inline'`.
 *
 * **The attribute.** Under SSR, `useColorMode` puts `data-theme` in the markup
 * from the cookie, so there is nothing to correct on arrival. The script below is
 * for the static build, where no server ran — and it reads the same cookie, so
 * the two shapes agree about where the answer lives.
 *
 * It used to validate against the two literals `'light'` and `'dark'` and discard
 * anything else, which would have silently thrown away every admin theme.
 */
useHead({
  link: [
    {
      rel: 'stylesheet',
      href: '/api/theme.css',
      // After `entry.css`, so a theme block wins over the built-in `:root`
      // declarations it is meant to override. Capo gives stylesheets 60 by
      // default; the built-ins live in the bundle, so this has to sort later.
      tagPriority: 65,
    },
  ],
  script: [
    {
      innerHTML: `
        (function () {
          try {
            var m = document.cookie.match(/(?:^|;\\s*)trackarr-theme=([^;]*)/);
            var v = m ? decodeURIComponent(m[1]) : '';
            // Shape only. Which themes exist is the server's business, and a
            // slug that no longer does resolves to the site default on the next
            // /api/auth/status — a wrong theme for one paint is better than an
            // unthemed one, and better than a script that has to know the list.
            document.documentElement.setAttribute(
              'data-theme',
              /^[a-z0-9-]{1,64}$/.test(v) ? v : 'dark'
            );
          } catch (e) {
            document.documentElement.setAttribute('data-theme', 'dark');
          }
        })();
      `,
      tagPosition: 'head',
    },
  ],
});

// Registers the session watcher and the `htmlAttrs` binding that renders
// `data-theme` server-side. Called here rather than in the layout because the
// login and registration pages set `layout: false`.
useColorMode();
</script>
