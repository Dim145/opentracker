<script setup lang="ts">
/**
 * Les lignes du catalogue.
 *
 * Une ligne répond, dans l'ordre où l'œil lit : de quoi il s'agit (le titre de
 * l'œuvre quand le cache le connaît, sinon le nom de la release), dans quelle
 * unité (S02 · E04), ce qu'il faut savoir avant de cliquer (gratuit, remplacée,
 * déjà prise), puis la qualité en puces, la taille, l'essaim et qui l'a
 * envoyée. La pastille de gauche dit l'état de l'essaim sans qu'on lise les
 * chiffres — et pas seulement par la couleur : son titre le nomme.
 *
 * Tout est au clavier : flèches pour parcourir, Entrée pour ouvrir, D pour
 * télécharger, F pour le favori — les mêmes touches que la fiche.
 */
import { formatAge, formatSize } from '~/utils/format';

export interface CatalogueRow {
  id: string;
  infoHash: string;
  name: string;
  size: number;
  createdAt: string;
  season?: number | null;
  episode?: number | null;
  isSticky?: boolean;
  supersededById?: string | null;
  freeleech?: boolean;
  viewerTaken?: boolean;
  viewerFavorited?: boolean;
  uploader?: { id: string; username: string | null } | null;
  work?: { title: string; year: number | null; posterUrl: string | null; type: string | null } | null;
  category?: { id: string; name: string; icon?: string | null } | null;
  tags?: Array<{ id: string; name: string; slug: string; color?: string | null }> | null;
  stats: { seeders: number; leechers: number; completed: number };
}

const props = withDefaults(
  defineProps<{
    torrents: CatalogueRow[];
    dense?: boolean;
    /** Le bloc des épinglés : même lignes, teinte chaude, sans en-tête. */
    pinned?: boolean;
    showHeader?: boolean;
  }>(),
  { dense: false, pinned: false, showHeader: true },
);

const { t } = useI18n();
const notifications = useNotificationStore();
const listRef = ref<HTMLElement | null>(null);

/* ── Favoris : optimiste, annulé si le serveur refuse ─────────────────────── */
const favOverride = ref(new Map<string, boolean>());
const isFavorited = (row: CatalogueRow) => favOverride.value.get(row.infoHash) ?? !!row.viewerFavorited;
async function toggleFavorite(row: CatalogueRow) {
  const before = isFavorited(row);
  favOverride.value.set(row.infoHash, !before);
  try {
    await $fetch(`/api/torrents/${row.infoHash}/favorite`, { method: before ? 'DELETE' : 'POST' });
  } catch (err: any) {
    favOverride.value.set(row.infoHash, before);
    notifications.error(err?.data?.message || t('components.torrentTable.errors.favoriteFailed'));
  }
}

/* ── L'état de l'essaim, lisible sans les chiffres ────────────────────────── */
type SwarmState = 'dead' | 'thin' | 'ok' | 'hot';
function swarmState(row: CatalogueRow): SwarmState {
  const s = row.stats.seeders;
  if (s === 0) return 'dead';
  if (s < 3) return 'thin';
  if (s >= 20) return 'hot';
  return 'ok';
}
const swarmTitle = (row: CatalogueRow) =>
  t(`search.rows.swarm.${swarmState(row)}`, { s: row.stats.seeders, l: row.stats.leechers });

const unit = (row: CatalogueRow) => {
  const parts: string[] = [];
  if (typeof row.season === 'number') parts.push(`S${String(row.season).padStart(2, '0')}`);
  if (typeof row.episode === 'number') parts.push(`E${String(row.episode).padStart(2, '0')}`);
  return parts.join(' · ');
};

const detailTo = (row: CatalogueRow) => `/torrents/${row.infoHash}`;
const downloadHref = (row: CatalogueRow) => `/api/torrents/${row.infoHash}/download`;

/* ── Clavier : ↑↓ parcourir, D télécharger, F favori ──────────────────────── */
function rowsEls(): HTMLElement[] {
  return Array.from(listRef.value?.querySelectorAll<HTMLElement>('.rr-row') ?? []);
}
function onKey(e: KeyboardEvent) {
  if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
  const target = e.target as HTMLElement | null;
  if (!target || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
  const rowEl = target.closest<HTMLElement>('.rr-row');
  if (!rowEl) return;
  const rows = rowsEls();
  const i = rows.indexOf(rowEl);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const next = rows[i + (e.key === 'ArrowDown' ? 1 : -1)];
    if (!next) return;
    e.preventDefault();
    next.querySelector<HTMLElement>('.rr-primary')?.focus();
    return;
  }
  if (e.key === 'd' || e.key === 'D') {
    const a = rowEl.querySelector<HTMLAnchorElement>('.rr-dl');
    if (a) {
      e.preventDefault();
      a.click();
    }
    return;
  }
  if (e.key === 'f' || e.key === 'F') {
    const b = rowEl.querySelector<HTMLButtonElement>('.rr-fav');
    if (b) {
      e.preventDefault();
      b.click();
    }
  }
}
</script>

