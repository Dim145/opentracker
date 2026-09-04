<script setup lang="ts">
import type { SeedObligation } from '~/composables/useTorrentDetail';

/**
 * La barre basse — le CTA qui reste joignable quand la page n'a pas de rail.
 *
 * # Le problème mesuré
 *
 * Sur une fenêtre de 844 px de haut, le bouton de téléchargement de la fiche
 * dense tombe à y=835 : neuf pixels de marge. Il est donc, en pratique,
 * sous la ligne de flottaison — un membre sur téléphone fait défiler pour
 * trouver la seule action de la page. Les deux références font pire encore :
 * leur CTA devient injoignable dès qu'on descend.
 *
 * # Un seul contrôle focalisable, à chaque largeur
 *
 * Cette barre n'existe QUE sous 1280 px, et `DownloadCta` en variante
 * `primary` disparaît exactement au même seuil (`display: none`, donc hors de
 * l'ordre de tabulation). Les deux règles sont symétriques et portées par les
 * composants eux-mêmes, pas par la page : un lecteur d'écran ne trouve jamais
 * deux liens « Télécharger le .torrent », à aucune largeur.
 *
 * # Ce qu'elle porte en plus du bouton
 *
 * Seeders, leechers, taille — et le temps de seed restant. Ce dernier est la
 * raison d'être de la barre : c'est la donnée qui fait renoncer, et la
 * cacher derrière un défilement revient à ne pas la donner.
 *
 * # Condition de montage
 *
 * `position: sticky` : la barre doit être le DERNIER enfant du conteneur
 * défilant de la page, et aucun de ses ancêtres ne doit porter
 * `overflow: hidden` — sinon elle se comporte en `static`, sans erreur ni
 * avertissement. Choisie plutôt que `fixed` parce qu'elle libère le bas de la
 * page en fin de défilement au lieu de recouvrir en permanence 4 rem de
 * contenu.
 */
const props = withDefaults(
  defineProps<{
    hash: string;
    size?: number | null;
    stats?: { seeders: number; leechers: number } | null;
    obligation?: SeedObligation | null;
    /** Résumé de qualité, transmis au CTA. */
    quality?: string | null;
    freeleech?: boolean;
  }>(),
  {
    size: null,
    stats: null,
    obligation: null,
    quality: null,
    freeleech: false,
  },
);

const { locale } = useI18n();

const num = (n: number) => n.toLocaleString(locale.value);

const view = computed(() => obligationView(props.obligation));

/**
 * Le temps dû n'apparaît que s'il y en a un.
 *
 * Un membre exempté, ou qui n'a jamais pris la release, verrait « 0 h » —
 * un chiffre qui ressemble à une dette réglée alors qu'il n'y a jamais eu de
 * dette. Rien à dire vaut mieux qu'un zéro ambigu sur une barre de quatre
 * chiffres.
 */
const owed = computed(() => {
  const v = view.value;
  if (!v || v.remaining <= 0) return null;
  if (v.state !== 'running' && v.state !== 'hnr') return null;
  return {
    text: formatDurationSeconds(v.remaining, locale.value),
    late: v.state === 'hnr',
  };
});

/*
 * L'état écrit par l'exemplaire primaire de `DownloadCta` : « le bouton
 * principal est-il à l'écran ? ». La barre n'est là que pour le remplacer
 * quand il n'y est plus — sinon elle répétait la même action à trente
 * centimètres de distance.
 */
const ctaOnScreen = useState('torrent-cta-onscreen', () => true);
</script>

