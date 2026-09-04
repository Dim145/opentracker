<script setup lang="ts">
/**
 * Le NFO, replié, et rendu au caractère près.
 *
 * # Pourquoi replié
 *
 * Un NFO fait couramment 60 lignes de dessin ASCII. Déplié il pousse les
 * commentaires et les cross-seeds à 2000 px du haut de page ; replié il coûte
 * 40 px. Le compte va dans le libellé — « NFO (10 lignes) » — pour que le
 * choix de l'ouvrir se fasse sans l'ouvrir.
 *
 * # Pourquoi tout ce fatras typographique
 *
 * Un NFO n'est pas du texte : c'est une image dessinée avec des caractères de
 * la page de code 437, et elle ne tient que si chaque glyphe occupe exactement
 * une cellule. Quatre réglages la cassent, et trois sont des DÉFAUTS :
 *
 *   - `liga` / `calt` — JetBrains Mono, la police mono du site, a des
 *     ligatures : `--` devient un tiret long, `|-` une flèche. Un cadre en
 *     `+---+` se referme d'un caractère.
 *   - `kern` / `font-kerning` — le crénage rapproche certaines paires. Sur une
 *     mono le pas doit être invariant, sinon les colonnes d'un tableau ASCII
 *     ne s'empilent plus.
 *   - `letter-spacing` — la fiche en pose ailleurs, et il s'hérite.
 *   - `line-height` — les caractères de dessin (`─│┌┐└┘`) touchent le haut et
 *     le bas de leur cellule. À 1.35 un cadre a des trous horizontaux ; à 1 il
 *     est continu.
 *
 * Et une pile mono explicite plutôt que `var(--font-mono)` : ce jeton est
 * modifiable par l'exploitant depuis la console des thèmes, et un NFO rendu
 * dans une police proportionnelle n'est plus lisible du tout. Le jeton reste en
 * tête de pile, avec de vraies mono derrière.
 */
import { formatSize } from '~/utils/format';

const props = defineProps<{
  /** Le texte brut, tel qu'il est stocké. Vide, la section ne se rend pas. */
  nfo: string | null | undefined;
}>();

const { t } = useI18n();
const { open, toggle, forced } = useDetailDisclosure();
const fid = useFieldIds();

const lineCount = computed(() => (props.nfo ? props.nfo.split('\n').length : 0));

/** Les octets, pas les caractères : un NFO en CP437 étendu pèse plus qu'il ne compte. */
const byteSize = computed(() =>
  props.nfo ? formatSize(new TextEncoder().encode(props.nfo).length) : '',
);

const hint = computed(() =>
  `${t('torrents.detail.nfoMeta.lines', { n: lineCount.value })} · ${byteSize.value}`,
);

/* ── La copie ─────────────────────────────────────────────────────────────── */

const copied = ref(false);
let resetTimer: ReturnType<typeof setTimeout> | undefined;

async function copy() {
  if (!props.nfo) return;
  try {
    await navigator.clipboard.writeText(props.nfo);
    copied.value = true;
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => (copied.value = false), 1500);
  } catch {
    // Presse-papiers refusé (contexte non sécurisé, permission) : le bouton ne
    // mentira pas en affichant « copié ».
    copied.value = false;
  }
}

onBeforeUnmount(() => clearTimeout(resetTimer));
</script>

