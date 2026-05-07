<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>

<script setup lang="ts">
// Apply the chosen theme synchronously, before Vue hydration paints anything,
// so the page never flashes the wrong palette. The script reads localStorage
// (set by the toggle in default.vue's header) or prefers-color-scheme as a
// fallback. Defaults to dark — matches the historical look.
useHead({
  script: [
    {
      innerHTML: `
        (function () {
          try {
            var stored = localStorage.getItem('trackarr.theme');
            var pref = (stored === 'light' || stored === 'dark')
              ? stored
              : (window.matchMedia &&
                 window.matchMedia('(prefers-color-scheme: light)').matches
                  ? 'light' : 'dark');
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
