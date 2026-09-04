<script setup lang="ts">
/**
 * Le titre d'une section, une fois pour toutes.
 *
 * Le motif `.section-head / -mark / -title / -line / -count` était recopié en
 * CSS scopé dans **treize** fichiers de pages et défini zéro fois dans
 * `main.css`. Treize copies d'un même bloc dérivent : elles l'ont déjà fait sur
 * la marge basse et sur la graisse du filet.
 *
 * Ce composant ne migre pas les treize — ce serait un autre chantier, avec son
 * propre rayon d'impact. Il existe pour que la page de détail d'un torrent, qui
 * en portait la plus grosse copie, cesse d'en être une quatorzième, et pour que
 * les composants extraits de cette page n'aient pas chacun à redéfinir le
 * motif. C'est précisément le piège dans lequel `.tool-btn` est tombée ici :
 * une classe utilisée par cinq fichiers et définie dans deux.
 *
 * # `--section-tone` : la teinte de la famille, héritée et non passée en prop
 *
 * Le recensement des couleurs de la fiche a mesuré 284 instances d'élément
 * colorées sur 348 en gris pur (82 %) : treize sections avec un conteneur
 * identique, et rien pour dire au lecteur laquelle est la fiche technique et
 * laquelle est la zone d'exploitation. La teinte est donc portée par une
 * propriété personnalisée que les composants posent sur LEUR racine, et que
 * cette en-tête lit.
 *
 * Héritée plutôt que passée en prop, pour deux raisons :
 *   - Une propriété personnalisée traverse la frontière du `<style scoped>` de
 *     Vue (le scopage agit sur les sélecteurs, pas sur la cascade des
 *     variables), donc un ancêtre suffit et aucun gabarit appelant ne change.
 *   - Le repli `var(--section-tone, var(--accent-warm))` garde exactement
 *     l'apparence d'avant pour les appelants qui ne posent rien — dont deux
 *     fichiers en cours de refonte par ailleurs.
 *
 * La teinte ne touche QUE des éléments non textuels : le glyphe de l'icône, le
 * filet, et la bordure de la pastille. Mesuré : `--accent-warm` sur fond neutre
 * donne 3,05:1 au pire (thème clair, `--bg-hover`) — au-dessus des 3:1 que
 * WCAG 1.4.11 demande d'un élément non textuel, et sous les 4,5:1 d'un texte,
 * ce qui est exactement pourquoi elle n'en peint aucun. Le texte de la pastille
 * reste `--fg-muted` sur le voile à 12 % : 5,94:1 au pire des huit teintes et
 * des deux thèmes.
 */
withDefaults(
  defineProps<{
    /** Le titre. Déjà traduit par l'appelant — ce composant ne connaît pas de clés. */
    title: string;
    /** Un compte affiché en pastille, quand il y en a un à donner. */
    count?: number | null;
    /** Icône Phosphor, à gauche du titre. */
    icon?: string | null;
    /** `h2` par défaut ; `h3` pour une sous-section. */
    level?: 'h2' | 'h3';
    /** Resserre les marges, pour une section imbriquée. */
    compact?: boolean;
    /**
     * Supprime la séparation SOUS le titre.
     *
     * La marge basse de l'en-tête sépare le titre de son contenu. Quand ce
     * contenu est replié, elle ne sépare plus rien : elle laisse une bande
     * vide au bas du panneau, et le titre paraît collé en haut d'une boîte
     * trop grande. Mesuré sur le panneau NFO fermé : 54 px de panneau pour un
     * en-tête de 34, dont 17,6 de marge morte.
     */
    flush?: boolean;
  }>(),
  { count: null, icon: null, level: 'h2', compact: false, flush: false },
);
</script>

