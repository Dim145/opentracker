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

          <!-- Where this work lives. The releases from our partners are IN
               this row now, so this is a fact about what expanding it will
               show — not a link to a second catalogue to go and check.

               Two shades, because they mean different things: some of it is
               only theirs, or all of it is. A member deciding whether to click
               cares which. -->
          <span
            v-if="group.partnerCount"
            class="grp-partners"
            :class="{ 'grp-partners--only': !group.localCount }"
            :title="
              group.localCount
                ? $t('search.group.onPartnersHint')
                : $t('search.group.partnersOnlyHint')
            "
          >
            <Icon name="ph:broadcast-bold" />
            {{
              group.localCount
                ? $t('search.group.onPartners', { n: group.partnerCount })
                : $t('search.group.partnersOnly', { n: group.partnerCount })
            }}
          </span>

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
  /**
   * Totals across the group. The rows show the spans above — what tells a
   * member whether the release they want is dead — while the listing sorts on
   * these, because "which work is most alive" is a question about the whole
   * group. Absent on the federated mirror.
   */
  seedTotal?: number;
  leechTotal?: number;
  completedTotal?: number;
  totalSize?: number;
  oldest?: string;
  scopes: ScopeSummary[];
  defaultScope: GroupScope;
  /**
   * How this row's releases are split between the two catalogues.
   *
   * They overlap: a release we hold that a partner also holds counts in both,
   * and in `releaseCount` exactly once. That is what lets the row say "seven
   * releases, four of which are also on partners" rather than claiming eleven.
   */
  localCount?: number;
  partnerCount?: number;
  /** How many partners contribute at least one release to this group. */
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

</script>

<style scoped>
.grp {
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  background: rgb(var(--bg-elevated) / 0.35);
  overflow: hidden;
  transition: border-color var(--dur-2) ease;
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
  transition: background-color var(--dur-1) ease;
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
  font-family: var(--font-mono);
  font-size: 0.75rem;
  font-weight: 500;
  color: rgb(var(--fg-default));
}
.grp-year {
  font-family: var(--font-mono);
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
  letter-spacing: calc(0.1em * var(--tracking-scale));
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: var(--radius-xs);
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
  border-radius: var(--radius-xs);
  border: 1px solid rgb(var(--line-strong));
  background: transparent;
  color: rgb(var(--fg-muted));
  cursor: pointer;
  white-space: nowrap;
  transition: border-color var(--dur-1) ease, color var(--dur-1) ease, background-color var(--dur-1) ease;
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
  border-radius: var(--radius-xs);
  border: 1px solid rgb(56 189 248 / 0.35);
  background: rgb(56 189 248 / 0.1);
  color: rgb(125 211 252);
  white-space: nowrap;
}
/* Nothing of this work is here. Filled rather than outlined, so the two states
   are told apart at a glance instead of by reading the number. */
.grp-partners--only {
  border-color: rgb(56 189 248 / 0.6);
  background: rgb(56 189 248 / 0.22);
  color: rgb(186 230 253);
}

/* ── Figures ─────────────────────────────────────────────────────────── */
.grp-facts {
  display: flex;
  align-items: center;
  gap: 1rem;
  font-family: var(--font-mono);
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
  letter-spacing: calc(0.1em * var(--tracking-scale));
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  border-top: 1px dashed rgb(var(--line-default));
  transition: color var(--dur-1) ease, background-color var(--dur-1) ease;
}
.grp-more:hover {
  color: #e5bf58;
  background: rgb(var(--accent-warm) / 0.06);
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
