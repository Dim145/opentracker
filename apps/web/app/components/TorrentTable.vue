<template>
  <!-- Below md: stack each torrent as a tappable card. Tables drown on
       phones — too many narrow columns force horizontal scroll inside
       a card on every page. The card layout keeps the same data
       (name + tags + category + S/L + size + age) but reflows it into
       readable blocks with a 44 px-min tap target. -->
  <!-- Mobile sort bar. The cards carry no header row, so the columns become
       chips; the active one shows its direction and reverses when tapped
       again, exactly like the desktop headers. -->
  <div
    v-if="sortBy !== undefined && torrents.length > 0"
    class="md:hidden flex items-center gap-1.5 px-3 py-2 overflow-x-auto no-scrollbar border-b border-border"
  >
    <span class="text-[10px] uppercase tracking-wider text-text-muted shrink-0">
      {{ $t('components.torrentTable.sortedBy') }}
    </span>
    <button
      v-for="opt in mobileSortOptions"
      :key="opt.key"
      type="button"
      class="shrink-0 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors"
      :class="
        sortBy === opt.key
          ? 'border-accent text-text-primary'
          : 'border-border text-text-muted'
      "
      :aria-pressed="sortBy === opt.key"
      @click="emit('sort', opt.key)"
    >
      {{ opt.label }}
      <Icon
        v-if="sortBy === opt.key"
        :name="order === 'asc' ? 'ph:caret-up-bold' : 'ph:caret-down-bold'"
        class="w-3 h-3"
      />
    </button>
  </div>

  <div class="md:hidden divide-y divide-border">
    <p
      v-if="torrents.length === 0"
      class="text-center text-text-muted py-8 text-sm"
    >
      {{ $t('components.torrentTable.noTorrents') }}
    </p>
    <button
      v-for="torrent in torrents"
      :key="torrent.id"
      type="button"
      class="w-full text-left px-3 py-3 active:bg-fg-default/5 transition-colors block"
      @click="navigateTo(`/torrents/${torrent.infoHash}`)"
    >
      <div class="flex items-start gap-2">
        <Icon
          :name="getCategoryIcon(torrent.category)"
          class="text-text-muted text-base shrink-0 mt-0.5"
        />
        <div class="flex-1 min-w-0">
          <p
            class="text-sm font-medium text-text-primary leading-snug break-words [overflow-wrap:anywhere] [text-wrap:pretty] line-clamp-2"
            :title="torrent.name"
          >
            {{ withWrapHints(torrent.name) }}
          </p>
          <!-- Meta row: category chip + tags. The tag list scrolls
               horizontally so a torrent with 5+ tags doesn't bloat
               the card height. -->
          <div
            v-if="torrent.category || (torrent.tags?.length ?? 0) > 0"
            class="mt-1.5 flex items-center gap-1.5 overflow-x-auto -mx-1 px-1 no-scrollbar"
          >
            <span
              v-if="!compact && torrent.category"
              class="text-[10px] bg-bg-tertiary border border-border px-1.5 py-0.5 rounded-sm text-text-secondary uppercase font-bold tracking-wider whitespace-nowrap shrink-0"
            >
              {{ getCategoryDisplayName(torrent.category) }}
            </span>
            <span
              v-for="tag in torrent.tags ?? []"
              :key="tag.id"
              class="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider border px-1.5 py-0.5 rounded-sm shrink-0 whitespace-nowrap"
              :style="tagBadgeStyle(tag)"
              :title="tag.name"
            >
              <span
                class="inline-block w-1.5 h-1.5 rounded-full"
                :style="{ backgroundColor: tag.color }"
              />
              {{ tag.name }}
            </span>
          </div>
          <!-- Stats row: S/L pills + size + age, all monospace.
               This row is always present so the user can compare
               cards by glancing down the right side. -->
          <div class="mt-2 flex items-center flex-wrap gap-x-3 gap-y-1.5">
            <span class="stat-badge stat-seeders">
              <Icon name="ph:arrow-up-bold" class="text-[8px]" />
              {{ torrent.stats.seeders }}
            </span>
            <span class="stat-badge stat-leechers">
              <Icon name="ph:arrow-down-bold" class="text-[8px]" />
              {{ torrent.stats.leechers }}
            </span>
            <span
              v-if="!compact"
              class="text-[10px] font-mono text-text-secondary"
              :title="$t('components.torrentTable.completedDownloads')"
            >
              <Icon name="ph:check-bold" class="text-[10px] inline" />
              {{ torrent.stats.completed }}
            </span>
            <span
              v-if="!compact"
              class="text-[10px] font-mono text-text-secondary"
            >
              {{ formatSize(torrent.size) }}
            </span>
            <span class="ml-auto text-[10px] font-mono text-text-muted">
              {{ formatAge(torrent.createdAt) }}
            </span>
            <button
              v-if="torrent.viewerFavorited !== undefined"
              type="button"
              class="favorite-star favorite-star--mobile"
              :class="{ 'is-on': isFavorited(torrent) }"
              :aria-pressed="isFavorited(torrent)"
              :title="
                isFavorited(torrent)
                  ? $t('components.torrentTable.unfavorite')
                  : $t('components.torrentTable.favorite')
              "
              @click.stop="toggleFavorite(torrent)"
            >
              <Icon
                :name="isFavorited(torrent) ? 'ph:star-fill' : 'ph:star-bold'"
              />
            </button>
            <button
              v-if="admin"
              type="button"
              class="text-text-muted hover:text-error active:text-error transition-colors w-9 h-9 -mr-2 -my-2 inline-flex items-center justify-center rounded"
              :title="$t('components.torrentTable.deleteTitle')"
              @click.stop="deleteTorrent(torrent)"
            >
              <Icon name="ph:trash" class="text-base" />
            </button>
          </div>
        </div>
      </div>
    </button>
  </div>

  <!-- ≥ md: original table preserved verbatim. -->
  <table class="data-table hidden md:table">
    <thead>
      <tr>
        <th class="w-1/2" :aria-sort="ariaSort('name')">
          <SortHeader v-bind="sortProps('name')">{{ $t('components.torrentTable.name') }}</SortHeader>
        </th>
        <th v-if="!compact" :aria-sort="ariaSort('category')">
          <SortHeader v-bind="sortProps('category')">{{ $t('components.torrentTable.category') }}</SortHeader>
        </th>
        <th v-if="!compact">{{ $t('components.torrentTable.hash') }}</th>
        <th class="text-center w-16" :aria-sort="ariaSort('seeders')">
          <SortHeader v-bind="sortProps('seeders')" align="center" :title="$t('components.torrentTable.seedersTitle')">
            <Icon name="ph:arrow-up-bold" class="text-success" />
            <span>{{ $t('components.torrentTable.seeders') }}</span>
          </SortHeader>
        </th>
        <th class="text-center w-16" :aria-sort="ariaSort('leechers')">
          <SortHeader v-bind="sortProps('leechers')" align="center" :title="$t('components.torrentTable.leechersTitle')">
            <Icon name="ph:arrow-down-bold" class="text-warning" />
            <span>{{ $t('components.torrentTable.leechers') }}</span>
          </SortHeader>
        </th>
        <th v-if="!compact" class="text-center w-16" :aria-sort="ariaSort('completed')">
          <SortHeader v-bind="sortProps('completed')" align="center" :title="$t('components.torrentTable.completedTitle')">
            <Icon name="ph:check-bold" class="text-text-secondary" />
            <span>{{ $t('components.torrentTable.completed') }}</span>
          </SortHeader>
        </th>
        <th v-if="!compact" :aria-sort="ariaSort('size')">
          <SortHeader v-bind="sortProps('size')">{{ $t('components.torrentTable.size') }}</SortHeader>
        </th>
        <th class="text-right w-16" :aria-sort="ariaSort('age')">
          <SortHeader v-bind="sortProps('age')" align="right">{{ $t('components.torrentTable.age') }}</SortHeader>
        </th>
        <th v-if="hasFavoriteColumn" class="w-10"></th>
        <th v-if="admin" class="w-12"></th>
      </tr>
    </thead>
    <tbody>
      <tr v-if="torrents.length === 0">
        <td
          :colspan="(compact ? 4 : 8) + (admin ? 1 : 0) + (hasFavoriteColumn ? 1 : 0)"
          class="text-center text-text-muted py-8"
        >
          {{ $t('components.torrentTable.noTorrents') }}
        </td>
      </tr>
      <tr
        v-for="torrent in torrents"
        :key="torrent.id"
        class="cursor-pointer"
        @click="navigateTo(`/torrents/${torrent.infoHash}`)"
      >
        <td>
          <div class="flex items-center gap-2 flex-wrap">
            <Icon
              :name="getCategoryIcon(torrent.category)"
              class="text-text-muted text-base shrink-0"
            />
            <span
              class="text-text-primary hover:text-text-strong transition-colors font-medium truncate max-w-[300px] lg:max-w-[500px]"
              >{{ torrent.name }}</span
            >
            <span
              v-for="tag in torrent.tags ?? []"
              :key="tag.id"
              class="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider border px-1.5 py-0.5 rounded-sm shrink-0"
              :style="tagBadgeStyle(tag)"
              :title="tag.name"
            >
              <span
                class="inline-block w-1.5 h-1.5 rounded-full"
                :style="{ backgroundColor: tag.color }"
              />
              {{ tag.name }}
            </span>
          </div>
        </td>
        <td v-if="!compact">
          <span
            v-if="torrent.category"
            class="text-[10px] bg-bg-tertiary border border-border px-1.5 py-0.5 rounded-sm text-text-secondary uppercase font-bold tracking-wider"
          >
            {{ getCategoryDisplayName(torrent.category) }}
          </span>
          <span v-else class="text-xs text-text-muted">—</span>
        </td>
        <td v-if="!compact">
          <code
            class="truncate-hash text-text-muted bg-bg-tertiary/50 px-1 rounded"
            :title="torrent.infoHash"
          >
            {{ torrent.infoHash.slice(0, 8) }}...{{
              torrent.infoHash.slice(-4)
            }}
          </code>
        </td>
        <td class="text-center">
          <span class="stat-badge stat-seeders">
            <Icon name="ph:arrow-up-bold" class="text-[8px]" />
            {{ torrent.stats.seeders }}
          </span>
        </td>
        <td class="text-center">
          <span class="stat-badge stat-leechers">
            <Icon name="ph:arrow-down-bold" class="text-[8px]" />
            {{ torrent.stats.leechers }}
          </span>
        </td>
        <td v-if="!compact" class="text-center text-text-secondary font-mono">
          {{ torrent.stats.completed }}
        </td>
        <td v-if="!compact" class="text-text-secondary font-mono text-[10px]">
          {{ formatSize(torrent.size) }}
        </td>
        <td class="text-right text-text-muted text-[10px] font-mono">
          {{ formatAge(torrent.createdAt) }}
        </td>
        <td
          v-if="torrent.viewerFavorited !== undefined"
          class="text-center w-10"
        >
          <button
            type="button"
            class="favorite-star"
            :class="[
              isFavorited(torrent)
                ? 'text-amber-500 hover:text-amber-400'
                : 'text-text-faint hover:text-amber-400',
            ]"
            :aria-pressed="isFavorited(torrent)"
            :title="
              isFavorited(torrent)
                ? $t('components.torrentTable.unfavorite')
                : $t('components.torrentTable.favorite')
            "
            @click.stop="toggleFavorite(torrent)"
          >
            <Icon
              :name="isFavorited(torrent) ? 'ph:star-fill' : 'ph:star-bold'"
              class="text-base transition-transform"
              :class="{ 'star-pop': isFavorited(torrent) }"
            />
          </button>
        </td>
        <td v-if="admin" class="text-center">
          <button
            class="text-text-muted hover:text-error transition-colors p-1.5 rounded hover:bg-error/10"
            :title="$t('components.torrentTable.deleteTitle')"
            @click.stop="deleteTorrent(torrent)"
          >
            <Icon name="ph:trash" class="text-base" />
          </button>
        </td>
      </tr>
    </tbody>
  </table>
