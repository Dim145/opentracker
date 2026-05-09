<template>
  <!-- Below lg, expose a compact pill that lets the user open the
       category nav as a left-side drawer. Above lg, the sidebar stays
       sticky in its column and the trigger is hidden. -->
  <button
    type="button"
    class="lg:hidden w-full inline-flex items-center justify-between gap-2 px-3 py-2.5 mb-3 rounded-md border border-border bg-bg-secondary text-xs font-bold uppercase tracking-widest text-text-secondary active:bg-fg-default/5 transition-colors"
    aria-controls="category-drawer"
    :aria-expanded="mobileOpen"
    @click="mobileOpen = true"
  >
    <span class="inline-flex items-center gap-2">
      <Icon name="ph:folders-bold" />
      <span>{{ activeLabel }}</span>
    </span>
    <Icon name="ph:caret-down-bold" class="text-[10px] text-text-muted" />
  </button>

  <!-- Desktop sidebar -->
  <aside class="w-56 shrink-0 hidden lg:block">
    <div class="sticky" style="top: calc(var(--header-h) + 1rem);">
      <div class="flex items-center gap-2 px-3 py-2 mb-2">
        <Icon name="ph:folders-bold" class="text-text-muted" />
        <h3 class="text-xs font-bold uppercase tracking-wider">Categories</h3>
      </div>
      <nav class="space-y-0.5">
        <CategorySidebarItems
          :categories="categories"
          :selected-id="selectedId"
          :expanded-ids="expandedIds"
          @select="(id) => $emit('select', id)"
          @toggle="handleCategoryClick"
        />
      </nav>
    </div>
  </aside>

  <!-- Mobile drawer — left-side sheet, animated. Locks body scroll
       while open via a small watcher. -->
  <Transition
    enter-active-class="transition-opacity duration-150 ease-out"
    enter-from-class="opacity-0"
    enter-to-class="opacity-100"
    leave-active-class="transition-opacity duration-100 ease-in"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0"
  >
    <div
      v-if="mobileOpen"
      class="lg:hidden fixed inset-0 z-50 bg-bg-primary/80 backdrop-blur-sm"
      @click.self="mobileOpen = false"
    />
  </Transition>
  <Transition
    enter-active-class="transition-transform duration-200 ease-out"
    enter-from-class="-translate-x-full"
    enter-to-class="translate-x-0"
    leave-active-class="transition-transform duration-150 ease-in"
    leave-from-class="translate-x-0"
    leave-to-class="-translate-x-full"
  >
    <aside
      v-if="mobileOpen"
      id="category-drawer"
      class="lg:hidden fixed inset-y-0 left-0 z-50 w-[85%] max-w-xs bg-bg-secondary border-r border-line-strong shadow-2xl flex flex-col"
    >
      <div
        class="flex items-center justify-between gap-3 px-3 border-b border-border"
        style="height: var(--header-h);"
      >
        <span class="eyebrow-mono text-text-muted">Categories</span>
        <button
          type="button"
          class="inline-flex items-center justify-center w-10 h-10 -mr-1.5 rounded-md text-text-strong hover:bg-fg-default/10 transition-colors"
          aria-label="Close categories"
          @click="mobileOpen = false"
        >
          <Icon name="ph:x-bold" class="text-lg" />
        </button>
      </div>
      <nav class="flex-1 overflow-y-auto p-2 pb-safe">
        <CategorySidebarItems
          :categories="categories"
          :selected-id="selectedId"
          :expanded-ids="expandedIds"
          dense
          @select="(id) => onMobileSelect(id)"
          @toggle="handleCategoryClick"
        />
      </nav>
    </aside>
  </Transition>
</template>

<script setup lang="ts">
interface Category {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  subcategories?: Category[];
}

const props = defineProps<{
  categories: Category[];
  selectedId: string;
}>();

const emit = defineEmits<{
  select: [id: string];
}>();

const expandedIds = ref<Set<string>>(new Set());
const mobileOpen = ref(false);

// Auto-expand parent if a subcategory is selected
watch(
  () => props.selectedId,
  (newId) => {
    if (!newId) return;
    for (const cat of props.categories) {
      if (cat.subcategories?.some((sub) => sub.id === newId)) {
        expandedIds.value.add(cat.id);
        break;
      }
    }
  },
  { immediate: true }
);

// Lock body scroll while the mobile drawer is open. Same pattern as
// the layout drawer — keeps the page from drifting under the sheet.
if (import.meta.client) {
  watch(mobileOpen, (open) => {
    document.body.style.overflow = open ? 'hidden' : '';
  });
}

function handleCategoryClick(category: Category) {
  if (category.subcategories?.length) {
    // Toggle expand/collapse
    if (expandedIds.value.has(category.id)) {
      expandedIds.value.delete(category.id);
    } else {
      expandedIds.value.add(category.id);
    }
  }
  // Always emit select for the category
  emit('select', category.id);
}

// Mobile drawer flow: emit + close so the page reflows under the user
// straight away. Without this the user sees the new selection through
// the open drawer, which is confusing.
function onMobileSelect(id: string) {
  emit('select', id);
  mobileOpen.value = false;
}

// Trigger label resolves to the currently-active leaf so the user
// doesn't need to open the drawer to know which category is on.
const activeLabel = computed(() => {
  if (!props.selectedId) return 'All Torrents';
  for (const cat of props.categories) {
    if (cat.id === props.selectedId) return cat.name;
    const sub = cat.subcategories?.find((s) => s.id === props.selectedId);
    if (sub) return `${cat.name} / ${sub.name}`;
  }
  return 'All Torrents';
});
</script>
