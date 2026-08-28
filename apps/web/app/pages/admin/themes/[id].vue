<template>
  <AdminThemeEditor :theme-id="themeId" />
</template>

<script setup lang="ts">
/**
 * One theme, on its own page.
 *
 * `new` is a route rather than a separate file so creating and editing are the
 * same screen — they differ by one field being empty, and two files would drift.
 * The editor reads `themeId: null` as "a new one".
 */
const route = useRoute();
const themeId = computed(() => {
  const id = String(route.params.id ?? '');
  return id === 'new' ? null : id;
});
</script>
