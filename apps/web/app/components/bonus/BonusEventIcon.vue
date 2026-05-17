<template>
  <template v-if="event">
    <button
      type="button"
      class="relative flex items-center justify-center h-9 w-9 rounded-md border bg-accent/10 hover:bg-accent/15 transition-colors group"
      :class="isPool ? 'border-amber-400/60 bg-amber-400/10 hover:bg-amber-400/20' : 'border-accent/40'"
      :aria-label="`${preset} event active`"
      :title="`${preset} · ${countdown} left`"
      @click="open = true"
    >
      <Icon
        :name="iconName"
        class="text-base group-hover:scale-110 transition-transform"
        :class="isPool ? 'text-amber-400' : 'text-accent'"
      />
      <!-- Pulsing dot to draw the eye while the event is live.
           A second ring on pool events makes the community origin
           obvious before the user even hovers. -->
      <span
        class="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ring-2 ring-bg-primary"
        :class="isPool ? 'bg-amber-400' : 'bg-success'"
      >
        <span
          class="absolute inset-0 rounded-full animate-ping opacity-75"
          :class="isPool ? 'bg-amber-400' : 'bg-success'"
        />
      </span>
    </button>
    <BonusEventModal v-model="open" :event="event" />
  </template>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  bonusPresetLabel,
  useActiveBonusEvent,
  bonusCountdown,
} from '~/composables/useActiveBonusEvent';
import BonusEventModal from '~/components/bonus/BonusEventModal.vue';

const { event } = useActiveBonusEvent();
const open = ref(false);

const isPool = computed(() => event.value?.source === 'freeleech_pool');

const preset = computed(() => {
  if (!event.value) return '';
  return bonusPresetLabel(
    event.value.downloadMultiplier,
    event.value.uploadMultiplier
  );
});

// Glyph picker — coins for community pool freeleech (the source
// flag wins over the preset label), gift box for an admin-run
// freeleech, lightning for silverleech / custom.
const iconName = computed(() => {
  if (!event.value) return 'ph:lightning';
  if (isPool.value) return 'ph:hand-coins-fill';
  if (preset.value === 'Freeleech') return 'ph:gift-fill';
  if (preset.value === 'Silverleech') return 'ph:lightning-fill';
  return 'ph:lightning-fill';
});

// Re-render the title every minute so the tooltip's countdown stays
// approximately fresh without a per-second timer in the navbar.
const countdown = computed(() =>
  event.value ? bonusCountdown(event.value.endsAt) : ''
);
</script>
