<script setup lang="ts">
/**
 * La vue Œuvres : une carte par œuvre, ses releases dépliées dedans.
 *
 * La carte ENTIÈRE ouvre : un clic sur l'en-tête, ou le chevron au bout de la
 * ligne, déplie l'œuvre sur la découpe du premier torrent du tri. Les pastilles
 * de découpe (épisode, saison, intégrale) ne sont plus la seule porte : elles
 * choisissent ce qu'on regarde, ouverte ou fermée.
 *
 * Dedans, la structure se lit avant les fichiers, comme sur la page d'un
 * groupe : saisons, puis épisodes avec leur compte, leurs résolutions et leurs
 * seeders, et les releases sous l'épisode qu'on déplie. La saison la plus
 * récente et son premier épisode sont ouverts d'office ; le reste attend un
 * clic. Les lignes sont celles de la vue Releases, en variante compacte.
 */
import { formatAge, formatDate, formatSize } from '~/utils/format';
import { kindOfSlug } from '~/utils/searchTokens';
import { scopeLabelKey, type GroupScope, type ScopeSummary } from '~/utils/groupScopes';
import { homeScope as homeScopeOf, scopesOf as scopesOfList, unitsOf as splitUnits, type Unit as StructUnit } from '~/utils/workUnits';
import type { CatalogueRow } from './ReleaseRows.vue';

export interface WorkGroup {
  key: string;
  source: 'tmdb' | 'igdb' | 'openlibrary' | 'solo';
  externalId: string;
  releaseCount: number;
  latest: string;
  leadName: string;
  categoryIds?: string[];
  minSize?: number;
  maxSize?: number;
  seedTotal?: number;
  seedMax?: number;
  leechTotal?: number;
  partnerCount?: number;
  peerCount?: number;
  scopes?: ScopeSummary[];
  defaultScope?: GroupScope;
  firstScope?: GroupScope;
  work?: { title: string; year: number | null; posterUrl: string | null; type: string | null; tint?: string | null } | null;
  tagSlugs?: string[];
}

const props = withDefaults(
  defineProps<{
    groups: WorkGroup[];
    categoryLabel: (ids: string[]) => string | null;
    dense?: boolean;
    /** Les filtres de la page, pour que les releases dépliées y obéissent aussi. */
    filterQuery?: Record<string, string | number | undefined>;
    /** Le tri de la page : les releases dépliées le suivent. */
    sortBy?: string;
    order?: 'asc' | 'desc';
  }>(),
  { dense: false, filterQuery: () => ({}), sortBy: 'age', order: 'desc' },
);

const { t } = useI18n();

const titleOf = (g: WorkGroup) => g.work?.title || g.leadName;
const pageHref = (g: WorkGroup) => `/torrents/group/${g.key}`;
const largePoster = (g: WorkGroup) => g.work?.posterUrl?.replace('/w342/', '/w500/') ?? null;

function kindIcon(g: WorkGroup): string {
  if (g.source === 'igdb') return 'ph:game-controller-bold';
  if (g.source === 'openlibrary') return 'ph:book-open-bold';
  if (g.externalId.startsWith('tv/')) return 'ph:television-bold';
  if (g.externalId.startsWith('movie/')) return 'ph:film-slate-bold';
  return 'ph:package-bold';
}

