<script setup lang="ts">
/**
 * Le rail des facettes : ce qui existe dans la recherche courante, compté.
 *
 * Chaque valeur porte le nombre de releases qu'elle donnerait — on voit ce qui
 * existe avant de filtrer, au lieu de découvrir une liste vide. Les comptes
 * viennent de `/api/torrents/facets`, qui applique tous les filtres sauf celui
 * de la dimension comptée : une catégorie cochée laisse ses voisines lisibles.
 *
 * Les étiquettes arrivent en slugs nus ; c'est le vocabulaire de la barre
 * (`searchTokens.ts`) qui les range par famille — un slug sans famille
 * (proper, 10bit…) ne s'affiche pas ici, il reste accessible par `tag=`.
 */
import { hasSlug, kindOfSlug, tagGroupIndex, type SearchToken, type TagKind } from '~/utils/searchTokens';
import type { FacetsResponse, FacetCategory, OptionKey } from '~/utils/catalogueFacets';
import { formatAgo } from '~/utils/format';


const props = withDefaults(
  defineProps<{
    facets: FacetsResponse | null;
    loading?: boolean;
    categories: FacetCategory[];
    selectedCategory: string;
    tokens: SearchToken[];
    options: OptionKey[];
    /** Dernière passe du collecteur : dit l'écart entre « avec des sources » et l'essaim vivant. */
    statsAt?: string | null;
  }>(),
  { loading: false, statsAt: null },
);
const emit = defineEmits<{
  selectCategory: [id: string];
  toggleSlug: [kind: TagKind, slug: string];
  toggleYear: [year: number];
  toggleOption: [key: OptionKey];
}>();

const { t } = useI18n();

