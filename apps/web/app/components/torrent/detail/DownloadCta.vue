<script setup lang="ts">
/**
 * Le bouton de téléchargement — l'or du site, en aplat.
 *
 * # Pourquoi l'or et non `--accent`
 *
 * Il portait `--accent`, qui est achromatique dans les deux thèmes livrés
 * (blanc sur sombre, quasi noir sur clair) : la seule action pour laquelle la
 * page existe était la chose la plus grise de la page. Les deux références que
 * le propriétaire tient pour réussies mettent chacune une couleur saturée sur
 * ce bouton — vert vif pour l'une, bleu pour l'autre — et c'est ce qui les
 * fait lire comme des sites plutôt que comme des tableurs.
 *
 * `--accent-warm` est la couleur à laquelle ce site se reconnaît, et sa paire
 * avec `--accent-warm-fg` est celle que le portail de contraste mesure déjà :
 * **7,77:1 en thème sombre, 5,15:1 en thème clair**. Les deux passent AA, le
 * sombre passe AAA. `--accent` reste ce qu'il est — le jeton d'accentuation
 * neutre du reste du site ; c'est cette page qui préfère sa signature.
 *
 * # Pourquoi le survol ne change pas le remplissage
 *
 * Un voile de 12 % par-dessus l'or l'éclaircit en sombre (l'encre monte à
 * 8,64:1) mais l'ASSOMBRIT en clair, où `--fg-strong` est noir : l'encre
 * tombe alors à 4,10:1, sous les 4,5:1 — l'état de survol échouerait dans un
 * thème sur deux, exactement le défaut que la note de `--danger-fg` décrit
 * dans `main.css`. Le survol passe donc par un anneau, une ombre et un
 * soulèvement d'un pixel : trois signaux visibles, zéro couleur non mesurée.
 *
 * # Un vrai lien
 *
 * `<a href download>`, pas un `<button @click>` qui construirait la même URL
 * en JavaScript. Un lien se copie, s'ouvre dans un onglet, se voit dans la
 * barre d'état, marche sans JavaScript et sait déjà ce qu'est une cible
 * `download`. La version bouton n'apporte rien et perd tout cela.
 *
 * # Un seul, à chaque largeur
 *
 * Au-dessus de 1280 px, l'exemplaire principal vit dans la barre d'action ;
 * en dessous, il DISPARAÎT (`display: none`, donc hors de l'ordre de
 * tabulation) et c'est la barre basse collante qui le porte. Deux exemplaires
 * simultanés, c'est deux fois « télécharger » dans la liste des liens d'un
 * lecteur d'écran, et un membre qui ne sait pas lequel des deux est le bon.
 *
 * La règle est portée ICI et non par la page : la garantie doit tenir quel que
 * soit l'endroit où le composant est monté.
 *
 * # Pourquoi la sous-ligne n'a pas d'alpha
 *
 * `rgb(var(--accent-warm-fg) / 0.75)` sur un aplat d'or tombe sous 4,5:1 :
 * l'or a précisément une luminance moyenne, donc le défaut n'est plus masqué
 * comme il l'était sur un accent achromatique — il est certain. La hiérarchie
 * passe par la taille et la graisse, jamais par la transparence.
 */
const props = withDefaults(
  defineProps<{
    /** L'infohash. Construit l'URL du `.torrent`. */
    hash: string;
    /** Taille du contenu, pour la sous-ligne. */
    size?: number | null;
    /** Seeders, pour la sous-ligne. */
    seeders?: number | null;
    /** Résumé de qualité déjà composé — « 2160p REMUX ». */
    quality?: string | null;
    /** Le torrent est gratuit : la sous-ligne le dit, c'est décisif. */
    freeleech?: boolean;
    /**
     * `primary` dans la barre d'action (caché sous 1280 px), `dock` dans la
     * barre basse (qui n'existe que sous 1280 px).
     */
    variant?: 'primary' | 'dock';
  }>(),
  {
    size: null,
    seeders: null,
    quality: null,
    freeleech: false,
    variant: 'primary',
  },
);

const { t, locale } = useI18n();

const href = computed(() => `/api/torrents/${props.hash}/download`);

/**
 * Ce qu'on annonce sous le libellé : taille, qualité, seeders, gratuité.
 *
 * Les parts absentes sont retirées et non rendues vides — une sous-ligne
 * « · · 47 seeders » sur une release dont la qualité n'a pas été analysée est
 * pire que pas de sous-ligne du tout.
 */
const subParts = computed(() => {
  const out: string[] = [];
  if (typeof props.size === 'number' && props.size > 0) out.push(formatSize(props.size));
  if (props.quality) out.push(props.quality);
  if (typeof props.seeders === 'number') {
    out.push(
      t(
        'torrents.detail.cta.seeders',
        { n: props.seeders.toLocaleString(locale.value) },
        props.seeders,
      ),
    );
  }
  if (props.freeleech) out.push(t('torrents.detail.cta.free'));
  return out;
});
</script>

