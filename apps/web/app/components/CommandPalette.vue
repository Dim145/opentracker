<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="modal-overlay palette-overlay"
        @click.self="close"
      >
        <div
          ref="panelRef"
          class="modal-panel palette-panel"
          role="dialog"
          aria-modal="true"
          :aria-label="$t('palette.title')"
          @click.stop
        >
          <div class="palette-field">
            <Icon
              name="ph:magnifying-glass"
              class="w-4 h-4 flex-shrink-0 text-text-muted"
            />
            <input
              ref="inputRef"
              v-model="query"
              type="text"
              role="combobox"
              autocomplete="off"
              spellcheck="false"
              :aria-expanded="flat.length > 0"
              :aria-controls="listId"
              :aria-activedescendant="activeOptionId"
              aria-autocomplete="list"
              :placeholder="$t('palette.placeholder')"
              :aria-label="$t('palette.placeholder')"
              class="palette-input"
              @keydown.down.prevent="move(1)"
              @keydown.up.prevent="move(-1)"
              @keydown.enter.prevent="choose(flat[selected])"
              @keydown.esc.prevent="close"
            />
            <kbd class="palette-kbd">esc</kbd>
          </div>

          <div
            :id="listId"
            ref="listRef"
            role="listbox"
            :aria-label="$t('palette.title')"
            :aria-busy="loading || undefined"
            class="palette-results"
          >
            <p v-if="!flat.length" class="palette-empty">
              {{ loading ? $t('palette.searching') : $t('palette.noResults') }}
            </p>

            <template v-for="section in sections" :key="section.key">
              <p class="palette-section eyebrow">{{ section.label }}</p>
              <button
                v-for="item in section.items"
                :id="optionId(item.id)"
                :key="item.id"
                type="button"
                role="option"
                :aria-selected="flat[selected]?.id === item.id"
                class="palette-option"
                :class="
                  flat[selected]?.id === item.id
                    ? 'bg-bg-tertiary text-text-primary'
                    : 'text-text-muted'
                "
                @click="choose(item)"
                @mousemove="selected = flat.indexOf(item)"
              >
                <Icon :name="item.icon" class="palette-option-icon" />
                <span class="truncate">{{ item.label }}</span>
                <span v-if="item.meta" class="palette-option-meta truncate">
                  {{ item.meta }}
                </span>
              </button>
            </template>

            <!-- The remote groups arrive after the local ones, so say so rather
                 than letting the panel look finished while it is not. -->
            <p v-if="loading && flat.length" class="palette-loading">
              {{ $t('palette.searching') }}
            </p>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import type { PaletteItem } from '~/utils/commandPalette';

/**
 * Global command palette — ⌘K / Ctrl+K.
 *
 * One surface over four kinds of answer: the menus (main nav, account pages,
 * and every admin destination), the actions that have no menu entry of their
 * own, the catalogue, and — for staff — the member list. Mounted once by the
 * default layout.
 *
 * Nothing here keeps its own copy of the navigation. The main links come from
 * the layout's own array and the admin ones from `useAdminNav`, which the
 * sidebar reads too: a palette that offers a page the chrome has dropped is
 * worse than no palette, because it looks authoritative.
 */

const { t } = useI18n();
const router = useRouter();
const route = useRoute();
const { user, clear } = useUserSession();
const { navGroups, navHome, navSettings } = useAdminNav();

// Comes from the layout, which has already awaited `useBranding()`. Resolving
// it here instead would make this an async component and drag it into the
// layout's <Suspense> boundary for one boolean.
const props = defineProps<{ federationEnabled?: boolean }>();

const open = ref(false);
const query = ref('');
const selected = ref(0);
const loading = ref(false);

const inputRef = ref<HTMLInputElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const listRef = ref<HTMLElement | null>(null);

// Stable ids so the combobox can point `aria-activedescendant` at the
// highlighted option without moving DOM focus out of the input.
const baseId = useId();
const listId = `${baseId}-listbox`;
const optionId = (id: string) => `${baseId}-option-${id}`;

/**
 * What this session may be shown. The whole matrix lives in
 * `app/utils/paletteAccess.ts`, pure and tested across every role — it used to
 * be four computeds here, where a lost condition failed silently.
 */
const access = computed(() => paletteAccessFor(user.value));

