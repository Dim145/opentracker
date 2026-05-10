<template>
  <Modal
    :model-value="modelValue"
    size="md"
    hide-close
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <template #header>
      <div class="flex items-center gap-3 min-w-0">
        <div
          class="flex items-center justify-center h-10 w-10 rounded-lg bg-gradient-to-br from-accent/30 to-accent/10 border border-accent/40 flex-shrink-0"
        >
          <Icon :name="iconName" class="text-xl text-accent" />
        </div>
        <div class="min-w-0">
          <h3 class="h-card truncate">{{ event.title }}</h3>
          <p class="text-xs text-accent mt-0.5">{{ $t('bonus.modal.countdownLeft', { time: countdown }) }}</p>
        </div>
      </div>
    </template>

    <div class="space-y-4 p-4">
      <!-- Description card -->
      <div
        v-if="event.description"
        class="border border-accent/30 rounded-lg px-4 py-3"
      >
        <p class="text-sm text-text-primary leading-relaxed">
          {{ event.description }}
        </p>
      </div>

      <!-- Multipliers grid -->
      <div class="grid grid-cols-2 gap-3">
        <div
          class="rounded-lg border px-4 py-3 text-center"
          :class="downloadCardClass"
        >
          <p
            class="text-[10px] font-bold uppercase tracking-widest mb-1"
            :class="downloadHeadClass"
          >
            {{ $t('bonus.modal.download') }}
          </p>
          <p class="text-2xl font-bold" :class="downloadValueClass">
            {{ downloadDisplay }}
          </p>
        </div>
        <div
          class="rounded-lg border px-4 py-3 text-center"
          :class="uploadCardClass"
        >
          <p
            class="text-[10px] font-bold uppercase tracking-widest mb-1"
            :class="uploadHeadClass"
          >
            {{ $t('bonus.modal.upload') }}
          </p>
          <p class="text-2xl font-bold" :class="uploadValueClass">
            {{ uploadDisplay }}
          </p>
        </div>
      </div>

      <!-- Window -->
      <div class="rounded-lg bg-bg-tertiary/50 border border-border px-4 py-3">
        <div class="flex items-center gap-2 mb-2">
          <Icon name="ph:clock" class="text-text-muted" />
          <p class="text-xs font-semibold text-text-primary">
            {{ $t('bonus.modal.eventWindow') }}
          </p>
        </div>
        <div class="grid grid-cols-2 gap-3 text-xs">
          <div>
            <p class="text-text-muted">{{ $t('bonus.modal.starts') }}</p>
            <p class="text-text-primary mt-0.5">{{ formatDateTime(event.startsAt) }}</p>
          </div>
          <div>
            <p class="text-text-muted">{{ $t('bonus.modal.ends') }}</p>
            <p class="text-text-primary mt-0.5">{{ formatDateTime(event.endsAt) }}</p>
          </div>
        </div>
      </div>

      <!-- Explainer -->
      <div class="rounded-lg border border-border px-4 py-3">
        <div class="flex items-start gap-2">
          <Icon name="ph:info" class="text-accent mt-0.5 flex-shrink-0" />
          <div class="text-xs text-text-muted leading-relaxed space-y-1">
            <p class="font-semibold text-text-primary">
              {{ $t('bonus.modal.whatIsThis', { preset: preset.toLowerCase() }) }}
            </p>
            <p>{{ explainer }}</p>
          </div>
        </div>
      </div>

      <!-- Action -->
      <div class="flex justify-end pt-2">
        <button
          type="button"
          class="btn btn-sm btn-primary"
          @click="$emit('update:modelValue', false)"
        >
          {{ $t('bonus.modal.gotIt') }}
        </button>
      </div>
    </div>
  </Modal>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import Modal from '~/components/Modal.vue';
import {
  bonusCountdown,
  bonusPresetLabel,
  formatBonusMultiplier,
  type ActiveBonusEvent,
} from '~/composables/useActiveBonusEvent';

const props = defineProps<{
  modelValue: boolean;
  event: ActiveBonusEvent;
}>();

defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
}>();

const { t } = useI18n();

const preset = computed(() =>
  bonusPresetLabel(
    props.event.downloadMultiplier,
    props.event.uploadMultiplier
  )
);

const iconName = computed(() => {
  if (preset.value === 'Freeleech') return 'ph:gift-fill';
  return 'ph:lightning-fill';
});

const countdown = computed(() => bonusCountdown(props.event.endsAt));

// Multiplier rendering. Below 1× we show "0%"/"50%" because that's
// what users associate with leech reductions; at or above 1× we show
// "1×"/"2×" because that maps to the bonus framing.
function display(bp: number): string {
  return bp < 100 ? `${bp}%` : `${formatBonusMultiplier(bp)}×`;
}

const downloadDisplay = computed(() => display(props.event.downloadMultiplier));
const uploadDisplay = computed(() => display(props.event.uploadMultiplier));

// Style the cards conditionally — "good for the user" gets the
// success palette, "bad / neutral" gets the muted one. Ratio-friendly
// changes are: download < 100 (less leech counted) and upload > 100
// (more upload counted).
const downloadGood = computed(() => props.event.downloadMultiplier < 100);
const uploadGood = computed(() => props.event.uploadMultiplier > 100);

const downloadCardClass = computed(() =>
  downloadGood.value
    ? 'bg-success/5 border-success/30'
    : 'bg-bg-tertiary/40 border-border'
);
const downloadHeadClass = computed(() =>
  downloadGood.value ? 'text-success' : 'text-text-muted'
);
const downloadValueClass = computed(() =>
  downloadGood.value ? 'text-success' : 'text-text-primary'
);

const uploadCardClass = computed(() =>
  uploadGood.value
    ? 'bg-accent/5 border-accent/30'
    : 'bg-bg-tertiary/40 border-border'
);
const uploadHeadClass = computed(() =>
  uploadGood.value ? 'text-accent' : 'text-text-muted'
);
const uploadValueClass = computed(() =>
  uploadGood.value ? 'text-accent' : 'text-text-primary'
);

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

const explainer = computed(() => {
  if (props.event.longDescription) return props.event.longDescription;
  // Auto-generated fallback when the admin didn't write one.
  const dl = props.event.downloadMultiplier;
  const ul = props.event.uploadMultiplier;
  const parts: string[] = [];
  if (dl === 0) {
    parts.push(t('bonus.modal.explainer.downloadFree'));
  } else if (dl < 100) {
    parts.push(t('bonus.modal.explainer.downloadReduced', { pct: dl }));
  } else if (dl === 100) {
    parts.push(t('bonus.modal.explainer.downloadNormal'));
  } else {
    parts.push(
      t('bonus.modal.explainer.downloadMultiplied', { mult: formatBonusMultiplier(dl) })
    );
  }
  if (ul === 0) {
    parts.push(t('bonus.modal.explainer.uploadNone'));
  } else if (ul === 100) {
    parts.push(t('bonus.modal.explainer.uploadNormal'));
  } else if (ul < 100) {
    parts.push(t('bonus.modal.explainer.uploadReduced', { pct: ul }));
  } else {
    parts.push(
      t('bonus.modal.explainer.uploadMultiplied', { mult: formatBonusMultiplier(ul) })
    );
  }
  return parts.join(' ');
});
</script>
