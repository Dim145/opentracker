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
        v-if="modelValue"
        class="modal-overlay"
        @click.self="onBackdropClick"
      >
        <div
          ref="panelRef"
          class="modal-panel"
          :class="sizeClass"
          role="dialog"
          aria-modal="true"
          tabindex="-1"
          :aria-labelledby="titleId"
          @click.stop
        >
          <header
            v-if="$slots.header || title"
            class="px-4 py-3 flex items-center justify-between gap-3"
            style="border-bottom: 1px solid var(--line-default); background-color: color-mix(in srgb, var(--bg-elevated) 50%, transparent);"
          >
            <div class="flex items-center gap-2 min-w-0">
              <Icon
                v-if="icon"
                :name="icon"
                class="text-base flex-shrink-0"
                :style="iconStyle"
              />
              <slot name="header">
                <h3 :id="titleId" class="h-card truncate">{{ title }}</h3>
              </slot>
            </div>
            <button
              v-if="!hideClose"
              type="button"
              class="btn-ghost btn btn-xs"
              :aria-label="closeLabel || t('components.modal.close')"
              @click="emit('update:modelValue', false)"
            >
              <Icon name="ph:x-bold" class="text-sm" />
            </button>
          </header>

          <div :class="['p-5', bodyClass]">
            <slot />
          </div>

          <footer
            v-if="$slots.footer"
            class="px-4 py-3 flex items-center justify-end gap-2"
            style="border-top: 1px solid var(--line-default); background-color: color-mix(in srgb, var(--bg-elevated) 50%, transparent);"
          >
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  title?: string;
  icon?: string;
  iconTone?: 'default' | 'danger' | 'warning' | 'success';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  hideClose?: boolean;
  /** Disable the click-outside-to-close behaviour. */
  persistent?: boolean;
  closeLabel?: string;
  /** Extra classes for the body wrapper (e.g. `!p-0` to remove padding). */
  bodyClass?: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'close'): void;
}>();

const titleId = `modal-${Math.random().toString(36).slice(2, 8)}`;

const sizeClass = computed(() => {
  switch (props.size) {
    case 'sm': return 'max-w-sm';
    case 'lg': return 'max-w-2xl';
    case 'xl': return 'max-w-4xl';
    case 'md':
    default:   return 'max-w-md';
  }
});

const iconStyle = computed(() => {
  switch (props.iconTone) {
    case 'danger':  return { color: 'var(--danger)' };
    case 'warning': return { color: 'var(--warning)' };
    case 'success': return { color: 'var(--online)' };
    default:        return { color: 'var(--fg-muted)' };
  }
});

function close() {
  emit('update:modelValue', false);
  emit('close');
}

function onBackdropClick() {
  if (props.persistent) return;
  close();
}

// ── Focus management + window-level Esc handler ─────────────
// Scoped Esc handlers (e.g. on the backdrop) only fire when the
// focus is already inside the modal. We bind on `window` so a
// keyboard user who tabs OUT of the modal can still press Esc to
// dismiss it. The panel auto-focuses on mount so the very first
// keystroke after open is captured.
const panelRef = ref<HTMLElement | null>(null);

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && !props.persistent) {
    e.preventDefault();
    close();
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (typeof window === 'undefined') return;
    if (open) {
      window.addEventListener('keydown', onKeydown);
      // Wait one tick so the teleport mounts before we steal focus.
      nextTick(() => panelRef.value?.focus());
    } else {
      window.removeEventListener('keydown', onKeydown);
    }
  }
);

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', onKeydown);
  }
});
</script>