// If a session ends while the panel is up — a ban, a logout in another tab,
// the 2FA enforcement landing on this account — it closes under the reader
// rather than staying open over a page they no longer have.
watch(
  () => access.value.available,
  (ok) => {
    if (!ok) close();
  }
);

/**
 * The same destinations the navbar shows, under the same conditions. Kept in
 * step with `visibleNavLinks` in the layout by construction: both filter on the
 * same three predicates.
 */
const mainLinks = computed<PaletteItem[]>(() => {
  const links = [
    { to: '/torrents', key: 'torrents', icon: 'ph:files' },
    {
      to: '/federated',
      key: 'federated',
      icon: 'ph:broadcast',
      needs: () => !!props.federationEnabled,
    },
    { to: '/requests', key: 'requests', icon: 'ph:megaphone-bold' },
    { to: '/forum', key: 'forum', icon: 'ph:chat-centered-text' },
    {
      to: '/admin',
      key: 'admin',
      icon: 'ph:shield-check',
      needs: () => access.value.admin,
    },
    { to: '/mod', key: 'mod', icon: 'ph:shield', needs: () => access.value.moderation },
  ];
  return links
    .filter((link) => !link.needs || link.needs())
    .map((link) => ({
      id: `nav-${link.key}`,
      group: 'navigation' as const,
      label: t(`nav.${link.key}`),
      icon: link.icon,
      to: link.to,
    }));
});

/** The account destinations, which live in the avatar menu rather than the bar. */
const accountLinks = computed<PaletteItem[]>(() => {
  if (!access.value.account) return [];
  const links = [
    { to: '/me', key: 'profile', icon: 'ph:user' },
    // Only when the scope admits this member — the palette never offers a
    // page the chrome has decided not to show.
    ...(access.value.messaging
      ? [{ to: '/messages', key: 'messages', icon: 'ph:chat-circle' }]
      : []),
    { to: '/favorites', key: 'favorites', icon: 'ph:heart' },
    { to: '/following', key: 'following', icon: 'ph:bell' },
    { to: '/downloads', key: 'downloads', icon: 'ph:download-simple' },
    { to: '/invites', key: 'invites', icon: 'ph:envelope-simple' },
    { to: '/shop', key: 'shop', icon: 'ph:storefront' },
    { to: '/notifications', key: 'notifications', icon: 'ph:bell-ringing' },
    { to: '/settings', key: 'settings', icon: 'ph:gear' },
  ];
  return links.map((link) => ({
    id: `account-${link.key}`,
    group: 'navigation' as const,
    label: t(`palette.account.${link.key}`),
    icon: link.icon,
    to: link.to,
  }));
});

/**
 * Every admin destination, tagged with the section it lives under so "Themes"
 * reads as "Themes · Appearance" and does not collide with the member-facing
 * pages in the same list.
 */
const adminLinks = computed<PaletteItem[]>(() => {
  if (!access.value.admin) return [];
  const flatten = (item: (typeof navHome)['value'], section?: string) => ({
    id: `admin-${item.path}`,
    group: 'navigation' as const,
    label: item.label,
    meta: section ?? t('admin.eyebrow'),
    icon: item.icon,
    to: item.path,
    keywords: item.description,
  });
  return [
    flatten(navHome.value),
    ...navGroups.value.flatMap((group) =>
      group.items.map((item) => flatten(item, group.label))
    ),
    flatten(navSettings.value),
  ];
});

/**
 * Things you do rather than places you go. Each still carries a `to`, so a
 * middle-click and the browser's own affordances keep working on the ones that
 * are really navigations.
 */
const actions = computed<PaletteItem[]>(() => {
  const out: PaletteItem[] = [];
  if (access.value.account) {
    out.push({
      id: 'action-upload',
      group: 'actions',
      label: t('palette.actions.upload'),
      icon: 'ph:upload-simple',
      to: '/torrents/upload',
      keywords: 'upload publish new torrent envoyer publier',
    });
  }
  // Deliberately the picker rather than a toggle. `useColorMode().toggle()`
  // only means anything between the two built-ins — on a custom theme it falls
  // back to `dark`, which would yank a member off the theme they chose.
  out.push({
    id: 'action-theme',
    group: 'actions',
    label: t('palette.actions.theme'),
    icon: 'ph:palette',
    to: '/settings',
    keywords: 'theme dark light mode appearance thème sombre clair apparence',
  });
  if (access.value.account) {
    out.push({
      id: 'action-signout',
      group: 'actions',
      label: t('palette.actions.signOut'),
      icon: 'ph:sign-out',
      to: '/',
      keywords: 'logout sign out disconnect deconnexion quitter',
      run: async () => {
        await $fetch('/api/auth/logout', { method: 'POST' });
        await clear();
        await router.push('/');
      },
    });
  }
  return out;
});

