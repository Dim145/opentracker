<template>
  <!--
    The "add a reaction" trigger, for the hover toolbar.

    Separated from the count strip so the strip can render nothing when a
    message has no reactions. Here it costs no layout at all: the toolbar
    is already floating, already revealed on hover, and already always
    visible where there is no hover.
  -->
  <span class="rp">
    <button
      type="button"
      class="rp-btn"
      :aria-label="$t('messaging.reactions.add')"
      :title="$t('messaging.reactions.add')"
      :aria-expanded="open"
      @click.stop="open = !open"
    >
      <Icon name="ph:smiley" />
    </button>

    <div
      v-if="open"
      class="rp-pop"
      role="group"
      :aria-label="$t('messaging.reactions.pick')"
    >
      <button
        v-for="key in REACTION_KEYS"
        :key="key"
        type="button"
        class="rp-pick"
        :class="{ 'rp-pick--mine': mine.includes(key) }"
        :aria-label="$t(`messaging.reactions.${key}`)"
        :title="$t(`messaging.reactions.${key}`)"
        @click.stop="pick(key)"
      >
        {{ REACTION_GLYPH[key] }}
      </button>
    </div>
  </span>
</template>

<script setup lang="ts">
defineProps<{ mine: string[] }>();
const emit = defineEmits<{ (e: 'toggle', key: string): void }>();

const open = ref(false);

function pick(key: string) {
  open.value = false;
  emit('toggle', key);
}

// Clicking anywhere else closes it. Without this the popover survives
// scrolling away from the message it belongs to, and reacts to whatever
// happens to be under it.
function onDocClick() {
  open.value = false;
}
onMounted(() => document.addEventListener('click', onDocClick));
onUnmounted(() => document.removeEventListener('click', onDocClick));
</script>

<style scoped>
.rp { position: relative; display: inline-flex; }
.rp-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.6rem;
  height: 1.6rem;
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: rgb(var(--fg-muted));
  font-size: 0.85rem;
  cursor: pointer;
  transition: color var(--dur-2) ease, background var(--dur-2) ease;
}
.rp-btn:hover {
  color: rgb(var(--fg-strong));
  background: rgb(var(--fg-default) / 0.1);
}
.rp-pop {
  position: absolute;
  /* Above the toolbar, which is itself above the bubble — so the
     popover never lands on the message it is about. */
  bottom: calc(100% + 0.35rem);
  right: 0;
  display: inline-flex;
  gap: 0.1rem;
  padding: 0.2rem;
  border: 1px solid rgb(var(--line-strong));
  border-radius: var(--radius-pill);
  background: rgb(var(--bg-elevated));
  box-shadow: 0 2px 10px rgb(0 0 0 / 0.35);
  z-index: 3;
}
.rp-pick {
  min-width: 1.9rem;
  min-height: 1.9rem;
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
}
.rp-pick:hover { background: rgb(var(--fg-default) / 0.1); }
.rp-pick--mine { background: rgb(var(--accent-warm) / 0.18); }
@media (prefers-reduced-motion: reduce) {
  .rp-btn { transition: none; }
}
</style>
