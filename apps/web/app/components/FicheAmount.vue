<script setup lang="ts">
/**
 * A measured quantity: a number and its unit.
 *
 * The value stays stored in base units (bit/s, bytes); changing the unit only
 * changes the frame of reference, never the data. That is what lets you switch
 * from Kbps to Mbps without the listing moving, and what removed the need to
 * re-enter a value already read from the file.
 */
import {
  bitRateFrom,
  bitRateIn,
  sizeFrom,
  sizeIn,
  type BitRateUnit,
  type SizeUnit,
} from '~/utils/mediainfo';

const props = defineProps<{ kind: 'bitrate' | 'size' }>();

/** The value in base units: bit/s for a bitrate, bytes for a size. */
const base = defineModel<number | undefined>('base');
const unit = defineModel<string | undefined>('unit');

const UNITS = {
  bitrate: ['Kbps', 'Mbps'],
  size: ['MiB', 'GiB'],
} as const;

const units = computed(() => UNITS[props.kind]);

// An absent unit would leave the select empty and the conversion arbitrary.
watchEffect(() => {
  if (!unit.value || !units.value.includes(unit.value as never)) {
    unit.value = props.kind === 'bitrate' ? 'Kbps' : 'GiB';
  }
});

const shown = computed<number | undefined>({
  get: () =>
    props.kind === 'bitrate'
      ? bitRateIn(base.value, (unit.value ?? 'Kbps') as BitRateUnit)
      : sizeIn(base.value, (unit.value ?? 'GiB') as SizeUnit),
  set: (v) => {
    base.value =
      props.kind === 'bitrate'
        ? bitRateFrom(v, (unit.value ?? 'Kbps') as BitRateUnit)
        : sizeFrom(v, (unit.value ?? 'GiB') as SizeUnit);
  },
});
</script>

<template>
  <div class="fiche-amount">
    <input v-model.number="shown" type="number" min="0" step="any" class="input field-input" />
    <select v-model="unit" class="input field-input field-input--select">
      <option v-for="u in units" :key="u" :value="u">{{ u }}</option>
    </select>
  </div>
</template>

<style scoped>
.fiche-amount {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.4rem;
  min-width: 0;
}
.fiche-amount select {
  width: auto;
}
</style>
