<template>
  <div class="flex flex-col md:flex-row gap-8">
    <!-- Sidebar:
         - On mobile (< md): horizontal scrollable strip pinned just under
           the header so admin sub-pages don't bury the user under 11
           sidebar entries before showing any content.
         - On md+: vertical sticky sidebar as before. -->
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
        <h2
          class="hidden md:block px-3 mb-3 eyebrow"
        >
          {{ $t('admin.eyebrow') }}
        </h2>

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

        <div class="hidden md:block mt-6 px-3">
          <div
            class="flex items-center gap-2 text-[10px] font-mono text-text-muted bg-bg-secondary px-2 py-1.5 rounded border border-border"
          >
            <span class="relative flex h-2 w-2">
              <span
                class="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"
              ></span>
              <span
                class="relative inline-flex rounded-full h-2 w-2 bg-success"
              ></span>
            </span>
            {{ $t('admin.liveTrackerFeed') }}
          </div>
        </div>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="flex-1 min-w-0">
      <!-- /admin (the dashboard root) brings its own bespoke
           header (the control-room banner with a live "tracker
           online" pulse). For every other admin sub-page we
           render the generic title strip so the operator always
           knows where they are. -->
      <div v-if="$route.path !== '/admin'" class="mb-6">
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
  middleware: 'admin',
});

const route = useRoute();
const { t } = useI18n();

const menuItems = computed(() => [
  {
    label: t('admin.nav.dashboard'),
    path: '/admin',
    icon: 'ph:layout',
    description: t('admin.descriptions.dashboard'),
  },
  {
    label: t('admin.nav.users'),
    path: '/admin/users',
    icon: 'ph:users',
    description: t('admin.descriptions.users'),
  },
  {
    label: t('admin.nav.roles'),
    path: '/admin/roles',
    icon: 'ph:user-circle-gear',
    description: t('admin.descriptions.roles'),
  },
  {
    label: t('admin.nav.categories'),
    path: '/admin/categories',
    icon: 'ph:folders',
    description: t('admin.descriptions.categories'),
  },
  {
    label: t('admin.nav.tags'),
    path: '/admin/tags',
    icon: 'ph:tag',
    description: t('admin.descriptions.tags'),
  },
  {
    label: t('admin.nav.bonusEvents'),
    path: '/admin/bonus-events',
    icon: 'ph:gift',
    description: t('admin.descriptions.bonusEvents'),
  },
  {
    label: t('admin.nav.bonusRules'),
    path: '/admin/bonus-rules',
    icon: 'ph:strategy',
    description: t('admin.descriptions.bonusRules'),
  },
  {
    label: t('admin.nav.shop'),
    path: '/admin/shop',
    icon: 'ph:storefront',
    description: t('admin.descriptions.shop'),
  },
  {
    label: t('admin.nav.freeleechPool'),
    path: '/admin/freeleech-pool',
    icon: 'ph:hand-coins',
    description: t('admin.descriptions.freeleechPool'),
  },
  {
    label: t('admin.nav.bannedIps'),
    path: '/admin/banned-ips',
    icon: 'ph:prohibit',
    description: t('admin.descriptions.bannedIps'),
  },
  {
    label: t('admin.nav.uploadRules'),
    path: '/admin/upload-rules',
    icon: 'ph:check-square',
    description: t('admin.descriptions.uploadRules'),
  },
  {
    label: t('admin.nav.invitations'),
    path: '/admin/invites',
    icon: 'ph:envelope-simple',
    description: t('admin.descriptions.invitations'),
  },
  {
    label: t('admin.nav.torznab'),
    path: '/admin/torznab',
    icon: 'ph:plug',
    description: t('admin.descriptions.torznab'),
  },
  {
    label: t('admin.nav.federation'),
    path: '/admin/federation',
    icon: 'ph:broadcast',
    description: t('admin.descriptions.federation'),
  },
  {
    label: t('admin.nav.branding'),
    path: '/admin/branding',
    icon: 'ph:paint-brush',
    description: t('admin.descriptions.branding'),
  },
  {
    label: t('admin.nav.notifications'),
    path: '/admin/notifications',
    icon: 'ph:bell-ringing',
    description: t('admin.descriptions.notifications'),
  },
  {
    label: t('admin.nav.settings'),
    path: '/admin/settings',
    icon: 'ph:gear',
    description: t('admin.descriptions.settings'),
  },
]);

const currentItem = computed(
  () => menuItems.value.find((item) => item.path === route.path) || menuItems.value[0]
);

const currentTitle = computed(() => currentItem?.value?.label);
const currentDescription = computed(() => currentItem?.value?.description);
</script>
