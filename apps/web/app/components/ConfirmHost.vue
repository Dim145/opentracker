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
        v-if="current"
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        @click.self="onCancel"
        @keydown.esc.stop="onCancel"
      >
        <div
          class="bg-bg-secondary border border-border rounded shadow-2xl w-full max-w-md overflow-hidden"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="`confirm-title-${current.id}`"
          :aria-describedby="
            current.message ? `confirm-body-${current.id}` : undefined
          "
        >
          <div
            class="flex items-center gap-2 px-4 py-3 border-b border-border bg-bg-tertiary/50"
          >
            <Icon
              :name="
                current.destructive
                  ? 'ph:warning-circle-bold'
                  : 'ph:question-bold'
              "
              :class="current.destructive ? 'text-error' : 'text-text-muted'"
            />
            <h3
              :id="`confirm-title-${current.id}`"
              class="text-xs font-bold uppercase tracking-widest text-text-primary"
            >
              {{ current.title }}
            </h3>
          </div>
          <div class="p-6">
            <p
              v-if="current.message"
              :id="`confirm-body-${current.id}`"
              class="text-sm text-text-secondary mb-6"
            >
              {{ current.message }}
            </p>
            <div class="flex gap-2">
              <button
                ref="cancelButtonRef"
                type="button"
                class="btn btn-secondary flex-1 text-xs font-bold uppercase tracking-widest"
                @click="onCancel"
              >
                {{ current.cancelText || t('common.cancel') }}
              </button>
              <!-- `.btn-danger` plutôt qu'une règle locale : sa couleur d'encre
                   est désormais un jeton par thème (`--danger-fg`), alors que le
                   `background-color: rgb(239 68 68); color: white` codé ici
                   donnait 3,76:1 et ignorait le thème clair, où le même blanc
                   sur le rouge du thème atteint 6,54:1. -->
              <button
                ref="confirmButtonRef"
                type="button"
                class="btn flex-1 text-xs font-bold uppercase tracking-widest"
                :class="current.destructive ? 'btn-danger' : 'btn-primary'"
                @click="onConfirm"
              >
                {{ current.confirmText || t('common.confirm') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
const { t } = useI18n();
const queue = useConfirmState();
const current = computed(() => queue.value[0] || null);
const confirmButtonRef = ref<HTMLButtonElement | null>(null);
const cancelButtonRef = ref<HTMLButtonElement | null>(null);

function pop(answer: boolean) {
  const req = queue.value[0];
  if (!req) return;
  req.resolve(answer);
  queue.value = queue.value.slice(1);
}

function onCancel() {
  pop(false);
}
function onConfirm() {
  pop(true);
}

/*
 * Où va le focus à l'ouverture.
 *
 * Sur un dialogue ORDINAIRE, sur Confirmer : c'est le geste attendu, et c'est
 * le défaut de `window.confirm`. Sur un dialogue DESTRUCTIF, sur Annuler — une
 * frappe Entrée résiduelle après le clic qui a ouvert la boîte détruisait
 * sinon la donnée, et `handleKey` résout justement Entrée sur le bouton
 * focalisé. La convention pour un dialogue destructif est d'exiger un geste
 * délibéré pour atteindre le bouton rouge.
 */
/** Ce qui avait le focus avant la question, pour le lui rendre après. */
let restoreTo: HTMLElement | null = null;

watch(current, async (req) => {
  if (!req) {
    // Sans cela, répondre à une confirmation laissait le focus sur `<body>` :
    // la tabulation suivante repartait du haut de la page, loin du bouton
    // qu'on venait d'actionner.
    restoreTo?.focus?.();
    restoreTo = null;
    return;
  }
  if (!restoreTo) restoreTo = document.activeElement as HTMLElement | null;
  await nextTick();
  if (req.destructive) cancelButtonRef.value?.focus();
  else confirmButtonRef.value?.focus();
});

// Trap Esc globally while a dialog is open. Without this, browsers handle
// Esc inconsistently for our overlay since it's not a native <dialog>.
function handleKey(e: KeyboardEvent) {
  if (!current.value) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    onCancel();
  } else if (e.key === 'Enter' && document.activeElement === confirmButtonRef.value) {
    e.preventDefault();
    onConfirm();
  } else if (e.key === 'Tab') {
    // Deux boutons, en boucle. `aria-modal` n'a jamais retenu la tabulation :
    // au troisième Tab l'utilisateur au clavier était dans la page derrière,
    // devant une question à laquelle il ne pouvait plus répondre autrement
    // qu'en revenant à reculons.
    const pair = [cancelButtonRef.value, confirmButtonRef.value].filter(
      (b): b is HTMLButtonElement => !!b,
    );
    if (!pair.length) return;
    e.preventDefault();
    const at = pair.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.shiftKey
      ? (at <= 0 ? pair.length - 1 : at - 1)
      : (at === pair.length - 1 ? 0 : at + 1);
    pair[next]!.focus();
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKey);
});
onUnmounted(() => {
  window.removeEventListener('keydown', handleKey);
});
</script>

<style scoped>
</style>
