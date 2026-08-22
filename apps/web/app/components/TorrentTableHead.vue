<template>
  <!--
    The catalogue's header row, shared by both views.

    Two listings that answer the same question in different shapes — one release
    per row, one work per row — have no business looking like two different
    instruments. The column set, their order, their alignment and the sort
    affordance all live here once, so switching views moves the rows and nothing
    else. It is also what makes the sort legible: the same header, in the same
    place, carrying the same arrow.
  -->
  <thead>
    <tr>
      <th class="th-name" :aria-sort="ariaSort('name')">
        <SortHeader v-bind="sortProps('name')">
          {{ $t('components.torrentTable.name') }}
        </SortHeader>
      </th>
      <th class="th-num" :aria-sort="ariaSort('seeders')">
        <SortHeader
          v-bind="sortProps('seeders')"
          align="center"
          :title="$t('components.torrentTable.seedersTitle')"
        >
          <Icon name="ph:arrow-up-bold" class="text-success" />
          <span>{{ $t('components.torrentTable.seeders') }}</span>
        </SortHeader>
      </th>
      <th class="th-num" :aria-sort="ariaSort('leechers')">
        <SortHeader
          v-bind="sortProps('leechers')"
          align="center"
          :title="$t('components.torrentTable.leechersTitle')"
        >
          <Icon name="ph:arrow-down-bold" class="text-warning" />
          <span>{{ $t('components.torrentTable.leechers') }}</span>
        </SortHeader>
      </th>
      <th v-if="!compact" class="th-num" :aria-sort="ariaSort('completed')">
        <SortHeader
          v-bind="sortProps('completed')"
          align="center"
          :title="$t('components.torrentTable.completedTitle')"
        >
          <Icon name="ph:check-bold" class="text-text-secondary" />
          <span>{{ $t('components.torrentTable.completed') }}</span>
        </SortHeader>
      </th>
      <th v-if="!compact" class="th-size" :aria-sort="ariaSort('size')">
        <SortHeader v-bind="sortProps('size')" align="right">
          {{ $t('components.torrentTable.size') }}
        </SortHeader>
      </th>
      <th class="th-age" :aria-sort="ariaSort('age')">
        <SortHeader v-bind="sortProps('age')" align="right">
          {{ $t('components.torrentTable.age') }}
        </SortHeader>
      </th>
      <!-- Trailing affordance: favourite star and admin actions on the flat
           view, the expand chevron on the grouped one. Never a label — the icon
           is the whole column. -->
      <th v-for="n in trailingColumns" :key="n" class="th-trailing"></th>
    </tr>
  </thead>
</template>

<script setup lang="ts">
import type { SortDirection, TorrentSortKey } from '@trackarr/shared';

const props = defineProps<{
  /**
   * Active sort. Undefined renders inert labels, which is what a caller
   * showing a fixed, already-ordered slice wants.
   */
  sortBy?: TorrentSortKey;
  order?: SortDirection;
  /** Drop the columns a narrow embed cannot afford: completions and size. */
  compact?: boolean;
  /** How many unlabelled cells close the row. */
  trailingColumns?: number;
}>();

const emit = defineEmits<{ sort: [key: TorrentSortKey] }>();

/** `aria-sort` belongs on the cell, per the WAI-ARIA table pattern. */
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
</script>

<style scoped>
/* One column rhythm for both views. The numeric columns are wide enough for the
   grouped view's spans ("9-136") so the two headers land on the same pixels and
   switching views does not shift the eye. */
.th-name {
  width: 50%;
}

.th-num {
  width: 4.5rem;
  text-align: center;
}

.th-size {
  width: 7rem;
  text-align: right;
}

.th-age {
  width: 5rem;
  text-align: right;
}

.th-trailing {
  width: 2.5rem;
}
</style>
