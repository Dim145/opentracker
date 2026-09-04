<script setup lang="ts">
/**
 * L'unité, nommée puis changée.
 *
 * # Pourquoi la nommer noir sur blanc
 *
 * Le tableau des versions comparait des releases sans jamais dire de QUOI
 * elles étaient les versions, et le résultat était un mensonge mesuré : la
 * fiche de `Cats.Eye.S01` étiquetait `Cats.Eye.S02` « Image max » et `S01`
 * « Léger ». Deux contenus différents présentés comme deux variantes du même.
 *
 * Le correctif tient en deux moitiés. `assignVersionMarkers` suppose que la
 * liste qu'on lui donne EST une unité ; cette barre est l'autre moitié : elle
 * écrit l'unité en clair — `Épisode  Épisode 09   Saison  Saison 01` — pour
 * que le lecteur sache sur quoi porte la comparaison AVANT de lire une ligne.
 * Sans elle, borner l'unité serait devenu invisible, donc indistinguable de
 * l'ancien comportement.
 *
 * Une paire libellé/valeur, pas une phrase : c'est une `<dl>`, ce que c'est
 * réellement, et un lecteur d'écran l'annonce comme telle.
 *
 * # Pourquoi un dépli et non trois listes déroulantes
 *
 * Changer d'unité est rare — on arrive sur la fiche de l'épisode qu'on veut.
 * Trois `<select>` en permanence coûteraient trois contrôles et une hauteur
 * fixe à chaque visite pour un geste que la plupart ne font jamais. Le dépli
 * met la navigation à un clic et zéro pixel le reste du temps.
 *
 * Une fois ouvert, les trois étages sont ceux de l'API — la portée, les
 * saisons, les épisodes d'UNE saison — dans cet ordre, parce que c'est
 * l'ordre dans lequel ils se contraignent : la portée décide s'il y a des
 * saisons, la saison décide quels épisodes existent.
 *
 * # Le vocabulaire est celui de la page de groupe, pas une deuxième copie
 *
 * Les libellés de portée passent par `scopeLabelKey` et les clés
 * `search.group.*` que `/torrents/group/[...key].vue` utilise déjà. Ses
 * pastilles ne sont PAS extraites ici : elles sont peintes avec un violet
 * littéral (`rgb(167 139 250 / .18)`), hors jetons de thème. Les extraire
 * telles quelles importerait la violation dans un fichier neuf, les
 * normaliser changerait le rendu de la page de groupe — et c'était la
 * condition. Ce qui est partagé est donc ce qui compte : le type `GroupScope`,
 * `ScopeSummary` et les traductions.
 */
import { scopeLabelKey, type GroupScope, type ScopeSummary } from '~/utils/groupScopes';

/** Un seau de saison, tel que `/api/torrents/group` le renvoie. */
export interface SeasonBucket {
  season: number | null;
  releaseCount: number;
  episodeCount: number;
  seeders: number;
  resolutions: string[];
}

/**
 * Un seau d'épisode. Son `season` arrive à `null` et c'est VOULU côté API
 * (`mixedBuckets`, `by: 'episode'` émet `NULL::smallint AS season`) : la
 * réponse porte « les épisodes d'UNE saison », et cette saison est ailleurs,
 * dans `openSeason`. Le champ n'est donc pas lu ici.
 */
export interface EpisodeBucket {
  episode: number | null;
  releaseCount: number;
  seeders: number;
  resolutions: string[];
}

const props = withDefaults(
  defineProps<{
    /** La portée ouverte, telle que la réponse l'a renvoyée. */
    scope: GroupScope;
    /** Les découpes que l'œuvre possède réellement. Une seule : pas de choix. */
    scopes: readonly ScopeSummary[];
    seasons: readonly SeasonBucket[];
    openSeason: number | null;
    episodes: readonly EpisodeBucket[];
    openEpisode: number | null;
    /** L'API plafonne à 300 épisodes ; au-delà elle le dit et on le répète. */
    episodesTruncated?: boolean;
    /**
     * L'unité de la release affichée. Le retour arrière : une fois qu'on est
     * parti voir l'épisode 10, plus rien ne ramène à celui de la page.
     */
    homeScope: GroupScope;
    homeSeason: number | null;
    homeEpisode: number | null;
    /**
     * Une requête est en vol. Les pastilles restent CLIQUABLES : les
     * désactiver le temps du vol arrache le focus du clavier à celle qu'on
     * vient d'activer, et un deuxième clic ne coûte qu'une requête de plus —
     * la clé change, `useFetch` recharge, la dernière réponse gagne.
     */
    pending?: boolean;
  }>(),
  { episodesTruncated: false, pending: false },
);

