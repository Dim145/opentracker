<template>
  <div
    class="min-h-screen flex flex-col bg-bg-primary text-text-primary selection:bg-accent selection:text-accent-fg"
  >
    <!-- Header — z-30 so dropdowns (z-40) and modals (z-50) layer above it -->
    <header
      class="sticky top-0 z-30 border-b border-border backdrop-blur-md app-header"
    >
      <div
        class="max-w-[1400px] mx-auto px-4 flex items-center justify-between"
        style="height: var(--header-h);"
      >
        <NuxtLink to="/" class="flex items-center gap-2.5 group">
          <div
            class="w-7 h-7 bg-accent rounded-sm flex items-center justify-center transition-transform group-hover:rotate-12 overflow-hidden"
          >
            <img
              v-if="branding?.siteLogoImage"
              :src="branding.siteLogoImage"
              alt="Logo"
              class="w-full h-full object-contain"
            />
            <Icon
              v-else
              :name="branding?.siteLogo || 'ph:broadcast-bold'"
              class="text-accent-fg text-lg"
            />
          </div>
          <div class="flex flex-col leading-none">
            <span
              class="text-sm tracking-tighter transition-colors"
              :class="{
                'font-bold': branding?.siteNameBold ?? true,
                'font-medium': !(branding?.siteNameBold ?? true),
              }"
              :style="{ color: branding?.siteNameColor || '' }"
              v-html="sanitizeHtml(branding?.siteName)"
            ></span>
            <span class="text-[10px] text-text-muted font-mono"
              v-html="sanitizeHtml(branding?.siteSubtitle)"
            ></span>
          </div>
        </NuxtLink>

        <nav class="flex items-center gap-1">
          <NuxtLink
            v-for="link in visibleNavLinks"
            :key="link.to"
            :to="link.to"
            class="px-3 py-1.5 text-xs font-medium rounded transition-all text-text-secondary hover:bg-fg-default/5 hover:text-text-primary"
            active-class="bg-fg-default/10 text-text-strong"
          >
            <div class="flex items-center gap-2">
              <Icon :name="link.icon" class="text-base" />
              <span>{{ link.label }}</span>
            </div>
          </NuxtLink>
        </nav>

        <div class="flex items-center gap-3">
          <!-- User Stats -->
          <div
            v-if="user"
            class="hidden sm:flex items-center gap-4 px-3 py-1 border-l border-border ml-2"
          >
            <div class="flex flex-col items-end leading-tight">
              <div class="flex items-center gap-1.5">
                <Icon
                  name="ph:arrow-up-bold"
                  class="text-[10px] text-success"
                />
                <span class="text-[11px] font-mono text-text-secondary">{{
                  formatSize(user.uploaded)
                }}</span>
              </div>
              <div class="flex items-center gap-1.5">
                <Icon
                  name="ph:arrow-down-bold"
                  class="text-[10px] text-text-muted"
                />
                <span class="text-[11px] font-mono text-text-secondary">{{
                  formatSize(user.downloaded)
                }}</span>
              </div>
            </div>
            <div class="flex flex-col items-center leading-tight">
              <span
                class="text-[9px] text-text-muted uppercase font-bold tracking-tighter"
                >Ratio</span
              >
              <span :class="['text-xs font-mono font-bold', ratioColor]">
                {{ calculateRatio(user.uploaded, user.downloaded) }}
              </span>
            </div>
            <button
              @click="refreshStats"
              class="p-1 rounded hover:bg-fg-default/5 text-text-muted hover:text-text-secondary transition-colors"
              title="Refresh stats"
            >
              <Icon name="ph:arrows-clockwise" class="text-xs" />
            </button>
          </div>

          <!-- User Menu -->
          <div class="relative" ref="userMenuRef">
            <button
              @click="toggleUserMenu"
              class="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-fg-default/5 transition-colors"
            >
              <div
                class="w-7 h-7 rounded-full bg-bg-tertiary border border-border flex items-center justify-center overflow-hidden"
              >
                <Icon
                  name="ph:user-circle-light"
                  class="text-xl text-text-secondary"
                />
              </div>
              <span class="text-sm font-medium">{{
                user?.displayName || user?.username
              }}</span>
              <Icon name="ph:caret-down" class="text-xs text-text-muted" />
            </button>

            <!-- Dropdown -->
            <Transition
              enter-active-class="transition duration-100 ease-out"
              enter-from-class="transform scale-95 opacity-0"
              enter-to-class="transform scale-100 opacity-100"
              leave-active-class="transition duration-75 ease-in"
              leave-from-class="transform scale-100 opacity-100"
              leave-to-class="transform scale-95 opacity-0"
            >
              <div
                v-if="showUserMenu"
                class="absolute right-0 top-full mt-1 w-64 bg-bg-secondary border border-border rounded-lg shadow-xl overflow-hidden z-40"
              >
                <NuxtLink
                  to="/me"
                  class="block px-4 py-3 border-b border-border hover:bg-fg-default/5 transition-colors group"
                  @click="showUserMenu = false"
                >
                  <div class="flex items-center justify-between gap-2">
                    <div class="min-w-0">
                      <p class="text-sm font-medium truncate">
                        {{ user?.displayName || user?.username }}
                      </p>
                      <p
                        v-if="user?.displayName"
                        class="text-[11px] font-mono text-text-muted mt-0.5 truncate"
                      >
                        @{{ user.username }}
                      </p>
                      <p
                        class="text-[10px] uppercase tracking-wider text-text-muted mt-0.5"
                      >
                        View profile
                      </p>
                    </div>
                    <Icon
                      name="ph:arrow-right"
                      class="text-text-muted group-hover:text-text-primary transition-colors flex-shrink-0"
                    />
                  </div>
                  <div
                    v-if="user?.isAdmin || user?.isModerator"
                    class="mt-1.5 flex gap-1"
                  >
                    <span
                      v-if="user?.isAdmin"
                      class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 bg-fg-default/10 rounded text-text-secondary"
                    >
                      Admin
                    </span>
                    <span
                      v-if="user?.isModerator"
                      class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 bg-fg-default/10 rounded text-text-secondary"
                    >
                      Moderator
                    </span>
                  </div>
                </NuxtLink>
                <!-- Stats grid: only shown on mobile (sm:hidden) — desktop has
                     the inline header bar and would otherwise show the same
                     numbers twice 200px apart. Downloaded uses text-secondary
                     (neutral) instead of red — downloading isn't an error. -->
                <div class="border-t border-border py-2 px-4 sm:hidden">
                  <div class="grid grid-cols-2 gap-2">
                    <div>
                      <p
                        class="text-[10px] uppercase tracking-wider text-text-muted mb-0.5"
                      >
                        Uploaded
                      </p>
                      <p class="text-xs font-mono text-success">
                        {{ formatSize(user?.uploaded || 0) }}
                      </p>
                    </div>
                    <div>
                      <p
                        class="text-[10px] uppercase tracking-wider text-text-muted mb-0.5"
                      >
                        Downloaded
                      </p>
                      <p class="text-xs font-mono text-text-secondary">
                        {{ formatSize(user?.downloaded || 0) }}
                      </p>
                    </div>
                    <div class="col-span-2">
                      <p
                        class="text-[10px] uppercase tracking-wider text-text-muted mb-0.5"
                      >
                        Ratio
                      </p>
                      <p class="text-xs font-mono" :class="ratioColor">
                        {{ calculateRatio(user?.uploaded, user?.downloaded) }}
                      </p>
                    </div>
                  </div>
                </div>
                <div class="py-1">
                  <NuxtLink
                    to="/settings"
                    class="w-full px-4 py-2 text-left text-sm text-text-secondary hover:bg-fg-default/5 transition-colors flex items-center gap-2"
                    @click="showUserMenu = false"
                  >
                    <Icon name="ph:gear" />
                    Settings
                  </NuxtLink>
                  <button
                    @click="handleLogout"
                    class="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-fg-default/5 transition-colors flex items-center gap-2"
                  >
                    <Icon name="ph:sign-out" />
                    Sign Out
                  </button>
                </div>
              </div>
            </Transition>
          </div>
        </div>
      </div>
    </header>

    <!-- Announcement Banner -->
    <ClientOnly>
      <Transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="opacity-0 -translate-y-2"
        enter-to-class="opacity-100 translate-y-0"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="opacity-100 translate-y-0"
        leave-to-class="opacity-0 -translate-y-2"
      >
        <div
          v-if="
            announcementReady &&
            announcement?.enabled &&
            announcement?.message &&
            !announcementDismissed
          "
          :class="[
            'border-b',
            announcementStyles[announcement.type || 'info'].bg,
            announcementStyles[announcement.type || 'info'].border,
          ]"
        >
          <div
            class="max-w-[1400px] mx-auto px-4 py-2.5 flex items-center gap-3"
          >
            <Icon
              :name="announcementStyles[announcement.type || 'info'].icon"
              :class="[
                'text-lg flex-shrink-0',
                announcementStyles[announcement.type || 'info'].text,
              ]"
            />
            <p
              :class="[
                'text-sm flex-1',
                announcementStyles[announcement.type || 'info'].text,
              ]"
            >
              {{ announcement.message }}
            </p>
            <button
              @click="dismissAnnouncement"
              class="p-1 rounded hover:bg-fg-default/10 transition-colors flex-shrink-0"
              title="Dismiss"
            >
              <Icon
                name="ph:x"
                :class="[
                  'text-sm',
                  announcementStyles[announcement.type || 'info'].text,
                ]"
              />
            </button>
          </div>
        </div>
      </Transition>
    </ClientOnly>

    <!-- Main Content -->
    <main class="flex-grow max-w-[1400px] w-full mx-auto px-4 py-6">
      <slot />
    </main>

    <!-- Global UI hosts: notifications & confirm dialogs.
         NotificationToast must be mounted here — without this, every
         `notifications.success(...)` / `.error(...)` call across the app
         updates the store but renders nothing.
         ConfirmHost provides a promise-based replacement for window.confirm. -->
    <NotificationToast />
    <ConfirmHost />

    <!-- Footer -->
    <footer class="border-t border-border mt-auto py-6 bg-bg-secondary/30">
      <div
        class="max-w-[1400px] mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-4"
      >
        <div
          class="flex items-center gap-4 text-[10px] text-text-muted font-mono uppercase tracking-widest"
        >
          <span
            class="[&>p]:inline [&>p]:m-0"
            v-html="
              sanitizeHtml(
                branding?.footerText ||
                `© ${new Date().getFullYear()} ${branding?.siteName || 'Trackarr'}`
              )
            "
          ></span>
        </div>
        <div class="flex gap-6">
          <a
            href="https://n0w.me/"
            target="_blank"
            rel="noopener"
            class="text-text-muted hover:text-text-strong transition-colors"
            ><Icon name="ph:globe" class="text-xl"
          /></a>
          <a
            href="https://github.com/florianjs/trackarr"
            target="_blank"
            rel="noopener"
            class="text-text-muted hover:text-text-strong transition-colors"
            ><Icon name="ph:github-logo" class="text-xl"
          /></a>
          <a
            href="https://discord.gg/GRFu35djvz"
            target="_blank"
            rel="noopener"
            class="text-text-muted hover:text-text-strong transition-colors"
            ><Icon name="ph:discord-logo" class="text-xl"
          /></a>
        </div>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
