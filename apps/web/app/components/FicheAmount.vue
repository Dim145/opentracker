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

const props = defineProps<{
  kind: 'bitrate' | 'size';
  /**
   * Nom accessible du champ. Même raison que dans `FicheCombo` : l'appelant
   * rend son libellé dans un `<span>`, et il y a deux contrôles — la quantité
   * et son unité — donc rien ne peut être déduit.
   */
  /**
   * OBLIGATOIRE, et c'est le point : rendue optionnelle, un appelant qui
   * l'oublie laisse un contrôle anonyme et rien ne le signale — ni le
   * compilateur, ni un détecteur statique, qui voit bien l'attribut posé sur
   * le contrôle mais pas si sa valeur arrive. Requise, le typecheck énumère
   * lui-même les oublis.
   */
  fieldLabel: string;
}>();

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
    <input
      v-model.number="shown"
      type="number"
      min="0"
      step="any"
      class="input field-input"
      :aria-label="fieldLabel"
    />
    <select
      v-model="unit"
      class="input field-input field-input--select"
      :aria-label="$t('fiche.tech.a11yUnitFor', { field: fieldLabel })"
    >
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
