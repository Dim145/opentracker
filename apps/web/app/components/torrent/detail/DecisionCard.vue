<script setup lang="ts">
import type { CrossSeedStats, SeedObligation } from '~/composables/useTorrentDetail';

/**
 * « Puis-je la prendre, et devrais-je ? » — une carte, quatre bandes.
 *
 * # Pourquoi une seule carte
 *
 * Les quatre réponses sont une seule décision : les chiffres du swarm, le
 * bouton, ce que la release coûte (ou ne coûte pas), et ce qu'elle engage.
 * Éclatées en quatre cartes, elles se lisent comme quatre sujets et le membre
 * clique avant d'avoir vu l'obligation — qui est justement celle des quatre
 * qu'il regretterait d'avoir manquée. Des filets d'un pixel séparent les
 * bandes ; rien d'autre. Conteneurs identiques, seule la couleur différencie.
 *
 * # Pourquoi la barre d'action est un slot
 *
 * « Signaler », « Favori », « Demander des seeds », « Modifier » dépendent de
 * quatre permissions et d'un compteur de seeders à zéro. Les faire entrer ici
 * demanderait six props booléennes que cette carte ne saurait pas quoi
 * vérifier — et la page les tient déjà toutes. Elle place donc ses contrôles
 * dans la bande ; la carte n'en fournit que la mise en page.
 *
 * # Couleur
 *
 * Aucune bande n'est peinte de la couleur de son propre texte. La bande de
 * bonus, la seule tentée de l'être, porte un fond neutre, un filet chaud à
 * gauche et une pastille sur la paire prévue pour ça
 * (`--accent-warm` / `--accent-warm-fg`). Le voile chaud sous un texte chaud
 * fait tomber la paire sous 4,5:1 en thème clair.
 */
const props = withDefaults(
  defineProps<{
    /** Taille du contenu, en octets. */
    size?: number | null;
    /** Nombre de fichiers, pour la sous-ligne de la taille. */
    fileCount?: number | null;
    stats?: { seeders: number; leechers: number; completed: number } | null;
    /** Les chiffres de cross-seed. Les octets arrivent en CHAÎNES (BigInt). */
    crossSeedStats?: CrossSeedStats | null;
    /** Le multiplicateur actif, tel que le dérive `useTorrentDetail`. */
    buff?: { kind: string; dl: number; ul: number; until: string | null } | null;
    /** « 0× DL · 2× UL », déjà composé et localisé par le composable. */
    buffPair?: string | null;
    /** « dans 3 jours », déjà composé par le composable. */
    buffEndsIn?: string | null;
    obligation?: SeedObligation | null;
    /** Un titre de section au-dessus des chiffres, quand la page en veut un. */
    title?: string | null;
  }>(),
  {
    size: null,
    fileCount: null,
    stats: null,
    crossSeedStats: null,
    buff: null,
    buffPair: null,
    buffEndsIn: null,
    obligation: null,
    title: null,
  },
);

const { t, locale } = useI18n();

const num = (n: number) => n.toLocaleString(locale.value);

/** Combien de seeders par leecher — la santé du swarm en un chiffre. */
const ratio = computed(() => {
  const s = props.stats;
  if (!s) return null;
  const value = s.leechers > 0 ? s.seeders / s.leechers : s.seeders;
  return value.toLocaleString(locale.value, { maximumFractionDigits: 1 });
});

/**
 * Les octets de cross-seed, en nombres.
 *
 * Le fil les porte en chaînes parce que le total dépasse `Number.MAX_SAFE_INTEGER`
 * chez les gros échangeurs. `Number()` d'une chaîne vide ou absente donne `0`
 * plutôt que `NaN`, mais `Number(undefined)` donne `NaN` — d'où le `?? '0'`.
 */
const exchanged = computed(() => {
  const cs = props.crossSeedStats;
  const total = Number(cs?.totalUploadedBytes ?? '0');
  const share = Number(cs?.uploadedShareBytes ?? '0');
  const ok = Number.isFinite(total) && Number.isFinite(share);
  return {
    total: ok ? total : 0,
    share: ok ? share : 0,
    fraction: ok && total > 0 ? share / total : 0,
  };
});

const sharePercent = computed(() =>
  exchanged.value.fraction.toLocaleString(locale.value, {
    style: 'percent',
    maximumFractionDigits: 1,
  }),
);