<template>
  <div
    ref="listRef"
    class="rr"
    :class="{ 'rr--dense': dense, 'rr--pinned': pinned }"
    @keydown="onKey"
  >
    <div v-if="showHeader && torrents.length" class="rr-head" aria-hidden="true">
      <span />
      <span>{{ t('search.rows.release') }}</span>
      <span>{{ t('search.rows.quality') }}</span>
      <span class="rr-num">{{ t('search.rows.size') }}</span>
      <span class="rr-num">{{ t('search.rows.swarm.label') }}</span>
      <span class="rr-col-by">{{ t('search.rows.by') }}</span>
      <span>{{ t('search.rows.age') }}</span>
      <span /><span />
    </div>
    <ul class="rr-list">
      <li
        v-for="row in torrents"
        :key="row.id"
        class="rr-row"
        :data-state="swarmState(row)"
        :class="{ 'is-taken': row.viewerTaken, 'is-old': !!row.supersededById }"
      >
        <span class="rr-pip" :title="swarmTitle(row)"><span class="sr-only">{{ swarmTitle(row) }}</span></span>

        <div class="rr-main">
          <div class="rr-l1">
            <NuxtLink
              class="rr-title rr-primary"
              :class="{ 'rr-title--name': !row.work?.title }"
              :to="detailTo(row)"
              :title="row.name"
            >
              <template v-if="row.work?.title">
                {{ row.work.title }}<span v-if="row.work.year" class="rr-year"> {{ row.work.year }}</span>
              </template>
              <template v-else>{{ row.name }}</template>
            </NuxtLink>
            <span v-if="unit(row)" class="rr-unit">{{ unit(row) }}</span>
            <span v-if="row.freeleech" class="rr-badge rr-badge--free">{{ t('search.rows.free') }}</span>
            <span v-if="row.supersededById" class="rr-badge rr-badge--old">{{ t('search.rows.replaced') }}</span>
            <span v-if="row.viewerTaken" class="rr-badge rr-badge--taken">
              <Icon name="ph:check-bold" aria-hidden="true" />{{ t('search.rows.taken') }}
            </span>
          </div>
          <p v-if="row.work?.title" class="rr-name" :title="row.name">{{ row.name }}</p>
          <p v-else-if="row.category" class="rr-cat">{{ row.category.name }}</p>
        </div>

        <TorrentDetailQualityChips :name="row.name" :tags="row.tags ?? null" compact class="rr-chips" />

        <span class="rr-size rr-num">{{ formatSize(row.size) }}</span>

        <span class="rr-swarm rr-num" :title="swarmTitle(row)">
          <span class="rr-seed"><Icon name="ph:arrow-up-bold" aria-hidden="true" />{{ row.stats.seeders }}</span>
          <span class="rr-leech"><Icon name="ph:arrow-down-bold" aria-hidden="true" />{{ row.stats.leechers }}</span>
        </span>

        <span class="rr-by rr-col-by">
          <NuxtLink v-if="row.uploader?.username" :to="`/users/${row.uploader.id}`" class="rr-by-link">
            {{ row.uploader.username }}
          </NuxtLink>
          <span v-else class="rr-by-none">—</span>
        </span>

        <time class="rr-age" :datetime="row.createdAt">{{ formatAge(row.createdAt) }}</time>

        <button
          v-if="row.viewerFavorited !== undefined"
          type="button"
          class="rr-ico rr-fav"
          :class="{ 'is-on': isFavorited(row) }"
          :aria-pressed="isFavorited(row)"
          :aria-label="isFavorited(row) ? t('components.torrentTable.unfavorite') : t('components.torrentTable.favorite')"
          @click.stop="toggleFavorite(row)"
        >
          <Icon :name="isFavorited(row) ? 'ph:star-fill' : 'ph:star-bold'" aria-hidden="true" />
        </button>
        <span v-else />
        <a
          class="rr-ico rr-dl"
          :href="downloadHref(row)"
          download
          :aria-label="t('search.rows.download', { name: row.name })"
        >
          <Icon name="ph:download-simple-bold" aria-hidden="true" />
        </a>
      </li>
    </ul>
    <p v-if="torrents.length && showHeader" class="rr-keys" aria-hidden="true">{{ t('search.rows.shortcuts') }}</p>
  </div>
