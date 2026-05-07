<template>
  <div class="tag-input" @click="focusInput">
    <span
      v-for="(tag, i) in modelValue"
      :key="`${tag}-${i}`"
      class="tag-chip"
    >
      <span
        class="tag-chip-dot"
        :style="dotStyle(tag)"
      />
      {{ tag }}
      <button
        type="button"
        class="tag-chip-close"
        :aria-label="`Remove ${tag}`"
        @click.stop="removeAt(i)"
      >
        <Icon name="ph:x-bold" />
      </button>
    </span>
    <input
      ref="inputRef"
      v-model="draft"
      type="text"
      class="tag-input-field"
      :placeholder="modelValue.length === 0 ? placeholder : ''"
      :disabled="disabled || atMax"
      :aria-label="placeholder"
      @keydown.enter.prevent="commitDraft"
      @keydown.,.prevent="commitDraft"
      @keydown.tab="onTab"
      @keydown.backspace="onBackspace"
      @keydown.down.prevent="moveSuggestion(1)"
      @keydown.up.prevent="moveSuggestion(-1)"
      @keydown.escape="suggestionsOpen = false"
      @focus="suggestionsOpen = true"
      @blur="onBlur"
    />
    <div
      v-if="
        suggestionsOpen && (filteredSuggestions.length > 0 || canCreateDraft)
      "
      class="tag-suggestions"
      role="listbox"
    >
      <button
        v-for="(s, i) in filteredSuggestions"
        :key="s.id"
        type="button"
        class="tag-suggestion"
        :class="{ 'is-active': i === activeSuggestion }"
        role="option"
        :aria-selected="i === activeSuggestion"
        @mousedown.prevent="commit(s.name)"
        @mouseenter="activeSuggestion = i"
      >
        <span class="tag-chip-dot" :style="{ backgroundColor: s.color }" />
        <span>{{ s.name }}</span>
      </button>
      <div
        v-if="canCreateDraft"
        class="tag-suggestion tag-suggestion--create"
        :class="{ 'is-active': activeSuggestion === filteredSuggestions.length }"
        @mousedown.prevent="commitDraft"
        @mouseenter="activeSuggestion = filteredSuggestions.length"
      >
        <Icon name="ph:plus-bold" class="text-text-muted" />
        <span>Create “{{ draft.trim() }}”</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface TagOption {
  id: string;
  name: string;
  slug: string;
  color: string;
}

const props = withDefaults(
  defineProps<{
    modelValue: string[];
    placeholder?: string;
    max?: number;
    disabled?: boolean;
    /**
     * If provided, the component uses this list rather than fetching one
     * itself. Useful when the parent already has the tag catalogue loaded.
     */
    suggestions?: TagOption[];
  }>(),
  {
    placeholder: 'Add tags…',
    max: 10,
    disabled: false,
    suggestions: undefined,
  }
);

const emit = defineEmits<{
  'update:modelValue': [string[]];
}>();

const inputRef = ref<HTMLInputElement | null>(null);
const draft = ref('');
const suggestionsOpen = ref(false);
const activeSuggestion = ref(0);

// When the parent hasn't supplied a catalogue, hit the API on first focus.
const remote = ref<TagOption[]>([]);
let fetched = false;
async function ensureCatalogue() {
  if (fetched || props.suggestions) return;
  try {
    remote.value = await $fetch<TagOption[]>('/api/tags', {
      query: { limit: 100 },
    });
  } catch {
    // List autocomplete is a nice-to-have; failing silent keeps the input
    // usable for create-by-typing.
  } finally {
    fetched = true;
  }
}

const catalogue = computed(() => props.suggestions ?? remote.value);

const atMax = computed(() => props.modelValue.length >= props.max);

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const selectedSlugs = computed(
  () => new Set(props.modelValue.map((n) => slugify(n)))
);

const filteredSuggestions = computed(() => {
  const q = draft.value.trim().toLowerCase();
  return catalogue.value
    .filter((t) => !selectedSlugs.value.has(t.slug))
    .filter((t) => !q || t.name.toLowerCase().includes(q) || t.slug.includes(q))
    .slice(0, 8);
});

const canCreateDraft = computed(() => {
  const trimmed = draft.value.trim();
  if (!trimmed) return false;
  const slug = slugify(trimmed);
  if (!slug) return false;
  if (selectedSlugs.value.has(slug)) return false;
  // Not a duplicate of an existing tag in the visible suggestions.
  return !catalogue.value.some((t) => t.slug === slug);
});

