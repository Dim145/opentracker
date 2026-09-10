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
 * La maquette lui donnait une case de 14 × 14 px. Ici la cible est le
 * `<label>` entier, 2rem de haut (32 px au réglage d'échelle par défaut) :
 * au-dessus des 24 px de la 2.5.8, alors qu'une case de 14 px est
 * précisément ce qu'on n'atteint pas au doigt.
 */
const expandAll = useExpandAll();
const fid = useFieldIds();
</script>

<template>
  <div class="xall">
    <!-- `<label for>` apparié plutôt qu'un `aria-label` : le libellé est
         visible, et un clic dessus doit cocher la case — c'est la moitié de la
         cible tactile. -->
    <!-- `title` : « (Ctrl+F) » se lisait comme la touche qui coche la case —
         d'autant plus depuis que D et F sont annoncés en <kbd> plus bas. La
         mention visible dit maintenant POUR quoi, et l'infobulle le reste. -->
    <label class="xall-label" :for="fid('expand-all')" :title="$t('torrents.detail.expandAll.title')">
      <input
        :id="fid('expand-all')"
        v-model="expandAll"
        type="checkbox"
        class="xall-box"
        :aria-describedby="expandAll ? fid('expand-all-note') : undefined"
      >
      <span class="xall-text">
        {{ $t('torrents.detail.expandAll.label') }}
        <span class="xall-kbd" aria-hidden="true">{{ $t('torrents.detail.expandAll.shortcut') }}</span>
      </span>
    </label>
    <!-- La confirmation, pour qui ne voit pas le résultat.
         Elle occupait une ligne sous la case ; depuis que la commande vit dans
         la barre du haut, à côté du lien de retour, cette ligne coûterait à
         elle seule plus de hauteur que le contrôle. Or ce qu'elle annonce —
         « toutes les sections sont ouvertes » — se CONSTATE d'un coup d'œil
         quand on voit la page. Elle reste donc dans le document, rattachée à
         la case par `aria-describedby`, pour qui n'a pas ce coup d'œil. -->
    <p v-if="expandAll" :id="fid('expand-all-note')" class="sr-only">
      {{ $t('torrents.detail.expandAll.note') }}
    </p>
  </div>
</template>

<style scoped>
.xall {
  display: flex;
}

/* La cible entière, pas seulement le carré, et le libellé dedans.
   2 rem au lieu de 2,75 : dans la barre du haut elle voisine un lien de
   24 px, et une pilule de 44 y pesait plus que la page. 32 px restent
   au-dessus des 24 de WCAG 2.5.8. */
.xall-label {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 2rem;
  padding: 0 0.65rem 0 0.45rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-pill);
  /* Translucide et floutée : elle flotte sur le bandeau de la fiche, à côté du
     lien de retour qui porte la même recette. */
  background: rgb(var(--bg-elevated) / 0.82);
  backdrop-filter: blur(8px);
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
</style>