<template>
  <section v-if="nfo" class="nfo-panel">
    <SectionHead
      :title="$t('torrents.detail.sections.nfo')"
      :count="lineCount"
      icon="ph:file-text-bold"
      compact
    >
      <template #action>
        <span class="nfo-hint">{{ hint }}</span>
        <button
          v-if="open"
          type="button"
          class="tool-btn tool-btn--sm tool-btn--text"
          @click="copy"
        >
          <Icon :name="copied ? 'ph:check-bold' : 'ph:copy-bold'" aria-hidden="true" />
          {{ copied ? $t('common.copied') : $t('common.copy') }}
        </button>
        <!-- `aria-expanded` porté par le bouton et `aria-controls` désignant le
             corps : sans les deux, un lecteur d'écran annonce « bouton » et rien
             sur l'état. Le bouton se désactive quand « tout afficher » tient
             l'ouverture, plutôt que de mentir sur ce qu'un clic ferait. -->
        <button
          type="button"
          class="tool-btn tool-btn--sm"
          :aria-expanded="open"
          :aria-controls="fid('nfo-body')"
          :disabled="forced"
          :aria-label="open
            ? $t('torrents.detail.nfoPanel.collapse')
            : $t('torrents.detail.nfoPanel.expand')"
          @click="toggle"
        >
          <Icon
            name="ph:caret-down-bold"
            class="nfo-caret"
            :class="{ 'nfo-caret--open': open }"
            aria-hidden="true"
          />
        </button>
      </template>
    </SectionHead>

    <div v-show="open" :id="fid('nfo-body')" class="nfo-frame">
      <pre class="nfo-body">{{ nfo }}</pre>
    </div>
  </section>
</template>

<style scoped>
/* La famille « contenu » de la fiche — le NFO, les pistes audio, les
   sous-titres : ce que le FICHIER contient, par opposition à ce que la release
   vaut (or) ou à ce que l'équipe en fait (bleu). `--accent-cool` était déclaré
   dans `main.css` et n'était utilisé nulle part ; c'est exactement la matière
   première qui manquait. `SectionHead` l'hérite sans qu'on lui passe rien. */
.nfo-panel {
  --section-tone: var(--accent-cool);
}

.nfo-hint {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  color: rgb(var(--fg-muted));
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.nfo-caret {
  transition: transform var(--dur-2) var(--ease-standard);
}
.nfo-caret--open { transform: rotate(180deg); }

/* Le cadre du NFO : un voile de la teinte de famille à 6 %, sous une encre
   NEUTRE. Un NFO est un artefact de terminal, et un fond très légèrement
   refroidi le dit sans rien coûter à la lisibilité — mesuré, `--fg-default`
   sur un voile de `--accent-cool` à 6 % donne 15,01:1 en sombre et 16,96:1 en
   clair. Le liseré de tête est non textuel (3:1 requis) : `--accent-cool` sur
   ces surfaces donne 8,65:1 et 3,44:1. */
.nfo-frame {
  background:
    linear-gradient(rgb(var(--accent-cool) / 0.06), rgb(var(--accent-cool) / 0.06)),
    rgb(var(--bg-inset));
  border: 1px solid rgb(var(--accent-cool) / 0.28);
  border-top: 2px solid rgb(var(--accent-cool) / 0.5);
  border-radius: var(--radius-md);
  padding: 0.7rem 0.8rem;
  overflow: auto;
  max-height: 70vh;
}

/*
 * La fidélité ASCII, réglage par réglage. Chacun corrige un défaut du
 * navigateur ou un héritage de la page — voir l'en-tête du fichier.
 */
.nfo-body {
  margin: 0;
  font-family:
    var(--font-mono), ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas,
    'DejaVu Sans Mono', monospace;
  font-size: 0.75rem;
  /* Une cellule = une ligne. Les caractères de dessin touchent leurs bords. */
  line-height: 1;
  /* Pas de ligature, pas de crénage, pas d'interlettrage : le pas est
     invariant, sinon les colonnes d'un cadre ne s'empilent plus. */
  font-variant-ligatures: none;
  font-feature-settings: 'liga' 0, 'clig' 0, 'calt' 0, 'kern' 0;
  font-kerning: none;
  letter-spacing: 0;
  font-variant-numeric: normal;
  color: rgb(var(--fg-default));
  white-space: pre;
  tab-size: 4;
  /* Un NFO est centré pour un terminal à largeur fixe : garder sa largeur
     naturelle évite le retour à la ligne qui détruit le dessin. */
  width: max-content;
  min-width: 100%;
}
</style>
