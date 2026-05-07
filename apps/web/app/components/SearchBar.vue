<template>
  <div class="search-bar-wrapper">
    <div class="relative group w-full">
      <div
        class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none z-10"
      >
        <Icon
          v-if="loading"
          name="ph:circle-notch"
          class="h-5 w-5 text-text-muted animate-spin"
        />
        <Icon
          v-else-if="detected"
          :name="detected.source === 'imdb'
            ? 'ph:film-strip-fill'
            : detected.source === 'tmdb'
              ? 'ph:popcorn-fill'
              : 'ph:television-simple-fill'"
          class="h-5 w-5 transition-colors"
          :class="`detected-icon detected-icon--${detected.source}`"
        />
        <Icon
          v-else
          name="ph:magnifying-glass"
          class="h-5 w-5 text-text-muted group-focus-within:text-text-strong transition-colors"
        />
      </div>
      <input
        ref="inputRef"
        :value="modelValue"
        type="text"
        :placeholder="effectivePlaceholder"
        class="search-input w-full bg-bg-secondary border border-border text-text-primary placeholder-text-muted focus:outline-none focus:bg-bg-tertiary transition-all"
        :class="[
          size === 'lg'
            ? 'rounded-xl pl-12 pr-24 py-4 text-lg'
            : 'rounded-md pl-10 pr-16 py-2 text-sm',
          detected
            ? `search-input--detected search-input--${detected.source}`
            : 'focus:border-fg-default/30',
        ]"
        @input="onInput"
        @keyup.enter="onSubmit"
      />
      <div class="absolute inset-y-0 right-0 pr-2 flex items-center gap-2 z-10">
        <div
          v-if="!modelValue && !detected"
          class="hidden sm:flex items-center gap-1 px-2 py-1 border border-border rounded-md text-[10px] text-text-muted font-mono bg-bg-primary/50 mr-2"
        >
          <span>/</span>
        </div>
        <button
          v-if="modelValue"
          class="text-text-muted hover:text-text-strong transition-colors p-2"
          title="Clear"
          @click="clear"
        >
          <Icon name="ph:x" :class="size === 'lg' ? 'h-4 w-4' : 'h-3.5 w-3.5'" />
        </button>
        <button
          class="btn-search"
          :class="size === 'lg' ? 'btn-lg' : 'btn-sm'"
          :title="detected ? `Search by ${detected.label}` : 'Search'"
          @click="onSubmit"
        >
          <Icon
            name="ph:arrow-right-bold"
            :class="size === 'lg' ? 'h-4 w-4' : 'h-3 w-3'"
          />
        </button>
      </div>
    </div>

    <!-- Detection hint chip — slides in below the input when the user
         pasted something we recognise as an external id or URL. The
         chip is purely informational; submitting still triggers the
         existing @search emit, but the parent picks up `detected` to
         decide whether to filter by id instead of by name. -->
    <Transition name="detect">
      <div
        v-if="detected"
        class="detection-hint"
        :class="`detection-hint--${detected.source}`"
      >
        <span class="detection-tag">{{ detected.label }}</span>
        <code class="detection-id">{{ detected.display }}</code>
        <span class="detection-arrow"
          ><Icon name="ph:arrow-right-bold" class="text-[10px]"
        /></span>
        <span class="detection-action">Press Enter to filter</span>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import {
  detectMediaId,
  type DetectedMediaId,
} from '~/utils/mediaIdDetect';

const props = defineProps<{
  modelValue: string;
  placeholder?: string;
  loading?: boolean;
  size?: 'sm' | 'lg';
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'search'): void;
  (e: 'mediaIdSearch', detected: DetectedMediaId): void;
}>();

const size = props.size ?? 'sm';

const inputRef = ref<HTMLInputElement | null>(null);

const detected = computed<DetectedMediaId | null>(() =>
  detectMediaId(props.modelValue || '')
);

const effectivePlaceholder = computed(() => {
  if (detected.value) return '';
  return props.placeholder ?? 'Search by name, hash, or paste an IMDb / TMDb / TVDB link…';
});

function onInput(event: Event) {
  const value = (event.target as HTMLInputElement).value;
  emit('update:modelValue', value);
}

function onSubmit() {
  if (detected.value) {
    emit('mediaIdSearch', detected.value);
  } else {
    emit('search');
  }
}

function clear() {
  emit('update:modelValue', '');
  emit('search');
  inputRef.value?.focus();
}

// Keyboard shortcut '/' to focus
function handleGlobalKeydown(e: KeyboardEvent) {
  if (
    e.key === '/' &&
    document.activeElement?.tagName !== 'INPUT' &&
    document.activeElement?.tagName !== 'TEXTAREA'
  ) {
    e.preventDefault();
    inputRef.value?.focus();
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleGlobalKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeydown);
});
</script>

<style scoped>
.search-bar-wrapper {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: 100%;
}

.btn-search {
  @apply rounded-lg text-text-secondary transition-all active:scale-95 shadow-lg;
}
.btn-search:hover {
  @apply text-text-strong;
}
.btn-lg {
  @apply p-2.5;
}
.btn-sm {
  @apply p-1.5;
}

/* Subtle border-tint when an id is detected — confirms to the user
   that the input has switched modes without a heavy banner. */
.search-input--detected {
  border-width: 1px;
}
.search-input--imdb {
  border-color: rgba(245, 197, 24, 0.55);
  box-shadow: 0 0 0 1px rgba(245, 197, 24, 0.18);
}
.search-input--tmdb {
  border-color: rgba(1, 180, 228, 0.55);
  box-shadow: 0 0 0 1px rgba(1, 180, 228, 0.18);
}
.search-input--tvdb {
  border-color: rgba(108, 209, 97, 0.55);
  box-shadow: 0 0 0 1px rgba(108, 209, 97, 0.18);
}

.detected-icon--imdb {
  color: #f5c518;
}
.detected-icon--tmdb {
  color: #01b4e4;
}
.detected-icon--tvdb {
  color: #6cd161;
}

/* Hint chip — discreet pill below the search input. */
.detection-hint {
  display: inline-flex;
  align-self: flex-start;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0.65rem;
  border-radius: 9999px;
  border: 1px solid;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgb(var(--fg-default));
}
.detection-hint--imdb {
  background: rgba(245, 197, 24, 0.08);
  border-color: rgba(245, 197, 24, 0.4);
}
.detection-hint--tmdb {
  background: rgba(1, 180, 228, 0.08);
  border-color: rgba(1, 180, 228, 0.4);
}
.detection-hint--tvdb {
  background: rgba(108, 209, 97, 0.08);
  border-color: rgba(108, 209, 97, 0.4);
}

.detection-tag {
  font-weight: 800;
}
.detection-hint--imdb .detection-tag {
  color: #f5c518;
}
.detection-hint--tmdb .detection-tag {
  color: #01b4e4;
}
.detection-hint--tvdb .detection-tag {
  color: #6cd161;
}
.detection-id {
  font-family: ui-monospace, SFMono-Regular, monospace;
  text-transform: none;
  letter-spacing: 0;
  color: rgb(var(--fg-default));
  font-weight: 600;
  font-size: 11px;
}
.detection-arrow {
  display: inline-flex;
  color: rgb(var(--fg-muted));
}
.detection-action {
  color: rgb(var(--fg-muted));
  font-weight: 500;
  letter-spacing: 0.04em;
}

.detect-enter-active,
.detect-leave-active {
  transition: opacity 0.15s ease, transform 0.18s ease;
}
.detect-enter-from,
.detect-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