</template>

<script setup lang="ts">
import type { TorrentSortKey } from '@trackarr/shared';
import { withWrapHints } from '~/utils/displayTitle';
import { getCategoryIcon } from '~/utils/categoryIcon';

interface TorrentTag {
  id: string;
  name: string;
  slug: string;
  color: string;
}

interface TorrentWithStats {
  id: string;
  infoHash: string;
  name: string;
  size: number;
  createdAt: string;
  category?: {
    id: string;
    name: string;
    slug: string;
    icon?: string | null;
    type?: string | null;
    parentId?: string | null;
  };
  tags?: TorrentTag[];
  stats: {
    seeders: number;
    leechers: number;
    completed: number;
  };
  // Set by the server when the caller is authenticated. Rendering
  // the star column keys off this field's presence: rows fetched
  // from contexts where favorites don't apply (admin tooling, …)
  // simply leave it `undefined` and the column disappears.
  viewerFavorited?: boolean;
}

const { t } = useI18n();
const { data: categories } = await useFetch('/api/categories');

const props = defineProps<{
  torrents: TorrentWithStats[];
  compact?: boolean;
  admin?: boolean;
  /**
   * Active sort, owned by the parent — the table is presentational and the
   * server does the ordering, so the page that holds the query owns the state.
   * Left undefined (the default) the headers render as plain labels, which is
   * what any caller that lists a fixed, already-ordered slice wants.
   */
  sortBy?: TorrentSortKey;
  order?: 'asc' | 'desc';
}>();

