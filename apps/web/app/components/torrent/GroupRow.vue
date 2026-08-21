<template>
  <!--
    One work in the grouped catalogue, collapsed.

    The row answers, without being opened: what this is, how it has been cut,
    how big the releases run, how alive the swarm is, and how recently anything
    landed. Opening it is for choosing a file, not for finding out what is
    there — which is why the scope chips are on the collapsed row and not
    inside it.
  -->
  <article class="grp" :class="{ 'grp--open': open }">
    <div class="grp-head" :class="{ 'grp-head--clickable': true }" @click="toggle()">
      <!-- Forty pixels is enough to recognise something already known. The
           hover preview is for everything else — telling two seasons of the
           same show apart, reading a title off the artwork. -->
      <TorrentPosterHover
        class="grp-poster"
        :src="poster?.posterUrl"
        :large="largePoster"
        :alt="title"
        :loading="posterLoading"
        :fallback-icon="kindIcon"
      />

      <div class="grp-body">
        <h3 class="grp-title" :class="{ 'grp-title--mono': !poster?.title }">
          {{ title }}
          <span v-if="poster?.year" class="grp-year">({{ poster.year }})</span>
        </h3>

        <div class="grp-tags">
          <span v-if="categoryName" class="grp-cat">{{ categoryName }}</span>
          <span v-if="categoryName && group.scopes.length" class="grp-tags-sep">|</span>

          <!--
            The scope chips. Each is both a label and a way in: clicking one
            opens the row already on that cut, so "give me the season packs" is
            one click rather than open-then-hunt. The chip carrying the newest
            release is the one that is lit, and the one a plain row click uses.
          -->
          <button
            v-for="s in group.scopes"
            :key="s.scope"
            type="button"
            class="grp-scope"
            :class="{ 'grp-scope--active': open && scope === s.scope,
                      'grp-scope--default': !open && s.scope === group.defaultScope }"
            @click.stop="openScope(s.scope)"
          >
            {{ scopeLabel(s) }}
            <Icon
              :name="open && scope === s.scope ? 'ph:caret-up-bold' : 'ph:caret-down-bold'"
              class="grp-scope-chev"
            />
          </button>

          <!-- The one thing the local catalogue cannot answer about itself:
               somebody else has more of this work. A link, not a merge — the
               federated catalogue is a place, and this says it is worth
               going. -->
          <NuxtLink
            v-if="group.partnerReleaseCount"
            :to="`/federated?q=${encodeURIComponent(searchableTitle)}`"
            class="grp-partners"
            :title="$t('search.group.onPartnersHint')"
            @click.stop
          >
            <Icon name="ph:broadcast-bold" />
            {{ $t('search.group.onPartners', { n: group.partnerReleaseCount }) }}
          </NuxtLink>

          <span v-if="group.peerCount" class="grp-peers">
            <Icon name="ph:broadcast-bold" />
            {{ $t('search.group.peerCount', group.peerCount) }}
          </span>
        </div>
      </div>

      <div class="grp-facts">
        <span class="grp-age">{{ age }}</span>
        <span class="grp-size">{{ sizeSpan }}</span>
        <!--
          A range, from the periodic snapshot rather than from Redis. Live
          numbers would be one read per release — hundreds for a long-running
          series, on a row nobody has opened. They appear the moment a scope is
          expanded, where the rows are few and the number decides something.
        -->
        <span class="grp-seed" :class="{ 'grp-seed--dead': group.seedMax === 0 }">
          <Icon name="ph:arrow-up-bold" />{{ span(group.seedMin, group.seedMax) }}
        </span>
        <span v-if="group.leechMax != null" class="grp-leech">
          <Icon name="ph:arrow-down-bold" />{{ span(group.leechMin ?? 0, group.leechMax) }}
        </span>
      </div>

      <Icon
        :name="open ? 'ph:caret-up-bold' : 'ph:caret-down-bold'"
        class="grp-chev"
      />
    </div>

    <TorrentGroupTree
      v-if="open"
      class="grp-tree"
      :group-key="group.key"
      :scope="scope"
      :endpoint="treeEndpoint"
    />

    <NuxtLink
      v-if="open && !hidePageLink"
      :to="groupHref"
      class="grp-more"
      @click.stop
    >
      {{ $t('search.group.openPage') }}
      <Icon name="ph:arrow-right-bold" />
    </NuxtLink>
  </article>
</template>

<script setup lang="ts">
import type { GroupScope, ScopeSummary } from '~/utils/groupScopes';

export interface GroupSummary {
  key: string;
  source: 'tmdb' | 'igdb' | 'openlibrary' | 'solo';
  externalId: string;
  releaseCount: number;
  latest: string;
  minSize: number;
  maxSize: number;
  leadName: string;
  categoryIds: string[];
  seedMin: number;
  seedMax: number;
  /** Absent on the federated mirror, which does not track leechers per source. */
  leechMin?: number;
  leechMax?: number;
  scopes: ScopeSummary[];
  defaultScope: GroupScope;
  /**
   * How many releases the PARTNERS hold for this same work. The bridge between
   * the two catalogues, and deliberately a count rather than a merge: it
   * answers the question a member actually has — does someone else have the
   * season I am missing — for one indexed query per page.
   */
  partnerReleaseCount?: number;
  /** On a federated row: how many partners contribute to this group. */
  peerCount?: number;
}