const localItems = computed<PaletteItem[]>(() => [
  ...mainLinks.value,
  ...accountLinks.value,
  ...adminLinks.value,
  ...actions.value,
]);

// ---------------------------------------------------------------------------
// Remote results
//
// Two round trips the palette cannot answer from memory. They are gated three
// ways — the panel has to be open, the query long enough to be worth a query,
// and the viewer entitled to the endpoint — because this component is mounted
// on every page and an ungated watcher would fan out on every keystroke of
// every session.
// ---------------------------------------------------------------------------

const remoteItems = ref<PaletteItem[]>([]);
let debounce: ReturnType<typeof setTimeout> | undefined;
let inFlight: AbortController | undefined;

const MIN_REMOTE_QUERY = 2;
const REMOTE_DEBOUNCE_MS = 250;

async function fetchRemote(term: string) {
  inFlight?.abort();
  const controller = new AbortController();
  inFlight = controller;
  loading.value = true;

  try {
    const [torrents, users] = await Promise.all([
      $fetch<{ data: Array<{ infoHash: string; name: string; category?: { name?: string } | null }> }>(
        '/api/torrents',
        { query: { search: term, limit: 5 }, signal: controller.signal }
      ).catch(() => null),
      access.value.memberSearch
        ? $fetch<{ items: Array<{ id: string; username: string; role?: string | null }> }>(
            '/api/admin/users',
            { query: { search: term, pageSize: 5 }, signal: controller.signal }
          ).catch(() => null)
        : Promise.resolve(null),
    ]);

    if (controller.signal.aborted) return;

    remoteItems.value = [
      ...(torrents?.data ?? []).map((torrent) => ({
        id: `torrent-${torrent.infoHash}`,
        group: 'torrents' as const,
        label: torrent.name,
        meta: torrent.category?.name ?? undefined,
        icon: 'ph:file-arrow-down',
        to: `/torrents/${torrent.infoHash}`,
      })),
      ...(users?.items ?? []).map((member) => ({
        id: `user-${member.id}`,
        group: 'users' as const,
        label: member.username,
        meta: member.role ?? undefined,
        icon: 'ph:user-circle',
        to: `/users/${member.id}`,
      })),
    ];
  } finally {
    if (!controller.signal.aborted) loading.value = false;
  }
}

watch([query, open], ([term, isOpen]) => {
  clearTimeout(debounce);
  if (!isOpen || term.trim().length < MIN_REMOTE_QUERY) {
    inFlight?.abort();
    remoteItems.value = [];
    loading.value = false;
    return;
  }
  debounce = setTimeout(() => fetchRemote(term.trim()), REMOTE_DEBOUNCE_MS);
});

// ---------------------------------------------------------------------------
// Ranking and display
// ---------------------------------------------------------------------------

const SECTION_ORDER = ['navigation', 'actions', 'torrents', 'users'] as const;

const ranked = computed(() =>
  rankPaletteItems([...localItems.value, ...remoteItems.value], query.value)
);

const sections = computed(() =>
  SECTION_ORDER.map((key) => ({
    key,
    label: t(`palette.groups.${key}`),
    items: ranked.value.filter((item) => item.group === key),
  })).filter((section) => section.items.length > 0)
);

/**
 * The rendered order, flattened.
 *
 * Arrow keys walk THIS, not the raw ranking: the panel draws section by
 * section, so stepping through the ranked order would send the highlight
 * jumping between headings for no reason the reader can see.
 */
const flat = computed(() => sections.value.flatMap((section) => section.items));

const activeOptionId = computed(() => {
  const item = flat.value[selected.value];
  return item ? optionId(item.id) : undefined;
});

watch(flat, (items) => {
  if (selected.value >= items.length) selected.value = 0;
});

function move(delta: number) {
  if (!flat.value.length) return;
  const next = selected.value + delta;
  // Wraps: at twenty-odd results, running off the end and stopping dead is
  // more annoying than landing back at the top.
  selected.value = (next + flat.value.length) % flat.value.length;
  nextTick(scrollSelectedIntoView);
}

