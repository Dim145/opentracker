<template>
  <template v-if="event">
    <button
      type="button"
      class="relative flex items-center justify-center h-9 w-9 rounded-md border border-accent/40 bg-accent/10 hover:bg-accent/15 transition-colors group"
      :aria-label="`${preset} event active`"
      :title="`${preset} · ${countdown} left`"
      @click="open = true"
    >
      <Icon
        :name="iconName"
        class="text-base text-accent group-hover:scale-110 transition-transform"
      />
      <!-- Pulsing dot to draw the eye while the event is live. -->
      <span
        class="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-success ring-2 ring-bg-primary"
      >
        <span class="absolute inset-0 rounded-full bg-success animate-ping opacity-75" />
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

const preset = computed(() => {
  if (!event.value) return '';
  return bonusPresetLabel(
    event.value.downloadMultiplier,
    event.value.uploadMultiplier
  );
});

// The lightning bolt is the universal "energy event" glyph. We swap
// to a gift box for full freeleech to mirror the more generous
// connotation, and a medal for silverleech (the screenshot used a
// lightning bolt — keeping that as the default).
const iconName = computed(() => {
  if (!event.value) return 'ph:lightning';
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
