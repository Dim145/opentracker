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
          :aria-labelledby="hasHeader ? titleId : undefined"
          :aria-label="hasHeader ? undefined : t('components.modal.fallbackLabel')"
          @click.stop
        >
          <header
            v-if="$slots.header || title"
            class="px-4 py-3 flex items-center justify-between gap-3"
            style="border-bottom: 1px solid rgb(var(--line-default)); background-color: color-mix(in srgb, rgb(var(--bg-elevated)) 50%, transparent);"
          >
            <div class="flex items-center gap-2 min-w-0">
              <Icon
                v-if="icon"
                :name="icon"
                class="text-base flex-shrink-0"
                :style="iconStyle"
              />
              <!-- L'id porte sur le conteneur, pas sur le `<h3>` par défaut.
                   Il était sur le titre par défaut uniquement : dès qu'un
                   appelant remplissait le slot `#header` — ce que font la
                   plupart des modales d'administration — `aria-labelledby`
                   pointait vers un élément qui n'existait pas, et un lecteur
                   d'écran annonçait « boîte de dialogue » sans nom. -->
              <div :id="titleId" class="min-w-0">
                <slot name="header">
                  <h3 class="h-card truncate">{{ title }}</h3>
                </slot>
              </div>
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
            style="border-top: 1px solid rgb(var(--line-default)); background-color: color-mix(in srgb, rgb(var(--bg-elevated)) 50%, transparent);"
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

// `useId()` plutôt que `Math.random()` : l'identifiant est calculé au `setup`,
// donc aussi côté serveur. Une modale ouverte au rendu initial recevait deux
// valeurs différentes et l'hydratation cassait le lien titre ↔ dialogue.
const titleId = useId();

const slots = useSlots();
const hasHeader = computed(() => Boolean(slots.header || props.title));

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
    case 'danger':  return { color: 'rgb(var(--danger))' };
    case 'warning': return { color: 'rgb(var(--warning))' };
    case 'success': return { color: 'rgb(var(--online))' };
    default:        return { color: 'rgb(var(--fg-muted))' };
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

// ── Focus, Échap et verrou de défilement ────────────────────
// La mécanique est dans `useModalChrome` : elle était ici, et
// `ReportModal.vue` — habillage sur mesure, donc pas réutilisable via ce
// composant — n'en avait rien. Une seule implémentation pour les deux.
const panelRef = ref<HTMLElement | null>(null);

useModalChrome({
  isOpen: () => props.modelValue,
  panel: panelRef,
  onEscape: close,
  escapable: () => !props.persistent,
});
</script>
