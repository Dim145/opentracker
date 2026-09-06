<script setup lang="ts">
/**
 * La vue Œuvres : une carte par œuvre, ses releases dépliées dedans.
 *
 * La carte dit ce qu'est l'œuvre (affiche, titre, année — tels que le cache
 * des métadonnées les connaît, sinon le nom de la release de tête), ce qui en
 * existe (résolutions et sources présentes, nombre de releases, essaim), et se
 * déplie sur place : les releases arrivent groupées par unité — épisode,
 * saison, intégrale — avec les mêmes lignes que la vue Releases, et les mêmes
 * filtres que la page (une puce « 1080p » vaut aussi dans la carte).
 */
import { formatAge } from '~/utils/format';
import { kindOfSlug } from '~/utils/searchTokens';
import type { CatalogueRow } from './ReleaseRows.vue';

export interface WorkGroup {
  key: string;
  source: 'tmdb' | 'igdb' | 'openlibrary' | 'solo';
  externalId: string;
  releaseCount: number;
  latest: string;
  leadName: string;
  categoryIds?: string[];
  seedTotal?: number;
  seedMax?: number;
  leechTotal?: number;
  partnerCount?: number;
  peerCount?: number;
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
  }>(),
  { dense: false, filterQuery: () => ({}) },
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

function meta(g: WorkGroup): string {
  const parts: string[] = [];
  const cat = props.categoryLabel(g.categoryIds ?? []);
  if (cat) parts.push(cat);
  parts.push(t('search.works.releases', g.releaseCount));
  const age = formatAge(g.latest);
  if (age) parts.push(t('search.works.added', { ago: age }));
  if (g.partnerCount) parts.push(t('search.works.partners', { n: g.partnerCount }));
  return parts.join(' · ');
}

/* ── Le dépliage : une requête par carte ouverte, groupée par unité ───────── */
interface Unit {
  key: string;
  label: string;
  order: number;
  rows: CatalogueRow[];
}
type Body = { state: 'loading' } | { state: 'error' } | { state: 'ready'; units: Unit[]; total: number };
const open = ref(new Set<string>());
const bodies = ref(new Map<string, Body>());
const pad = (n: number) => String(n).padStart(2, '0');

function unitsOf(rows: CatalogueRow[]): Unit[] {
  const map = new Map<string, Unit>();
  for (const r of rows) {
    let key: string;
    let label: string;
    let order: number;
    if (typeof r.season === 'number' && typeof r.episode === 'number') {
      key = `e${r.season}-${r.episode}`;
      label = t('search.works.unit.episode', { s: pad(r.season), e: pad(r.episode) });
      order = 3_000_000 - (r.season * 10_000 + r.episode);
    } else if (typeof r.season === 'number') {
      key = `s${r.season}`;
      label = t('search.works.unit.season', { s: pad(r.season) });
      order = 5_000_000 - r.season;
    } else {
      key = 'all';
      label = t('search.works.unit.integral');
      order = 9_000_000;
    }
    const u = map.get(key) ?? { key, label, order, rows: [] };
    u.rows.push(r);
    map.set(key, u);
  }
  return Array.from(map.values()).sort((a, b) => a.order - b.order);
}

async function load(g: WorkGroup) {
  bodies.value.set(g.key, { state: 'loading' });
  try {
    const res = await $fetch<{ data: CatalogueRow[]; pagination: { total: number } }>('/api/torrents', {
      query: { ...props.filterQuery, groupKey: g.key, limit: 60, sortBy: 'age', order: 'desc', page: 1 },
    });
    bodies.value.set(g.key, { state: 'ready', units: unitsOf(res.data), total: res.pagination.total });
  } catch {
    bodies.value.set(g.key, { state: 'error' });
  }
}