/* ── Sans affiche : un monogramme, pas une tuile grise ─────────────────────── */
const initialOf = (g: WorkGroup) => {
  const m = titleOf(g).match(/\p{L}|\p{N}/u);
  return (m?.[0] ?? '·').toUpperCase();
};
function monoHue(g: WorkGroup): number {
  const seed = props.categoryLabel(g.categoryIds ?? []) ?? g.source;
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
function cardStyle(g: WorkGroup, index: number): Record<string, string> {
  const style: Record<string, string> = { '--i': String(Math.min(index % 20, 12)) };
  if (g.work?.tint) style['--work-tint'] = g.work.tint;
  return style;
}

/* ── L'échelle des qualités : ce qui existe, résolutions puis sources ─────── */
const resolutionRank = (slug: string) => {
  const m = slug.match(/(\d{3,4})[pi]/);
  if (m) return Number(m[1]);
  if (slug === '8k') return 4320;
  if (slug === '4k' || slug === 'uhd') return 2160;
  return 0;
};
function ladder(g: WorkGroup): { resolutions: string[]; sources: string[] } {
  const res: string[] = [];
  const src: string[] = [];
  for (const slug of g.tagSlugs ?? []) {
    const kind = kindOfSlug(slug);
    if (kind === 'resolution') res.push(slug);
    else if (kind === 'source') src.push(slug);
  }
  return {
    resolutions: Array.from(new Set(res)).sort((a, b) => resolutionRank(b) - resolutionRank(a)).slice(0, 4),
    sources: Array.from(new Set(src)).slice(0, 4),
  };
}

type SwarmState = 'dead' | 'thin' | 'ok' | 'hot';
function swarmState(g: WorkGroup): SwarmState {
  const s = g.seedTotal ?? g.seedMax ?? 0;
  if (s === 0) return 'dead';
  if (s < 3) return 'thin';
  if (s >= 20) return 'hot';
  return 'ok';
}
function sizeRange(g: WorkGroup): string {
  if (!g.minSize && !g.maxSize) return '';
  const a = formatSize(g.minSize ?? 0);
  const b = formatSize(g.maxSize ?? 0);
  return a === b ? a : `${a} – ${b}`;
}
function meta(g: WorkGroup): string {
  const parts: string[] = [];
  const cat = props.categoryLabel(g.categoryIds ?? []);
  if (cat) parts.push(cat);
  parts.push(t('search.works.releases', g.releaseCount));
  if (g.partnerCount) parts.push(t('search.works.partners', { n: g.partnerCount }));
  return parts.join(' · ');
}

/* ── Les découpes ─────────────────────────────────────────────────────────── */
const scopesOf = (g: WorkGroup): ScopeSummary[] => scopesOfList(g.scopes);
function scopeLabel(s: ScopeSummary): string {
  return s.scope === 'all' ? t('search.group.scope.all', s.units) : t(scopeLabelKey(s.scope), { n: s.units });
}
const homeScope = (g: WorkGroup): GroupScope => homeScopeOf(g);
const chosen = ref(new Map<string, GroupScope>());
const scopeOf = (g: WorkGroup) => chosen.value.get(g.key) ?? homeScope(g);

/* ── Le dépliage : une requête par carte et par découpe ───────────────────── */
interface Unit {
  key: string;
  kind: StructUnit<CatalogueRow>['kind'];
  season: number | null;
  episode: number | null;
  label: string | null;
  order: number;
  rows: CatalogueRow[];
  seeders: number;
  resolutions: string[];
}
/** Un bloc de saison (en découpe « épisode ») : ses épisodes, son total. */
interface SeasonBlock {
  key: string;
  season: number | null;
  label: string | null;
  units: Unit[];
  seeders: number;
}
type Body =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'ready'; blocks: SeasonBlock[]; total: number };
const open = ref(new Set<string>());
const bodies = ref(new Map<string, Body>());
const openUnits = ref(new Map<string, Set<string>>());
const openSeasons = ref(new Map<string, Set<string>>());
const pad = (n: number) => String(n).padStart(2, '0');
const bodyKey = (g: WorkGroup, scope: GroupScope) => `${g.key}|${scope}`;

function unitLabel(u: StructUnit<CatalogueRow>): string | null {
  if (u.kind === 'episode') return t('search.works.unit.episodeShort', { e: pad(u.episode ?? 0) });
  if (u.kind === 'season') return t('search.works.unit.season', { s: pad(u.season ?? 0) });
  if (u.kind === 'integral') return t('search.works.unit.integral');
  return null;
}
function decorate(u: StructUnit<CatalogueRow>): Unit {
  const res = new Set<string>();
  let seeders = 0;
  for (const r of u.rows) {
    seeders += r.stats?.seeders ?? 0;
    for (const tg of r.tags ?? []) if (kindOfSlug(tg.slug) === 'resolution') res.add(tg.slug);
  }
  return {
    key: u.key,
    kind: u.kind,
    season: u.season,
    episode: u.episode,
    label: unitLabel(u),
    order: u.order,
    rows: u.rows,
    seeders,
    resolutions: Array.from(res).sort((a, b) => resolutionRank(b) - resolutionRank(a)),
  };
}
/**
 * Les blocs : en découpe « épisode », une saison par bloc avec ses épisodes ;
 * sinon un bloc unique sans en-tête. Le premier bloc et sa première unité
 * s'ouvrent d'office.
 */