const props = withDefaults(
  defineProps<{
    group: GroupSummary;
    /** Already resolved by the page — the row knows nothing about categories. */
    categoryLabel?: string | null;
    /** Which catalogue the tree reads. */
    treeEndpoint?: string;
    /** Where "open the group page" goes; omit for the local default. */
    pageHref?: string | null;
    /**
     * Federated groups have no page on this instance — the local group route
     * would look up a key the local catalogue does not hold.
     */
    hidePageLink?: boolean;
  }>(),
  {
    categoryLabel: null,
    treeEndpoint: '/api/torrents/group',
    pageHref: null,
    hidePageLink: false,
  },
);

const { t } = useI18n();

/**
 * "À l'épisode (7)". Only the fallback scope pluralises — the others put the
 * count in parentheses, where a singular and a plural read the same.
 */
function scopeLabel(s: ScopeSummary): string {
  return s.scope === 'all'
    ? t('search.group.scope.all', s.units)
    : t(scopeLabelKey(s.scope), { n: s.units });
}

const open = ref(false);
const scope = ref<GroupScope>(props.group.defaultScope);

function toggle() {
  if (!open.value) scope.value = props.group.defaultScope;
  open.value = !open.value;
}

function openScope(next: GroupScope) {
  // Clicking the chip of the scope already showing closes the row, so the same
  // gesture that opened it puts it away.
  if (open.value && scope.value === next) {
    open.value = false;
    return;
  }
  scope.value = next;
  open.value = true;
}

// ── Metadata ─────────────────────────────────────────────────────────────
const hint = computed<'movie' | 'tv' | 'game' | 'book' | null>(() => {
  const g = props.group;
  if (g.source === 'igdb') return 'game';
  if (g.source === 'openlibrary') return 'book';
  if (g.externalId.startsWith('tv/')) return 'tv';
  if (g.externalId.startsWith('movie/')) return 'movie';
  return null;
});

/** The lookup wants a bare TMDb id; the key keeps the namespace. */
const lookupId = computed(() =>
  props.group.source === 'solo'
    ? null
    : props.group.source === 'tmdb'
      ? props.group.externalId.replace(/^(movie|tv)\//, '')
      : props.group.externalId,
);

const posters = useMediaPosters();
watchEffect(() => {
  if (lookupId.value) posters.register(lookupId.value, hint.value);
});
const poster = computed(() => posters.posterFor(lookupId.value, hint.value));
const posterLoading = computed(() =>
  posters.isPosterLoading(lookupId.value, hint.value),
);

/** Falls back to the largest release's filename until metadata resolves. */
const title = computed(() => poster.value?.title || props.group.leadName);

/**
 * The full-size poster for the hover preview.
 *
 * The composable downscales TMDb's `w500` to `w342` so a page of thumbnails
 * does not pull half a megabyte per row; the preview wants the original back.
 * Undoing the substitution costs nothing and keeps one lookup, not two. A
 * source with no such ladder — IGDB, Open Library — hands back the same URL,
 * which is still an improvement on forty pixels wide.
 */
const largePoster = computed(
  () => poster.value?.posterUrl?.replace('/w342/', '/w500/') ?? null,
);

const kindIcon = computed(() => {
  switch (hint.value) {
    case 'tv':
      return 'ph:television-bold';
    case 'game':
      return 'ph:game-controller-bold';
    case 'book':
      return 'ph:book-open-bold';
    case 'movie':
      return 'ph:film-slate-bold';
    default:
      return 'ph:package-bold';
  }
});

const categoryName = computed(() => props.categoryLabel);

const groupHref = computed(
  () => props.pageHref ?? `/torrents/group/${props.group.key}`,
);

// ── Figures ──────────────────────────────────────────────────────────────
/**
 * A span, never a sum. Adding the releases up would describe downloading every
 * edition of the same work, which nobody does; the span is what a member
 * actually weighs — "is the cheapest copy 1.4 GB or 40 GB".
 */
const sizeSpan = computed(() =>
  props.group.minSize === props.group.maxSize
    ? formatSize(props.group.maxSize)
    : `${formatSize(props.group.minSize)} – ${formatSize(props.group.maxSize)}`,
);

function span(min: number, max: number): string {
  return min === max ? String(max) : `${min}-${max}`;
}

const age = computed(() => formatAge(props.group.latest));

/**
 * What to search the federated catalogue for. The resolved title when metadata
 * came back, otherwise the release name with its technical tail cut off — a
 * partner's copy of the same work almost never shares our filename, so sending
 * the whole thing would find nothing.
 */
const searchableTitle = computed(() => {
  if (poster.value?.title) return poster.value.title;
  const { tag, lead, tail } = splitReleaseName(props.group.leadName);
  return (tag + lead).trim() || tail;
});
</script>

<style scoped>
.grp {
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md, 8px);
  background: rgb(var(--bg-elevated) / 0.35);
  overflow: hidden;
  transition: border-color 140ms ease;
}
.grp--open {
  border-color: rgb(167 139 250 / 0.4);
}

