<script setup lang="ts">
/**
 * Les pistes audio et de sous-titres, modélisées.
 *
 * # Le correctif structurel de la page
 *
 * V3X consacre 71 % de sa fiche à la description de l'uploadeur, C411 58 % — et
 * dans les deux cas ce texte REDIT ce que le site sait déjà : résolution,
 * codec, taille, tout est déjà en base et déjà affiché. La seule information
 * réellement neuve qu'il porte, c'est la liste des pistes : quelles langues,
 * quels sous-titres, forcés ou non, malentendants ou non. C'est aussi la seule
 * qui décide un téléchargement pour qui ne regarde pas en VO.
 *
 * Modélisée ici, elle sort du pavé de BBCode — et la description redevient ce
 * qu'elle devrait être : une légende.
 *
 * # D'où viennent les données, et pourquoi ce n'est pas idéal
 *
 * **Le schéma n'a aucune colonne par piste.** `torrents` porte `nfo` (texte),
 * `description` (texte), et la qualité vit dans les TAGS (`resolution`,
 * `codec`, `source`) — rien de structuré sur l'audio ni les sous-titres, et
 * aucune colonne `media_info`. Les pistes sont donc ANALYSÉES depuis le texte
 * MediaInfo trouvé dans le NFO ou dans la description.
 *
 * L'analyseur n'est pas écrit ici : `parseMediaInfoText()` existe déjà dans
 * `app/utils/mediainfo.ts`, il sert au formulaire d'upload (le membre y colle
 * sa sortie MediaInfo), il est testé, et il tolère les libellés français comme
 * anglais. Une deuxième grammaire aurait dérivé de la première.
 *
 * Ce que ça implique, et qui doit être dit : un uploadeur qui n'a collé aucun
 * bloc MediaInfo n'aura pas de pistes, et la section ne se rendra pas. Le
 * correctif propre serait des colonnes par piste alimentées à l'upload — le
 * formulaire construit DÉJÀ un `TechnicalSheet` complet et le jette dans du
 * BBCode. La légende de la section dit d'où vient ce qu'elle montre.
 */
import {
  formatBitRate,
  parseMediaInfoText,
  prettyAudioFormat,
  type MediaTrack,
} from '~/utils/mediainfo';

const props = withDefaults(
  defineProps<{
    /** Le NFO. Première source essayée : c'est là que MediaInfo est collé. */
    nfo?: string | null;
    /** La description. Repli — beaucoup d'uploadeurs y collent le bloc. */
    description?: string | null;
  }>(),
  { nfo: null, description: null },
);

const { locale } = useI18n();
const {
  open: audioOpen,
  toggle: toggleAudio,
  forced: audioForced,
} = useDetailDisclosure();
const { open: subsOpen, toggle: toggleSubs, forced: subsForced } = useDetailDisclosure();
const fid = useFieldIds();

/**
 * La première source qui donne des pistes gagne.
 *
 * Dans cet ordre parce que le NFO est le champ prévu pour ça, et parce qu'une
 * description peut contenir un bloc MediaInfo tronqué (un `[spoiler]` fermé
 * trop tôt) là où le NFO est copié tel quel.
 */
const parsed = computed(() => {
  for (const [source, raw] of [
    ['nfo', props.nfo],
    ['description', props.description],
  ] as const) {
    if (!raw) continue;
    const sheet = parseMediaInfoText(raw);
    if (sheet.audio.length || sheet.text.length) return { sheet, source };
  }
  return null;
});

const audio = computed(() => parsed.value?.sheet.audio ?? []);
const subs = computed(() => parsed.value?.sheet.text ?? []);
const source = computed(() => parsed.value?.source ?? null);

/**
 * `fr` → « français ». MediaInfo écrit tantôt le code, tantôt le nom anglais ;
 * un code affiché brut n'aide personne, et `Intl` connaît les deux formes.
 * Toute valeur qu'il refuse ressort inchangée plutôt que vide.
 */
const languageName = computed(() => {
  let dn: Intl.DisplayNames | null = null;
  try {
    dn = new Intl.DisplayNames([locale.value], { type: 'language', fallback: 'none' });
  } catch {
    dn = null;
  }
  return (raw?: string): string => {
    const v = (raw ?? '').trim();
    if (!v) return '—';
    if (!dn || v.length > 3) return v;
    try {
      return dn.of(v.toLowerCase()) ?? v;
    } catch {
      return v;
    }
  };
});

/** Ce qu'un sous-titre EST, en termes de tracker : intégral, forcé, ou SDH. */
function subtitleKind(t: MediaTrack): 'sdh' | 'forced' | 'full' {
  if (t.isSdh) return 'sdh';
  if (t.isForced) return 'forced';
  return 'full';
}

function audioFormat(t: MediaTrack): string {
  return prettyAudioFormat(t.format, t.profile);
}
</script>

