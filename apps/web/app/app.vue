<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>

<script setup lang="ts">
/**
 * The application root, and what is deliberately NOT here.
 *
 * Both of the things that decide the first paint — the theme stylesheet link and
 * the inline script that applies the theme cookie — are declared in
 * `nuxt.config.ts` under `app.head`. That is not tidiness: `useHead` in this file
 * does not run at all in the static build, where there is no server, so anything
 * declared here reaches the SSR markup and nowhere else. Both were, and both
 * made the static build paint the wrong colours until the bundle had booted.
 * `app.head` is baked into the HTML that both shapes generate.
 */

// Registers the session watcher and the `htmlAttrs` binding that renders
// `data-theme` server-side. Called here rather than in the layout because the
// login and registration pages set `layout: false`.
useColorMode();
</script>