.grp-head {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: center;
  gap: 0.9rem;
  padding: 0.6rem 0.85rem;
  cursor: pointer;
  transition: background-color 120ms ease;
}
.grp-head:hover {
  background: rgb(var(--bg-hover));
}

/* ── Identity ────────────────────────────────────────────────────────── */
.grp-body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.grp-title {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: rgb(var(--fg-strong));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Until the metadata lookup resolves the heading is a filename. Setting a
   filename in the title face reads as a broken title, so the fallback is
   typeset as what it is. */
.grp-title--mono {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.75rem;
  font-weight: 500;
  color: rgb(var(--fg-default));
}
.grp-year {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.6875rem;
  font-weight: 400;
  color: rgb(var(--fg-faint));
}

.grp-tags {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.grp-cat {
  font-size: 0.5625rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: 2px;
  background: rgb(167 139 250 / 0.15);
  color: rgb(196 181 253);
  white-space: nowrap;
}
.grp-tags-sep {
  color: rgb(var(--fg-faint));
  opacity: 0.4;
}

.grp-scope {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  font-size: 0.625rem;
  font-weight: 500;
  padding: 2px 6px;
  border-radius: 3px;
  border: 1px solid rgb(var(--line-strong));
  background: transparent;
  color: rgb(var(--fg-muted));
  cursor: pointer;
  white-space: nowrap;
  transition: border-color 120ms ease, color 120ms ease, background-color 120ms ease;
}
.grp-scope:hover {
  color: rgb(var(--fg-default));
  border-color: rgb(var(--fg-faint));
}
/* Lit while its scope is on screen. The dimmer "default" state marks, on a
   closed row, the cut a plain click will open — so the row tells you where
   it is about to take you. */
.grp-scope--active {
  background: rgb(167 139 250 / 0.18);
  border-color: rgb(167 139 250 / 0.5);
  color: rgb(196 181 253);
}
/* Filled, but a step down from active: on a closed row this is a prediction
   ("a plain click lands here"), not a state. */
.grp-scope--default {
  background: rgb(167 139 250 / 0.09);
  border-color: rgb(167 139 250 / 0.35);
  color: rgb(196 181 253);
}
.grp-scope-chev {
  width: 0.5rem;
  height: 0.5rem;
  opacity: 0.7;
}

/* Federated signals share one hue — cyan — across the whole interface, so
   "this comes from elsewhere" is learned once. */
.grp-partners,
.grp-peers {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.625rem;
  font-weight: 500;
  padding: 2px 6px;
  border-radius: 3px;
  border: 1px solid rgb(56 189 248 / 0.35);
  background: rgb(56 189 248 / 0.1);
  color: rgb(125 211 252);
  white-space: nowrap;
}
.grp-partners:hover {
  background: rgb(56 189 248 / 0.2);
  border-color: rgb(56 189 248 / 0.6);
}

/* ── Figures ─────────────────────────────────────────────────────────── */
.grp-facts {
  display: flex;
  align-items: center;
  gap: 1rem;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.625rem;
  color: rgb(var(--fg-muted));
  white-space: nowrap;
}
.grp-age {
  min-width: 3.5rem;
  text-align: right;
  color: rgb(var(--fg-faint));
}
.grp-size {
  min-width: 7rem;
  text-align: right;
  color: rgb(var(--fg-default));
}
.grp-seed,
.grp-leech {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-width: 3.2rem;
  justify-content: flex-end;
}
.grp-seed {
  color: rgb(var(--online));
}
/* Nothing seeding anywhere in the group: it looks available and is not. */
.grp-seed--dead {
  color: rgb(var(--danger));
}
.grp-leech {
  color: rgb(var(--fg-faint));
}

.grp-chev {
  width: 0.9rem;
  height: 0.9rem;
  color: rgb(var(--fg-faint));
}

.grp-tree {
  border-top: 1px solid rgb(var(--line-default));
}

.grp-more {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  padding: 0.5rem;
  font-size: 0.625rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  border-top: 1px dashed rgb(var(--line-default));
  transition: color 120ms ease, background-color 120ms ease;
}
.grp-more:hover {
  color: #e5bf58;
  background: rgb(212 167 52 / 0.06);
}

/* ── Phone ───────────────────────────────────────────────────────────── */
@media (max-width: 900px) {
  .grp-head {
    grid-template-columns: auto 1fr auto;
    grid-template-areas:
      'poster body chev'
      'facts facts facts';
    row-gap: 0.5rem;
  }
  .grp-poster {
    grid-area: poster;
  }
  .grp-body {
    grid-area: body;
  }
  .grp-chev {
    grid-area: chev;
  }
  .grp-facts {
    grid-area: facts;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .grp-age,
  .grp-size {
    text-align: left;
    min-width: 0;
  }
  .grp-seed,
  .grp-leech {
    min-width: 0;
  }
}
</style>