function blocksOf(rows: CatalogueRow[], scope: GroupScope): SeasonBlock[] {
  const units = splitUnits(rows, scope).map(decorate);
  if (scope !== 'episode') {
    return [{ key: 'all', season: null, label: null, units, seeders: units.reduce((a, u) => a + u.seeders, 0) }];
  }
  const map = new Map<string, SeasonBlock>();
  for (const u of units) {
    const k = `s${u.season ?? 'x'}`;
    const b = map.get(k) ?? {
      key: k,
      season: u.season,
      label: u.season === null ? t('search.group.seasonUnknown') : t('search.works.unit.season', { s: pad(u.season) }),
      units: [],
      seeders: 0,
    };
    b.units.push(u);
    b.seeders += u.seeders;
    map.set(k, b);
  }
  return Array.from(map.values()).sort((a, b) => (b.season ?? -1) - (a.season ?? -1));
}

async function load(g: WorkGroup, scope: GroupScope) {
  const k = bodyKey(g, scope);
  bodies.value.set(k, { state: 'loading' });
  try {
    const res = await $fetch<{ data: CatalogueRow[]; pagination: { total: number } }>('/api/torrents', {
      query: { ...props.filterQuery, groupKey: g.key, groupScope: scope, limit: 60, sortBy: props.sortBy, order: props.order, page: 1 },
    });
    const blocks = blocksOf(res.data, scope);
    bodies.value.set(k, { state: 'ready', blocks, total: res.pagination.total });
    // Ouverts d'office : le premier bloc, et sa première unité.
    openSeasons.value.set(k, new Set(blocks[0] ? [blocks[0].key] : []));
    openUnits.value.set(k, new Set(blocks[0]?.units[0] ? [blocks[0].units[0].key] : []));
  } catch {
    bodies.value.set(k, { state: 'error' });
  }
}