const { user, clear, fetch } = useUserSession();
// Theme is loaded server-side via the session; the composable's watcher
// reconciles the DOM. The settings page is the only surface that flips
// it, so the layout doesn't need to import useColorMode here.
const router = useRouter();

const showUserMenu = ref(false);
const userMenuRef = ref<HTMLElement | null>(null);

// Fetch site branding
const { data: branding } = await useFetch<{
  siteName: string;
  siteLogo: string;
  siteLogoImage: string | null;
  siteFavicon: string | null;
  siteSubtitle: string | null;
  siteNameColor: string | null;
  siteNameBold: boolean | undefined;
  authTitle: string | null;
  authSubtitle: string | null;
  footerText: string | null;
  pageTitleSuffix: string | null;
}>('/api/branding');

// Set dynamic favicon and title template
useHead({
  titleTemplate: computed(() => {
    const suffix =
      branding.value?.pageTitleSuffix ||
      `- ${branding.value?.siteName?.replace(/<[^>]*>/g, '') || 'TRACKARR'}`;
    return (title?: string) =>
      title ? `${title} ${suffix}` : suffix.replace(/^- /, '');
  }),
  link: [
    {
      rel: 'icon',
      type: computed(() => {
        const url = branding.value?.siteFavicon;
        if (!url) return 'image/x-icon';
        if (url.endsWith('.svg')) return 'image/svg+xml';
        if (url.endsWith('.png')) return 'image/png';
        if (url.endsWith('.webp')) return 'image/webp';
        return 'image/x-icon';
      }),
      href: computed(() => branding.value?.siteFavicon || '/favicon.ico'),
    },
  ],
});