<template>
  <section
    class="sd"
    :class="{ 'sd--shown': !ctaOnScreen }"
    :aria-label="$t('torrents.detail.dock.label')"
  >
    <div class="sd-in">
      <div class="sd-facts">
        <span v-if="stats" class="sd-fact sd-fact--seed">
          <span class="sd-v">{{ num(stats.seeders) }}</span>
          <span class="sd-k">{{ $t('torrents.detail.dock.seed') }}</span>
        </span>
        <span v-if="stats" class="sd-fact sd-fact--leech">
          <span class="sd-v">{{ num(stats.leechers) }}</span>
          <span class="sd-k">{{ $t('torrents.detail.dock.leech') }}</span>
        </span>
        <span v-if="typeof size === 'number' && size > 0" class="sd-fact">
          <span class="sd-v">{{ formatSize(size) }}</span>
        </span>
        <span
          v-if="owed"
          class="sd-fact"
          :class="owed.late ? 'sd-fact--late' : 'sd-fact--owed'"
        >
          <span class="sd-v">{{ owed.text }}</span>
          <span class="sd-k">{{ $t('torrents.detail.dock.owed') }}</span>
        </span>
      </div>

      <!-- Doublon pour la souris : le contrôle réel est celui de la carte de
           décision, au 8ᵉ rang de tabulation. Voir l'en-tête de `DownloadCta`. -->
      <TorrentDetailDownloadCta
        aria-hidden="true"
        tabindex="-1"
        variant="dock"
        :hash="hash"
        :size="size"
        :seeders="stats?.seeders ?? null"
        :quality="quality"
        :freeleech="freeleech"
      />
    </div>
  </section>
</template>

<style scoped>
.sd {
  display: none;
  position: sticky;
  bottom: 0;
  /* 30, l'échelon « collant » de l'échelle documentée dans `main.css`
     (collant 30, listes déroulantes 40, modales 50, notifications 60). La
     maquette disait 50 : la barre serait alors passée AU-DESSUS du voile
     d'une modale ouverte par-dessus la page. */
  z-index: 30;
  padding: 0.625rem 1rem max(0.625rem, env(safe-area-inset-bottom));
  background-color: rgb(var(--bg-elevated) / 0.96);
  backdrop-filter: blur(14px);
  border-top: 1px solid rgb(var(--line-strong));
  box-shadow: var(--shadow-popover);
}

/* Elle n'existe que quand le CTA principal est sorti de l'écran — voir
   `DownloadCta`. Plus de seuil de largeur : le doublon ne dépendait pas de la
   taille de l'écran mais de la position dans le défilement. */
.sd--shown {
  display: block;
}

.sd-in {
  display: flex;
  align-items: center;
  gap: 0.875rem;
}

.sd-facts {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.5rem 0.875rem;
  min-width: 0;
}

.sd-fact {
  display: flex;
  align-items: baseline;
  gap: 0.3125rem;
  white-space: nowrap;
}

.sd-v {
  /* `rem` et non `px` : `--ui-scale` n'agit que sur `html { font-size }`. */
  font-family: var(--font-mono);
  font-size: 0.9375rem;
  font-weight: 700;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: rgb(var(--fg-strong));
}
.sd-fact--seed .sd-v {
  color: rgb(var(--online));
}
.sd-fact--leech .sd-v {
  color: rgb(var(--info));
}
.sd-fact--owed .sd-v {
  color: rgb(var(--warning));
}
.sd-fact--late .sd-v {
  color: rgb(var(--danger));
}

.sd-k {
  font-family: var(--font-mono);
  font-size: var(--label-sm, 0.5625rem);
  font-weight: var(--label-weight, 700);
  line-height: 1;
  letter-spacing: var(--label-tracking, calc(0.08em * var(--tracking-scale)));
  text-transform: uppercase;
  /* `--fg-muted` : `--fg-subtle` tombe à 3,93:1 dès qu'un fond se rapproche
     de `--bg-hover` en thème sombre, et un voile à 96 % s'en rapproche. */
  color: rgb(var(--fg-muted));
}

@media (max-width: 767px) {
  .sd {
    padding-inline: 0.65rem;
  }
  .sd-in {
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .sd-facts {
    width: 100%;
    justify-content: space-between;
    gap: 0.5rem;
  }
}
</style>
