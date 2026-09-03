<script setup lang="ts">
/**
 * A dropdown that does not box you in.
 *
 * The common values are offered — that is what you want 95% of the time and it
 * avoids the typos that make listings diverge — but a release always breaks the
 * mould, so "Other" reveals a free field. A value from MediaInfo that appears
 * in no list switches to free input by itself rather than being silently
 * erased.
 */
const props = defineProps<{
  options: readonly string[];
  placeholder?: string;
  /** Label of the empty entry; absent, the field becomes mandatory. */
  emptyLabel?: string;
  /** How to render an option when the stored value is not readable as-is — a
   *  language code, for instance. */
  labelFor?: (value: string) => string;
  /**
   * Nom accessible du champ.
   *
   * Explicite, et pas déduit : les appelants rendent leur libellé dans un
   * `<span class="field-label">`, pas un `<label for>`, donc rien ne désigne
   * le `<select>` que ce composant crée — un lecteur d'écran annonçait
   * « liste » sans dire de quoi. La retombée automatique des attributs ne
   * suffirait pas non plus : il y a DEUX contrôles ici, et un `aria-label`
   * atterrirait sur le `<div>` racine.
   *
   * `fieldLabel` et non `fieldLabel` : `aria-label` EST un attribut ARIA natif,
   * donc `:aria-label="…"` sur le composant satisfait la signature HTML de la
   * balise et n'alimente jamais la prop du même nom camélisé. Le typecheck
   * restait rouge en signalant une prop manquante alors que l'attribut était
   * bien là — un nom distinct lève l'ambiguïté.
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

const model = defineModel<string>({ default: '' });

const CUSTOM = '__custom__';
const forced = ref(false);

/** True as soon as the current value is absent from the offered list. */
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
    <select
      v-model="selected"
      class="input field-input field-input--select"
      :aria-label="fieldLabel"
    >
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
      
      :aria-label="$t('fiche.tech.a11yCustomFor', { field: fieldLabel })":placeholder="placeholder"
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