const emit = defineEmits<{
  /** La portée ET l'unité changent ensemble : une saison n'existe pas partout. */
  pick: [{ scope: GroupScope; season: number | null; episode: number | null }];
}>();

const { t } = useI18n();

const open = ref(false);

/** Deux découpes ou plus, ou une autre unité dans celle-ci : il y a un choix. */
const navigable = computed(
  () =>
    props.scopes.length > 1 ||
    props.seasons.length > 1 ||
    props.episodes.length > 1,
);

/** `9` → `09`. Un `E9` au milieu d'une colonne de `E10` casse l'alignement. */
function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function seasonLabel(season: number | null): string {
  return season === null
    ? t('search.group.seasonUnknown')
    : t('search.group.season', { n: pad(season) });
}

/**
 * Le nom accessible d'une pastille d'épisode.
 *
 * `E09` suivi d'un `4` nu s'annonce « E zéro neuf quatre », ce qui ne dit ni
 * « épisode » ni « releases ». Les deux clés sont recomposées ici plutôt que
 * dupliquées en une troisième chaîne à traduire.
 */
function episodeAria(e: EpisodeBucket): string | undefined {
  if (e.episode === null) return undefined;
  const unit = t('torrents.detail.versions.unit.episodeValue', {
    n: pad(e.episode),
  });
  return `${unit} — ${t('search.group.nReleases', e.releaseCount)}`;
}

/**
 * L'unité, en paires. Ce que la barre affiche en permanence.
 *
 * L'ordre est celui du tracker de référence — l'épisode d'abord, la saison
 * ensuite — parce que l'épisode est ce qu'on est venu chercher et la saison
 * seulement où il se trouve.
 */
const pairs = computed<{ key: string; label: string; value: string }[]>(() => {
  const out: { key: string; label: string; value: string }[] = [];
  if (props.scope === 'episode') {
    out.push({
      key: 'episode',
      label: t('torrents.detail.versions.unit.episodeLabel'),
      value:
        props.openEpisode === null
          ? '—'
          : t('torrents.detail.versions.unit.episodeValue', {
              n: pad(props.openEpisode),
            }),
    });
  }
  if (props.scope === 'episode' || props.scope === 'season') {
    out.push({
      key: 'season',
      label: t('torrents.detail.versions.unit.seasonLabel'),
      value: seasonLabel(props.openSeason),
    });
  }
  if (props.scope === 'integral') {
    out.push({
      key: 'integral',
      label: t('torrents.detail.versions.unit.cutLabel'),
      value: t('torrents.detail.versions.unit.integral'),
    });
  }
  if (props.scope === 'all') {
    out.push({
      key: 'all',
      label: t('torrents.detail.versions.unit.cutLabel'),
      value: t('torrents.detail.versions.unit.whole'),
    });
  }
  return out;
});

/** La portée d'une pastille : nouvelle découpe, unité laissée au serveur. */
function pickScope(scope: GroupScope) {
  if (scope === props.scope) return;
  // Revenir sur sa propre découpe, c'est revenir à sa propre unité — sinon le
  // serveur ouvre le seau le plus récent, qui n'est pas celui de la page.
  if (scope === props.homeScope) {
    emit('pick', {
      scope,
      season: props.homeSeason,
      episode: props.homeEpisode,
    });
    return;
  }
  emit('pick', { scope, season: null, episode: null });
}

/** Changer de saison remet l'épisode au choix du serveur : le plus récent. */
function pickSeason(season: number | null) {
  if (season === props.openSeason) return;
  emit('pick', { scope: props.scope, season, episode: null });
}

function pickEpisode(episode: number | null) {
  if (episode === props.openEpisode) return;
  emit('pick', { scope: props.scope, season: props.openSeason, episode });
}

/** Le retour arrière ne s'affiche que quand on en est réellement parti. */
const away = computed(
  () =>
    props.scope !== props.homeScope ||
    (props.scope !== 'all' &&
      props.scope !== 'integral' &&
      props.openSeason !== props.homeSeason) ||
    (props.scope === 'episode' && props.openEpisode !== props.homeEpisode),
);