const showExchanged = computed(() => exchanged.value.total > 0);

/** La ligne de détail cross-seed : elle n'existe que s'il y a du trafic. */
const showCrossSeedLine = computed(() => {
  const cs = props.crossSeedStats;
  if (!cs) return false;
  return exchanged.value.share > 0 || cs.seederCount > 0 || cs.leecherCount > 0;
});

/** La pastille du bonus : courte, c'est elle qu'on lit de loin. */
const buffBadge = computed(() => {
  const b = props.buff;
  if (!b) return null;
  if (b.kind === 'freeleech') return t('torrents.detail.buff.freeleech');
  if (b.kind === 'upload') {
    return t('torrents.detail.buff.upload', {
      n: (b.ul / 100).toLocaleString(locale.value),
    });
  }
  return t('torrents.detail.buff.mixed');
});

/** Ce que le bonus change, en une phrase. */
const buffNote = computed(() => {
  const b = props.buff;
  if (!b) return null;
  if (b.kind === 'freeleech') return t('torrents.detail.buff.freeleechNote');
  if (b.kind === 'upload') {
    return t('torrents.detail.buff.uploadNote', {
      n: (b.ul / 100).toLocaleString(locale.value),
    });
  }
  return t('torrents.detail.buff.mixedNote');
});

/**
 * `useSlots()` au niveau du `setup`, pas dans le `computed`.
 *
 * Appelée depuis un `computed`, elle sort de la portée d'instance : Vue
 * renvoie les slots du composant en cours de rendu, qui n'est pas forcément
 * celui-ci, et la bande d'action apparaissait ou disparaissait selon l'ordre
 * de rendu. L'objet retourné est déjà réactif, donc le `computed` le lit sans
 * rappeler la fonction.
 */
const slots = useSlots();
/*
 * `cta` compte, et son absence ici est ce qui a fait rendre la page sans
 * aucun bouton de téléchargement : le gabarit ne posait pas de
 * `<slot name="cta" />`, Vue ne prévient pas pour un slot passé et jamais
 * rendu, et le seul CTA restant était celui du dock — masqué au-delà du
 * seuil mobile. Sur un écran large, la page n'offrait plus AUCUN moyen de
 * prendre le torrent, et ni le typecheck ni les tests ne pouvaient le voir.
 */
const hasActions = computed(
  () => !!slots.cta || !!slots.actions || !!slots.actionsSecondary,
);
</script>