</template>

<style scoped>
.rr {
  container-type: inline-size;
  border: 1px solid rgb(var(--line-default) / 1);
  border-radius: var(--radius-lg);
  background: rgb(var(--bg-surface) / 1);
  overflow: hidden;
}
.rr--pinned {
  border-color: rgb(var(--accent-warm) / 0.35);
  background: rgb(var(--accent-warm) / 0.05);
}
.rr-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

/* ── La grille, partagée par l'en-tête et les lignes ────────────────────── */
.rr-head,
.rr-row {
  display: grid;
  grid-template-columns: 0.5rem minmax(0, 1fr) minmax(0, 17rem) 5.25rem 5.75rem 7rem 4.75rem 2rem 2rem;
  gap: 0 0.85rem;
  align-items: center;
  padding: 0.7rem 0.85rem 0.7rem 0.65rem;
}
.rr-head {
  padding-top: 0.45rem;
  padding-bottom: 0.45rem;
  border-bottom: 1px solid rgb(var(--line-default) / 1);
  font-family: var(--font-mono);
  font-size: 0.66rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: rgb(var(--fg-muted) / 1);
  background: rgb(var(--bg-inset) / 0.6);
}
.rr-row {
  position: relative;
  border-bottom: 1px solid rgb(var(--line-default) / 0.7);
  transition: background-color var(--dur-2) var(--ease-standard);
}
.rr-row:last-child {
  border-bottom: 0;
}
.rr-row:hover,
.rr-row:focus-within {
  background: rgb(var(--bg-hover) / 0.6);
}
.rr--dense .rr-row {
  padding-top: 0.35rem;
  padding-bottom: 0.35rem;
}
.rr--dense .rr-name,
.rr--dense .rr-cat {
  display: none;
}
.rr--dense .rr-chips {
  --qc-scale: 0.92;
}

/* ── La pastille d'état ──────────────────────────────────────────────────── */
.rr-pip {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: rgb(var(--fg-faint) / 1);
}
.rr-row[data-state='hot'] .rr-pip {
  background: rgb(var(--online) / 1);
  box-shadow: 0 0 0 3px rgb(var(--online) / 0.18);
}
.rr-row[data-state='ok'] .rr-pip {
  background: rgb(var(--online) / 0.8);
}
.rr-row[data-state='thin'] .rr-pip {
  background: rgb(var(--warning) / 1);
}
.rr-row[data-state='dead'] .rr-pip {
  background: transparent;
  box-shadow: inset 0 0 0 1.5px rgb(var(--danger) / 0.7);
}