function goHome() {
  emit('pick', {
    scope: props.homeScope,
    season: props.homeSeason,
    episode: props.homeEpisode,
  });
}
</script>

<template>
  <div class="unit" :data-pending="pending ? 'true' : 'false'">
    <div class="unit-bar">
      <dl class="unit-pairs">
        <template v-for="p in pairs" :key="p.key">
          <dt class="unit-key">{{ p.label }}</dt>
          <dd class="unit-val">{{ p.value }}</dd>
        </template>
      </dl>

      <button
        v-if="navigable"
        type="button"
        class="unit-toggle"
        :aria-expanded="open"
        @click="open = !open"
      >
        <span>{{ $t('torrents.detail.versions.unit.change') }}</span>
        <Icon
          :name="open ? 'ph:caret-up-bold' : 'ph:caret-down-bold'"
          aria-hidden="true"
        />
      </button>
    </div>

    <div v-if="open && navigable" class="unit-panel">
      <!-- La portée d'abord : c'est elle qui décide s'il y a des saisons. -->
      <div v-if="scopes.length > 1" class="unit-row">
        <span class="unit-row-key">{{ $t('torrents.detail.versions.unit.scopeRow') }}</span>
        <div class="unit-chips">
          <button
            v-for="s in scopes"
            :key="s.scope"
            type="button"
            class="unit-chip"
            :aria-pressed="s.scope === scope"
            @click="pickScope(s.scope)"
          >
            {{ $t(scopeLabelKey(s.scope), { n: s.units }) }}
          </button>
        </div>
      </div>

      <div v-if="seasons.length > 1" class="unit-row">
        <span class="unit-row-key">{{ $t('torrents.detail.versions.unit.seasonRow') }}</span>
        <div class="unit-chips">
          <button
            v-for="s in seasons"
            :key="s.season ?? 'none'"
            type="button"
            class="unit-chip"
            :aria-pressed="s.season === openSeason"
            @click="pickSeason(s.season)"
          >
            {{ seasonLabel(s.season) }}
            <!-- Ce que le seau contient, pour ne pas avoir à l'ouvrir : des
                 épisodes quand la découpe en a, des releases sinon. -->
            <span class="unit-chip-n">{{
              scope === 'episode'
                ? $t('search.group.nEpisodes', s.episodeCount)
                : $t('search.group.nReleases', s.releaseCount)
            }}</span>
          </button>
        </div>
      </div>

      <div v-if="episodes.length > 1" class="unit-row">
        <span class="unit-row-key">{{ $t('torrents.detail.versions.unit.episodeRow') }}</span>
        <div class="unit-chips">
          <button
            v-for="e in episodes"
            :key="e.episode ?? 'none'"
            type="button"
            class="unit-chip unit-chip--ep"
            :aria-pressed="e.episode === openEpisode"
            :aria-label="episodeAria(e)"
            @click="pickEpisode(e.episode)"
          >
            {{ e.episode === null ? '—' : `E${pad(e.episode)}` }}
            <span class="unit-chip-n">{{ e.releaseCount }}</span>
          </button>
        </div>
      </div>

      <p v-if="episodesTruncated" class="unit-note">
        {{ $t('search.group.episodesTruncated') }}
      </p>

      <p class="unit-note">
        {{ $t('torrents.detail.versions.unit.hint') }}
        <button v-if="away" type="button" class="unit-home" @click="goHome">
          {{ $t('torrents.detail.versions.unit.backHere') }}
        </button>
      </p>
    </div>
  </div>
</template>

<style scoped>
.unit {
  /* La teinte de la barre. Locale : la portée n'est pas la teinte de la
     section, qui appartient à l'en-tête. */
  --unit-tone: var(--accent-cool);
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  background-color: rgb(var(--bg-inset));
}
.unit[data-pending='true'] .unit-val,
.unit[data-pending='true'] .unit-chip-n { opacity: 0.55; }

.unit-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.35rem 1rem;
  padding: 0.4rem 0.7rem;
}

/*
 * Les paires. Une `<dl>` en grille à deux rangs : les libellés au-dessus des
 * valeurs serait l'autre choix, mais la barre ferait deux fois la hauteur pour
 * la même information — et elle est là en permanence.
 */