/** Les familles montrées, dans l'ordre où l'on choisit une release. */
const FAMILIES: readonly TagKind[] = ['resolution', 'source', 'codec', 'language', 'hdr', 'audio'];
const LIMIT = 6;
const expanded = ref(new Set<string>());
const isExpanded = (id: string) => expanded.value.has(id);
function toggleExpanded(id: string) {
  const next = new Set(expanded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expanded.value = next;
}

/* ── Catégories : les enfants comptent pour leur parent ───────────────────── */
interface CatRow {
  id: string;
  name: string;
  count: number;
  kids: Array<{ id: string; name: string; count: number }>;
}
const catRows = computed<CatRow[]>(() => {
  const counts = new Map((props.facets?.categories ?? []).map((c) => [c.id, c.count]));
  const sel = props.selectedCategory;
  return props.categories
    .map((p) => {
      const kids = (p.subcategories ?? [])
        .map((s) => ({ id: s.id, name: s.name, count: counts.get(s.id) ?? 0 }))
        .filter((k) => k.count > 0 || k.id === sel)
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      const count = (counts.get(p.id) ?? 0) + kids.reduce((acc, k) => acc + k.count, 0);
      return { id: p.id, name: p.name, count, kids };
    })
    .filter((p) => p.count > 0 || p.id === sel || p.kids.some((k) => k.id === sel))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
});
const openParentId = computed(() => {
  const sel = props.selectedCategory;
  if (!sel) return null;
  return catRows.value.find((p) => p.id === sel || p.kids.some((k) => k.id === sel))?.id ?? null;
});
const visibleCats = computed(() =>
  isExpanded('category') ? catRows.value : catRows.value.slice(0, LIMIT),
);
const isCatOn = (id: string) => props.selectedCategory === id;
function pickCategory(id: string) {
  emit('selectCategory', isCatOn(id) ? '' : id);
}

/* ── Étiquettes, par famille ──────────────────────────────────────────────── */
interface FamilyRows {
  kind: TagKind;
  rows: Array<{ slug: string; name: string; count: number }>;
}
/*
 * Une famille qui a un jeton se compte SANS lui (sinon sa valeur cochée serait
 * la seule à rester, et on ne pourrait plus en changer) : ses lignes viennent
 * de `tagsByGroup[i]`, les autres familles lisent les comptes stricts.
 */
const families = computed<FamilyRows[]>(() => {
  const f = props.facets;
  if (!f) return [];
  const pick = (kind: TagKind) => {
    const i = tagGroupIndex(props.tokens, kind);
    return (i >= 0 ? f.tagsByGroup?.[String(i)] : undefined) ?? f.tags;
  };
  return FAMILIES.map((kind) => ({
    kind,
    rows: pick(kind)
      .filter((tg) => kindOfSlug(tg.slug) === kind)
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  })).filter((fam) => fam.rows.length > 0);
});
const visibleRows = (f: FamilyRows) => (isExpanded(f.kind) ? f.rows : f.rows.slice(0, LIMIT));

/* ── Années : un petit histogramme des plus récentes ──────────────────────── */
const selectedYear = computed(() => {
  const tk = props.tokens.find((x) => x.kind === 'year');
  return tk ? Number(tk.value) : null;
});
const years = computed(() => {
  const all = [...(props.facets?.years ?? [])].sort((a, b) => a.year - b.year);
  const recent = all.slice(-14);
  const max = Math.max(1, ...recent.map((y) => y.count));
  return recent.map((y) => ({ ...y, pct: Math.max(8, Math.round((100 * y.count) / max)) }));
});

/* ── Options : quatre questions de membre ─────────────────────────────────── */
const optionRows = computed(() => {
  const o = props.facets?.options;
  return [
    { key: 'seeded' as OptionKey, count: o?.withSeeders ?? 0 },
    { key: 'free' as OptionKey, count: o?.freeleech ?? 0 },
    { key: 'untaken' as OptionKey, count: o?.notTaken ?? 0 },
    { key: 'current' as OptionKey, count: o?.superseded ?? 0 },
  ];
});
const isOptionOn = (key: OptionKey) => props.options.includes(key);

const empty = computed(
  () => !props.loading && catRows.value.length === 0 && families.value.length === 0 && years.value.length === 0,
);
</script>

<template>
  <div class="cf" :class="{ 'cf--loading': loading }" :aria-busy="loading">
    <p v-if="empty" class="cf-empty">{{ t('search.facets.none') }}</p>

    <section v-if="catRows.length" class="facet">
      <h3 class="fh">{{ t('search.facets.category') }}</h3>
      <ul class="flist">
        <li v-for="cat in visibleCats" :key="cat.id">
          <button
            type="button"
            class="frow"
            :class="{ 'frow--on': isCatOn(cat.id) }"
            :aria-pressed="isCatOn(cat.id)"
            @click="pickCategory(cat.id)"
          >
            <span class="frow-l">{{ cat.name }}</span>
            <span class="frow-c">{{ cat.count }}</span>
          </button>
          <ul v-if="openParentId === cat.id && cat.kids.length" class="flist flist--sub">
            <li v-for="kid in cat.kids" :key="kid.id">
              <button
                type="button"
                class="frow"
                :class="{ 'frow--on': isCatOn(kid.id) }"
                :aria-pressed="isCatOn(kid.id)"
                @click="pickCategory(kid.id)"
              >
                <span class="frow-l">{{ kid.name }}</span>
                <span class="frow-c">{{ kid.count }}</span>
              </button>
            </li>
          </ul>
        </li>
      </ul>
      <button
        v-if="catRows.length > LIMIT"
        type="button"
        class="frow-more"
        :aria-expanded="isExpanded('category')"
        @click="toggleExpanded('category')"
      >
        {{ isExpanded('category') ? t('search.facets.less') : t('search.facets.more', { n: catRows.length - LIMIT }) }}
      </button>
    </section>

    <section v-for="fam in families" :key="fam.kind" class="facet">
      <h3 class="fh">{{ t(`search.facets.${fam.kind}`) }}</h3>
      <ul class="flist">
        <li v-for="row in visibleRows(fam)" :key="row.slug">
          <button
            type="button"
            class="frow"
            :class="{ 'frow--on': hasSlug(tokens, row.slug) }"
            :aria-pressed="hasSlug(tokens, row.slug)"
            @click="emit('toggleSlug', fam.kind, row.slug)"
          >
            <span class="frow-l">{{ row.name }}</span>
            <span class="frow-c">{{ row.count }}</span>
          </button>
        </li>
      </ul>
      <button
        v-if="fam.rows.length > LIMIT"
        type="button"
        class="frow-more"
        :aria-expanded="isExpanded(fam.kind)"
        @click="toggleExpanded(fam.kind)"
      >
        {{ isExpanded(fam.kind) ? t('search.facets.less') : t('search.facets.more', { n: fam.rows.length - LIMIT }) }}
      </button>
    </section>

    <section v-if="years.length" class="facet">
      <h3 class="fh">{{ t('search.facets.year') }}</h3>
      <div class="years" role="group" :aria-label="t('search.facets.year')">
        <button
          v-for="y in years"
          :key="y.year"
          type="button"
          class="yb"
          :class="{ 'yb--on': selectedYear === y.year }"
          :aria-pressed="selectedYear === y.year"
          :title="t('search.facets.yearTitle', { year: y.year, n: y.count }, y.count)"
          :aria-label="t('search.facets.yearTitle', { year: y.year, n: y.count }, y.count)"
          @click="emit('toggleYear', y.year)"
        >
          <span class="ybar" :style="{ height: `${y.pct}%` }" />
          <span class="yl">{{ String(y.year).slice(2) }}</span>
        </button>
      </div>
    </section>

    <section class="facet facet--opts">
      <h3 class="fh">{{ t('search.facets.options') }}</h3>
      <ul class="flist">
        <li v-for="opt in optionRows" :key="opt.key">
          <button
            type="button"
            class="frow frow--switch"
            :class="{ 'frow--on': isOptionOn(opt.key) }"
            role="switch"
            :aria-checked="isOptionOn(opt.key)"
            @click="emit('toggleOption', opt.key)"
          >
            <span class="sw-mini" aria-hidden="true" />
            <span class="frow-l">{{ t(`search.options.${opt.key}`) }}</span>
            <span class="frow-c">{{ opt.count }}</span>
          </button>
        </li>
      </ul>
      <p v-if="statsAt" class="cf-fresh">{{ t('search.facets.fresh', { ago: formatAgo(statsAt) }) }}</p>
    </section>
  </div>
</template>

<style scoped>
.cf {
  display: grid;
  gap: 1.1rem;
  transition: opacity var(--dur-2) var(--ease-standard);
}
.cf--loading {
  opacity: 0.6;
}
.cf-empty {
  margin: 0;
  font-size: 0.8rem;
  color: rgb(var(--fg-muted) / 1);
}
.cf-fresh {
  margin: 0.35rem 0 0 0.5rem;
  font-family: var(--font-mono);
  font-size: 0.62rem;
  color: rgb(var(--fg-faint) / 1);
}
.facet {
  position: relative;
}
.fh {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.35rem;
  font-family: var(--font-mono);
  font-size: 0.62rem;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted) / 1);
}
.fh::after {
  content: '';
  flex: 1;
  height: 1px;
  background: rgb(var(--line-default) / 1);
}
.flist {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
}
.flist--sub {
  margin-left: 1.1rem;
  border-left: 1px solid rgb(var(--line-default) / 1);
}
.frow {
  position: relative;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 1.85rem;
  padding: 0 0.5rem 0 1.45rem;
  border-radius: var(--radius-sm);
  color: rgb(var(--fg-default) / 1);
  font-size: 0.82rem;
  text-align: left;
  transition: background-color var(--dur-1) var(--ease-standard);
}
.frow::before {
  content: '';
  position: absolute;
  left: 0.35rem;
  top: 50%;
  width: 0.75rem;
  height: 0.75rem;
  transform: translateY(-50%);
  border: 1px solid rgb(var(--line-field) / 1);
  border-radius: 3px;
  background: rgb(var(--bg-inset) / 1);
}
.frow:hover {
  background: rgb(var(--bg-hover) / 1);
}
.frow--on {
  color: rgb(var(--fg-strong) / 1);
  font-weight: 600;
}
.frow--on::before {
  background: rgb(var(--accent-warm) / 1);
  border-color: rgb(var(--accent-warm) / 1);
  box-shadow: inset 0 0 0 2px rgb(var(--bg-base) / 1);
}
.frow-l {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.frow-c {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 0.66rem;
  font-variant-numeric: tabular-nums;
  color: rgb(var(--fg-muted) / 1);
}
.frow--on .frow-c {
  color: rgb(var(--accent-warm-text) / 1);
}
.frow-more {
  margin: 0.2rem 0 0 1.45rem;
  font-size: 0.7rem;
  font-weight: 600;
  color: rgb(var(--fg-muted) / 1);
  border-radius: var(--radius-xs);
}
.frow-more:hover {
  color: rgb(var(--fg-strong) / 1);
}

/* ── Années ──────────────────────────────────────────────────────────────── */
.years {
  display: flex;
  align-items: flex-end;
  gap: 0.25rem;
  height: 3.4rem;
  padding: 0 0.3rem;
}
.yb {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: stretch;
  gap: 0.25rem;
  height: 100%;
  min-width: 0;
  border-radius: var(--radius-xs);
}
.ybar {
  display: block;
  min-height: 3px;
  border-radius: 2px 2px 0 0;
  background: rgb(var(--fg-default) / 0.18);
  transition: background-color var(--dur-1) var(--ease-standard);
}
.yb:hover .ybar {
  background: rgb(var(--fg-default) / 0.35);
}
.yb--on .ybar {
  background: rgb(var(--accent-warm) / 1);
}
.yl {
  font-family: var(--font-mono);
  font-size: 0.55rem;
  font-weight: 600;
  line-height: 1;
  text-align: center;
  color: rgb(var(--fg-muted) / 1);
}
.yb--on .yl {
  color: rgb(var(--accent-warm-text) / 1);
}

/* ── Options : des interrupteurs, pas des cases ──────────────────────────── */
.facet--opts .frow {
  padding-left: 0.5rem;
}
.facet--opts .frow::before {
  display: none;
}
.sw-mini {
  position: relative;
  flex: none;
  width: 1.9rem;
  height: 1.05rem;
  margin-right: 0.2rem;
  border-radius: var(--radius-pill);
  background: rgb(var(--line-strong) / 1);
  transition: background-color var(--dur-2) var(--ease-standard);
}
.sw-mini::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 0.8rem;
  height: 0.8rem;
  border-radius: 50%;
  background: rgb(var(--fg-default) / 1);
  transition: left var(--dur-2) var(--ease-standard), background-color var(--dur-2) var(--ease-standard);
}
.frow--on .sw-mini {
  background: rgb(var(--accent-warm) / 1);
}
.frow--on .sw-mini::after {
  left: calc(100% - 0.8rem - 2px);
  background: rgb(var(--accent-warm-fg) / 1);
}
@media (pointer: coarse) {
  .frow {
    min-height: 2.25rem;
  }
}
@media (prefers-reduced-motion: reduce) {
  .cf,
  .frow,
  .ybar,
  .sw-mini,
  .sw-mini::after {
    transition: none;
  }
}
</style>
