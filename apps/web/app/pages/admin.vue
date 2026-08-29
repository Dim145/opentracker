<template>
  <div>
    <!-- While the sheet is up, everything behind it leaves the tab order and
         the accessibility tree. The backdrop only hides it visually; without
         this you can tab straight through the covered page. -->
    <div
      class="flex flex-col md:flex-row gap-8"
      :inert="drawerOpen || undefined"
    >
      <aside class="w-full md:w-64 flex-shrink-0">
        <!-- Below md the whole sidebar collapses to one row naming the page
             you are on, and the list moves into a sheet. It used to be a
             horizontally scrolling strip: it showed four of twenty entries
             and gave no hint the other sixteen existed, which is the
             documented failure mode of a scrolling tab bar — what is out of
             frame is out of mind. The sheet shows all twenty at once. -->
        <button
          type="button"
          class="
            md:hidden w-full flex items-center gap-2.5 mb-4
            px-3 py-3 rounded-md text-sm font-medium
            bg-bg-secondary border border-border text-text-primary
            hover:bg-bg-tertiary transition-colors
          "
          :aria-expanded="drawerOpen"
          aria-controls="admin-nav-drawer"
          @click="drawerOpen = true"
        >
          <Icon
            :name="currentItem?.icon ?? 'ph:layout'"
            class="w-4 h-4 flex-shrink-0 text-text-muted"
          />
          <span class="truncate">{{ currentTitle }}</span>
          <Icon
            name="ph:caret-down-bold"
            class="ml-auto w-3.5 h-3.5 flex-shrink-0 text-text-muted"
          />
        </button>

        <div
          class="hidden md:block md:sticky"
          style="top: calc(var(--header-h) + 1.5rem);"
        >
          <h2 class="px-3 mb-3 eyebrow">
            {{ $t('admin.eyebrow') }}
          </h2>

          <AdminNavTree
            :home="navHome"
            :groups="navGroups"
            :settings="navSettings"
            :current-path="currentItem?.path"
          />

          <div class="mt-6 px-3">
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

    <!-- Mobile sheet — same shape as the layout drawer in default.vue:
         slides down from the top, backdrop dismisses, body scroll locked. -->
    <Transition
      enter-active-class="transition-opacity duration-150 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-100 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="drawerOpen"
        class="md:hidden fixed inset-0 z-50 bg-bg-primary/80 backdrop-blur-sm"
        @click.self="drawerOpen = false"
      />
    </Transition>
    <Transition
      enter-active-class="transition-transform duration-200 ease-out"
      enter-from-class="-translate-y-full"
      enter-to-class="translate-y-0"
      leave-active-class="transition-transform duration-150 ease-in"
      leave-from-class="translate-y-0"
      leave-to-class="-translate-y-full"
    >
      <aside
        v-if="drawerOpen"
        id="admin-nav-drawer"
        class="md:hidden fixed inset-x-0 top-0 z-50 max-h-[100dvh] overflow-y-auto bg-bg-secondary border-b border-line-strong flex flex-col"
      >
        <div
          class="flex items-center justify-between gap-3 px-3 border-b border-border"
          style="height: var(--header-h);"
        >
          <span class="eyebrow-mono text-text-muted truncate">
            {{ $t('admin.eyebrow') }}
          </span>
          <button
            type="button"
            class="inline-flex items-center justify-center w-10 h-10 -mr-1.5 rounded-md text-text-strong hover:bg-fg-default/10 active:bg-fg-default/15 transition-colors"
            :aria-label="$t('admin.nav.closeMenu')"
            @click="drawerOpen = false"
          >
            <Icon name="ph:x-bold" class="text-lg" />
          </button>
        </div>

        <div class="p-3">
          <AdminNavTree
            :home="navHome"
            :groups="navGroups"
            :settings="navSettings"
            :current-path="currentItem?.path"
            @navigate="drawerOpen = false"
          />
        </div>
      </aside>
    </Transition>
  </div>
</template>

<script setup lang="ts">
definePageMeta({
  middleware: 'admin',
});

const route = useRoute();

// The destinations themselves live in `useAdminNav` — the command palette
// reads the same list, and two copies would drift.
const { navHome, navGroups, navSettings, adminNavItems } = useAdminNav();

/**
 * Which section the current route belongs to.
 *
 * An exact match first, then the longest entry the path starts with — because a
 * section may have sub-routes now. `/admin/themes/<id>` matched nothing and fell
 * through to the first entry, so editing a theme was headed "Dashboard" and the
 * sidebar highlighted the wrong row.
 *
 * The `/admin` root is excluded from the prefix pass: it is the prefix of
 * everything, and its own exact match above already covers it.
 */
function sectionFor(path: string) {
  const exact = adminNavItems.value.find((item) => item.path === path);
  if (exact) return exact;
  return (
    adminNavItems.value
      .filter((item) => item.path !== '/admin' && path.startsWith(`${item.path}/`))
      .sort((a, b) => b.path.length - a.path.length)[0] ?? adminNavItems.value[0]
  );
}

const currentItem = computed(() => sectionFor(route.path));

const currentTitle = computed(() => currentItem?.value?.label);
const currentDescription = computed(() => currentItem?.value?.description);

const drawerOpen = ref(false);

// Navigating closes the sheet, so the reader is never left looking at the new
// page through the old menu.
watch(() => route.fullPath, () => {
  drawerOpen.value = false;
});

if (import.meta.client) {
  // Lock body scroll behind the sheet, same as the layout drawer.
  watch(drawerOpen, (open) => {
    document.body.style.overflow = open ? 'hidden' : '';
  });

  // The sheet is `md:hidden`, so a rotation into the desktop layout would
  // otherwise leave it "open" but invisible — still holding the scroll lock
  // and still marking the whole page inert, with nothing on screen to close.
  const desktop = window.matchMedia('(min-width: 768px)');
  const onBreakpoint = (event: MediaQueryListEvent) => {
    if (event.matches) drawerOpen.value = false;
  };

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') drawerOpen.value = false;
  };
  onMounted(() => {
    document.addEventListener('keydown', onKeydown);
    desktop.addEventListener('change', onBreakpoint);
  });
  onBeforeUnmount(() => {
    document.removeEventListener('keydown', onKeydown);
    desktop.removeEventListener('change', onBreakpoint);
    document.body.style.overflow = '';
  });
}
</script>