.unit-pairs {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.15rem 0.85rem;
  margin: 0;
  min-width: 0;
}
.unit-key {
  font-family: var(--font-mono);
  font-size: var(--label-sm, 0.5625rem);
  font-weight: var(--label-weight, 700);
  letter-spacing: var(--label-tracking-wide, calc(0.16em * var(--tracking-scale)));
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.unit-val {
  margin: 0 0.5rem 0 0.3rem;
  font-size: 0.8125rem;
  font-weight: 700;
  color: rgb(var(--fg-strong));
  white-space: nowrap;
}
/* La dernière valeur n'a pas de voisine à écarter. */
.unit-val:last-child { margin-right: 0; }

.unit-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  margin-left: auto;
  min-height: 1.75rem;
  padding: 0 0.5rem;
  font-family: var(--font-mono);
  font-size: var(--label-md, 0.625rem);
  font-weight: var(--label-weight, 700);
  letter-spacing: var(--label-tracking, calc(0.08em * var(--tracking-scale)));
  text-transform: uppercase;
  white-space: nowrap;
  color: rgb(var(--fg-muted));
  background: transparent;
  border: 1px solid rgb(var(--line-strong));
  border-radius: var(--radius-xs);
  cursor: pointer;
  transition:
    color var(--dur-1) var(--ease-standard),
    border-color var(--dur-1) var(--ease-standard);
}
.unit-toggle:hover {
  color: rgb(var(--fg-default));
  border-color: rgb(var(--unit-tone));
}

.unit-panel {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 0.55rem 0.7rem 0.6rem;
  border-top: 1px solid rgb(var(--line-default));
}

/* Le libellé d'étage à largeur FIXE : les trois rangées de pastilles
   commencent au même `x`, sinon les trois étages se lisent comme trois
   listes sans rapport. */
.unit-row {
  display: grid;
  grid-template-columns: 4.5rem minmax(0, 1fr);
  align-items: start;
  gap: 0.5rem;
}
.unit-row-key {
  padding-top: 0.25rem;
  font-family: var(--font-mono);
  font-size: var(--label-sm, 0.5625rem);
  font-weight: var(--label-weight, 700);
  letter-spacing: var(--label-tracking-wide, calc(0.16em * var(--tracking-scale)));
  text-transform: uppercase;
  color: rgb(var(--fg-faint));
}
.unit-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  min-width: 0;
}

/*
 * La pastille active prend la paire pleine `--accent-warm` /
 * `--accent-warm-fg`. `--accent-warm-text` posé sur un voile de la même
 * teinte tombe sous 4,5:1 en thème clair, et c'est mesuré — le même arbitrage
 * que le repère de version juste en dessous.
 */
.unit-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 1.6rem;
  padding: 0 0.45rem;
  font-size: 0.6875rem;
  font-weight: 600;
  white-space: nowrap;
  color: rgb(var(--fg-muted));
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-strong));
  border-radius: var(--radius-xs);
  cursor: pointer;
  transition:
    color var(--dur-1) var(--ease-standard),
    border-color var(--dur-1) var(--ease-standard),
    background-color var(--dur-1) var(--ease-standard);
}
.unit-chip:hover {
  color: rgb(var(--fg-default));
  border-color: rgb(var(--unit-tone));
}
.unit-chip[aria-pressed='true'] {
  background-color: rgb(var(--accent-warm));
  border-color: rgb(var(--accent-warm));
  color: rgb(var(--accent-warm-fg));
}
.unit-chip--ep {
  font-family: var(--font-mono);
  /* `E09` et `E10` côte à côte : sans chiffres tabulaires la colonne de
     pastilles ondule. */
  font-variant-numeric: tabular-nums;
}
.unit-chip-n {
  font-family: var(--font-mono);
  font-size: 0.5625rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  opacity: 0.75;
}

.unit-note {
  margin: 0;
  font-size: 0.65625rem;
  line-height: 1.55;
  color: rgb(var(--fg-faint));
}
.unit-home {
  padding: 0;
  font-size: inherit;
  font-weight: 700;
  color: rgb(var(--accent));
  background: none;
  border: 0;
  cursor: pointer;
  text-decoration: underline;
}
.unit-home:hover { color: rgb(var(--accent-hover)); }

@media (max-width: 720px) {
  /* Sous 720 px le libellé d'étage mangerait un tiers de la largeur des
     pastilles ; il passe au-dessus. */
  .unit-row {
    grid-template-columns: minmax(0, 1fr);
    gap: 0.2rem;
  }
  .unit-row-key { padding-top: 0; }
  .unit-chip { min-height: 2rem; }
  .unit-toggle { min-height: 2rem; }
}
</style>