<template>
  <div class="card dc">
    <div v-if="title" class="dc-band dc-band--head">
      <SectionHead :title="title" level="h2" compact />
    </div>

    <!-- ── Les chiffres. Une liste de définitions, parce que c'est ce que
         c'est : « Seeders / 47 / 7,8 par leecher ». Un lecteur d'écran
         annonce la nature avant la valeur, ce qu'une grille de `<span>` ne
         permet pas. ─────────────────────────────────────────────────────── -->
    <div class="dc-band">
      <dl class="dc-stats">
        <div v-if="typeof size === 'number'" class="dc-stat">
          <dt class="dc-k">{{ $t('torrents.detail.stats.totalSize') }}</dt>
          <dd class="dc-v">{{ formatSize(size) }}</dd>
          <dd v-if="typeof fileCount === 'number' && fileCount > 0" class="dc-s">
            {{ $t('torrents.detail.decision.files', { n: num(fileCount) }, fileCount) }}
          </dd>
        </div>

        <div v-if="stats" class="dc-stat dc-stat--seed">
          <dt class="dc-k">{{ $t('torrents.detail.stats.seeders') }}</dt>
          <!-- Le chevron double la couleur. `color-not-only` : un daltonien
               distingue « qui envoie » de « qui reçoit » à la direction du
               glyphe, pas à la teinte du chiffre. `aria-hidden`, parce que le
               `<dt>` a déjà nommé la nature de la valeur. -->
          <dd class="dc-v">
            <Icon name="ph:caret-up-fill" class="dc-glyph" aria-hidden="true" />{{ num(stats.seeders) }}
          </dd>
          <dd v-if="ratio" class="dc-s">
            {{ $t('torrents.detail.decision.perLeecher', { value: ratio }) }}
          </dd>
        </div>

        <div v-if="stats" class="dc-stat dc-stat--leech">
          <dt class="dc-k">{{ $t('torrents.detail.stats.leechers') }}</dt>
          <dd class="dc-v">
            <Icon name="ph:caret-down-fill" class="dc-glyph" aria-hidden="true" />{{ num(stats.leechers) }}
          </dd>
          <dd class="dc-s">{{ $t('torrents.detail.decision.inProgress') }}</dd>
        </div>

        <div v-if="stats" class="dc-stat">
          <dt class="dc-k">{{ $t('torrents.detail.stats.completed') }}</dt>
          <dd class="dc-v">{{ num(stats.completed) }}</dd>
          <dd class="dc-s">{{ $t('torrents.detail.decision.snatches') }}</dd>
        </div>

        <div v-if="showExchanged" class="dc-stat">
          <dt class="dc-k">{{ $t('torrents.detail.stats.exchanged') }}</dt>
          <dd class="dc-v">{{ formatSize(exchanged.total) }}</dd>
          <dd class="dc-s">
            {{ $t('torrents.detail.decision.xseedShare', { percent: sharePercent }) }}
          </dd>
        </div>
      </dl>

      <p v-if="showCrossSeedLine && crossSeedStats" class="dc-xseed">
        <span>
          {{
            $t('torrents.detail.decision.xseedSwarm', {
              seeders: num(crossSeedStats.seederCount),
              leechers: num(crossSeedStats.leecherCount),
            })
          }}
        </span>
        <span v-if="exchanged.share > 0">
          {{
            $t('torrents.detail.decision.xseedBytes', {
              size: formatSize(exchanged.share),
              percent: sharePercent,
            })
          }}
        </span>
      </p>
    </div>

    <!-- ── La barre d'action : une seule rangée, le CTA à droite.
         Il gardait sa propre ligne au-dessus des autres, par crainte qu'il ne
         devienne « un bouton parmi cinq » à côté du rouge de « Supprimer ».
         Ce n'est pas ce que ça faisait : ça laissait un bouton seul sur une
         ligne pleine largeur, avec un vide à sa droite. Il tient sa place par
         sa taille et sa couleur, pas par un retour à la ligne.

         Le CTA est DERNIER dans le document parce qu'il est à droite à
         l'écran : un ordre de tabulation qui ne suit pas l'ordre visuel est
         précisément ce que WCAG 2.4.3 interdit. Il passe du 11ᵉ au 15ᵉ
         arrêt — loin des 33 d'avant. ───────────────────────────────────── -->
    <div v-if="hasActions" class="dc-band dc-band--actions">
      <div v-if="$slots.actions || $slots.actionsSecondary" class="dc-actions">
        <slot name="actions" />
        <span v-if="$slots.actionsSecondary" class="dc-spacer" />
        <slot name="actionsSecondary" />
      </div>
      <div v-if="$slots.cta" class="dc-cta">
        <slot name="cta" />
      </div>
    </div>

    <!-- ── Le bonus. La seule bande qui a le droit d'être chaude — et elle
         l'est par un filet, pas par un voile. ───────────────────────────── -->
    <div v-if="buff" class="dc-band">
      <div class="dc-buff">
        <span class="dc-buff-badge">{{ buffBadge }}</span>
        <span v-if="buffPair" class="dc-buff-pair">{{ buffPair }}</span>
        <span v-if="buffNote" class="dc-buff-note">{{ buffNote }}</span>
        <span v-if="buffEndsIn" class="dc-buff-until">
          {{ $t('torrents.detail.buff.until', { left: buffEndsIn }) }}
        </span>
      </div>
    </div>

    <!-- ── Ce que la release engage. En dernier parce qu'on la lit après avoir
         décidé de la prendre — mais AVANT d'avoir cliqué, ce qui est tout
         l'intérêt de la garder dans la même carte. ──────────────────────── -->
    <div v-if="obligation" class="dc-band">
      <TorrentDetailSeedObligationCard :obligation="obligation" />
    </div>
  </div>
</template>

<style scoped>
.dc {
  /* La carte de décision est la seule qui parle de LA release : sa famille est
     l'or du site, et `SectionHead` l'hérite sans qu'on lui passe rien. */
  --section-tone: var(--accent-warm);
  /* Les bandes recouvrent le rayon de la carte : sans lui, le filet du haut
     traverse l'arrondi et laisse deux pointes qui dépassent. */
  overflow: hidden;
  /* Un liseré chaud d'un pixel en haut de la carte. Non textuel, donc soumis
     aux 3:1 de la 1.4.11 et non aux 4,5:1 : `--accent-warm` sur les surfaces
     de la fiche donne 7,02:1 au pire en sombre et 3,05:1 au pire en clair.
     C'est ce qui distingue cette carte des douze autres conteneurs de la
     page, qui étaient rigoureusement identiques. */
  box-shadow: inset 0 2px 0 rgb(var(--accent-warm) / 0.55);
}

