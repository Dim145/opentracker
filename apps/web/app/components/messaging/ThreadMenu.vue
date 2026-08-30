<template>
  <!--
    Everything you can do to a conversation, behind one control.

    An overflow menu rather than four more buttons in the header: the bar
    already carries a back arrow, a name and two status tags, and cramming
    is the failure mode the pattern exists to avoid. These are also all
    infrequent — you archive a thread once, you block somebody once.
  -->
  <div ref="rootRef" class="tm">
    <button
      type="button"
      class="tm-btn"
      :aria-label="$t('messaging.menu.label')"
      :title="$t('messaging.menu.label')"
      :aria-expanded="open"
      aria-haspopup="menu"
      @click.stop="open = !open"
    >
      <Icon name="ph:dots-three-vertical-bold" />
    </button>

    <div v-if="open" class="tm-pop" role="menu">
      <button type="button" class="tm-item" role="menuitem" @click="run('archive')">
        <Icon :name="archived ? 'ph:tray-arrow-up' : 'ph:archive'" />
        {{ archived ? $t('messaging.menu.unarchive') : $t('messaging.menu.archive') }}
      </button>

      <div class="tm-group" role="group" :aria-label="$t('messaging.menu.mute')">
        <p class="tm-group-label">
          <Icon :name="muted ? 'ph:bell-slash' : 'ph:bell'" />
          {{ muted ? $t('messaging.menu.mutedUntil', { until: mutedLabel }) : $t('messaging.menu.mute') }}
        </p>
        <!-- Durations, not a switch. A mute with no end is how a thread
             stays unanswered for a month without anyone having decided
             to ignore it. -->
        <div class="tm-durations">
          <button
            v-for="h in [1, 8, 24, 168]"
            :key="h"
            type="button"
            class="tm-duration"
            role="menuitem"
            @click="run('mute', h)"
          >
            {{ $t(`messaging.menu.for.${h}`) }}
          </button>
          <button
            v-if="muted"
            type="button"
            class="tm-duration tm-duration--off"
            role="menuitem"
            @click="run('mute', 0)"
          >
            {{ $t('messaging.menu.unmute') }}
          </button>
        </div>
      </div>

      <!-- Last, separated, and in the danger colour: blocking is the one
           action here that closes the door in both directions. -->
      <button
        v-if="peer"
        type="button"
        class="tm-item tm-item--danger"
        role="menuitem"
        @click="run('block')"
      >
        <Icon name="ph:prohibit" />
        {{ $t('messaging.menu.block', { name: peer }) }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  /** The correspondent's name, absent when the account was erased. */
  peer?: string | null;
  archived?: boolean;
  /** ISO date, or null. */
  mutedUntil?: string | null;
}>();

const emit = defineEmits<{
  (e: 'archive'): void;
  (e: 'mute', hours: number): void;
  (e: 'block'): void;
}>();

const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);

// A mute in the past is not a mute. The row keeps the date rather than
// clearing it, so the check is on the clock, not on the field's presence.
const muted = computed(
  () =>
    !!props.mutedUntil && new Date(props.mutedUntil).getTime() > Date.now()
);
const mutedLabel = computed(() =>
  props.mutedUntil ? new Date(props.mutedUntil).toLocaleString() : ''
);

function run(action: 'archive' | 'mute' | 'block', hours = 0) {
  open.value = false;
  // Spelled out rather than `emit(action)`: `defineEmits` declares one
  // overload per event, so a union argument matches none of them.
  if (action === 'mute') emit('mute', hours);
  else if (action === 'archive') emit('archive');
  else emit('block');
}

// Clicking elsewhere closes it, and so does Escape — a menu you can only
// leave by picking something is a menu you picked by accident.
function onDocClick(e: MouseEvent) {
  if (!rootRef.value?.contains(e.target as Node)) open.value = false;
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false;
}
onMounted(() => {
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKey);
});
onUnmounted(() => {
  document.removeEventListener('click', onDocClick);
  document.removeEventListener('keydown', onKey);
});
</script>

<style scoped>
.tm { position: relative; display: inline-flex; }
.tm-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* 44px: the one control that opens everything else here. */
  width: 2.25rem;
  height: 2.25rem;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: rgb(var(--fg-muted));
  cursor: pointer;
  transition: color var(--dur-2) ease, background var(--dur-2) ease;
}
.tm-btn:hover {
  color: rgb(var(--fg-strong));
  background: rgb(var(--fg-default) / 0.08);
}
.tm-pop {
  position: absolute;
  top: calc(100% + 0.3rem);
  right: 0;
  z-index: 30;
  min-width: 15rem;
  padding: 0.3rem;
  border: 1px solid rgb(var(--line-strong));
  border-radius: var(--radius-md);
  background: rgb(var(--bg-elevated));
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.4);
}
.tm-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  min-height: 2.25rem;
  padding: 0 0.5rem;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: rgb(var(--fg-default));
  font-size: 0.8rem;
  text-align: left;
  cursor: pointer;
}
.tm-item:hover { background: rgb(var(--fg-default) / 0.08); }
.tm-item--danger { color: rgb(var(--danger)); margin-top: 0.15rem; }
.tm-item--danger:hover { background: rgb(var(--danger) / 0.12); }

.tm-group {
  padding: 0.35rem 0.5rem 0.25rem;
  border-top: 1px solid rgb(var(--line-default));
  border-bottom: 1px solid rgb(var(--line-default));
  margin: 0.15rem 0;
}
.tm-group-label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0 0 0.3rem;
  color: rgb(var(--fg-muted));
  font-size: 0.72rem;
}
.tm-durations { display: flex; flex-wrap: wrap; gap: 0.25rem; }
.tm-duration {
  min-height: 1.75rem;
  padding: 0 0.5rem;
  border: 1px solid rgb(var(--line-strong));
  border-radius: var(--radius-pill);
  background: transparent;
  color: rgb(var(--fg-default));
  font-size: 0.7rem;
  cursor: pointer;
}
.tm-duration:hover { background: rgb(var(--fg-default) / 0.08); }
.tm-duration--off { border-color: rgb(var(--accent-warm)); color: rgb(var(--accent-warm)); }
@media (prefers-reduced-motion: reduce) {
  .tm-btn { transition: none; }
}
</style>
