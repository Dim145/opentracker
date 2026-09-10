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

/*
 * La langue du document, alignée sur celle du membre.
 *
 * `nuxt.config` pose un plancher (`lang="en"`) pour que le HTML servi n'en soit
 * jamais dépourvu, y compris dans la construction statique où ce fichier ne
 * tourne pas. Ici on met la vraie : le code BCP-47 déclaré pour la locale
 * (`en-US`, `fr-FR`), et non le code court, parce que c'est ce qu'un lecteur
 * d'écran utilise pour choisir sa voix ET sa prononciation régionale.
 */
const { locale, locales } = useI18n();
useHead({
  htmlAttrs: {
    lang: () =>
      (locales.value as Array<{ code: string; language?: string }>).find(
        (l) => l.code === locale.value,
      )?.language || locale.value,
  },
});
</script>
