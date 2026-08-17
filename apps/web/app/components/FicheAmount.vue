<script setup lang="ts">
/**
 * Grandeur mesurée : un nombre et son unité.
 *
 * La valeur reste stockée en unité de base (bit/s, octets) ; changer l'unité
 * ne fait que changer le repère de lecture, jamais la donnée. C'est ce qui
 * permet de passer de Kbps à Mbps sans que la fiche bouge, et ce qui évitait
 * d'avoir à ressaisir une valeur déjà lue dans le fichier.
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

/** Valeur en unité de base : bit/s pour un débit, octets pour une taille. */
const base = defineModel<number | undefined>('base');
const unit = defineModel<string | undefined>('unit');

const UNITS = {
  bitrate: ['Kbps', 'Mbps'],
  size: ['MiB', 'GiB'],
} as const;

const units = computed(() => UNITS[props.kind]);

// Une unité absente rendrait le select vide et la conversion arbitraire.
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