function scrollSelectedIntoView() {
  const item = flat.value[selected.value];
  if (!item || !listRef.value) return;
  listRef.value
    .querySelector(`#${CSS.escape(optionId(item.id))}`)
    ?.scrollIntoView({ block: 'nearest' });
}

async function choose(item: PaletteItem | undefined) {
  if (!item) return;
  close();
  if (item.run) {
    await item.run();
    return;
  }
  await router.push(item.to);
}

// ---------------------------------------------------------------------------
// Open / close
// ---------------------------------------------------------------------------

/** Where focus was before the palette took it, so Esc can hand it back. */
let opener: HTMLElement | null = null;

function toggle() {
  if (open.value) {
    close();
    return;
  }
  if (!access.value.available) return;
  opener = (document.activeElement as HTMLElement) ?? null;
  query.value = '';
  selected.value = 0;
  remoteItems.value = [];
  open.value = true;
  nextTick(() => inputRef.value?.focus());
}

function close() {
  if (!open.value) return;
  open.value = false;
  clearTimeout(debounce);
  inFlight?.abort();
  // Handing focus back matters most when ⌘K was pressed from a text field:
  // dropping focus to <body> there loses the caret the reader was using.
  opener?.focus?.();
  opener = null;
}

function onKeydown(event: KeyboardEvent) {
  const key = event.key?.toLowerCase();
  if ((event.metaKey || event.ctrlKey) && key === 'k') {
    if (!access.value.available && !open.value) return;
    event.preventDefault();
    toggle();
  } else if (key === 'escape' && open.value) {
    event.preventDefault();
    close();
  }
}

// The navbar chip opens the palette through this rather than prop-drilling a
// ref down through the layout.
const TOGGLE_EVENT = 'trackarr:toggle-palette';

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  window.addEventListener(TOGGLE_EVENT, toggle);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener(TOGGLE_EVENT, toggle);
  clearTimeout(debounce);
  inFlight?.abort();
});

// Navigating away closes it — `choose` already does, but a browser back button
// while the panel is up would otherwise leave it hanging over the new page.
watch(() => route.fullPath, close);

// Lock body scroll behind the panel, same as the layout drawer.
if (import.meta.client) {
  watch(open, (isOpen) => {
    document.body.style.overflow = isOpen ? 'hidden' : '';
  });
  onBeforeUnmount(() => {
    document.body.style.overflow = '';
  });
}
</script>

<style scoped>
/* `.modal-overlay` centres its child; the palette hangs from the top instead,
   the way every command bar does — the list grows downwards and the input
   stays where the eye already is. Only the two properties that reposition it
   are overridden; the backdrop colour and blur stay the house treatment. */
.palette-overlay {
  align-items: flex-start;
  padding-top: 12vh;
}

.palette-panel {
  max-width: 40rem;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.palette-field {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.875rem 1rem;
  border-bottom: 1px solid rgb(var(--line-default));
}

.palette-input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: 0;
  font-size: 0.9375rem;
  color: rgb(var(--fg-strong));
}

.palette-kbd {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: 0.625rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgb(var(--fg-subtle));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-xs);
  padding: 0.125rem 0.375rem;
}

.palette-results {
  overflow-y: auto;
  max-height: min(60vh, 32rem);
  padding: 0.375rem;
}

.palette-section {
  padding: 0.5rem 0.625rem 0.25rem;
}

.palette-option {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  width: 100%;
  /* A finger target below md, where this is a full-width sheet of results. */
  padding: 0.6875rem 0.625rem;
  border-radius: var(--radius-sm);
  font-size: 0.875rem;
  text-align: left;
  cursor: pointer;
}

.palette-option-icon {
  width: 1rem;
  height: 1rem;
  flex-shrink: 0;
  opacity: 0.75;
}

.palette-option-meta {
  margin-left: auto;
  padding-left: 0.75rem;
  font-size: 0.75rem;
  color: rgb(var(--fg-subtle));
}

.palette-empty,
.palette-loading {
  padding: 1.5rem 0.625rem;
  text-align: center;
  font-size: 0.875rem;
  color: rgb(var(--fg-muted));
}

.palette-loading {
  padding: 0.5rem 0.625rem;
}

@media (min-width: 768px) {
  .palette-option {
    padding: 0.4375rem 0.625rem;
  }
}
</style>