<template>
  <a
    :href="href"
    download
    class="dlc"
    :class="`dlc--${variant}`"
  >
    <Icon name="ph:download-simple-bold" class="dlc-icon" aria-hidden="true" />
    <span class="dlc-text">
      <span class="dlc-label">{{ $t('torrents.detail.cta.download') }}</span>
      <span v-if="variant === 'primary' && subParts.length" class="dlc-sub">{{
        subParts.join(' · ')
      }}</span>
    </span>
  </a>
</template>

<style scoped>
.dlc {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  text-decoration: none;
  background-color: rgb(var(--accent-warm));
  color: rgb(var(--accent-warm-fg));
  border: 1px solid rgb(var(--accent-warm));
  border-radius: var(--radius-lg);
  transition:
    box-shadow var(--dur-3) var(--ease-standard),
    transform var(--dur-2) var(--ease-emphasis);
}
/* L'or ne bouge pas, son entourage bouge — voir l'en-tête : un voile sur ce
   remplissage échoue au contraste dans un thème sur deux. */
.dlc:hover {
  transform: translateY(-1px);
  box-shadow:
    0 0 0 3px rgb(var(--accent-warm) / 0.28),
    0 6px 16px -8px rgb(var(--shadow-color) / calc(0.7 * var(--shadow-strength)));
}
.dlc:active {
  transform: translateY(1px);
  box-shadow: 0 0 0 2px rgb(var(--accent-warm) / 0.35);
}
/* Un lien reste un lien : l'anneau de focus du site, jamais remplacé par le
   traitement de survol. */
.dlc:focus-visible {
  outline: 2px solid rgb(var(--focus-ring));
  outline-offset: 3px;
}
@media (prefers-reduced-motion: reduce) {
  .dlc:hover,
  .dlc:active {
    transform: none;
  }
}

.dlc-icon {
  flex: none;
  font-size: 1.125rem;
}
.dlc-text {
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
  min-width: 0;
}

/* ── L'exemplaire principal : 52 px de haut contre des fantômes de 34 ────── */
.dlc--primary {
  min-height: 3.25rem;
  padding: 0 1.4rem;
  flex: 0 1 auto;
  box-shadow: 0 1px 0 rgb(var(--shadow-color) / 0.25);
}
.dlc--primary .dlc-icon {
  /* La flèche descend d'un cheveu au survol : le geste que le bouton décrit.
     Une micro-interaction qui dit quelque chose, pas un rebond décoratif. */
  transition: transform var(--dur-2) var(--ease-emphasis);
}
.dlc--primary:hover .dlc-icon {
  transform: translateY(2px);
}
@media (prefers-reduced-motion: reduce) {
  .dlc--primary:hover .dlc-icon {
    transform: none;
  }
}
.dlc--primary .dlc-label {
  /* `rem`, jamais `px` : `--ui-scale` n'agit que sur `html { font-size }`. */
  font-size: 0.9375rem;
  font-weight: 800;
  letter-spacing: calc(-0.005em * var(--tracking-scale));
  line-height: 1.2;
}
.dlc--primary .dlc-sub {
  /* Pleine opacité — voir l'en-tête : un alpha sur cette encre casse le
     contraste, l'or ayant précisément une luminance moyenne. */
  color: rgb(var(--accent-warm-fg));
  font-size: 0.6875rem;
  font-weight: 600;
  line-height: 1.3;
  font-variant-numeric: tabular-nums;
  letter-spacing: calc(0.01em * var(--tracking-scale));
}

/* Sous 1280 px, la barre basse porte le CTA. Un seul contrôle focalisable. */
@media (max-width: 1279.98px) {
  .dlc--primary {
    display: none;
  }
}

/* ── L'exemplaire de la barre basse : une ligne, pas de sous-ligne ───────── */
.dlc--dock {
  flex: none;
  margin-left: auto;
  padding: 0.6875rem 1.125rem;
  gap: 0.45rem;
}
.dlc--dock .dlc-label {
  font-size: 0.875rem;
  font-weight: 700;
  line-height: 1.2;
  white-space: nowrap;
}

@media (max-width: 767px) {
  .dlc--primary {
    /* Sur téléphone il n'existe pas, mais la règle reste vraie si un appelant
       futur le remonte : pleine largeur plutôt qu'un bouton flottant. */
    width: 100%;
    justify-content: center;
    padding: 0 0.75rem;
  }
  .dlc--dock {
    width: 100%;
    margin-left: 0;
    justify-content: center;
  }
}
</style>