const emit = defineEmits<{
  deleted: [infoHash: string];
  /** A header was activated. The parent decides what that does to the query. */
  sort: [key: TorrentSortKey];
}>();

/**
 * Props for one header cell. `sortBy` being undefined disables the whole row,
 * so a caller opts in simply by passing the current sort.
 */
const { t: tt } = useI18n();

/**
 * Mobile chips, in the column order of the desktop table so the two read the
 * same. The swarm columns use their spelled-out labels — "S" and "L" only work
 * next to an arrow in a header.
 */
const mobileSortOptions = computed(() =>
  (
    [
      ['name', 'name'],
      ['category', 'category'],
      ['seeders', 'seedersTitle'],
      ['leechers', 'leechersTitle'],
      ['completed', 'completedTitle'],
      ['size', 'size'],
      ['age', 'age'],
    ] as [TorrentSortKey, string][]
  ).map(([key, label]) => ({
    key,
    label: tt(`components.torrentTable.${label}`),
  }))
);

/** `aria-sort` value for a header cell, per the WAI-ARIA table pattern. */
function ariaSort(key: TorrentSortKey) {
  if (props.sortBy !== key) return undefined;
  return props.order === 'asc' ? 'ascending' : 'descending';
}

function sortProps(key: TorrentSortKey) {
  return {
    sortable: props.sortBy !== undefined,
    active: props.sortBy === key,
    order: props.order ?? 'desc',
    onSort: () => emit('sort', key),
  };
}

