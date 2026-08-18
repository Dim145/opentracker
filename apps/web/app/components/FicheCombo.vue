<script setup lang="ts">
/**
 * Liste déroulante qui n'enferme pas.
 *
 * Les valeurs courantes sont proposées — c'est ce qu'on veut dans 95 % des
 * cas et ça évite les fautes de frappe qui font diverger les fiches — mais
 * une release sort toujours des cases, alors « Autre » découvre un champ
 * libre. Une valeur venue de MediaInfo qui n'est dans aucune liste bascule
 * d'elle-même en saisie libre plutôt que d'être silencieusement effacée.
 */
const props = defineProps<{
  options: readonly string[];
  placeholder?: string;
  /** Libellé de l'entrée vide ; absent, le champ devient obligatoire. */
  emptyLabel?: string;
  /** Rendu d'une option quand la valeur stockée n'est pas lisible telle
   *  quelle — un code de langue, par exemple. */
  labelFor?: (value: string) => string;
}>();

const model = defineModel<string>({ default: '' });

const CUSTOM = '__custom__';
const forced = ref(false);

/** Vrai dès que la valeur courante ne figure pas dans la liste proposée. */
const isCustom = computed(
  () => forced.value || (!!model.value && !props.options.includes(model.value)),
);

const selected = computed({
  get: () => (isCustom.value ? CUSTOM : model.value),
  set: (v: string) => {
    if (v === CUSTOM) {
      forced.value = true;
      return;
    }
    forced.value = false;
    model.value = v;
  },
});
</script>

<template>
  <div class="fiche-combo">
    <select v-model="selected" class="input field-input field-input--select">
      <option v-if="emptyLabel !== undefined" value="">{{ emptyLabel }}</option>
      <option v-for="o in options" :key="o" :value="o">
        {{ labelFor ? labelFor(o) : o }}
      </option>
      <option :value="CUSTOM">{{ $t('fiche.tech.custom') }}</option>
    </select>
    <input
      v-if="isCustom"
      v-model="model"
      type="text"
      class="input field-input"
      :placeholder="placeholder"
    />
  </div>
</template>

<style scoped>
.fiche-combo {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  min-width: 0;
}
</style>
