<template>
  <div
    class="min-h-screen flex flex-col bg-bg-primary text-text-primary selection:bg-accent selection:text-accent-fg"
  >
    <!--
      Top-of-page progress bar that lights up while a route's
      setup blocks on its `await useFetch(...)` calls. Without
      it the SPA build (Dockerfile.static) feels frozen between
      a link click and the new page's first paint — the new
      route's fetches run client-side and the old page sits
      there silently until they resolve.

      `throttle` keeps the bar from flashing on cache-hit
      navigations; `duration` is the fake-progress ceiling we
      hit when a fetch is genuinely slow.
    -->
    <NuxtLoadingIndicator
      color="#d4a734"
      :height="2"
      :duration="2500"
      :throttle="180"
    />

    <!-- Header — z-30 so dropdowns (z-40) and modals (z-50) layer above it.
         Below md the header keeps just the brand + a hamburger; the rest of
         the chrome (nav, user stats, account dropdown) folds into a drawer
         that mounts at the top of the viewport. -->
    <header
      class="sticky top-0 z-30 border-b border-border backdrop-blur-md app-header"
    >
      <div
        class="max-w-[1400px] mx-auto px-3 sm:px-4 flex items-center justify-between gap-3"
        style="height: var(--header-h);"
      >
        <NuxtLink to="/" class="flex items-center gap-2.5 group min-w-0">
          <div
            class="w-7 h-7 bg-accent rounded-sm flex items-center justify-center transition-transform group-hover:rotate-12 overflow-hidden flex-shrink-0"
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
          <div class="flex flex-col leading-none min-w-0">
            <span
              class="text-sm tracking-tighter transition-colors truncate"
              :class="{
                'font-bold': branding?.siteNameBold ?? true,
                'font-medium': !(branding?.siteNameBold ?? true),
              }"
              :style="{ color: branding?.siteNameColor || '' }"
              v-html="sanitizeHtml(branding?.siteName)"
            ></span>
            <span class="text-[10px] text-text-muted font-mono truncate"
              v-html="sanitizeHtml(branding?.siteSubtitle)"
            ></span>
          </div>
        </NuxtLink>

        <!-- Desktop nav: hidden below md, visible from md up.
             From md→lg the labels collapse so the search bar has room
             without bumping the user-menu off-screen; lg+ shows full
             icon+label pairs again. -->
        <nav class="hidden md:flex items-center gap-1 flex-shrink-0">
          <NuxtLink
            v-for="link in visibleNavLinks"
            :key="link.to"
            :to="link.to"
            class="px-2.5 py-1.5 text-xs font-medium rounded transition-all text-text-secondary hover:bg-fg-default/5 hover:text-text-primary"
            active-class="bg-fg-default/10 text-text-strong"
            :title="$t(link.labelKey)"
          >
            <div class="flex items-center gap-2">
              <Icon :name="link.icon" class="text-base" />
              <span class="hidden lg:inline">{{ $t(link.labelKey) }}</span>
            </div>
          </NuxtLink>
        </nav>

        <!-- Navbar search — the centerpiece. Grows to fill the gap
             between the nav cluster and the right-hand stats so the
             header reads as "directory · search · status" left-to-right.
             A `/` keypress anywhere on the page focuses it; the input is
             a search-typed control so the browser surfaces a clear
             button on Webkit/Chromium. Submitting pushes to /torrents
             with the query pre-filled — the page already watches
             `route.query.q` and re-runs the fetch automatically. -->
        <form
          class="hidden md:flex flex-1 min-w-0 max-w-[640px] mx-2 lg:mx-3"
          role="search"
          @submit.prevent="submitNavSearch"
        >
          <div
            class="navsearch"
            :class="{ 'navsearch--filled': navSearchQuery.length > 0 }"
          >
            <Icon
              name="ph:magnifying-glass-bold"
              class="navsearch-icon"
              aria-hidden="true"
            />
            <input
              ref="navSearchRef"
              v-model="navSearchQuery"
              type="search"
              autocomplete="off"
              :placeholder="$t('nav.searchPlaceholder')"
              :aria-label="$t('nav.searchAria')"
              class="navsearch-input"
              @focus="navSearchFocused = true"
              @blur="navSearchFocused = false"
            />
            <kbd
              v-if="!navSearchQuery && !navSearchFocused"
              class="navsearch-kbd"
              :title="$t('nav.searchHint')"
              aria-hidden="true"
            >/</kbd>
            <button
              v-else-if="navSearchQuery"
              type="button"
              class="navsearch-clear"
              :aria-label="$t('common.cancel')"
              @click="clearNavSearch"
            >
              <Icon name="ph:x-bold" />
            </button>
          </div>
        </form>

        <div class="flex items-center gap-3 flex-shrink-0">
          <!-- Active bonus event icon — visible to every signed-in user
               whenever a Freeleech / Silverleech / custom multiplier
               window is in flight. Renders nothing while idle. -->
          <BonusEventIcon v-if="user" />

          <!-- Notifications bell + dropdown. Renders nothing for
               anonymous viewers. The composable opens its own SSE
               stream as soon as the session is live, so the badge
               count and the recent-notifications list refresh
               without manual polling. -->
          <NotificationBell v-if="user" />

          <!-- User Stats — desktop only -->
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
              :title="$t('nav.refreshStats')"
            >
              <Icon name="ph:arrows-clockwise" class="text-xs" />
            </button>
          </div>

          <!-- User Menu — desktop only -->
          <div class="relative hidden md:block" ref="userMenuRef">
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
              <span class="text-sm font-medium max-w-[12rem] truncate">{{
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
                        {{ $t('nav.profile') }}
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
                      {{ $t('nav.admin') }}
                    </span>
                    <span
                      v-if="user?.isModerator"
                      class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 bg-fg-default/10 rounded text-text-secondary"
                    >
                      {{ $t('nav.mod') }}
                    </span>
                  </div>
                </NuxtLink>
                <div class="py-1">
                  <NuxtLink
                    to="/favorites"
                    class="w-full px-4 py-2 text-left text-sm text-text-secondary hover:bg-fg-default/5 transition-colors flex items-center gap-2"
                    @click="showUserMenu = false"
                  >
                    <Icon name="ph:star-bold" class="text-amber-500" />
                    {{ $t('nav.favorites') }}
                  </NuxtLink>
                  <NuxtLink
                    to="/following"
                    class="w-full px-4 py-2 text-left text-sm text-text-secondary hover:bg-fg-default/5 transition-colors flex items-center gap-2"
                    @click="showUserMenu = false"
                  >
                    <Icon name="ph:users-three-bold" class="text-emerald-500" />
                    {{ $t('nav.following') }}
                  </NuxtLink>
                  <NuxtLink
                    to="/downloads"
                    class="w-full px-4 py-2 text-left text-sm text-text-secondary hover:bg-fg-default/5 transition-colors flex items-center gap-2"
                    @click="showUserMenu = false"
                  >
                    <Icon name="ph:download-simple-bold" />
                    {{ $t('nav.downloads', 'Downloads') }}
                  </NuxtLink>
                  <NuxtLink
                    to="/torrents/upload"
                    class="w-full px-4 py-2 text-left text-sm text-text-secondary hover:bg-fg-default/5 transition-colors flex items-center gap-2"
                    @click="showUserMenu = false"
                  >
                    <Icon name="ph:upload-simple-bold" />
                    {{ $t('torrents.upload') }}
                  </NuxtLink>
                  <NuxtLink
                    to="/invites"
                    class="w-full px-4 py-2 text-left text-sm text-text-secondary hover:bg-fg-default/5 transition-colors flex items-center gap-2"
                    @click="showUserMenu = false"
                  >
                    <Icon name="ph:envelope-simple-bold" />
                    {{ $t('nav.invitations', 'Invitations') }}
                  </NuxtLink>
                  <NuxtLink
                    to="/shop"
                    class="w-full px-4 py-2 text-left text-sm text-text-secondary hover:bg-fg-default/5 transition-colors flex items-center justify-between gap-2"
                    @click="showUserMenu = false"
                  >
                    <span class="flex items-center gap-2">
                      <Icon name="ph:storefront-bold" />
                      {{ $t('nav.shop') }}
                    </span>
                    <span
                      v-if="user && (user as any).bonusPoints !== undefined"
                      class="text-[10px] font-mono text-text-muted"
                    >
                      {{ (user as any).bonusPoints }}
                    </span>
                  </NuxtLink>
                  <NuxtLink
                    to="/reports"
                    class="w-full px-4 py-2 text-left text-sm text-text-secondary hover:bg-fg-default/5 transition-colors flex items-center gap-2"
                    @click="showUserMenu = false"
                  >
                    <Icon name="ph:flag-bold" />
                    {{ $t('nav.reports', 'My reports') }}
                  </NuxtLink>
                  <NuxtLink
                    to="/settings"
                    class="w-full px-4 py-2 text-left text-sm text-text-secondary hover:bg-fg-default/5 transition-colors flex items-center gap-2"
                    @click="showUserMenu = false"
                  >
                    <Icon name="ph:gear" />
                    {{ $t('nav.settings') }}
                  </NuxtLink>
                  <button
                    @click="handleLogout"
                    class="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-fg-default/5 transition-colors flex items-center gap-2"
                  >
                    <Icon name="ph:sign-out" />
                    {{ $t('nav.signOut') }}
                  </button>
                </div>
              </div>
            </Transition>
          </div>

          <!-- Mobile hamburger — visible below md only -->
          <button
            type="button"
            class="md:hidden inline-flex items-center justify-center w-10 h-10 -mr-1.5 rounded-md text-text-strong hover:bg-fg-default/10 active:bg-fg-default/15 transition-colors"
            :aria-expanded="showMobileNav"
            :aria-label="$t('nav.openNav')"
            @click="showMobileNav = true"
          >
            <Icon name="ph:list-bold" class="text-xl" />
          </button>
        </div>
      </div>
    </header>

    <!-- Mobile drawer — slides down from the top, fills the viewport.
         Contains the user identity card, the nav, the stats grid, and
         the settings/sign-out actions. Animated; tap on backdrop or any
         link auto-closes. -->
    <Transition
      enter-active-class="transition-opacity duration-150 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-100 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="showMobileNav"
        class="md:hidden fixed inset-0 z-50 bg-bg-primary/80 backdrop-blur-sm"
        @click.self="showMobileNav = false"
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
        v-if="showMobileNav"
        class="md:hidden fixed inset-x-0 top-0 z-50 max-h-[100dvh] overflow-y-auto bg-bg-secondary border-b border-line-strong flex flex-col mobile-drawer"
      >
        <!-- Drawer header — mirrors the sticky header so the close button
             lands where the hamburger was. -->
        <div
          class="flex items-center justify-between gap-3 px-3 border-b border-border"
          style="height: var(--header-h);"
        >
          <span
            class="eyebrow-mono text-text-muted truncate"
          >
            {{ branding?.siteName ? stripTags(branding.siteName) : 'Trackarr' }}
            · Menu
          </span>
          <button
            type="button"
            class="inline-flex items-center justify-center w-10 h-10 -mr-1.5 rounded-md text-text-strong hover:bg-fg-default/10 active:bg-fg-default/15 transition-colors"
            :aria-label="$t('nav.closeNav')"
            @click="showMobileNav = false"
          >
            <Icon name="ph:x-bold" class="text-lg" />
          </button>
        </div>

        <!-- Mobile search — same surface as the desktop navbar input,
             reflowed into the drawer so phone users still get a
             one-tap path into the listing without having to navigate
             to /torrents first. -->
        <form
          class="px-3 py-3 border-b border-border"
          role="search"
          @submit.prevent="submitNavSearchMobile"
        >
          <div class="navsearch navsearch--block">
            <Icon
              name="ph:magnifying-glass-bold"
              class="navsearch-icon"
              aria-hidden="true"
            />
            <input
              ref="navSearchMobileRef"
              v-model="navSearchMobileQuery"
              type="search"
              autocomplete="off"
              :placeholder="$t('nav.searchPlaceholder')"
              :aria-label="$t('nav.searchAria')"
              class="navsearch-input"
            />
            <button
              v-if="navSearchMobileQuery"
              type="button"
              class="navsearch-clear"
              :aria-label="$t('common.cancel')"
              @click="navSearchMobileQuery = ''"
            >
              <Icon name="ph:x-bold" />
            </button>
          </div>
        </form>

        <!-- User identity card -->
        <NuxtLink
          v-if="user"
          to="/me"
          class="flex items-center gap-3 px-4 py-4 border-b border-border hover:bg-fg-default/5 transition-colors"
          @click="showMobileNav = false"
        >
          <div
            class="w-12 h-12 rounded-md bg-bg-elevated border border-border flex items-center justify-center overflow-hidden flex-shrink-0"
          >
            <Icon
              name="ph:user-circle-light"
              class="text-3xl text-text-secondary"
            />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-bold text-text-strong truncate">
              {{ user?.displayName || user?.username }}
            </p>
            <p
              v-if="user?.displayName"
              class="text-[11px] font-mono text-text-muted truncate mt-0.5"
            >
              @{{ user.username }}
            </p>
            <div
              v-if="user?.isAdmin || user?.isModerator"
              class="mt-1 flex gap-1"
            >
              <span
                v-if="user?.isAdmin"
                class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 bg-fg-default/10 rounded text-text-secondary"
              >{{ $t('nav.admin') }}</span>
              <span
                v-if="user?.isModerator"
                class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 bg-fg-default/10 rounded text-text-secondary"
              >{{ $t('nav.mod') }}</span>
            </div>
          </div>
          <Icon name="ph:arrow-right-bold" class="text-text-muted text-base flex-shrink-0" />
        </NuxtLink>

        <!-- Stats strip — three cells, mono numerics -->
        <div
          v-if="user"
          class="grid grid-cols-3 border-b border-border bg-bg-inset/50"
        >
          <div class="px-3 py-3 border-r border-border">
            <p class="text-[9px] uppercase tracking-widest text-text-muted font-bold mb-0.5">↑ {{ $t('nav.uploaded') }}</p>
            <p class="text-xs font-mono font-bold text-success truncate">
              {{ formatSize(user.uploaded) }}
            </p>
          </div>
          <div class="px-3 py-3 border-r border-border">
            <p class="text-[9px] uppercase tracking-widest text-text-muted font-bold mb-0.5">↓ {{ $t('nav.downloaded') }}</p>
            <p class="text-xs font-mono font-bold text-text-secondary truncate">
              {{ formatSize(user.downloaded) }}
            </p>
          </div>
          <div class="px-3 py-3">
            <p class="text-[9px] uppercase tracking-widest text-text-muted font-bold mb-0.5">{{ $t('nav.ratio') }}</p>
            <p :class="['text-xs font-mono font-bold truncate', ratioColor]">
              {{ calculateRatio(user.uploaded, user.downloaded) }}
            </p>
          </div>
        </div>

        <!-- Primary nav -->
        <nav class="flex flex-col p-2">
          <NuxtLink
            v-for="link in visibleNavLinks"
            :key="link.to"
            :to="link.to"
            class="flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium text-text-secondary hover:bg-fg-default/5 hover:text-text-primary transition-colors"
            active-class="bg-fg-default/10 text-text-strong"
            @click="showMobileNav = false"
          >
            <Icon :name="link.icon" class="text-lg flex-shrink-0" />
            <span>{{ link.label }}</span>
          </NuxtLink>
        </nav>

        <!-- Footer actions -->
        <div class="mt-auto border-t border-border p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] flex flex-col">
          <NuxtLink
            to="/favorites"
            class="flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium text-text-secondary hover:bg-fg-default/5 hover:text-text-primary transition-colors"
            @click="showMobileNav = false"
          >
            <Icon name="ph:star-bold" class="text-lg flex-shrink-0 text-amber-500" />
            <span>{{ $t('nav.favorites') }}</span>
          </NuxtLink>
          <NuxtLink
            to="/following"
            class="flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium text-text-secondary hover:bg-fg-default/5 hover:text-text-primary transition-colors"
            @click="showMobileNav = false"
          >
            <Icon name="ph:users-three-bold" class="text-lg flex-shrink-0 text-emerald-500" />
            <span>{{ $t('nav.following') }}</span>
          </NuxtLink>
          <NuxtLink
            to="/downloads"
            class="flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium text-text-secondary hover:bg-fg-default/5 hover:text-text-primary transition-colors"
            @click="showMobileNav = false"
          >
            <Icon name="ph:download-simple-bold" class="text-lg flex-shrink-0" />
            <span>{{ $t('nav.downloads', 'Downloads') }}</span>
          </NuxtLink>
          <NuxtLink
            to="/torrents/upload"
            class="flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium text-text-secondary hover:bg-fg-default/5 hover:text-text-primary transition-colors"
            @click="showMobileNav = false"
          >
            <Icon name="ph:upload-simple-bold" class="text-lg flex-shrink-0" />
            <span>{{ $t('torrents.upload') }}</span>
          </NuxtLink>
          <NuxtLink
            to="/shop"
            class="flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium text-text-secondary hover:bg-fg-default/5 hover:text-text-primary transition-colors"
            @click="showMobileNav = false"
          >
            <Icon name="ph:storefront-bold" class="text-lg flex-shrink-0" />
            <span class="flex-1">{{ $t('nav.shop') }}</span>
            <span
              v-if="user && (user as any).bonusPoints !== undefined"
              class="text-[11px] font-mono text-text-muted"
            >
              {{ (user as any).bonusPoints }}
            </span>
          </NuxtLink>
          <NuxtLink
            to="/invites"
            class="flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium text-text-secondary hover:bg-fg-default/5 hover:text-text-primary transition-colors"
            @click="showMobileNav = false"
          >
            <Icon name="ph:envelope-simple-bold" class="text-lg flex-shrink-0" />
            <span>{{ $t('nav.invitations', 'Invitations') }}</span>
          </NuxtLink>
          <NuxtLink
            to="/reports"
            class="flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium text-text-secondary hover:bg-fg-default/5 hover:text-text-primary transition-colors"
            @click="showMobileNav = false"
          >
            <Icon name="ph:flag-bold" class="text-lg flex-shrink-0" />
            <span>{{ $t('nav.reports', 'My reports') }}</span>
          </NuxtLink>
          <NuxtLink
            to="/settings"
            class="flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium text-text-secondary hover:bg-fg-default/5 hover:text-text-primary transition-colors"
            @click="showMobileNav = false"
          >
            <Icon name="ph:gear" class="text-lg flex-shrink-0" />
            <span>{{ $t('nav.settings') }}</span>
          </NuxtLink>
          <button
            type="button"
            class="flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium text-red-400 hover:bg-red-500/10 transition-colors text-left"
            @click="onMobileLogout"
          >
            <Icon name="ph:sign-out" class="text-lg flex-shrink-0" />
            <span>{{ $t('nav.signOut') }}</span>
          </button>
        </div>
      </aside>
    </Transition>

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
          <span
            v-if="appVersion"
            class="text-text-muted/60"
            :title="`Trackarr v${appVersion}`"
            >v{{ appVersion }}</span
          >
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

// Navbar search bar state. The query is local to the layout — it
// pushes to /torrents on submit and the listing's own `route.query.q`
// watcher takes over from there. Tracking focus in a ref (rather than
// CSS :focus-within) lets us swap the right-hand affordance between a
// `/` key hint (idle) and an `x` clear button (typing).
const navSearchQuery = ref('');
const navSearchRef = ref<HTMLInputElement | null>(null);
const navSearchFocused = ref(false);
const navSearchMobileRef = ref<HTMLInputElement | null>(null);
const navSearchMobileQuery = ref('');

// Mobile drawer state. We close it on every route change so the user
// doesn't see stale chrome from the previous page, and we lock body
// scroll while it's open so the page underneath doesn't move when the
// user scrolls inside the drawer.
const showMobileNav = ref(false);
watch(() => router.currentRoute.value.fullPath, () => {
  showMobileNav.value = false;
});
if (import.meta.client) {
  watch(showMobileNav, (open) => {
    document.body.style.overflow = open ? 'hidden' : '';
  });
}

// App version comes from `pkg.version` via nuxt.config runtime config;
// the static-build path also gets a runtime override from the API at
// boot (apps/web/app/plugins/runtime-config.client.ts).
const appVersion = computed(
  () => useRuntimeConfig().public.appVersion as string | undefined
);

// Site branding — shared composable that dedupes across the
// layout, the homepage hero, and the auth pages so we don't
// fetch the same payload 3-4 times per SSR request.
const branding = await useBranding();

// Set dynamic favicon and title template
useHead({
  titleTemplate: computed(() => {
    const suffix =
      branding.value?.pageTitleSuffix ||
      `- ${stripTags(branding.value?.siteName) || 'TRACKARR'}`;
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

// Nav labels go through `t()` at render time. The `labelKey` lookup
// stays in `i18n/locales/*.json` under `nav.*` so a translator only
// has to touch the JSON, never the template.
// Dashboard ("/") is reachable via the logo on the left of the bar, so
// it's omitted from the link list to keep the navbar slim — adding a
// duplicate entry would just buy space and noise without a new
// affordance.
//
// /search was merged into /torrents — one surface for browsing, searching
// and uploading. The icon stays a "list" because the navbar already
// surfaces a magnifying-glass via the centred search bar; doubling up
// would muddy the meaning of the link.
const navLinks = [
  { to: '/torrents', labelKey: 'nav.torrents', icon: 'ph:files', adminOnly: false },
  { to: '/requests', labelKey: 'nav.requests', icon: 'ph:megaphone-bold', adminOnly: false },
  { to: '/forum', labelKey: 'nav.forum', icon: 'ph:chat-centered-text', adminOnly: false },
  { to: '/admin', labelKey: 'nav.admin', icon: 'ph:shield-check', adminOnly: true },
  { to: '/mod', labelKey: 'nav.mod', icon: 'ph:shield', modOnly: true },
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

// Submit either the desktop or mobile navbar search. Same destination,
// same query semantics — the only difference is which input we read.
// We trim whitespace, bail on empty submissions (no point landing on
// /torrents?q= with an empty parameter that the page would just ignore),
// and clear the field afterwards so the navbar feels "consumed" the
// way a command palette does.
function submitNavSearch() {
  const q = navSearchQuery.value.trim();
  if (!q) return;
  router.push({ path: '/torrents', query: { q } });
  navSearchQuery.value = '';
  navSearchRef.value?.blur();
}

function clearNavSearch() {
  navSearchQuery.value = '';
  navSearchRef.value?.focus();
}

function submitNavSearchMobile() {
  const q = navSearchMobileQuery.value.trim();
  if (!q) return;
  router.push({ path: '/torrents', query: { q } });
  navSearchMobileQuery.value = '';
  showMobileNav.value = false;
}

// Global `/` shortcut — focuses the navbar search from anywhere on
// the page. We deliberately ignore the keypress while the user is
// already typing in another field (input/textarea/contenteditable) so
// that legitimate slashes still land in their target. Esc inside the
// search blurs the field and clears any in-flight query.
function onGlobalKeydown(e: KeyboardEvent) {
  if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const active = document.activeElement as HTMLElement | null;
    const isTyping =
      !!active &&
      (active.tagName === 'INPUT' ||
        active.tagName === 'TEXTAREA' ||
        active.isContentEditable);
    if (isTyping) return;
    e.preventDefault();
    navSearchRef.value?.focus();
    navSearchRef.value?.select();
    return;
  }
  if (e.key === 'Escape' && document.activeElement === navSearchRef.value) {
    navSearchQuery.value = '';
    navSearchRef.value?.blur();
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
  document.addEventListener('keydown', onGlobalKeydown);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
  document.removeEventListener('keydown', onGlobalKeydown);
});

async function onMobileLogout() {
  // Mobile drawer wraps both the link and the button: close the drawer
  // first so the transition isn't fighting the navigation.
  showMobileNav.value = false;
  await handleLogout();
}

async function handleLogout() {
  showUserMenu.value = false;
  // Without this POST the server-side session cookie stays valid, so
  // the auth middleware bounces /auth/login back to / — the user
  // appeared to be redirected home "without logging out".
  try {
    await $fetch('/api/auth/logout', { method: 'POST' });
  } catch {
    // The endpoint clears the cookie unconditionally; if the network
    // hiccupped we still fall through to clear() so the local state
    // matches what the server is about to do on the next request.
  }
  await clear();
  await navigateTo('/auth/login');
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

/* Drawer panel: solid surface so the page underneath isn't visible
   through the sheet, with a hard shadow that anchors it to the top. */
.mobile-drawer {
  box-shadow: var(--shadow-overlay);
}

/* =============================================================================
 * Navbar search — slim pill that nests between the desktop nav and the
 * stats cluster. The container does the visuals (border, background,
 * focus glow); the <input> stays transparent so the icon and the
 * trailing affordance (kbd hint OR clear button) feel like part of one
 * surface. The whole thing follows the brutalist-techno tokens used
 * elsewhere — JetBrains Mono caption, 4px radius, accent-tinted ring
 * on focus.
 * ============================================================================= */
.navsearch {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  height: 34px;
  padding: 0 0.5rem 0 0.7rem;
  background: rgb(var(--bg-elevated) / 0.55);
  border: 1px solid rgb(var(--line-default));
  border-radius: 6px;
  transition: border-color 0.18s ease, background 0.18s ease,
    box-shadow 0.18s ease;
  position: relative;
}
.navsearch::before {
  /* Faint top-edge sheen — reads as a subtle "lit-from-above" treatment
     when the input is on a dark background, mirroring the depth of the
     stats badge to its right. Hidden in light mode where the gradient
     would muddy the cleaner palette. */
  content: '';
  position: absolute;
  inset: 0 1px auto 1px;
  height: 1px;
  background: linear-gradient(
    to right,
    transparent,
    rgb(var(--fg-default) / 0.08),
    transparent
  );
  border-radius: inherit;
  pointer-events: none;
}
.navsearch:hover {
  border-color: rgb(var(--line-strong));
  background: rgb(var(--bg-elevated) / 0.85);
}
.navsearch:focus-within {
  border-color: rgb(var(--accent) / 0.7);
  background: rgb(var(--bg-elevated));
  box-shadow:
    0 0 0 3px rgb(var(--accent) / 0.14),
    0 1px 0 0 rgb(var(--accent) / 0.18) inset;
}
.navsearch--filled {
  border-color: rgb(var(--accent) / 0.4);
}
.navsearch--block {
  /* Mobile drawer: full-width, slightly taller for thumb comfort. */
  height: 40px;
  border-radius: 8px;
  padding-left: 0.85rem;
}

.navsearch-icon {
  color: rgb(var(--fg-muted));
  font-size: 14px;
  flex-shrink: 0;
  transition: color 0.18s ease, transform 0.18s ease;
}
.navsearch:focus-within .navsearch-icon,
.navsearch--filled .navsearch-icon {
  color: rgb(var(--accent));
  transform: scale(1.05);
}

.navsearch-input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: 0;
  outline: 0;
  padding: 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12.5px;
  font-weight: 500;
  letter-spacing: 0.01em;
  color: rgb(var(--fg-strong));
  caret-color: rgb(var(--accent));
}
.navsearch-input::placeholder {
  color: rgb(var(--fg-subtle));
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-weight: 400;
  letter-spacing: 0.01em;
}
.navsearch-input:focus::placeholder {
  color: rgb(var(--fg-faint));
}
/* Hide the WebKit/Blink "search" decorations — the trailing X cancel
   button doesn't match the rest of the design and the magnifier-result
   decoration is redundant with our left-side icon. */
.navsearch-input::-webkit-search-decoration,
.navsearch-input::-webkit-search-cancel-button,
.navsearch-input::-webkit-search-results-button,
.navsearch-input::-webkit-search-results-decoration {
  display: none;
}

/* Idle affordance — a `/` keyboard hint badge that mirrors the in-page
   SearchBar component, doubling as visual weight balance against the
   left icon. Disappears on focus + when the user starts typing. */
.navsearch-kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 1.2rem;
  min-width: 1.2rem;
  padding: 0 0.35rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 700;
  color: rgb(var(--fg-muted));
  background: rgb(var(--bg-base) / 0.7);
  border: 1px solid rgb(var(--line-default));
  border-radius: 3px;
  flex-shrink: 0;
  transition: opacity 0.18s ease, transform 0.18s ease;
}

/* Active affordance — clear button, swaps in once the user starts
   typing. Matches the size/weight of the kbd hint so the bar's
   silhouette doesn't shift between idle and editing. */
.navsearch-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 1.4rem;
  width: 1.4rem;
  padding: 0;
  background: transparent;
  border: 0;
  border-radius: 3px;
  color: rgb(var(--fg-muted));
  cursor: pointer;
  flex-shrink: 0;
  transition: color 0.14s ease, background 0.14s ease;
}
.navsearch-clear:hover {
  color: rgb(var(--fg-strong));
  background: rgb(var(--fg-default) / 0.1);
}
.navsearch-clear svg {
  width: 11px;
  height: 11px;
}
</style>