/* ── La colonne principale ───────────────────────────────────────────────── */
.rr-main {
  min-width: 0;
  display: grid;
  gap: 0.15rem;
}
.rr-l1 {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.2rem 0.5rem;
  min-width: 0;
}
.rr-title {
  font-weight: 600;
  font-size: 0.95rem;
  color: rgb(var(--fg-strong) / 1);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
  border-radius: var(--radius-xs);
}
.rr-title::after {
  /* La ligne entière ouvre la fiche, sans emballer neuf cellules dans un lien. */
  content: '';
  position: absolute;
  inset: 0;
  z-index: 0;
}
.rr-title--name {
  font-family: var(--font-mono);
  font-weight: 500;
  font-size: 0.82rem;
  letter-spacing: -0.01em;
}
.rr-year {
  font-weight: 400;
  color: rgb(var(--fg-muted) / 1);
}
.rr-unit {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  padding: 0.05rem 0.4rem;
  border-radius: var(--radius-xs);
  background: rgb(var(--bg-inset) / 1);
  color: rgb(var(--fg-default) / 1);
}
.rr-name,
.rr-cat {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: rgb(var(--fg-muted) / 1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rr-cat {
  font-family: inherit;
}
.rr-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  height: 1.1rem;
  padding: 0 0.4rem;
  border-radius: var(--radius-pill);
  font-size: 0.66rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  line-height: 1;
}
.rr-badge :deep(svg) {
  width: 0.6rem;
  height: 0.6rem;
}
.rr-badge--free {
  background: rgb(var(--online) / 0.16);
  color: rgb(var(--online) / 1);
}
.rr-badge--old {
  background: rgb(var(--bg-inset) / 1);
  color: rgb(var(--fg-muted) / 1);
}
.rr-badge--taken {
  background: rgb(var(--info) / 0.14);
  color: rgb(var(--info) / 1);
}
.rr-row.is-old .rr-title,
.rr-row.is-old .rr-name {
  color: rgb(var(--fg-muted) / 1);
}

/* ── Les cellules ────────────────────────────────────────────────────────── */
.rr-chips {
  min-width: 0;
  position: relative;
  z-index: 1;
}
.rr-num {
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.rr-size {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  color: rgb(var(--fg-default) / 1);
  white-space: nowrap;
}
.rr-swarm {
  display: inline-flex;
  justify-content: flex-end;
  gap: 0.5rem;
  font-family: var(--font-mono);
  font-size: 0.78rem;
  white-space: nowrap;
}
.rr-seed,
.rr-leech {
  display: inline-flex;
  align-items: center;
  gap: 0.1rem;
}
.rr-seed {
  color: rgb(var(--online) / 1);
}
.rr-leech {
  color: rgb(var(--fg-muted) / 1);
}
.rr-row[data-state='dead'] .rr-seed {
  color: rgb(var(--danger) / 1);
}
.rr-swarm :deep(svg) {
  width: 0.65rem;
  height: 0.65rem;
}
.rr-by {
  min-width: 0;
  font-size: 0.78rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rr-by-link {
  position: relative;
  z-index: 1;
  color: rgb(var(--fg-default) / 1);
  text-decoration: none;
}
.rr-by-link:hover {
  color: rgb(var(--fg-strong) / 1);
  text-decoration: underline;
}
.rr-by-none {
  color: rgb(var(--fg-faint) / 1);
}
.rr-age {
  font-size: 0.75rem;
  color: rgb(var(--fg-muted) / 1);
  white-space: nowrap;
}
.rr-ico {
  position: relative;
  z-index: 1;
  display: inline-grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: var(--radius-sm);
  color: rgb(var(--fg-muted) / 1);
  transition:
    background-color var(--dur-1) var(--ease-standard),
    color var(--dur-1) var(--ease-standard),
    transform var(--dur-1) var(--ease-standard);
}
.rr-ico :deep(svg) {
  width: 1rem;
  height: 1rem;
}
.rr-ico:hover {
  background: rgb(var(--bg-inset) / 1);
  color: rgb(var(--fg-strong) / 1);
}
.rr-ico:active {
  transform: scale(0.92);
}
.rr-fav.is-on {
  color: rgb(var(--accent-warm-text) / 1);
}
.rr-dl:hover {
  color: rgb(var(--accent-warm-text) / 1);
}
.rr-keys {
  margin: 0;
  padding: 0.35rem 0.85rem;
  border-top: 1px solid rgb(var(--line-default) / 0.7);
  font-family: var(--font-mono);
  font-size: 0.66rem;
  letter-spacing: 0.02em;
  color: rgb(var(--fg-faint) / 1);
}
@media (pointer: coarse) {
  .rr-keys {
    display: none;
  }
}

/* ── Quand la place manque : l'uploadeur, puis l'empilement ─────────────── */
@container (max-width: 64rem) {
  .rr-head,
  .rr-row {
    grid-template-columns: 0.5rem minmax(0, 1fr) minmax(0, 15rem) 5.25rem 5.75rem 4.75rem 2rem 2rem;
  }
  .rr-col-by {
    display: none;
  }
}
@container (max-width: 46rem) {
  .rr-head {
    display: none;
  }
  .rr-row {
    grid-template-columns: 0.5rem minmax(0, 1fr) 2.25rem 2.25rem;
    grid-template-areas:
      'pip main fav dl'
      'pip chips chips chips'
      'pip meta meta meta';
    row-gap: 0.4rem;
    padding: 0.85rem 0.75rem 0.85rem 0.65rem;
  }
  .rr-pip {
    grid-area: pip;
    align-self: start;
    margin-top: 0.45rem;
  }
  .rr-main {
    grid-area: main;
  }
  .rr-chips {
    grid-area: chips;
  }
  .rr-fav {
    grid-area: fav;
  }
  .rr-dl {
    grid-area: dl;
  }
  .rr-size,
  .rr-swarm,
  .rr-age {
    grid-area: meta;
    text-align: left;
    justify-content: flex-start;
  }
  .rr-size {
    justify-self: start;
  }
  .rr-swarm {
    justify-self: center;
  }
  .rr-age {
    justify-self: end;
  }
  .rr-ico {
    width: 2.25rem;
    height: 2.25rem;
  }
  .rr--dense .rr-name {
    display: block;
  }
}
@media (prefers-reduced-motion: reduce) {
  .rr-row,
  .rr-ico {
    transition: none;
  }
}
</style>