<template>
  <div
    class="section-head"
    :class="{ 'section-head--compact': compact, 'section-head--flush': flush }"
  >
    <span v-if="icon" class="section-head-plate" aria-hidden="true">
      <Icon :name="icon" class="section-head-mark" />
    </span>
    <component :is="level" class="section-head-title">{{ title }}</component>
    <!-- Le compte AVANT le filet : il appartient au titre, pas à la décoration.
         C'est ce qui rend « Fichiers (12) » lisible d'un coup d'œil et évite
         d'ouvrir un repli pour savoir s'il valait le clic. -->
    <span v-if="count !== null" class="section-head-count">{{ count }}</span>
    <span class="section-head-line" aria-hidden="true" />
    <!-- L'action de droite : le bouton « copier » d'un NFO, un lien « tout voir ». -->
    <slot name="action" />
  </div>
</template>

<style scoped>
.section-head {
  /* Le repli EST la valeur d'avant : un appelant qui ne pose rien ne change
     pas d'apparence. */
  /*
   * `--section-tint` AUSSI, parce que c'est le nom que le reste du site
   * emploie déjà : `me.vue` peint son filet de section avec, bien avant que
   * cette page n'invente `--section-tone` pour la même idée. Accepter les deux
   * évite qu'une troisième page en invente un troisième.
   */
  --tone: var(--section-tone, var(--section-tint, var(--accent-warm)));
  display: flex;
  /*
   * Le repli, sans quoi l'action de fin de ligne SORT de l'en-tête.
   *
   * Mesuré sur la fiche d'un torrent à 320 px de large : « Toutes les
   * releases → » fait 158 px, l'en-tête n'en offre que 269 une fois le titre
   * posé, et le lien s'étendait jusqu'à x=390 dans une fenêtre de 367 — 78 px
   * de défilement horizontal pour la page entière. Même chose avec l'indice
   * du NFO (125 px) et l'étiquette d'essaim (126 px) : trois symptômes, un
   * seul en-tête. Au-dessus de 430 px rien ne se voyait.
   */
  flex-wrap: wrap;
  align-items: center;
  /*
   * `0.75rem` et `padding-bottom: 0.4rem` : les valeurs de `.section-head`
   * dans `me.vue`, qui est la page la plus travaillée du site et donc la
   * référence de fait. Deux en-têtes qui veulent dire la même chose et ne se
   * ressemblent pas tout à fait se lisent comme une négligence, pas comme une
   * intention.
   */
  gap: 0.75rem;
  margin-bottom: 1.1rem;
  padding-bottom: 0.4rem;
}
.section-head--compact {
  margin-bottom: 0.6rem;
}
/* Rien à séparer : le contenu est replié. */
.section-head--flush {
  margin-bottom: 0;
  padding-bottom: 0;
}

/* ── La marque : une plaque NEUTRE, jamais teintée ────────────────────────
   Le glyphe est de la teinte ; sa plaque ne peut donc pas l'être. Mesuré :
   une teinte posée sur un voile de 8 % d'ELLE-MÊME tombe à 2,59:1 en thème
   clair pour l'or et 2,79:1 pour `--chart-1` — sous les 3:1 d'un élément non
   textuel. C'est le même défaut que la note de `main.css` décrit pour le
   texte, et il vaut aussi pour une icône. Fond neutre, teinte sur le glyphe et
   sur le filet : la paire tient dans les deux thèmes. */
.section-head-plate {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 1.6rem;
  height: 1.6rem;
  background: rgb(var(--bg-inset));
  border: 1px solid rgb(var(--tone) / 0.45);
  border-radius: var(--radius-sm);
  transition:
    border-color var(--dur-3) var(--ease-standard),
    background-color var(--dur-3) var(--ease-standard);
}
.section-head--compact .section-head-plate {
  width: 1.35rem;
  height: 1.35rem;
  border-radius: var(--radius-xs);
}
.section-head-mark {
  font-size: 0.9rem;
  color: rgb(var(--tone));
}
.section-head--compact .section-head-mark {
  font-size: 0.78125rem;
}

