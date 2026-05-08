<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>

<script setup lang="ts">
// Paint the chosen theme synchronously, before Vue hydration runs, so
// the page never flashes the wrong palette. Source of truth is the
// user's `users.theme` column (synced into the session and watched by
// useColorMode); this script just primes <html data-theme=…> from the
// localStorage cache so the *first* paint of an authenticated user
// matches what the session is about to confirm. Default is dark — both
// the schema default and the historical look of the site.
useHead({
  script: [
    {
      innerHTML: `
        (function () {
          try {
            var stored = localStorage.getItem('trackarr.theme');
            var pref = (stored === 'light' || stored === 'dark') ? stored : 'dark';
            document.documentElement.setAttribute('data-theme', pref);
          } catch (e) {
            document.documentElement.setAttribute('data-theme', 'dark');
          }
        })();
      `,
      tagPosition: 'head',
    },
  ],
});
</script>
