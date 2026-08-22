<template>
  <!-- Not sortable: render the label as-is, so a caller that lists an
       already-ordered slice keeps the plain header it had before. -->
  <span v-if="!sortable" class="sort-head" :class="alignClass" :title="title">
    <slot />
  </span>

  <!-- Sortable: a real button, because this is an action. `aria-sort` lives on
       the parent `<th>` in the WAI-ARIA pattern, but the label needs to carry
       the current state too — a screen reader user tabbing through headers hears
       "Seeders, sorted descending" rather than just "Seeders". -->
  <button
    v-else
    type="button"
    class="sort-head sort-head--btn"
    :class="[alignClass, { 'is-active': active }]"
    :title="title"
    :aria-label="ariaLabel"
    @click="$emit('sort')"
  >
    <slot />
    <!-- The arrow only appears on the active column: a chevron on all seven
         headers is noise, and the hover state already says "clickable". -->
    <Icon
      v-if="active"
      :name="order === 'asc' ? 'ph:caret-up-bold' : 'ph:caret-down-bold'"
      class="sort-head-caret"
    />
  </button>
</template>

<script setup lang="ts">
import type { SortDirection } from '@trackarr/shared';

const props = defineProps<{
  /** Off by default so an unsorted table keeps inert headers. */
  sortable?: boolean;
  /** This column is the one the listing is currently ordered by. */
  active?: boolean;
  order?: SortDirection;
  title?: string;
  align?: 'left' | 'center' | 'right';
}>();

defineEmits<{ sort: [] }>();

const alignClass = computed(() => {
  if (props.align === 'center') return 'sort-head--center';
  if (props.align === 'right') return 'sort-head--right';
  return '';
});

const { t } = useI18n();

/**
 * Announce what activating the header will do, not just what it is. When the
 * column is already active the click reverses it, which is the part a label
 * like "sort by Age" would hide.
 */
const ariaLabel = computed(() => {
  if (!props.sortable) return undefined;
  const key = props.active
    ? props.order === 'asc'
      ? 'components.sortHeader.activeAsc'
      : 'components.sortHeader.activeDesc'
    : 'components.sortHeader.inactive';
  return t(key, { column: props.title ?? '' });
});
</script>

<style scoped>
.sort-head {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.sort-head--center {
  justify-content: center;
  width: 100%;
}

.sort-head--right {
  justify-content: flex-end;
  width: 100%;
}

.sort-head--btn {
  /* Inherit the `th`'s typography — this is a header that happens to be
     clickable, not a control that happens to sit in a header. */
  font: inherit;
  color: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  cursor: pointer;
  background: none;
  border: 0;
  padding: 0;
  transition: color 0.12s ease;
}

.sort-head--btn:hover,
.sort-head--btn:focus-visible {
  color: rgb(var(--fg-strong));
}

.sort-head--btn.is-active {
  color: rgb(var(--fg-strong));
}

.sort-head-caret {
  width: 0.75rem;
  height: 0.75rem;
  flex-shrink: 0;
}
</style>