.dc-band {
  padding: 0.6rem 0.85rem;
}
/* Un filet d'un pixel, jamais un fond différent : les conteneurs sont
   identiques et c'est la position qui porte le sens. */
.dc-band + .dc-band {
  border-top: 1px solid rgb(var(--line-default));
}
.dc-band--head {
  padding-bottom: 0;
}

/* ── Les cellules de chiffres ─────────────────────────────────────────────── */
.dc-stats {
  display: grid;
  /* `auto-fit` et non `repeat(5, …)` : la carte porte QUATRE cellules la
     plupart du temps — « échangés » n'apparaît que s'il y a du volume en
     cross-seed. Avec cinq colonnes fixes, la quatrième laissait un vide en
     bout de ligne, et dans la bande 768–1280 px (trois colonnes fixes) la
     quatrième tombait SEULE sur une deuxième ligne, à côté d'un vide de deux
     colonnes. Mesuré à 1000 px : c'est ce que ça faisait.
     `auto-fit` répartit ce qu'on lui donne, quel qu'en soit le nombre. */
  grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
  gap: 0.4rem;
  margin: 0;
}

.dc-stat {
  --cell-tone: var(--fg-faint);
  position: relative;
  min-width: 0;
  padding: 0.5rem 0.55rem;
  /* Fond NEUTRE, et il le reste : ces cellules portent des chiffres TEINTÉS
     (vert, cyan), et une encre sémantique sur un voile coloré tombe à 4,00:1
     en thème clair — mesuré sur les quatre teintes décoratives. La couleur
     arrive donc par le chiffre et par le rail, pas par le fond. */
  background-color: rgb(var(--bg-inset));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  overflow: hidden;
  transition: border-color var(--dur-3) var(--ease-standard);
}
/* Le rail de tête : deux pixels de la teinte de la cellule. Non textuel. */
.dc-stat::before {
  content: '';
  position: absolute;
  inset: 0 0 auto;
  height: 2px;
  background: rgb(var(--cell-tone) / 0.75);
}
.dc-stat--seed { --cell-tone: var(--online); }
.dc-stat--leech { --cell-tone: var(--info); }

.dc-k {
  display: block;
  margin-bottom: 0.1rem;
  /* `rem` et non `px` : `--ui-scale` n'agit qu'une fois, sur
     `html { font-size }`. */
  font-family: var(--font-mono);
  font-size: var(--label-sm, 0.5625rem);
  font-weight: 700;
  letter-spacing: var(--label-tracking, calc(0.08em * var(--tracking-scale)));
  text-transform: uppercase;
  color: rgb(var(--fg-subtle));
}

/* Le point focal de la fiche.
   Recensement d'avant : la plus grosse chose d'un document de 3 830 px faisait
   23 px, et ces chiffres — les seuls que le membre lit pour décider — en
   faisaient 16, soit la taille du texte courant. Les deux références font
   l'inverse : leur bandeau de chiffres est ce qui saute aux yeux. La mono
   plutôt que l'Inter parce que c'est la police des données sur ce site, et que
   des chiffres tabulaires de deux lignes voisines doivent s'aligner. */
.dc-v {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  margin: 0;
  font-family: var(--font-mono);
  font-size: clamp(1.15rem, 1.1vw + 0.75rem, 1.5rem);
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: calc(-0.02em * var(--tracking-scale));
  font-variant-numeric: tabular-nums;
  color: rgb(var(--fg-strong));
  overflow-wrap: anywhere;
}
/* Le chevron prend la teinte du chiffre et 0,7 de sa taille : il accompagne,
   il ne concurrence pas. */
.dc-glyph {
  flex: none;
  font-size: 0.7em;
  color: rgb(var(--cell-tone));
}
/* Couleur sémantique dans des conteneurs identiques : on lit la position, la
   couleur ne fait que confirmer, et le chevron la confirme une deuxième fois
   sans couleur. Mesuré sur `--bg-inset` : `--online` 8,41:1 en sombre et
   4,60:1 en clair, `--info` 8,95:1 et 5,44:1. */
