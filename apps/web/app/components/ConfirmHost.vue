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
        class="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        @click.self="onCancel"
        @keydown.esc.stop="onCancel"
      >
        <div
          class="bg-bg-secondary border border-border rounded shadow-2xl w-full max-w-md overflow-hidden"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="`confirm-title-${current.id}`"
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
              class="text-sm text-text-secondary mb-6"
            >
              {{ current.message }}
            </p>
            <div class="flex gap-2">
              <button
                type="button"
                class="btn btn-secondary flex-1 text-[10px] font-bold uppercase tracking-widest"
                @click="onCancel"
              >
                {{ current.cancelText || 'Cancel' }}
              </button>
              <button
                ref="confirmButtonRef"
                type="button"
                class="btn btn-primary flex-1 text-[10px] font-bold uppercase tracking-widest"
                :class="current.destructive ? 'destructive-btn' : ''"
                @click="onConfirm"
              >
                {{ current.confirmText || 'Confirm' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
const queue = useConfirmState();
const current = computed(() => queue.value[0] || null);
const confirmButtonRef = ref<HTMLButtonElement | null>(null);

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

// Auto-focus the confirm button when a dialog opens so Enter resolves
// "Confirm" and Esc resolves "Cancel" — same default as window.confirm.
watch(current, async (req) => {
  if (!req) return;
  await nextTick();
  confirmButtonRef.value?.focus();
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
.destructive-btn {
  background-color: rgb(239 68 68);
  color: white;
}
.destructive-btn:hover {
  background-color: rgb(220 38 38);
}
</style>
