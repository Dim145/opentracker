<template>
  <!-- Below md: stack each torrent as a tappable card. Tables drown on
       phones — too many narrow columns force horizontal scroll inside
       a card on every page. The card layout keeps the same data
       (name + tags + category + S/L + size + age) but reflows it into
       readable blocks with a 44 px-min tap target. -->
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
          name="ph:file-zip"
          class="text-text-muted text-base shrink-0 mt-0.5"
        />
        <div class="flex-1 min-w-0">
          <p
            class="text-sm font-medium text-text-primary leading-snug break-words line-clamp-2"
          >
            {{ torrent.name }}
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
        <th class="w-1/2">{{ $t('components.torrentTable.name') }}</th>
        <th v-if="!compact">{{ $t('components.torrentTable.category') }}</th>
        <th v-if="!compact">{{ $t('components.torrentTable.hash') }}</th>
        <th class="text-center w-16">
          <div class="flex items-center justify-center gap-1" :title="$t('components.torrentTable.seedersTitle')">
            <Icon name="ph:arrow-up-bold" class="text-success" />
            <span>{{ $t('components.torrentTable.seeders') }}</span>
          </div>
        </th>
        <th class="text-center w-16">
          <div class="flex items-center justify-center gap-1" :title="$t('components.torrentTable.leechersTitle')">
            <Icon name="ph:arrow-down-bold" class="text-warning" />
            <span>{{ $t('components.torrentTable.leechers') }}</span>
          </div>
        </th>
        <th v-if="!compact" class="text-center w-16">
          <div class="flex items-center justify-center gap-1" :title="$t('components.torrentTable.completedTitle')">
            <Icon name="ph:check-bold" class="text-text-secondary" />
            <span>{{ $t('components.torrentTable.completed') }}</span>
          </div>
        </th>
        <th v-if="!compact">{{ $t('components.torrentTable.size') }}</th>
        <th class="text-right w-16">{{ $t('components.torrentTable.age') }}</th>
        <th v-if="admin" class="w-12"></th>
      </tr>
    </thead>
    <tbody>
      <tr v-if="torrents.length === 0">
        <td
          :colspan="(compact ? 4 : 8) + (admin ? 1 : 0)"
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
              name="ph:file-zip"
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
  };
  tags?: TorrentTag[];
  stats: {
    seeders: number;
    leechers: number;
    completed: number;
  };
}

const { t } = useI18n();
const { data: categories } = await useFetch('/api/categories');

const props = defineProps<{
  torrents: TorrentWithStats[];
  compact?: boolean;
  admin?: boolean;
}>();

const emit = defineEmits<{
  deleted: [infoHash: string];
}>();

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