// Header for the favorite column appears as soon as ANY row in
// the current page carries a `viewerFavorited` flag — the parent
// page either authenticates the request or it doesn't, so the
// flag is uniform across the slice. We use `.some()` rather than
// `[0]` so empty pages don't flicker.
const hasFavoriteColumn = computed(() =>
  props.torrents.some((t) => t.viewerFavorited !== undefined),
);

const categoriesById = computed(() => {
  const map = new Map<string, { id: string; name: string }>();
  for (const cat of categories.value ?? []) {
    map.set(cat.id, cat);
  }
  return map;
});

function getCategoryDisplayName(category: { name: string; parentId?: string }) {
  const parent = category.parentId
    ? categoriesById.value.get(category.parentId)
    : undefined;
  return parent ? `${parent.name}/${category.name}` : category.name;
}

function tagBadgeStyle(tag: TorrentTag) {
  const hex = (tag.color || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) {
    return {
      backgroundColor: 'rgb(var(--bg-elevated))',
      borderColor: 'rgb(var(--line-default))',
      color: 'rgb(var(--fg-default))',
    };
  }
  return {
    backgroundColor: `#${hex}1a`,
    borderColor: `#${hex}66`,
    color: 'rgb(var(--fg-default))',
  };
}

const confirm = useConfirm();
const notifications = useNotificationStore();