function toggle(g: WorkGroup) {
  const next = new Set(open.value);
  if (next.has(g.key)) {
    next.delete(g.key);
  } else {
    next.add(g.key);
    if (!bodies.value.has(g.key)) void load(g);
  }
  open.value = next;
}
const isOpen = (g: WorkGroup) => open.value.has(g.key);
const bodyOf = (g: WorkGroup) => bodies.value.get(g.key);
const bodyId = (g: WorkGroup) => `work-body-${g.key.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

// Les filtres changent : ce qui était déplié se recharge à l'ouverture suivante.
watch(
  () => JSON.stringify(props.filterQuery),
  () => {
    bodies.value = new Map();
    for (const g of props.groups) if (open.value.has(g.key)) void load(g);
  },
);
</script>

<template>
  <ul class="works" :class="{ 'works--dense': dense }">
    <li
      v-for="g in groups"
      :key="g.key"
      class="work"
      :class="{ 'work--open': isOpen(g), 'work--tinted': !!g.work?.tint }"
      :data-state="swarmState(g)"
      :style="g.work?.tint ? { '--work-tint': g.work.tint } : undefined"
    >
      <div class="w-row">
        <TorrentPosterHover
          class="w-poster"
          :src="g.work?.posterUrl ?? null"
          :large="largePoster(g)"
          :alt="titleOf(g)"
          :fallback-icon="kindIcon(g)"
        />
        <div class="w-main">
          <div class="w-l1">
            <NuxtLink class="w-title" :class="{ 'w-title--mono': !g.work?.title }" :to="pageHref(g)">
              {{ titleOf(g) }}
            </NuxtLink>
            <span v-if="g.work?.year" class="w-year">{{ g.work.year }}</span>
          </div>
          <p class="w-l2">{{ meta(g) }}</p>
          <div v-if="ladder(g).resolutions.length || ladder(g).sources.length" class="w-ladder">
            <span v-for="r in ladder(g).resolutions" :key="`r-${r}`" class="lad lad--res">{{ r }}</span>
            <span v-if="ladder(g).resolutions.length && ladder(g).sources.length" class="lad-sep" aria-hidden="true" />
            <span v-for="s in ladder(g).sources" :key="`s-${s}`" class="lad">{{ s }}</span>
          </div>
        </div>
        <div class="w-side">
          <span class="w-sw">
            <span class="w-pip" aria-hidden="true" />
            {{ (g.seedTotal ?? 0) > 0 ? t('search.works.sources', g.seedTotal ?? 0) : t('search.works.noSources') }}
          </span>
          <button
            type="button"
            class="w-exp"
            :aria-expanded="isOpen(g)"
            :aria-controls="bodyId(g)"
            @click="toggle(g)"
          >
            {{ isOpen(g) ? t('search.works.close') : t('search.works.open') }}
            <Icon name="ph:caret-down-bold" class="w-car" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div v-if="isOpen(g)" :id="bodyId(g)" class="w-body">
        <p v-if="!bodyOf(g) || bodyOf(g)!.state === 'loading'" class="w-note">
          <Icon name="ph:circle-notch" class="animate-spin" aria-hidden="true" />
          {{ t('search.works.loading') }}
        </p>
        <p v-else-if="bodyOf(g)!.state === 'error'" class="w-note w-note--err">{{ t('search.works.error') }}</p>
        <template v-else-if="bodyOf(g)!.state === 'ready'">
          <p v-if="(bodyOf(g) as { units: Unit[] }).units.length === 0" class="w-note">{{ t('search.works.empty') }}</p>
          <div v-for="u in (bodyOf(g) as { units: Unit[] }).units" :key="u.key" class="unit">
            <h4 class="unit-h">
              {{ u.label }}
              <span class="unit-n">{{ t('search.works.releases', u.rows.length) }}</span>
            </h4>
            <SearchReleaseRows :torrents="u.rows" :dense="dense" :show-header="false" />
          </div>
          <NuxtLink class="w-all" :to="pageHref(g)">
            {{ t('search.works.openPage') }}
            <Icon name="ph:arrow-right-bold" aria-hidden="true" />
          </NuxtLink>
        </template>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.works {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.6rem;
}
.work {
  position: relative;
  overflow: hidden;
  border: 1px solid rgb(var(--line-default) / 1);
  border-radius: var(--radius-xl);
  background: rgb(var(--bg-surface) / 1);
  transition: border-color var(--dur-2) var(--ease-standard);
}
.work:hover {
  border-color: rgb(var(--line-strong) / 1);
}
/* Le filet de gauche dit l'état de l'essaim de l'œuvre, comme la pastille des lignes. */
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
/* La teinte de l'affiche, celle que la fiche calcule : le catalogue et la fiche
   se répondent, l'œil retrouve l'œuvre par sa couleur. Elle prime sur l'état
   de l'essaim, que la pastille dit déjà. */
.work--tinted::before {
  background: linear-gradient(rgb(var(--work-tint) / 0.85), rgb(var(--work-tint) / 0.25));
}
.w-row {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) auto;
  gap: 1rem;
  align-items: center;
  padding: 0.75rem 0.9rem 0.75rem 1rem;
}
.works--dense .w-row {
  grid-template-columns: 48px minmax(0, 1fr) auto;
  padding: 0.5rem 0.8rem;
}
.w-poster {
  width: 64px;
  height: 96px;
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.works--dense .w-poster {
  width: 48px;
  height: 72px;
}
.w-main {
  min-width: 0;
  display: grid;
  gap: 0.3rem;
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
  font-size: 1.3rem;
  line-height: 1.15;
  color: rgb(var(--fg-strong) / 1);
  text-decoration: none;
  border-radius: var(--radius-xs);
}
.works--dense .w-title {
  font-size: 1.1rem;
}
.w-title:hover {
  text-decoration: underline;
  text-decoration-color: rgb(var(--accent-warm) / 1);
  text-underline-offset: 0.2em;
}
.w-title--mono {
  font-family: var(--font-mono);
  font-style: normal;
  font-size: 0.9rem;
  word-break: break-all;
}
.w-year {
  font-family: var(--font-display);
  font-weight: 500;
  font-size: 0.9rem;
  color: rgb(var(--fg-muted) / 1);
}
.w-l2 {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.66rem;
  font-weight: 500;
  line-height: 1.4;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted) / 1);
}
.w-ladder {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
}
.lad {
  display: inline-flex;
  align-items: center;
  height: 1.45rem;
  padding: 0 0.5rem;
  border: 1px solid rgb(var(--line-default) / 1);
  border-radius: var(--radius-sm);
  background: rgb(var(--bg-inset) / 1);
  font-size: 0.72rem;
  font-weight: 500;
  color: rgb(var(--fg-muted) / 1);
  text-transform: uppercase;
}
.lad--res {
  font-weight: 700;
  color: rgb(var(--fg-default) / 1);
}
.lad-sep {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: rgb(var(--fg-faint) / 1);
}
.w-side {
  display: grid;
  justify-items: end;
  gap: 0.45rem;
}
.w-sw {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.78rem;
  font-weight: 600;
  color: rgb(var(--fg-default) / 1);
  white-space: nowrap;
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
.w-exp {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 2rem;
  padding: 0 0.7rem;
  border: 1px solid rgb(var(--line-strong) / 1);
  border-radius: var(--radius-sm);
  background: rgb(var(--bg-elevated) / 1);
  font-size: 0.74rem;
  font-weight: 600;
  color: rgb(var(--fg-default) / 1);
  white-space: nowrap;
  transition: border-color var(--dur-1) var(--ease-standard);
}
.w-exp:hover {
  border-color: rgb(var(--fg-muted) / 1);
}
.w-car {
  width: 0.7rem;
  height: 0.7rem;
  transition: transform var(--dur-2) var(--ease-standard);
}
.w-exp[aria-expanded='true'] .w-car {
  transform: rotate(180deg);
}
.w-body {
  display: grid;
  gap: 0.7rem;
  padding: 0.6rem 0.9rem 0.8rem;
  border-top: 1px solid rgb(var(--line-default) / 1);
  background: rgb(var(--bg-inset) / 0.6);
}
.w-note {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0.2rem 0;
  font-size: 0.8rem;
  color: rgb(var(--fg-muted) / 1);
}
.w-note--err {
  color: rgb(var(--danger) / 1);
}
.unit-h {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin: 0.2rem 0 0.3rem;
  font-family: var(--font-mono);
  font-size: 0.62rem;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted) / 1);
}
.unit-h::after {
  content: '';
  flex: 1;
  height: 1px;
  background: rgb(var(--line-default) / 1);
}
.unit-n {
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: none;
  color: rgb(var(--fg-faint) / 1);
}
.w-all {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  justify-self: end;
  font-size: 0.74rem;
  font-weight: 600;
  color: rgb(var(--fg-muted) / 1);
  text-decoration: none;
  border-radius: var(--radius-xs);
}
.w-all:hover {
  color: rgb(var(--fg-strong) / 1);
}
.w-all :deep(svg) {
  width: 0.75rem;
  height: 0.75rem;
}
@container (max-width: 40rem) {
  .w-row {
    grid-template-columns: 48px minmax(0, 1fr);
  }
  .w-side {
    grid-column: 2;
    grid-auto-flow: column;
    justify-items: start;
    justify-content: space-between;
    width: 100%;
  }
  .w-exp {
    min-height: 2.25rem;
  }
}
@media (prefers-reduced-motion: reduce) {
  .work,
  .w-exp,
  .w-car {
    transition: none;
  }
}
</style>
