<script setup lang="ts">
/**
 * « Tout afficher » — la réponse au `Ctrl+F`.
 *
 * Les sections repliées coûtent 60 px au lieu de ~2000, et c'est la raison
 * d'être du bas de page. Mais ce qui est en `display: none` est introuvable par
 * la recherche du navigateur, qu'on ne peut pas intercepter. Cette case déplie
 * tout d'un coup : le membre qui cherche une piste de sous-titres par `Ctrl+F`
 * la coche une fois et la fiche entière redevient cherchable.
 *
 * La maquette lui donnait une case de 14 × 14 px. Ici la cible fait 2.75rem
 * (44 px au réglage d'échelle par défaut) : c'est le minimum de la 2.5.5, et
 * une case de 14 px est précisément ce qu'on n'atteint pas au doigt.
 */
const expandAll = useExpandAll();
const fid = useFieldIds();
</script>

<template>
  <div class="xall">
    <!-- `<label for>` apparié plutôt qu'un `aria-label` : le libellé est
         visible, et un clic dessus doit cocher la case — c'est la moitié de la
         cible tactile. -->
    <label class="xall-label" :for="fid('expand-all')">
      <input
        :id="fid('expand-all')"
        v-model="expandAll"
        type="checkbox"
        class="xall-box"
      >
      <span class="xall-text">
        {{ $t('torrents.detail.expandAll.label') }}
        <span class="xall-kbd" aria-hidden="true">{{ $t('torrents.detail.expandAll.shortcut') }}</span>
      </span>
    </label>
    <p v-if="expandAll" class="xall-note">
      {{ $t('torrents.detail.expandAll.note') }}
    </p>
  </div>
</template>

<style scoped>
.xall {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

/* La cible entière, pas seulement le carré : 2.75rem de haut, et le libellé
   dedans. */
.xall-label {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  min-height: 2.75rem;
  padding: 0 0.7rem 0 0.5rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-pill);
  background: rgb(var(--bg-elevated));
  cursor: pointer;
  transition:
    border-color var(--dur-2) ease,
    background-color var(--dur-2) ease;
}
.xall-label:hover {
  border-color: rgb(var(--fg-default) / 0.3);
  background: rgb(var(--bg-hover));
}

.xall-box {
  flex: none;
  width: 1.1rem;
  height: 1.1rem;
  margin: 0;
  accent-color: rgb(var(--accent-warm));
  cursor: pointer;
}

.xall-text {
  display: inline-flex;
  align-items: baseline;
  gap: 0.4rem;
  font-size: 0.8125rem;
  font-weight: 600;
  color: rgb(var(--fg-default));
}
.xall-kbd {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 500;
  color: rgb(var(--fg-muted));
}

.xall-note {
  margin: 0;
  padding-inline: 0.5rem;
  font-size: 0.75rem;
  line-height: 1.45;
  color: rgb(var(--fg-muted));
}
</style>
