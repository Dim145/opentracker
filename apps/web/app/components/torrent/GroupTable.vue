<template>
  <div>
    <!-- Below md: the card layout. A seven-column table on a phone means
         horizontal scrolling inside every row, so the small screen keeps the
         stacked cards — with the same sort chips the flat view uses, since the
         header that carries the sort is exactly what a card list lacks. -->
    <div class="md:hidden">
      <div
        v-if="sortBy !== undefined && groups.length > 0"
        class="flex items-center gap-1.5 px-3 py-2 overflow-x-auto no-scrollbar border-b border-border"
      >
        <span class="text-[10px] uppercase tracking-wider text-text-muted shrink-0">
          {{ $t('components.torrentTable.sortedBy') }}
        </span>
        <button
          v-for="opt in sortOptions"
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

      <TorrentGroupRow
        v-for="group in groups"
        :key="group.key"
        :group="group"
        :category-label="categoryLabel(group.categoryIds)"
        :tree-endpoint="treeEndpoint"
        :page-href="pageHrefFor?.(group) ?? null"
        :hide-page-link="hidePageLink"
      />
    </div>

    <!-- ≥ md: the same table as the flat view, one work per row. -->
    <table class="data-table hidden md:table">
      <TorrentTableHead
        :sort-by="sortBy"
        :order="order"
        :trailing-columns="1"
        @sort="(key) => emit('sort', key)"
      />
      <tbody>
        <tr v-if="groups.length === 0">
          <td :colspan="7" class="text-center text-text-muted py-8">
            {{ $t('search.noResults') }}
          </td>
        </tr>
        <TorrentGroupTableRow
          v-for="group in groups"
          :key="group.key"
          :group="group"
          :category-label="categoryLabel(group.categoryIds)"
          :tree-endpoint="treeEndpoint"
          :page-href="pageHrefFor?.(group) ?? null"
          :hide-page-link="hidePageLink"
        />
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import type { SortDirection, TorrentSortKey } from '@trackarr/shared';
import type { GroupSummary } from './GroupRow.vue';

const props = defineProps<{
  groups: GroupSummary[];
  /** Resolves the category chip; the rows know nothing about categories. */
  categoryLabel: (ids: string[]) => string | null;
  /** Active sort, owned by the page. Undefined renders inert headers. */
  sortBy?: TorrentSortKey;
  order?: SortDirection;
  treeEndpoint?: string;
  pageHrefFor?: (group: GroupSummary) => string | null;
  hidePageLink?: boolean;
}>();

const emit = defineEmits<{ sort: [key: TorrentSortKey] }>();

const { t } = useI18n();

/**
 * Mobile chips, in the column order of the table above so the two read the
 * same. The swarm columns use their spelled-out labels — "S" and "L" only work
 * next to an arrow in a header.
 */
const sortOptions = computed(() =>
  (
    [
      ['name', 'name'],
      ['seeders', 'seedersTitle'],
      ['leechers', 'leechersTitle'],
      ['completed', 'completedTitle'],
      ['size', 'size'],
      ['age', 'age'],
    ] as [TorrentSortKey, string][]
  ).map(([key, label]) => ({
    key,
    label: t(`components.torrentTable.${label}`),
  }))
);
</script>