/* ── Le titre ─────────────────────────────────────────────────────────────
   La police d'affichage n'apparaissait que 9 fois sur 234 nœuds de texte de la
   fiche (3,8 %), parce que la variante `compact` — celle que portent onze des
   treize sections — la remplaçait par de l'Inter capitale grise. La signature
   typographique du site était donc absente de sa page la plus dense.
   Les deux variantes prennent maintenant Fraunces, et se distinguent par le
   STYLE plutôt que par la police : italique pour une section, romain pour une
   sous-section. C'est la distinction qu'un titre de niveau porte en édition,
   et elle survit à un changement de police par l'exploitant. */
.section-head-title {
  margin: 0;
  font-family: var(--font-display);
  font-style: italic;
  font-weight: 500;
  /* `rem` et non `px` : `--ui-scale` n'est appliqué qu'une seule fois, sur
     `html { font-size }`, donc toute taille en pixels rend le réglage
     d'échelle de l'exploitant inerte. */
  font-size: clamp(1.15rem, 2.2vw, 1.55rem);
  line-height: 1.15;
  letter-spacing: calc(-0.015em * var(--tracking-scale));
  color: rgb(var(--fg-strong));
  white-space: nowrap;
}
/*
 * `compact` change la TAILLE, plus la langue.
 *
 * Il basculait en romain non-display : sur une même page, « Versions » et
 * « Commentaires » s'affichaient en italique display pendant que « NFO »,
 * « Pistes audio », « Sous-titres » et « Note de l'uploadeur » s'affichaient
 * en Inter droit — mesuré à 25,6 px italique contre 19,2 px romain, pour des
 * sections qui sont exactement du même rang. Deux systèmes typographiques sur
 * un seul écran, sans qu'aucune règle ne dise lequel s'applique quand.
 *
 * Il reste utile pour un titre IMBRIQUÉ (celui de la carte de décision), où
 * une taille moindre marque la subordination — ce qu'une variation d'échelle
 * dit très bien sans changer de police.
 */
.section-head--compact .section-head-title {
  font-size: clamp(1rem, 1.6vw, 1.2rem);
}

/* ── La pastille de compte ────────────────────────────────────────────────
   Voile de la teinte à 12 %, encre NEUTRE. C'est le seul motif teinté que le
   contraste autorise partout : `--fg-muted` sur un voile à 12 % de n'importe
   laquelle des huit teintes, sur n'importe laquelle des cinq surfaces, dans
   les deux thèmes, ne descend pas sous 5,94:1. La note d'origine écartait le
   voile parce qu'elle mesurait la teinte SUR SON PROPRE voile — le cas qui
   échoue — et non une encre neutre dessus. */
.section-head-count {
  flex: none;
  min-width: 1.5rem;
  padding: 0.05rem 0.4rem;
  border-radius: var(--radius-pill);
  background: rgb(var(--tone) / 0.12);
  border: 1px solid rgb(var(--tone) / 0.35);
  font-family: var(--font-mono);
  font-size: 0.7rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-align: center;
  color: rgb(var(--fg-muted));
}

/* ── Le filet ─────────────────────────────────────────────────────────────
   Il partait du gris de filet et s'éteignait. Il part maintenant de la teinte,
   passe par le gris, puis s'éteint : une trace colorée traverse la largeur de
   CHAQUE section, ce qui est la manière la moins coûteuse de rendre la teinte
   d'une famille visible sans peindre un seul fond. Purement décoratif —
   `aria-hidden`, et aucune information n'y repose. */
.section-head-line {
  flex: 1 1 auto;
  height: 1px;
  min-width: 1rem;
  background: linear-gradient(
    to right,
    rgb(var(--tone) / 0.65),
    rgb(var(--line-default)) 8rem,
    rgb(var(--line-default) / 0)
  );
}
.section-head--compact .section-head-line {
  background: linear-gradient(
    to right,
    rgb(var(--tone) / 0.45),
    rgb(var(--line-default)) 5rem,
    rgb(var(--line-default) / 0)
  );
}

@media (max-width: 640px) {
  .section-head-title {
    /* Le titre passe avant le filet quand la place manque : c'est lui qu'on
       lit, et un `nowrap` sur une largeur de téléphone le fait déborder. */
    white-space: normal;
  }
}
</style>