<template>
  <div v-if="audio.length || subs.length" class="tracks">
    <!-- ── Audio ────────────────────────────────────────────────────────── -->
    <section v-if="audio.length" class="tracks-block">
      <SectionHead
        :flush="!audioOpen"
        :title="$t('torrents.detail.tracks.audioTitle')"
        :count="audio.length"
        icon="ph:speaker-high-bold"
      >
        <template #action>
          <button
            type="button"
            class="tool-btn tool-btn--sm"
            :aria-expanded="audioOpen"
            :aria-controls="fid('audio')"
            :disabled="audioForced"
            :aria-label="audioOpen
              ? $t('torrents.detail.tracks.collapseAudio')
              : $t('torrents.detail.tracks.expandAudio')"
            @click="toggleAudio()"
          >
            <Icon
              name="ph:caret-down-bold"
              class="tracks-caret"
              :class="{ 'tracks-caret--open': audioOpen }"
              aria-hidden="true"
            />
          </button>
        </template>
      </SectionHead>

      <div v-show="audioOpen" :id="fid('audio')" class="tracks-wrap">
        <table class="tracks-table">
          <caption class="sr-only">{{ $t('torrents.detail.tracks.audioTitle') }}</caption>
          <thead>
            <tr>
              <th scope="col" class="tracks-num">#</th>
              <th scope="col">{{ $t('torrents.detail.tracks.col.language') }}</th>
              <th scope="col">{{ $t('torrents.detail.tracks.col.format') }}</th>
              <th scope="col">{{ $t('torrents.detail.tracks.col.channels') }}</th>
              <th scope="col" class="tracks-num">{{ $t('torrents.detail.tracks.col.bitrate') }}</th>
              <th scope="col">{{ $t('torrents.detail.tracks.col.title') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(t, i) in audio" :key="`a${i}`">
              <td class="tracks-num">{{ i + 1 }}</td>
              <td class="tracks-strong">
                {{ languageName(t.language) }}
                <!-- Conteneur neutre plus un point : un fond teinté par la
                     couleur de son texte perd le contraste en thème clair. -->
                <span v-if="t.isDefault" class="tracks-flag">
                  <span class="tracks-flag-dot tracks-flag-dot--default" aria-hidden="true" />
                  {{ $t('torrents.detail.tracks.flag.default') }}
                </span>
              </td>
              <td class="tracks-strong">{{ audioFormat(t) }}</td>
              <td>{{ t.channels ?? '—' }}</td>
              <td class="tracks-num">{{ formatBitRate(t.bitRate) ?? '—' }}</td>
              <td class="tracks-title">{{ t.title ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- ── Sous-titres ──────────────────────────────────────────────────── -->
    <section v-if="subs.length" class="tracks-block">
      <SectionHead
        :flush="!subsOpen"
        :title="$t('torrents.detail.tracks.subsTitle')"
        :count="subs.length"
        icon="ph:subtitles-bold"
      >
        <template #action>
          <button
            type="button"
            class="tool-btn tool-btn--sm"
            :aria-expanded="subsOpen"
            :aria-controls="fid('subs')"
            :disabled="subsForced"
            :aria-label="subsOpen
              ? $t('torrents.detail.tracks.collapseSubs')
              : $t('torrents.detail.tracks.expandSubs')"
            @click="toggleSubs()"
          >
            <Icon
              name="ph:caret-down-bold"
              class="tracks-caret"
              :class="{ 'tracks-caret--open': subsOpen }"
              aria-hidden="true"
            />
          </button>
        </template>
      </SectionHead>

      <div v-show="subsOpen" :id="fid('subs')" class="tracks-wrap">
        <table class="tracks-table">
          <caption class="sr-only">{{ $t('torrents.detail.tracks.subsTitle') }}</caption>
          <thead>
            <tr>
              <th scope="col" class="tracks-num">#</th>
              <th scope="col">{{ $t('torrents.detail.tracks.col.language') }}</th>
              <th scope="col">{{ $t('torrents.detail.tracks.col.format') }}</th>
              <th scope="col">{{ $t('torrents.detail.tracks.col.kind') }}</th>
              <th scope="col">{{ $t('torrents.detail.tracks.col.title') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(t, i) in subs" :key="`s${i}`">
              <td class="tracks-num">{{ i + 1 }}</td>
              <td class="tracks-strong">
                {{ languageName(t.language) }}
                <span v-if="t.isDefault" class="tracks-flag">
                  <span class="tracks-flag-dot tracks-flag-dot--default" aria-hidden="true" />
                  {{ $t('torrents.detail.tracks.flag.default') }}
                </span>
              </td>
              <td>{{ t.format ?? '—' }}</td>
              <td>
                <span class="tracks-kind">
                  <span
                    class="tracks-flag-dot"
                    :class="`tracks-flag-dot--${subtitleKind(t)}`"
                    aria-hidden="true"
                  />
                  {{ $t(`torrents.detail.tracks.kind.${subtitleKind(t)}`) }}
                </span>
              </td>
              <td class="tracks-title">{{ t.title ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- D'où vient ce tableau. Une donnée analysée depuis un texte libre n'a
         pas la même autorité qu'une colonne, et le lecteur a le droit de le
         savoir. -->
    <p class="tracks-source">
      <Icon name="ph:info-bold" class="tracks-source-icon" aria-hidden="true" />
      {{ source === 'nfo'
        ? $t('torrents.detail.tracks.sourceNfo')
        : $t('torrents.detail.tracks.sourceDescription') }}
    </p>
  </div>
</template>

<style scoped>
.tracks {
  /* La même famille que le NFO — ce que le fichier contient. Voir l'en-tête de
     `NfoPanel.vue` pour la clé complète des quatre familles. */
  --section-tone: var(--accent-cool);
  display: flex;
  flex-direction: column;
  gap: 1.15rem;
}
.tracks-block { display: block; }

.tracks-caret { transition: transform var(--dur-2) var(--ease-standard); }
.tracks-caret--open { transform: rotate(180deg); }

.tracks-wrap {
  overflow-x: auto;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--accent-cool) / 0.22);
  border-radius: var(--radius-md);
}

.tracks-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.75rem;
}
.tracks-table th,
.tracks-table td {
  padding: 0.35rem 0.6rem;
  text-align: left;
  white-space: nowrap;
  border-bottom: 1px solid rgb(var(--line-default));
}
.tracks-table tbody tr:last-child td { border-bottom: 0; }
/* L'en-tête de colonne : voile de la teinte de famille à 16 %, encre NEUTRE.
   `--fg-muted` sur un voile à 16 % de n'importe laquelle des huit teintes, sur
   les trois fonds de carte et dans les deux thèmes, tient 4,84:1 au pire.
   C'est le motif qui rend une table colorée sans toucher à une seule paire
   texte/fond du corps. */
.tracks-table th {
  font-family: var(--font-mono);
  font-size: var(--label-sm, 0.5625rem);
  font-weight: var(--label-weight, 700);
  letter-spacing: var(--label-tracking, calc(0.08em * var(--tracking-scale)));
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  background:
    linear-gradient(rgb(var(--accent-cool) / 0.16), rgb(var(--accent-cool) / 0.16)),
    rgb(var(--bg-inset));
  border-bottom-color: rgb(var(--accent-cool) / 0.28);
}
.tracks-table td {
  color: rgb(var(--fg-muted));
  font-variant-numeric: tabular-nums;
  transition: background-color var(--dur-2) var(--ease-standard);
}
/* Vingt pistes audio se lisent en balayant une ligne : le survol la désigne.
   Voile à 6 % sous encre neutre — `--fg-muted` y tient 6,03:1 en sombre et
   5,96:1 en clair. */
.tracks-table tbody tr:hover td {
  background-color: rgb(var(--accent-cool) / 0.06);
  color: rgb(var(--fg-default));
}
.tracks-strong {
  color: rgb(var(--fg-default));
  font-weight: 600;
}
/* Les débits s'empilent : alignés à droite en chiffres tabulaires, sinon la
   comparaison d'une ligne à l'autre demande de lire au lieu de regarder. */
.tracks-num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.tracks-title {
  max-width: 18rem;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tracks-flag,
.tracks-kind {
  display: inline-flex;
  align-items: center;
  gap: 0.28rem;
  padding: 0.02rem 0.4rem;
  border-radius: var(--radius-pill);
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-inset));
  font-family: var(--font-mono);
  font-size: var(--label-sm, 0.5625rem);
  font-weight: var(--label-weight, 700);
  letter-spacing: var(--label-tracking, calc(0.08em * var(--tracking-scale)));
  text-transform: uppercase;
  color: rgb(var(--fg-default));
  white-space: nowrap;
}
.tracks-flag { margin-left: 0.35rem; }

.tracks-flag-dot {
  flex: none;
  width: 0.35rem;
  height: 0.35rem;
  border-radius: var(--radius-pill);
  background: rgb(var(--fg-faint));
}
.tracks-flag-dot--default { background: rgb(var(--online)); }
.tracks-flag-dot--full { background: rgb(var(--online)); }
.tracks-flag-dot--forced { background: rgb(var(--warning)); }
.tracks-flag-dot--sdh { background: rgb(var(--info)); }

/* La provenance de la table. C'est une note de bas de page, pas un
   avertissement : un filet de la teinte de famille à gauche, un voile très
   faible, et l'encre neutre du texte discret. Elle se lit comme une légende. */
.tracks-source {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  margin: 0;
  padding: 0.45rem 0.6rem;
  background-color: rgb(var(--accent-cool) / 0.06);
  border-left: 2px solid rgb(var(--accent-cool) / 0.45);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  font-size: 0.71875rem;
  line-height: 1.5;
  color: rgb(var(--fg-muted));
}
/* Une classe posée sur l'`<Icon>` plutôt qu'un sélecteur d'élément : le
   composant rend tantôt un `<svg>`, tantôt un `<span>` masqué selon le mode de
   `@nuxt/icon`, et un sélecteur de balise ne toucherait qu'un des deux. */
.tracks-source-icon {
  flex: none;
  margin-top: 0.15rem;
  font-size: 0.85rem;
  color: rgb(var(--accent-cool));
}

@media (max-width: 720px) {
  .tracks-table { font-size: 0.71875rem; }
  .tracks-table th,
  .tracks-table td { padding: 0.3rem 0.45rem; }
  .tracks-title { max-width: 9rem; }
}
</style>
