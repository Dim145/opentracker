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
    /**
     * Le compteur du membre — envoyé / reçu, en octets — pour dire ce que ce
     * téléchargement fait à son ratio AVANT qu'il clique. `null` quand
     * personne n'est connecté : la bande ne se rend pas.
     */
    viewerStats?: { uploaded: number; downloaded: number } | null;
    /** L'infohash, pour que la santé de l'essaim aille chercher sa courbe. */
    hash?: string | null;
    /** Les pairs anonymisés de la fiche, pour la dernière annonce. */
    peers?: ReadonlyArray<{ lastSeen?: string | null }> | null;
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
    viewerStats: null,
    hash: null,
    peers: null,
  },
);

const { t, locale } = useI18n();

const num = (n: number) => n.toLocaleString(locale.value);

/**
 * Une valeur qui change pendant que la carte est affichée glisse vers le haut
 * (la `<Transition>` sur la clé) et sa tuile se teinte une demi-seconde : rien
 * ne signalait qu'un chiffre venait d'être rafraîchi. Jamais au premier rendu.
 */
const flash = reactive({ seed: false, leech: false, done: false });
const timers: Partial<Record<keyof typeof flash, ReturnType<typeof setTimeout>>> = {};
function pulse(k: keyof typeof flash) {
  flash[k] = false;
  requestAnimationFrame(() => { flash[k] = true; });
  if (timers[k]) clearTimeout(timers[k]);
  timers[k] = setTimeout(() => (flash[k] = false), 700);
}
watch(() => props.stats?.seeders, (n, o) => { if (o !== undefined && n !== o) pulse('seed'); });
watch(() => props.stats?.leechers, (n, o) => { if (o !== undefined && n !== o) pulse('leech'); });
watch(() => props.stats?.completed, (n, o) => { if (o !== undefined && n !== o) pulse('done'); });
onBeforeUnmount(() => { for (const t of Object.values(timers)) if (t) clearTimeout(t); });

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
/**
 * Ce que ce téléchargement fait au ratio du membre.
 *
 * C'est l'information qui décide vraiment d'un téléchargement sur un tracker
 * privé, et elle n'était affichée nulle part : il fallait connaître sa taille,
 * son propre compteur et le multiplicateur en cours, puis calculer de tête.
 * Tout est déjà dans la page ; on fait le calcul à la place du membre.
 *
 * Le multiplicateur de TÉLÉCHARGEMENT est celui qui compte ici (`buff.dl`, en
 * pourcentage — 0 en freeleech, 100 en temps normal). Le multiplicateur d'envoi
 * ne change pas ce que le clic coûte, seulement ce que le partage rapportera.
 */