// Per-row optimistic state for the favorite star. Storing the
// override in a Map (keyed by infoHash) lets the user click
// multiple rows in succession without the in-flight requests
// stomping each other's UI state. The map is preferred over
// mutating the prop because the parent re-binds `torrents` on
// refresh — we want the local override to win for the lifetime
// of the in-flight toggle, then defer back to the prop.
const favOverride = ref<Map<string, boolean>>(new Map());

function isFavorited(t: TorrentWithStats): boolean {
  const override = favOverride.value.get(t.infoHash);
  if (override !== undefined) return override;
  return Boolean(t.viewerFavorited);
}

async function toggleFavorite(torrent: TorrentWithStats) {
  const before = isFavorited(torrent);
  const next = !before;
  favOverride.value.set(torrent.infoHash, next);
  try {
    await $fetch(`/api/torrents/${torrent.infoHash}/favorite`, {
      method: before ? 'DELETE' : 'POST',
    });
  } catch (err: any) {
    favOverride.value.set(torrent.infoHash, before);
    notifications.error(
      err?.data?.message || t('components.torrentTable.errors.favoriteFailed'),
    );
  }
}

async function deleteTorrent(torrent: TorrentWithStats) {
  const ok = await confirm({
    title: t('components.torrentTable.deleteConfirmTitle'),
    message: t('components.torrentTable.deleteConfirmMessage', { name: torrent.name }),
    confirmText: t('components.torrentTable.deleteAction'),
    destructive: true,
  });
  if (!ok) return;

  try {
    await $fetch(`/api/torrents/${torrent.infoHash}`, { method: 'DELETE' });
    notifications.success(t('components.torrentTable.toasts.deleted'));
    emit('deleted', torrent.infoHash);
  } catch (err: any) {
    console.error('Delete failed:', err);
    notifications.error(err?.data?.message || t('components.torrentTable.errors.deleteFailed'));
  }
}
</script>

<style scoped>
/* Subtle button base — the heavy-lifting of color comes from
   tailwind utility classes applied in the template. This block
   only handles the few things tailwind doesn't carry cleanly:
   the touch-target padding, the pop animation on activation,
   and the mobile-card variant's tighter footprint. */
.favorite-star {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.35rem;
  border-radius: 0.25rem;
  background: transparent;
  border: 0;
  cursor: pointer;
  transition: color 0.15s, background 0.15s, transform 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.favorite-star:hover {
  background: rgba(245, 158, 11, 0.08);
}
.favorite-star--mobile {
  width: 2.25rem;
  height: 2.25rem;
  margin: -0.5rem 0;
}
.star-pop {
  animation: star-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes star-pop {
  0%   { transform: scale(1) rotate(0); }
  35%  { transform: scale(1.4) rotate(-10deg); }
  60%  { transform: scale(0.92) rotate(6deg); }
  100% { transform: scale(1) rotate(0); }
}
</style>
