<template>
  <!-- Shared category list — the desktop sidebar and the mobile drawer
       both render this body, so the active state, expand toggles, and
       icon mapping live in one place. The `dense` variant tightens the
       paddings for the drawer on small phones. -->
  <button
    type="button"
    class="w-full text-left rounded-md text-xs font-medium transition-colors flex items-center gap-2"
    :class="[
      dense ? 'px-3 py-2.5' : 'px-3 py-2',
      !selectedId
        ? 'bg-fg-default/10 text-text-strong'
        : 'text-text-secondary hover:bg-fg-default/5 hover:text-text-strong',
    ]"
    @click="$emit('select', '')"
  >
    <Icon name="ph:list-bold" class="text-sm" />
    <span>All Torrents</span>
  </button>

  <div v-for="category in categories" :key="category.id" class="mt-0.5">
    <button
      type="button"
      class="w-full text-left rounded-md text-xs font-medium transition-colors flex items-center justify-between"
      :class="[
        dense ? 'px-3 py-2.5' : 'px-3 py-2',
        selectedId === category.id
          ? 'bg-fg-default/10 text-text-strong'
          : 'text-text-secondary hover:bg-fg-default/5 hover:text-text-strong',
      ]"
      @click="$emit('toggle', category)"
    >
      <span class="flex items-center gap-2 min-w-0">
        <Icon :name="getCategoryIcon(category.slug)" class="text-sm flex-shrink-0" />
        <span class="truncate">{{ category.name }}</span>
      </span>
      <Icon
        v-if="category.subcategories?.length"
        name="ph:caret-right-bold"
        class="text-[10px] text-text-muted transition-transform flex-shrink-0"
        :class="{ 'rotate-90': expandedIds.has(category.id) }"
      />
    </button>

    <Transition
      enter-active-class="transition-all duration-200 ease-out"
      enter-from-class="opacity-0 max-h-0"
      enter-to-class="opacity-100 max-h-96"
      leave-active-class="transition-all duration-150 ease-in"
      leave-from-class="opacity-100 max-h-96"
      leave-to-class="opacity-0 max-h-0"
    >
      <div
        v-if="expandedIds.has(category.id) && category.subcategories?.length"
        class="overflow-hidden ml-4 border-l border-border/50 pl-2 mt-0.5 space-y-0.5"
      >
        <button
          v-for="sub in category.subcategories"
          :key="sub.id"
          type="button"
          class="w-full text-left rounded-md text-[11px] font-medium transition-colors flex items-center gap-2"
          :class="[
            dense ? 'px-3 py-2' : 'px-3 py-1.5',
            selectedId === sub.id
              ? 'bg-fg-default/10 text-text-strong'
              : 'text-text-muted hover:bg-fg-default/5 hover:text-text-secondary',
          ]"
          @click="$emit('select', sub.id)"
        >
          <span class="truncate">{{ sub.name }}</span>
        </button>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
interface Category {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  subcategories?: Category[];
}

defineProps<{
  categories: Category[];
  selectedId: string;
  expandedIds: Set<string>;
  dense?: boolean;
}>();

defineEmits<{
  select: [id: string];
  toggle: [category: Category];
}>();

function getCategoryIcon(slug: string): string {
  const icons: Record<string, string> = {
    movies: 'ph:film-slate-bold',
    tv: 'ph:television-bold',
    music: 'ph:music-notes-bold',
    games: 'ph:game-controller-bold',
    software: 'ph:app-window-bold',
    ebooks: 'ph:book-open-bold',
    anime: 'ph:shooting-star-bold',
    xxx: 'ph:prohibit-bold',
    other: 'ph:package-bold',
  };
  return icons[slug] || 'ph:folder-bold';
}
</script>