const cost = computed(() => {
  const v = props.viewerStats;
  if (!v || typeof props.size !== 'number' || props.size <= 0) return null;
  const up = Math.max(0, Number(v.uploaded) || 0);
  const down = Math.max(0, Number(v.downloaded) || 0);
  const factor = props.buff ? Math.max(0, props.buff.dl) / 100 : 1;
  const counted = props.size * factor;
  const fmt = (x: number) =>
    x.toLocaleString(locale.value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const before = down > 0 ? up / down : null;
  const after = down + counted > 0 ? up / (down + counted) : null;
  const afterWithout = down + props.size > 0 ? up / (down + props.size) : null;
  // « Inchangé » se juge sur ce qui s'AFFICHE : 1,4 GiB contre 290 GiB reçus
  // fait passer 1,4157 à 1,4090, et les deux s'écrivent « 1,42 ». Montrer
  // « 1,42 → 1,42 » sans un mot dessus ressemblait à une erreur ; le mot le
  // dit, et la flèche disparaît.
  const beforeTxt = before === null ? null : fmt(before);
  const afterTxt = after === null ? null : fmt(after);
  return {
    before: beforeTxt,
    after: afterTxt,
    unchanged: beforeTxt !== null && afterTxt !== null && beforeTxt === afterTxt,
    kind: factor === 0 ? 'freeleech' : factor < 1 ? 'partial' : 'full',
    factorLabel: factor.toLocaleString(locale.value, { maximumFractionDigits: 2 }),
    // Ce que ça aurait coûté sans le bonus — pour mesurer ce que le bonus vaut.
    without:
      factor < 1 && before !== null && afterWithout !== null
        ? { before: fmt(before), after: fmt(afterWithout) }
        : null,
  };
});

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

/*
 * `cta` compte, et son absence ici est ce qui a fait rendre la page sans
 * aucun bouton de téléchargement : le gabarit ne posait pas de
 * `<slot name="cta" />`, Vue ne prévient pas pour un slot passé et jamais
 * rendu, et le seul CTA restant était celui du dock — masqué au-delà du
 * seuil mobile. Sur un écran large, la page n'offrait plus AUCUN moyen de
 * prendre le torrent, et ni le typecheck ni les tests ne pouvaient le voir.
 */
</script>

<template>
  <div class="card dc">
    <div v-if="title" class="dc-band dc-band--head">
      <SectionHead :title="title" level="h2" compact />
    </div>

    <!-- ── Le geste. En tête de la carte, pleine largeur : dans la colonne
         épinglée c'est la première chose sous les yeux et elle y reste
         pendant qu'on lit les 3 000 px du dessous. Les boutons secondaires
         (favoris, signaler…) ne sont plus ici : ils ont leur propre carte
         « Vos actions », plus bas dans la colonne, où le rouge de
         « Supprimer » ne voisine plus le bouton principal. ─────────────── -->
    <div v-if="$slots.cta" class="dc-band dc-band--cta">
      <slot name="cta" />
    </div>

    <!-- ── La santé de l'essaim : l'état en un mot, la dernière annonce, la
         tendance. Juste sous le geste, parce que c'est ce qu'on veut savoir
         avant de le faire. ───────────────────────────────────────────────── -->
    <div v-if="hash && stats" class="dc-band">
      <TorrentDetailSwarmHealth :hash="hash" :stats="stats" :peers="peers" />
    </div>

    <!-- ── Les chiffres. Une réglette, pas quatre tuiles : dans une colonne de
         21,5 rem, quatre boîtes de 150 px empilées deux par deux faisaient une
         tour de cartons sous le bouton — mesuré, 310 px pour trois nombres. La
         taille est déjà sous le bouton ; restent les trois faits de l'essaim,
         côte à côte, séparés d'un filet. Une liste de définitions quand même :
         un lecteur d'écran annonce la nature avant la valeur. ──────────── -->
    <div v-if="stats || showExchanged" class="dc-band">
      <dl class="dc-strip">
        <div v-if="stats" class="dc-cell dc-cell--seed" :data-changed="flash.seed || undefined">
          <dt class="dc-k">{{ $t('torrents.detail.stats.seeders') }}</dt>
          <!-- Le chevron double la couleur (`color-not-only`) ; `aria-hidden`,
               le `<dt>` a déjà nommé la valeur. -->
          <dd class="dc-v">
            <Icon name="ph:caret-up-fill" class="dc-glyph" aria-hidden="true" />
            <Transition name="dcn" mode="out-in"><span :key="stats.seeders">{{ num(stats.seeders) }}</span></Transition>
          </dd>
          <!-- « 0 par leecher » sous zéro source ne dit rien : la ligne ne se
               rend qu'avec au moins une source. -->
          <dd v-if="ratio && stats.seeders > 0" class="dc-s">
            {{ $t('torrents.detail.decision.perLeecher', { value: ratio }) }}
          </dd>
        </div>
        <div v-if="stats" class="dc-cell dc-cell--leech" :data-changed="flash.leech || undefined">
          <dt class="dc-k">{{ $t('torrents.detail.stats.leechers') }}</dt>
          <dd class="dc-v">
            <Icon name="ph:caret-down-fill" class="dc-glyph" aria-hidden="true" />
            <Transition name="dcn" mode="out-in"><span :key="stats.leechers">{{ num(stats.leechers) }}</span></Transition>
          </dd>
          <dd class="dc-s">{{ $t('torrents.detail.decision.inProgress') }}</dd>
        </div>
        <div v-if="stats" class="dc-cell" :data-changed="flash.done || undefined">
          <dt class="dc-k">{{ $t('torrents.detail.stats.completed') }}</dt>
          <dd class="dc-v">
            <Transition name="dcn" mode="out-in"><span :key="stats.completed">{{ num(stats.completed) }}</span></Transition>
          </dd>
          <dd class="dc-s">{{ $t('torrents.detail.decision.snatches') }}</dd>
        </div>
        <div v-if="showExchanged" class="dc-cell">
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

    <!-- ── Ce que ça vous coûte. Le ratio avant → après, freeleech compris :
         la seule ligne de la carte qui parle du MEMBRE et non de la release,
         et celle qu'il calculait de tête jusqu'ici. ─────────────────────── -->
    <div v-if="cost" class="dc-band">
      <div class="dc-cost">
        <span class="dc-k">{{ $t('torrents.detail.cost.title') }}</span>
        <p v-if="cost.before !== null && cost.after !== null" class="dc-cost-ratio">
          <span class="dc-cost-n" :class="{ 'dc-cost-n--same': cost.unchanged }">{{ cost.before }}</span>
          <template v-if="!cost.unchanged">
            <Icon name="ph:arrow-right" class="dc-cost-arrow" aria-hidden="true" />
            <span class="dc-cost-n">{{ cost.after }}</span>
          </template>
          <span v-else class="dc-cost-tag">{{ $t('torrents.detail.cost.unchanged') }}</span>
        </p>
        <p v-else class="dc-cost-note">{{ $t('torrents.detail.cost.noRatio') }}</p>
        <p class="dc-cost-note">
          <!-- Gratuit : le bandeau GRATUIT dessous dit déjà « ne compte pas dans
               votre ratio » — ici, seulement ce qu'on aurait payé sans lui.
               Plein tarif et « ratio inchangé » : « il compte en entier » à côté
               d'un ratio qui ne bouge pas se lisait comme une contradiction ; la
               note explique pourquoi les deux sont vrais. -->
          <template v-if="cost.kind === 'freeleech'">
            <template v-if="cost.without">{{ $t('torrents.detail.cost.without', { before: cost.without.before, after: cost.without.after }) }}</template>
            <template v-else>{{ $t('torrents.detail.buff.freeleechNote') }}</template>
          </template>
          <template v-else-if="cost.kind === 'partial'">
            {{ $t('torrents.detail.cost.partial', { n: cost.factorLabel }) }}
            <template v-if="cost.without">{{ ' ' }}{{ $t('torrents.detail.cost.without', { before: cost.without.before, after: cost.without.after }) }}</template>
          </template>
          <template v-else-if="cost.unchanged">{{ $t('torrents.detail.cost.fullUnchanged') }}</template>
          <template v-else>{{ $t('torrents.detail.cost.full') }}</template>
        </p>
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

/* Le rail de tête : deux pixels de la teinte de la cellule. Non textuel. */

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
  font-size: 1.25rem;
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
.dc-cell--seed .dc-v,
.dc-cell--leech .dc-v {
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
@media (min-width: 40rem) {
  .dc-cta {
    display: block;
  }
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
  .dc-spacer {
    display: none;
  }
}

/* Le CTA prend toute la largeur de la carte : la racine de `DownloadCta` est
   atteinte par ce style scopé, comme pour toutes les racines d'enfants. */
.dc-band--cta {
  padding: 0.85rem 0.85rem 0.75rem;
}
.dc-band--cta > .dlc {
  width: 100%;
  justify-content: center;
}

/* ── Ce que ça vous coûte ─────────────────────────────────────────────── */
.dc-cost { display: grid; gap: 0.25rem; }
.dc-cost-ratio {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin: 0;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
.dc-cost-n { font-size: 1.15rem; font-weight: 700; color: rgb(var(--fg-strong)); }
/* Inchangé : le chiffre d'après en vert — la bonne nouvelle, dite aussi en
   toutes lettres à côté pour qui ne voit pas la couleur. */
.dc-cost-n--same { color: rgb(var(--online)); }
.dc-cost-arrow { align-self: center; color: rgb(var(--fg-subtle)); }
.dc-cost-tag { font-family: var(--font-sans); font-size: 0.6875rem; font-weight: 600; color: rgb(var(--online)); }
.dc-cost-note { margin: 0; font-size: 0.6875rem; line-height: 1.45; color: rgb(var(--fg-muted)); }

/* ── La réglette des chiffres ─────────────────────────────────────────── */
.dc-strip {
  display: grid;
  /* Trois cellules côte à côte dans la colonne ; une quatrième (échangés en
     cross-seed) fait passer à deux par deux plutôt qu'à quatre étroites. */
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 5.5rem), 1fr));
  margin: 0;
}
.dc-cell {
  --cell-tone: var(--fg-muted);
  min-width: 0;
  padding: 0.15rem 0.6rem 0.1rem;
}
.dc-cell[data-changed] {
  animation: dc-flash calc(500ms * var(--motion-scale)) var(--ease-standard) both;
}
@keyframes dc-flash {
  from { background-color: rgb(var(--cell-tone) / 0.16); }
  to { background-color: transparent; }
}
.dcn-enter-active,
.dcn-leave-active {
  display: inline-block;
  transition: opacity var(--dur-3) var(--ease-emphasis), transform var(--dur-3) var(--ease-emphasis);
}
.dcn-enter-from { opacity: 0; transform: translateY(0.4em); }
.dcn-leave-to { opacity: 0; transform: translateY(-0.4em); }
.dc-cell + .dc-cell {
  border-left: 1px solid rgb(var(--line-default));
}
.dc-cell--seed { --cell-tone: var(--online); }
.dc-cell--leech { --cell-tone: var(--info); }

@media (prefers-reduced-motion: reduce) {
  .dc-cell[data-changed] { animation: none; }
  .dcn-enter-active,
  .dcn-leave-active { transition: none; }
}
</style>