.dc-stat--seed .dc-v,
.dc-stat--leech .dc-v {
  color: rgb(var(--cell-tone));
}

.dc-s {
  display: block;
  margin: 0;
  font-size: 0.65625rem;
  line-height: 1.35;
  /* `--fg-muted` et non `--fg-subtle` : la sous-ligne est la plus petite
     chose de la carte, et `--fg-subtle` ne garde que 4,6:1 sur `--bg-inset`.
     `--fg-muted` en donne près de sept dans les deux thèmes. */
  color: rgb(var(--fg-muted));
  font-variant-numeric: tabular-nums;
}

.dc-xseed {
  display: flex;
  flex-wrap: wrap;
  gap: 0.2rem 0.6rem;
  margin: 0.4rem 0 0;
  font-size: 0.6875rem;
  color: rgb(var(--fg-muted));
  font-variant-numeric: tabular-nums;
}

/* ── La barre d'action ────────────────────────────────────────────────────── */
/* Le CTA prend la largeur sur mobile et se contente de la sienne dès qu'il y
   a de la place : un bouton de 700 px de large ne se lit pas comme un
   bouton. */
/* La rangée : les actions à gauche, le CTA poussé à droite. Elles passent à la
   ligne avant lui quand la place manque — c'est le CTA qui doit rester entier,
   pas la rangée de secondaires. */
.dc-band--actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
}
.dc-cta {
  display: flex;
  margin-left: auto;
}
@media (min-width: 40rem) {
  .dc-cta {
    display: block;
  }
}

.dc-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  /* Elle cède la place au CTA plutôt que de le comprimer. */
  flex: 1 1 auto;
  min-width: 0;
}
.dc-spacer {
  flex: 1 1 0;
  min-width: 0;
}

/* ── Le bonus ─────────────────────────────────────────────────────────────── */
.dc-buff {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.5rem;
  padding: 0.45rem 0.55rem;
  /* Le voile chaud est de retour, et cette fois il est mesuré. Ce que la note
     d'origine avait écarté, c'était un texte de la MÊME famille sur ce voile —
     `--accent-warm-text` sur un voile d'or tombe à 4,13:1 en clair. Ici les
     trois textes sont neutres (`--fg-strong`, `--fg-muted`) et la pastille est
     un aplat, pas un texte : `--fg-default` sur un voile d'or à 10 % donne
     15,32:1 en sombre et 16,17:1 en clair, `--fg-muted` 6,19:1 et 6,09:1. */
  background-color: rgb(var(--accent-warm) / 0.1);
  border: 1px solid rgb(var(--accent-warm) / 0.3);
  border-left: 3px solid rgb(var(--accent-warm));
  border-radius: var(--radius-md);
}
.dc-buff-badge {
  display: inline-flex;
  align-items: center;
  height: 1.4rem;
  padding: 0 0.45rem;
  font-size: var(--label-md, 0.625rem);
  font-weight: 800;
  letter-spacing: var(--label-tracking, calc(0.08em * var(--tracking-scale)));
  text-transform: uppercase;
  /* La paire prévue pour ça, et la seule qui tienne dans les deux thèmes. */
  background-color: rgb(var(--accent-warm));
  color: rgb(var(--accent-warm-fg));
  border-radius: var(--radius-sm);
}
.dc-buff-pair {
  font-family: var(--font-mono);
  font-size: 0.71875rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: rgb(var(--fg-strong));
}
.dc-buff-note {
  font-size: 0.71875rem;
  color: rgb(var(--fg-muted));
}
.dc-buff-until {
  font-size: 0.71875rem;
  color: rgb(var(--fg-muted));
  font-variant-numeric: tabular-nums;
}

/* ── Responsive réel : trois paliers, pas un seul point de rupture ───────── */


@media (max-width: 767px) {
  .dc-band {
    padding: 0.6rem 0.65rem;
  }
  .dc-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .dc-v {
    /* Réduit, pas rabaissé : il reste la plus grosse chose de la carte, parce
       qu'un téléphone est justement l'écran où l'on décide en un coup d'œil. */
    font-size: 1.05rem;
  }
  .dc-actions {
    gap: 0.4rem;
  }
  .dc-spacer {
    display: none;
  }
}
</style>