// Fetch announcement
const { data: announcement } = await useFetch<{
  enabled: boolean;
  message?: string;
  type?: 'info' | 'warning' | 'error';
}>('/api/announcement');

const announcementDismissed = ref(false);
const announcementReady = ref(false);

// Simple hash function for announcement message
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

const announcementStyles = {
  info: {
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
    text: 'text-blue-400',
    icon: 'ph:info',
  },
  warning: {
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-500/30',
    text: 'text-yellow-400',
    icon: 'ph:warning',
  },
  error: {
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    text: 'text-red-400',
    icon: 'ph:warning-circle',
  },
};

function dismissAnnouncement() {
  announcementDismissed.value = true;
  if (import.meta.client && announcement.value?.message) {
    const messageHash = hashString(announcement.value.message);
    sessionStorage.setItem(`announcement_dismissed_${messageHash}`, 'true');
  }
}

onMounted(() => {
  if (import.meta.client && announcement.value?.message) {
    const messageHash = hashString(announcement.value.message);
    announcementDismissed.value =
      sessionStorage.getItem(`announcement_dismissed_${messageHash}`) ===
      'true';
  }
  // Use nextTick to ensure transition is applied after DOM is ready
  nextTick(() => {
    announcementReady.value = true;
  });
});

// Refresh user stats from database
async function refreshStats() {
  await $fetch('/api/auth/status');
  await fetch();
}