watch(suggestionsOpen, (open) => {
  if (open) {
    ensureCatalogue();
    activeSuggestion.value = 0;
  }
});

watch(draft, () => {
  activeSuggestion.value = 0;
  suggestionsOpen.value = true;
});

function focusInput() {
  inputRef.value?.focus();
}

function commit(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  if (props.modelValue.length >= props.max) return;
  const slug = slugify(trimmed);
  if (!slug || selectedSlugs.value.has(slug)) {
    draft.value = '';
    return;
  }
  // If the input matches a known tag, prefer that tag's canonical name —
  // keeps the displayed casing consistent with what the catalogue holds.
  const known = catalogue.value.find((t) => t.slug === slug);
  emit('update:modelValue', [...props.modelValue, known ? known.name : trimmed]);
  draft.value = '';
}

function commitDraft() {
  const total = filteredSuggestions.value.length + (canCreateDraft.value ? 1 : 0);
  if (total === 0) {
    if (draft.value.trim()) commit(draft.value);
    return;
  }
  // If the user is on a real suggestion row, pick that. Otherwise (or if
  // the highlighted row is the synthetic "Create …" one) commit the draft.
  if (activeSuggestion.value < filteredSuggestions.value.length) {
    commit(filteredSuggestions.value[activeSuggestion.value]!.name);
  } else if (canCreateDraft.value) {
    commit(draft.value);
  }
}

function onTab() {
  // Tab acts as commit only when there's something pending; otherwise let
  // the browser move focus normally.
  if (draft.value.trim()) commitDraft();
}

function onBackspace() {
  if (draft.value === '' && props.modelValue.length > 0) {
    removeAt(props.modelValue.length - 1);
  }
}

function removeAt(i: number) {
  const next = props.modelValue.slice();
  next.splice(i, 1);
  emit('update:modelValue', next);
}

function moveSuggestion(delta: number) {
  const total =
    filteredSuggestions.value.length + (canCreateDraft.value ? 1 : 0);
  if (total === 0) return;
  suggestionsOpen.value = true;
  activeSuggestion.value = (activeSuggestion.value + delta + total) % total;
}

function onBlur() {
  // Defer so a click on a suggestion item lands before we close.
  setTimeout(() => (suggestionsOpen.value = false), 120);
}

function dotStyle(name: string) {
  const slug = slugify(name);
  const found = catalogue.value.find((t) => t.slug === slug);
  return { backgroundColor: found?.color ?? 'rgb(var(--fg-muted))' };
}

defineExpose({ focus: focusInput });
</script>

<style scoped>
.tag-input {
  @apply relative w-full min-h-[38px] flex flex-wrap items-center gap-1.5
         bg-bg-tertiary border border-border rounded px-2 py-1.5
         text-xs cursor-text transition-colors;
}
.tag-input:focus-within {
  border-color: rgb(var(--fg-default) / 0.3);
}

.tag-chip {
  @apply inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm
         border border-border bg-bg-secondary text-text-primary
         font-medium text-[11px];
}
.tag-chip-dot {
  @apply inline-block w-2 h-2 rounded-full;
}
.tag-chip-close {
  @apply inline-flex items-center text-text-muted hover:text-error
         transition-colors;
}
.tag-chip-close :deep(svg) {
  @apply w-2.5 h-2.5;
}

.tag-input-field {
  @apply flex-1 min-w-[80px] bg-transparent outline-none border-0
         text-text-primary placeholder-text-muted text-xs;
}
.tag-input-field:disabled {
  @apply cursor-not-allowed opacity-60;
}

.tag-suggestions {
  @apply absolute left-0 right-0 top-full mt-1 z-20
         bg-bg-secondary border border-border rounded shadow-2xl
         max-h-64 overflow-y-auto;
}
.tag-suggestion {
  @apply w-full flex items-center gap-2 px-3 py-2 text-left text-xs
         text-text-primary transition-colors;
}
.tag-suggestion.is-active,
.tag-suggestion:hover {
  background: rgb(var(--fg-default) / 0.08);
}
.tag-suggestion--create {
  @apply text-text-muted italic;
  border-top: 1px dashed rgb(var(--line-default));
}
</style>