const isOpen = (g: WorkGroup) => open.value.has(g.key);
const bodyOf = (g: WorkGroup) => bodies.value.get(bodyKey(g, scopeOf(g)));
const bodyId = (g: WorkGroup) => `work-body-${g.key.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

function openOn(g: WorkGroup, scope: GroupScope) {
  chosen.value.set(g.key, scope);
  const next = new Set(open.value);
  next.add(g.key);
  open.value = next;
  if (!bodies.value.has(bodyKey(g, scope))) void load(g, scope);
}
function fold(g: WorkGroup) {
  const next = new Set(open.value);
  next.delete(g.key);
  open.value = next;
}
/** L'en-tête entier : un clic ouvre (sur la découpe maison) ou replie. Les liens et boutons gardent le leur. */
function onHeaderClick(e: MouseEvent, g: WorkGroup) {
  if ((e.target as HTMLElement | null)?.closest('a, button')) return;
  if (isOpen(g)) fold(g);
  else openOn(g, scopeOf(g));
}
function toggle(g: WorkGroup) {
  if (isOpen(g)) fold(g);
  else openOn(g, scopeOf(g));
}
/** Une pastille : ouvre sur cette découpe ; celle déjà ouverte replie. */
function pickScope(g: WorkGroup, scope: GroupScope) {
  if (isOpen(g) && scopeOf(g) === scope) {
    fold(g);
    return;
  }
  openOn(g, scope);
}
const unitOpen = (g: WorkGroup, u: Unit) => openUnits.value.get(bodyKey(g, scopeOf(g)))?.has(u.key) ?? false;
function toggleUnit(g: WorkGroup, u: Unit) {
  const k = bodyKey(g, scopeOf(g));
  const set = new Set(openUnits.value.get(k) ?? []);
  if (set.has(u.key)) set.delete(u.key);
  else set.add(u.key);
  openUnits.value.set(k, set);
}
const seasonOpen = (g: WorkGroup, b: SeasonBlock) => openSeasons.value.get(bodyKey(g, scopeOf(g)))?.has(b.key) ?? false;
function toggleSeason(g: WorkGroup, b: SeasonBlock) {
  const k = bodyKey(g, scopeOf(g));
  const set = new Set(openSeasons.value.get(k) ?? []);
  if (set.has(b.key)) set.delete(b.key);
  else set.add(b.key);
  openSeasons.value.set(k, set);
}

// Les filtres ou le tri changent : ce qui était déplié se recharge.
watch(
  () => JSON.stringify([props.filterQuery, props.sortBy, props.order]),
  () => {
    bodies.value = new Map();
    for (const g of props.groups) if (open.value.has(g.key)) void load(g, scopeOf(g));
  },
);
</script>

<template>
  <ul class="works" :class="{ 'works--dense': dense }">
    <li
      v-for="(g, i) in groups"
      :key="g.key"
      class="work"
      :class="{ 'work--open': isOpen(g), 'work--tinted': !!g.work?.tint }"
      :data-state="swarmState(g)"
      :style="cardStyle(g, i)"
    >
      <!-- L'en-tête est la porte : tout clic hors lien et bouton ouvre ou replie. -->
      <div class="w-row" @click="onHeaderClick($event, g)">
        <TorrentPosterHover
          v-if="g.work?.posterUrl"
          class="w-poster"
          :src="g.work.posterUrl"
          :large="largePoster(g)"
          :alt="titleOf(g)"
          :fallback-icon="kindIcon(g)"
        />
        <NuxtLink
          v-else
          class="w-poster w-mono"
          :to="pageHref(g)"
          :style="{ '--mono-hue': monoHue(g) }"
          :aria-label="titleOf(g)"
        >
          <span class="w-mono-letter" aria-hidden="true">{{ initialOf(g) }}</span>
          <Icon :name="kindIcon(g)" class="w-mono-kind" aria-hidden="true" />
        </NuxtLink>

        <div class="w-main">
          <div class="w-l1">
            <NuxtLink class="w-title" :class="{ 'w-title--plain': !g.work?.title }" :to="pageHref(g)">
              {{ titleOf(g) }}
            </NuxtLink>
            <span v-if="g.work?.year" class="w-year">{{ g.work.year }}</span>
          </div>
          <div class="w-l2">
            <span class="w-meta">{{ meta(g) }}</span>
            <span v-if="ladder(g).resolutions.length || ladder(g).sources.length" class="w-ladder">
              <span v-for="r in ladder(g).resolutions" :key="`r-${r}`" class="lad lad--res">{{ r }}</span>
              <span v-for="s in ladder(g).sources" :key="`s-${s}`" class="lad">{{ s }}</span>
            </span>
            <!-- Les découpes : un choix, pas la seule porte. Une seule découpe : rien à choisir. -->
            <span v-if="scopesOf(g).length > 1" class="w-scopes" role="group" :aria-label="t('search.works.scopeRow')">
              <button
                v-for="s in scopesOf(g)"
                :key="s.scope"
                type="button"
                class="w-scope"
                :class="{ 'w-scope--on': isOpen(g) && scopeOf(g) === s.scope }"
                :aria-pressed="isOpen(g) && scopeOf(g) === s.scope"
                @click="pickScope(g, s.scope)"
              >
                {{ scopeLabel(s) }}
              </button>
            </span>
          </div>
        </div>

        <!-- Les chiffres, comme sur la page d'un groupe : seeders, puis taille et âge empilés. -->
        <div class="w-figures">
          <span class="w-fig w-fig--seed">
            <span class="sr-only">{{ t('search.rows.swarm.label') }}</span>
            <span class="w-pip" aria-hidden="true" />{{ g.seedTotal ?? 0 }}
          </span>
          <span class="w-fig-stack">
            <span v-if="sizeRange(g)" class="w-fig w-fig--size">
              <span class="sr-only">{{ t('search.rows.size') }}</span>{{ sizeRange(g) }}
            </span>
            <time class="w-fig w-fig--age" :datetime="g.latest" :title="formatDate(g.latest)">
              <span class="sr-only">{{ t('search.rows.age') }}</span>{{ formatAge(g.latest) }}
            </time>
          </span>
        </div>
        <button
          type="button"
          class="w-toggle"
          :aria-expanded="isOpen(g)"
          :aria-controls="isOpen(g) ? bodyId(g) : undefined"
          :aria-label="isOpen(g) ? t('search.works.close') : t('search.works.open')"
          @click="toggle(g)"
        >
          <Icon name="ph:caret-down-bold" class="w-toggle-car" aria-hidden="true" />
        </button>
      </div>

      <div v-if="isOpen(g)" :id="bodyId(g)" class="w-body">
        <p v-if="!bodyOf(g) || bodyOf(g)!.state === 'loading'" class="w-note">
          <Icon name="ph:circle-notch" class="animate-spin" aria-hidden="true" />
          {{ t('search.works.loading') }}
        </p>
        <p v-else-if="bodyOf(g)!.state === 'error'" class="w-note w-note--err">{{ t('search.works.error') }}</p>
        <template v-else-if="bodyOf(g)!.state === 'ready'">
          <p v-if="(bodyOf(g) as { blocks: SeasonBlock[] }).blocks.length === 0" class="w-note">{{ t('search.works.empty') }}</p>
          <div v-for="b in (bodyOf(g) as { blocks: SeasonBlock[] }).blocks" :key="b.key" class="w-season" :class="{ 'w-season--open': seasonOpen(g, b) }">
            <!-- Une saison : en-tête repliable, comme sur la page du groupe. -->
            <button v-if="b.label" type="button" class="w-season-h" :aria-expanded="seasonOpen(g, b)" @click="toggleSeason(g, b)">
              <span class="w-season-name">{{ b.label }}</span>
              <span class="w-season-n">{{ t('search.works.episodes', b.units.length) }}</span>
              <span class="w-season-seed" :class="{ 'is-live': b.seeders > 0 }">
                <Icon name="ph:arrow-up-bold" aria-hidden="true" />{{ b.seeders }}
              </span>
              <Icon name="ph:caret-down-bold" class="w-car" aria-hidden="true" />
            </button>
            <div v-show="!b.label || seasonOpen(g, b)" class="w-units">
              <div v-for="u in b.units" :key="u.key" class="unit" :class="{ 'unit--open': unitOpen(g, u) }">
                <!-- Un épisode, une saison, l'intégrale : ce qu'il contient avant de l'ouvrir. -->
                <button v-if="u.label" type="button" class="unit-h" :aria-expanded="unitOpen(g, u)" @click="toggleUnit(g, u)">
                  <span class="unit-name">{{ u.label }}</span>
                  <span class="unit-n">{{ t('search.works.releases', u.rows.length) }}</span>
                  <span class="unit-res">
                    <span v-for="r in u.resolutions" :key="r" class="unit-r">{{ r }}</span>
                  </span>
                  <span class="unit-seed" :class="{ 'is-live': u.seeders > 0 }">
                    <Icon name="ph:arrow-up-bold" aria-hidden="true" />{{ u.seeders }}
                  </span>
                  <Icon name="ph:caret-down-bold" class="w-car" aria-hidden="true" />
                </button>
                <div v-show="!u.label || unitOpen(g, u)" class="unit-rows">
                  <SearchReleaseRows :torrents="u.rows" :dense="dense" :show-header="false" nested />
                </div>
              </div>
            </div>
          </div>
          <div class="w-foot">
            <button type="button" class="w-fold" @click="fold(g)">
              <Icon name="ph:caret-up-bold" aria-hidden="true" />
              {{ t('search.works.close') }}
            </button>
            <NuxtLink class="w-all" :to="pageHref(g)">
              {{ t('search.works.openPage') }}
              <Icon name="ph:arrow-right-bold" aria-hidden="true" />
            </NuxtLink>
          </div>
        </template>
      </div>
    </li>
  </ul>
</template>

<style scoped>
/*
 * L'échelle : 10 · 11 · 12 · 13 · 14 · 16 · 20 · 26 px, et rien entre deux.
 * Le mono capitales est réservé aux repères (unités, saisons) ; la ligne méta
 * est en texte courant, bas de casse.
 */
.works {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.5rem;
}
.work {
  position: relative;
  overflow: hidden;
  border: 1px solid rgb(var(--line-default) / 1);
  border-radius: var(--radius-lg);
  background: rgb(var(--bg-surface) / 1);
  transition:
    border-color var(--dur-2) var(--ease-standard),
    box-shadow var(--dur-2) var(--ease-standard);
  animation: work-in var(--dur-4) var(--ease-emphasis) both;
  animation-delay: calc(var(--i, 0) * 30ms);
}
@keyframes work-in {
  from {
    opacity: 0;
    transform: translateY(0.4rem);
  }
}
.work:hover {
  border-color: rgb(var(--line-strong) / 1);
  box-shadow: 0 14px 28px -20px rgb(var(--shadow-color) / var(--shadow-strength));
}
.work--open {
  border-color: rgb(var(--line-strong) / 1);
}
.work::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: rgb(var(--fg-faint) / 0.6);
}
.work[data-state='hot']::before,
.work[data-state='ok']::before {
  background: linear-gradient(rgb(var(--online) / 0.9), rgb(var(--online) / 0.25));
}
.work[data-state='thin']::before {
  background: linear-gradient(rgb(var(--warning) / 0.9), rgb(var(--warning) / 0.25));
}
.work[data-state='dead']::before {
  background: rgb(var(--danger) / 0.5);
}
.work.work--tinted::before {
  background: linear-gradient(rgb(var(--work-tint) / 0.85), rgb(var(--work-tint) / 0.25));
}
.work.work--tinted {
  background:
    linear-gradient(90deg, rgb(var(--work-tint) / 0.09), rgb(var(--work-tint) / 0) 42%),
    rgb(var(--bg-surface) / 1);
}

/* ── L'en-tête : une porte, un chevron ───────────────────────────────────── */
.w-row {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr) auto 2.25rem;
  gap: 0.9rem;
  align-items: center;
  padding: 0.65rem 0.6rem 0.65rem 1rem;
  cursor: pointer;
  user-select: none;
}
.works--dense .w-row {
  grid-template-columns: 44px minmax(0, 1fr) auto 2.25rem;
  padding: 0.45rem 0.6rem 0.45rem 0.8rem;
}
.w-poster {
  width: 56px;
  height: 84px;
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.works--dense .w-poster {
  width: 44px;
  height: 66px;
}
.w-mono {
  position: relative;
  display: grid;
  place-items: center;
  border: 1px solid hsl(var(--mono-hue, 40) 40% 50% / 0.45);
  background:
    radial-gradient(hsl(var(--mono-hue, 40) 45% 60% / 0.28) 1px, transparent 1px) 0 0 / 7px 7px,
    linear-gradient(160deg, hsl(var(--mono-hue, 40) 40% 50% / 0.22), hsl(var(--mono-hue, 40) 40% 50% / 0.06));
  text-decoration: none;
}
.w-mono-letter {
  font-family: var(--font-display);
  font-style: italic;
  font-weight: 500;
  font-size: 1.625rem;
  line-height: 1;
  color: rgb(var(--fg-strong) / 0.85);
}
.works--dense .w-mono-letter {
  font-size: 1.25rem;
}
.w-mono-kind {
  position: absolute;
  right: 0.25rem;
  bottom: 0.25rem;
  width: 0.75rem;
  height: 0.75rem;
  color: rgb(var(--fg-muted) / 1);
}
.w-main {
  min-width: 0;
  display: grid;
  gap: 0.3rem;
  user-select: text;
}
.w-l1 {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.6rem;
}
.w-title {
  font-family: var(--font-display);
  font-style: italic;
  font-weight: 500;
  font-size: 1.25rem;
  line-height: 1.15;
  color: rgb(var(--fg-strong) / 1);
  text-decoration: none;
  border-radius: var(--radius-xs);
}
.works--dense .w-title {
  font-size: 1rem;
}
.w-title:hover {
  text-decoration: underline;
  text-decoration-color: rgb(var(--accent-warm) / 1);
  text-underline-offset: 0.2em;
}
.w-title--plain {
  font-family: var(--font-sans);
  font-style: normal;
  font-weight: 600;
  font-size: 1rem;
  line-height: 1.3;
  overflow-wrap: anywhere;
}
.w-year {
  font-family: var(--font-display);
  font-weight: 500;
  font-size: 0.8125rem;
  color: rgb(var(--fg-muted) / 1);
}
.w-l2 {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem 0.65rem;
  min-width: 0;
}
.w-meta {
  font-size: 0.75rem;
  line-height: 1.4;
  color: rgb(var(--fg-muted) / 1);
}
.w-ladder {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem;
}
.lad {
  display: inline-flex;
  align-items: center;
  height: 1.25rem;
  padding: 0 0.4rem;
  border: 1px solid rgb(var(--line-default) / 1);
  border-radius: var(--radius-xs);
  background: rgb(var(--bg-inset) / 1);
  font-size: 0.6875rem;
  font-weight: 500;
  color: rgb(var(--fg-muted) / 1);
  text-transform: uppercase;
}
.lad--res {
  font-weight: 700;
  color: rgb(var(--fg-default) / 1);
}
.w-scopes {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}
.w-scope {
  display: inline-flex;
  align-items: center;
  min-height: 1.5rem;
  padding: 0 0.5rem;
  border: 1px solid rgb(var(--line-default) / 1);
  border-radius: var(--radius-xs);
  background: transparent;
  font-size: 0.75rem;
  font-weight: 600;
  color: rgb(var(--fg-muted) / 1);
  white-space: nowrap;
  transition:
    color var(--dur-1) var(--ease-standard),
    border-color var(--dur-1) var(--ease-standard),
    background-color var(--dur-1) var(--ease-standard);
}
.w-scope:hover {
  color: rgb(var(--fg-strong) / 1);
  border-color: rgb(var(--fg-muted) / 1);
}
.w-scope--on {
  background: rgb(var(--accent-warm) / 1);
  border-color: rgb(var(--accent-warm) / 1);
  color: rgb(var(--accent-warm-fg) / 1);
}
.w-scope--on:hover {
  color: rgb(var(--accent-warm-fg) / 1);
  border-color: rgb(var(--accent-warm) / 1);
}

/* Les chiffres : les seeders, puis taille et âge empilés, à leur largeur — rien de coupé. */
.w-figures {
  display: flex;
  align-items: center;
  gap: 1.1rem;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
}
.w-fig--seed {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.4rem;
  min-width: 3rem;
  font-size: 0.8125rem;
  font-weight: 700;
  color: rgb(var(--fg-muted) / 1);
}
.work[data-state='hot'] .w-fig--seed,
.work[data-state='ok'] .w-fig--seed {
  color: rgb(var(--online) / 1);
}
.work[data-state='thin'] .w-fig--seed {
  color: rgb(var(--warning) / 1);
}
.w-fig-stack {
  display: grid;
  gap: 0.15rem;
  justify-items: end;
}
.w-fig--size {
  font-size: 0.75rem;
  color: rgb(var(--fg-default) / 1);
}
.w-fig--age {
  font-size: 0.6875rem;
  color: rgb(var(--fg-muted) / 1);
}
.w-pip {
  flex: none;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: rgb(var(--fg-faint) / 1);
}
.work[data-state='hot'] .w-pip,
.work[data-state='ok'] .w-pip {
  background: rgb(var(--online) / 1);
  box-shadow: 0 0 0 3px rgb(var(--online) / 0.18);
}
.work[data-state='thin'] .w-pip {
  background: rgb(var(--warning) / 1);
}
.work[data-state='dead'] .w-pip {
  background: transparent;
  box-shadow: inset 0 0 0 1.5px rgb(var(--danger) / 0.7);
}
.w-toggle {
  display: inline-grid;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: var(--radius-sm);
  color: rgb(var(--fg-muted) / 1);
  transition: background-color var(--dur-1) var(--ease-standard), color var(--dur-1) var(--ease-standard);
}
.w-row:hover .w-toggle,
.w-toggle:hover {
  background: rgb(var(--bg-inset) / 1);
  color: rgb(var(--fg-strong) / 1);
}
.w-toggle-car,
.w-car {
  width: 0.7rem;
  height: 0.7rem;
  transition: transform var(--dur-2) var(--ease-standard);
}
.work--open .w-toggle-car,
.w-season--open .w-season-h .w-car,
.unit--open .unit-h .w-car {
  transform: rotate(180deg);
}

/* ── Dedans : saisons, épisodes, releases ────────────────────────────────── */
.w-body {
  display: grid;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem 0.75rem;
  border-top: 1px solid rgb(var(--line-default) / 1);
  background: rgb(var(--bg-inset) / 0.6);
  animation: w-body-in var(--dur-4) var(--ease-emphasis) both;
}
@keyframes w-body-in {
  from {
    opacity: 0;
    transform: translateY(-0.35rem);
    clip-path: inset(0 0 100% 0);
  }
  to {
    opacity: 1;
    transform: none;
    clip-path: inset(0);
  }
}
.w-note {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0.2rem 0;
  font-size: 0.8125rem;
  color: rgb(var(--fg-muted) / 1);
}
.w-note--err {
  color: rgb(var(--danger) / 1);
}
.w-season {
  display: grid;
  gap: 0.35rem;
}
.w-season-h,
.unit-h {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  width: 100%;
  min-height: 2.25rem;
  padding: 0 0.6rem;
  border-radius: var(--radius-sm);
  text-align: left;
  transition: background-color var(--dur-1) var(--ease-standard);
}
.w-season-h:hover,
.unit-h:hover {
  background: rgb(var(--bg-hover) / 1);
}
.w-season-h {
  border: 1px solid rgb(var(--line-default) / 1);
  background: rgb(var(--bg-surface) / 1);
}
.w-season-name {
  font-size: 0.875rem;
  font-weight: 600;
  color: rgb(var(--fg-strong) / 1);
}
.w-season-n,
.unit-n {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  color: rgb(var(--fg-muted) / 1);
}
.w-season-seed,
.unit-seed {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  color: rgb(var(--fg-faint) / 1);
}
.w-season-seed.is-live,
.unit-seed.is-live {
  color: rgb(var(--online) / 1);
}
.w-season-seed :deep(svg),
.unit-seed :deep(svg) {
  width: 0.6rem;
  height: 0.6rem;
}
.w-units {
  display: grid;
  gap: 0.3rem;
}
.w-season--open .w-units {
  padding-left: 0.5rem;
  border-left: 2px solid rgb(var(--line-default) / 1);
}
.unit {
  display: grid;
  gap: 0.3rem;
}
.unit-h {
  min-height: 2rem;
}
.unit-name {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: rgb(var(--fg-strong) / 1);
}
.unit-res {
  display: inline-flex;
  gap: 0.25rem;
}
.unit-r {
  padding: 0 0.3rem;
  border: 1px solid rgb(var(--accent-warm) / 0.4);
  border-radius: var(--radius-xs);
  font-family: var(--font-mono);
  font-size: 0.625rem;
  color: rgb(var(--accent-warm-text) / 1);
}
.unit-rows {
  padding-left: 0.5rem;
}
.w-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding-top: 0.25rem;
}
.w-fold,
.w-all {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: rgb(var(--fg-muted) / 1);
  text-decoration: none;
  border-radius: var(--radius-xs);
}
.w-fold:hover,
.w-all:hover {
  color: rgb(var(--fg-strong) / 1);
}
.w-fold :deep(svg),
.w-all :deep(svg) {
  width: 0.75rem;
  height: 0.75rem;
}

/* ── Quand la place manque ───────────────────────────────────────────────── */
@container (max-width: 52rem) {
  .w-figures {
    gap: 0.75rem;
  }
}
@container (max-width: 40rem) {
  .w-row {
    grid-template-columns: 44px minmax(0, 1fr) 2.25rem;
    align-items: start;
  }
  .w-poster {
    width: 44px;
    height: 66px;
  }
  .w-figures {
    grid-column: 2;
    justify-content: start;
    gap: 0.75rem;
    text-align: left;
  }
  .w-fig--seed {
    flex: none;
    min-width: 0;
    justify-content: flex-start;
  }
  .w-fig-stack {
    justify-items: start;
  }
  /* La carte se resserre : l'échelle des qualités se retrouve dans les unités dépliées. */
  .w-ladder {
    display: none;
  }
  .w-toggle {
    grid-row: 1;
    grid-column: 3;
  }
  .w-scopes {
    flex-wrap: nowrap;
    width: 100%;
    padding-right: 1.5rem;
    overflow-x: auto;
    scrollbar-width: none;
    /* La rangée défile : un fondu au bord dit qu'il y en a d'autres. */
    mask-image: linear-gradient(90deg, rgb(0 0 0 / 1) calc(100% - 1.5rem), rgb(0 0 0 / 0));
    -webkit-mask-image: linear-gradient(90deg, rgb(0 0 0 / 1) calc(100% - 1.5rem), rgb(0 0 0 / 0));
  }
  .w-scopes::-webkit-scrollbar {
    display: none;
  }
  .w-scope {
    min-height: 2.25rem;
    flex: none;
  }
  .unit-res {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .work,
  .w-body {
    animation: none;
  }
  .work,
  .w-scope,
  .w-toggle,
  .w-toggle-car,
  .w-car,
  .w-season-h,
  .unit-h {
    transition: none;
  }
}
</style>