const navLinks = [
  { to: '/', label: 'Dashboard', icon: 'ph:squares-four', adminOnly: false },
  {
    to: '/search',
    label: 'Search',
    icon: 'ph:magnifying-glass',
    adminOnly: false,
  },
  { to: '/torrents', label: 'Torrents', icon: 'ph:files', adminOnly: false },
  {
    to: '/forum',
    label: 'Forum',
    icon: 'ph:chat-centered-text',
    adminOnly: false,
  },
  { to: '/admin', label: 'Admin', icon: 'ph:shield-check', adminOnly: true },
  { to: '/mod', label: 'Mod', icon: 'ph:shield', modOnly: true },
];

const visibleNavLinks = computed(() =>
  navLinks.filter((link) => {
    if (link.adminOnly && !user.value?.isAdmin) return false;
    if (link.modOnly && !user.value?.isAdmin && !user.value?.isModerator)
      return false;
    return true;
  })
);

function toggleUserMenu() {
  showUserMenu.value = !showUserMenu.value;
}

// Close on outside click
function handleClickOutside(event: MouseEvent) {
  if (userMenuRef.value && !userMenuRef.value.contains(event.target as Node)) {
    showUserMenu.value = false;
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});

async function handleLogout() {
  showUserMenu.value = false;
  await clear();
  router.push('/auth/login');
}

function calculateRatio(up = 0, down = 0) {
  if (down === 0) return up > 0 ? '∞' : '0.00';
  return (up / down).toFixed(2);
}

const ratioColor = computed(() => {
  const up = user.value?.uploaded ?? 0;
  const down = user.value?.downloaded ?? 0;
  if (down === 0) return up > 0 ? 'text-success' : 'text-text-secondary';

  const ratio = up / down;
  if (ratio < 0.5) return 'text-error';
  if (ratio < 1.0) return 'text-warning';
  return 'text-success';
});
</script>

<style scoped>
/* Header background — translucent surface that adapts to the active theme */
.app-header {
  background-color: color-mix(in srgb, var(--bg-base) 80%, transparent);
}

</style>
