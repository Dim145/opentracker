<template>
  <div class="flex flex-col md:flex-row gap-8">
    <!-- Sidebar: horizontal scroll on mobile, vertical sticky on md+. -->
    <aside class="w-full md:w-64 flex-shrink-0">
      <div
        class="
          flex md:flex-col gap-2 md:gap-1
          overflow-x-auto md:overflow-visible
          -mx-4 md:mx-0 px-4 md:px-0
          py-2 md:py-0
          md:sticky
          border-b md:border-b-0 border-border
        "
        style="top: calc(var(--header-h) + 1.5rem);"
      >
        <h2 class="hidden md:block px-3 mb-3 eyebrow">{{ $t('mod.eyebrow') }}</h2>

        <NuxtLink
          v-for="item in menuItems"
          :key="item.path"
          :to="item.path"
          class="
            flex-shrink-0 inline-flex items-center gap-2
            px-3 py-2 text-sm font-medium rounded-md
            transition-colors whitespace-nowrap
            md:gap-3
          "
          :class="[
            $route.path === item.path
              ? 'bg-bg-secondary text-text-primary border border-border'
              : 'text-text-muted hover:text-text-primary hover:bg-bg-secondary/50 border border-transparent',
          ]"
        >
          <Icon :name="item.icon" class="w-4 h-4 flex-shrink-0" />
          <span>{{ item.label }}</span>
        </NuxtLink>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="flex-1 min-w-0">
      <div class="mb-6">
        <h1
          class="text-2xl font-bold text-text-primary tracking-tight uppercase"
        >
          {{ currentTitle }}
        </h1>
        <p class="text-xs text-text-muted font-mono mt-1">
          {{ currentDescription }}
        </p>
      </div>

      <NuxtPage />
    </main>
  </div>
</template>

<script setup lang="ts">
definePageMeta({
  middleware: 'moderator' as any,
});

const route = useRoute();
const { t } = useI18n();

const menuItems = computed(() => [
  {
    label: t('mod.nav.dashboard'),
    path: '/mod',
    icon: 'ph:shield-check',
    description: t('mod.descriptions.dashboard'),
  },
  {
    label: t('mod.nav.pendingTorrents'),
    path: '/mod/pending',
    icon: 'ph:clock',
    description: t('mod.descriptions.pendingTorrents'),
  },
  {
    label: t('mod.nav.users'),
    path: '/mod/users',
    icon: 'ph:users',
    description: t('mod.descriptions.users'),
  },
  {
    label: t('mod.nav.reports'),
    path: '/mod/reports',
    icon: 'ph:flag',
    description: t('mod.descriptions.reports'),
  },
  {
    label: t('mod.nav.hnr'),
    path: '/mod/hnr',
    icon: 'ph:lightning',
    description: t('mod.descriptions.hnr'),
  },
]);

const currentItem = computed(
  () => menuItems.value.find((item) => item.path === route.path) || menuItems.value[0]
);

const currentTitle = computed(() => currentItem.value?.label || '');
const currentDescription = computed(() => currentItem.value?.description || '');
</script>
