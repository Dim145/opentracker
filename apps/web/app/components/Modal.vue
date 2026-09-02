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

// ── Focus management + window-level Esc handler ─────────────
// Scoped Esc handlers (e.g. on the backdrop) only fire when the
// focus is already inside the modal. We bind on `window` so a
// keyboard user who tabs OUT of the modal can still press Esc to
// dismiss it. The panel auto-focuses on mount so the very first
// keystroke after open is captured.
const panelRef = ref<HTMLElement | null>(null);

/** L'élément qui avait le focus avant l'ouverture, pour le lui rendre. */
let restoreTo: HTMLElement | null = null;

/**
 * Ce qui est atteignable au clavier, dans l'ordre du document.
 *
 * `offsetParent` écarte ce qui est masqué (`display: none`), donc les onglets
 * repliés d'une modale à onglets ne piègent pas le focus dans le vide.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

function focusables(): HTMLElement[] {
  const root = panelRef.value;
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && !props.persistent) {
    e.preventDefault();
    close();
    return;
  }
  if (e.key !== 'Tab') return;
  // Le piège à focus.
  //
  // `aria-modal="true"` dit au lecteur d'écran que le reste de la page est
  // inerte ; il ne dit rien au navigateur, dont l'ordre de tabulation continuait
  // droit dans la page derrière l'ombrage. Un utilisateur au clavier sortait de
  // la modale dès la dernière tabulation et se retrouvait à parcourir une page
  // qu'il ne voyait plus, sans savoir comment revenir.
  const items = focusables();
  if (!items.length) {
    e.preventDefault();
    panelRef.value?.focus();
    return;
  }
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const active = document.activeElement as HTMLElement | null;
  const inside = panelRef.value?.contains(active) ?? false;
  if (!inside) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
    return;
  }
  if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * Le verrou de défilement, partagé par toutes les modales.
 *
 * Un compteur, pas un booléen : une modale ouverte au-dessus d'une autre
 * (une confirmation par-dessus un formulaire) rendait le défilement à la
 * fermeture de la première alors que la seconde était toujours à l'écran.
 */
let lockedByThis = false;

function lockScroll() {
  if (lockedByThis) return;
  lockedByThis = true;
  const n = Number(document.body.dataset.modalLocks || '0') + 1;
  document.body.dataset.modalLocks = String(n);
  if (n === 1) document.body.style.overflow = 'hidden';
}

function unlockScroll() {
  if (!lockedByThis) return;
  lockedByThis = false;
  const n = Math.max(0, Number(document.body.dataset.modalLocks || '1') - 1);
  document.body.dataset.modalLocks = String(n);
  if (n === 0) document.body.style.overflow = '';
}

watch(
  () => props.modelValue,
  (open) => {
    if (typeof window === 'undefined') return;
    if (open) {
      restoreTo = document.activeElement as HTMLElement | null;
      window.addEventListener('keydown', onKeydown);
      lockScroll();
      // Wait one tick so the teleport mounts before we steal focus.
      nextTick(() => panelRef.value?.focus());
    } else {
      window.removeEventListener('keydown', onKeydown);
      unlockScroll();
      // Rendre le focus au bouton qui a ouvert la modale. Sans cela il retombe
      // sur `<body>` et la tabulation suivante repart du haut de la page.
      restoreTo?.focus?.();
      restoreTo = null;
    }
  },
  // `immediate` pour le cas d'une modale montée DÉJÀ ouverte : aucun appelant
  // ne le fait aujourd'hui (vérifié sur les 27 usages de `<Modal v-model>`),
  // mais sans cela le premier changement d'état ne serait jamais observé et la
  // modale s'afficherait sans verrou de défilement, sans piège à focus et sans
  // gestionnaire Échap. La branche « fermée » est inoffensive : le verrou n'est
  // pas pris, et la restitution de focus porte sur `null`.
  { immediate: true },
);

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', onKeydown);
    unlockScroll();
  }
});
</script>
