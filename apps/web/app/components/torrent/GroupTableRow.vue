<template>
  <!--
    One work in the grouped catalogue, as a table row.

    The row answers, without being opened: what this is, how it has been cut,
    how big the releases run, how alive the swarm is, and how recently anything
    landed. Opening it is for choosing a file, not for finding out what is
    there — which is why the scope chips sit on the collapsed row.

    It is a `<tr>` rather than the card it used to be so that the grouped view
    and the flat one share a header, a column rhythm and a sort. Two listings
    that answer the same question in different shapes should not read as two
    different instruments.
  -->
  <tr
    class="gtr"
    :class="{ 'gtr--open': open }"
    :aria-expanded="open"
    @click="toggle()"
  >
    <td>
      <div class="gtr-name-inner">
        <!-- Forty pixels is enough to recognise something already known; the
             hover preview is for everything else. -->
        <TorrentPosterHover
          :src="poster?.posterUrl"
          :large="largePoster"
          :alt="title"
          :loading="posterLoading"
          :fallback-icon="kindIcon"
        />

        <div class="gtr-text">
          <p class="gtr-title" :class="{ 'gtr-title--mono': !poster?.title }">
            {{ title }}
            <span v-if="poster?.year" class="gtr-year">({{ poster.year }})</span>
          </p>

          <div class="gtr-meta">
            <span v-if="categoryName" class="gtr-cat">{{ categoryName }}</span>

            <!--
              The scope chips: each is both a label and a way in. Clicking one
              opens the row already on that cut, so "give me the season packs"
              is one click rather than open-then-hunt. The chip carrying the
              newest release is the lit one, and the one a plain row click uses.
            -->
            <button
              v-for="s in group.scopes"
              :key="s.scope"
              type="button"
              class="gtr-scope"
              :class="{
                'gtr-scope--active': open && scope === s.scope,
                'gtr-scope--default': !open && s.scope === group.defaultScope,
              }"
              @click.stop="openScope(s.scope)"
            >
              {{ scopeLabel(s) }}
            </button>

            <!-- The one thing the local catalogue cannot answer about itself:
                 somebody else has more of this work. A link, not a merge. -->
            <NuxtLink
              v-if="group.partnerReleaseCount"
              :to="`/federated?q=${encodeURIComponent(searchableTitle)}`"
              class="gtr-partners"
              :title="$t('search.group.onPartnersHint')"
              @click.stop
            >
              <Icon name="ph:broadcast-bold" />
              {{ $t('search.group.onPartners', { n: group.partnerReleaseCount }) }}
            </NuxtLink>

            <span v-if="group.peerCount" class="gtr-partners">
              <Icon name="ph:broadcast-bold" />
              {{ $t('search.group.peerCount', group.peerCount) }}
            </span>
          </div>
        </div>
      </div>
    </td>

    <!--
      Spans, not sums, in the swarm columns: adding them up would describe
      seeding every edition of the same work at once. What a member weighs is
      "is the copy I want alive", and the span is what says so. The listing
      still SORTS on the group's total — a different question, answered in
      `buildGroupOrderBy`.
    -->
    <td class="gtr-num">
      <span class="stat-badge stat-seeders" :class="{ 'is-dead': group.seedMax === 0 }">
        <Icon name="ph:arrow-up-bold" class="text-[8px]" />
        {{ span(group.seedMin, group.seedMax) }}
      </span>
    </td>
    <td class="gtr-num">
      <span v-if="group.leechMax != null" class="stat-badge stat-leechers">
        <Icon name="ph:arrow-down-bold" class="text-[8px]" />
        {{ span(group.leechMin ?? 0, group.leechMax) }}
      </span>
      <span v-else class="gtr-dash">—</span>
    </td>
    <!-- Completions are cumulative, so the group's total is the only figure
         that means anything here. -->
    <td class="gtr-num">
      <span class="gtr-completed">{{ group.completedTotal ?? 0 }}</span>
    </td>
    <td class="gtr-size">{{ sizeSpan }}</td>
    <td class="gtr-age">{{ age }}</td>
    <td class="gtr-chev">
      <Icon :name="open ? 'ph:caret-up-bold' : 'ph:caret-down-bold'" />
    </td>
  </tr>

  <!-- The releases, in the row's own width. A second `<tr>` rather than a
       nested table: the files answer a different question from the works above
       them and deserve their own columns. -->
  <tr v-if="open" class="gtr-expanded">
    <td :colspan="7">
      <TorrentGroupTree
        :group-key="group.key"
        :scope="scope"
        :endpoint="treeEndpoint"
      />
      <NuxtLink v-if="!hidePageLink" :to="groupHref" class="gtr-more" @click.stop>
        {{ $t('search.group.openPage') }}
        <Icon name="ph:arrow-right-bold" />
      </NuxtLink>
    </td>
  </tr>
</template>

<script setup lang="ts">
import type { GroupScope, ScopeSummary } from '~/utils/groupScopes';
import type { GroupSummary } from './GroupRow.vue';

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
  }
);

const { t } = useI18n();

/**
 * "Per episode (7)". Only the fallback scope pluralises — the others put the
 * count in parentheses, where singular and plural read the same.
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
      : props.group.externalId
);

const posters = useMediaPosters();
watchEffect(() => {
  if (lookupId.value) posters.register(lookupId.value, hint.value);
});
const poster = computed(() => posters.posterFor(lookupId.value, hint.value));
const posterLoading = computed(() =>
  posters.isPosterLoading(lookupId.value, hint.value)
);

/** Falls back to the largest release's filename until metadata resolves. */
const title = computed(() => poster.value?.title || props.group.leadName);

/**
 * The full-size poster for the hover preview: the composable downscales TMDb's
 * `w500` to `w342` so a page of thumbnails does not pull half a megabyte per
 * row, and the preview wants the original back.
 */
const largePoster = computed(
  () => poster.value?.posterUrl?.replace('/w342/', '/w500/') ?? null
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
  () => props.pageHref ?? `/torrents/group/${props.group.key}`
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
    : `${formatSize(props.group.minSize)} – ${formatSize(props.group.maxSize)}`
);

function span(min: number, max: number): string {
  return min === max ? String(max) : `${min}-${max}`;
}

const age = computed(() => formatAge(props.group.latest));

/**
 * What to search the federated catalogue for: the resolved title when metadata
 * came back, otherwise the release name with its technical tail cut off — a
 * partner's copy of the same work almost never shares our filename.
 */
const searchableTitle = computed(() => {
  if (poster.value?.title) return poster.value.title;
  const { tag, lead, tail } = splitReleaseName(props.group.leadName);
  return (tag + lead).trim() || tail;
});
</script>

<style scoped>
.gtr {
  cursor: pointer;
  transition: background-color var(--dur-1) ease;
}

.gtr:hover {
  background: rgb(var(--bg-hover));
}

/* An open row and its releases read as one block: the parent keeps the hover
   tint so the eye does not lose which work it opened. */
.gtr--open {
  background: rgb(var(--bg-hover));
}

.gtr-name-inner {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  min-width: 0;
}

.gtr-text {
  min-width: 0;
}

/* A work's title is prose; a release name is a machine string. The two views
   carry the same columns, and this is what tells them apart at a glance. */
.gtr-title {
  font-size: 0.875rem;
  font-weight: 500;
  color: rgb(var(--fg-strong));
  line-height: 1.3;
  overflow-wrap: anywhere;
  text-wrap: pretty;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.gtr-title--mono {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.8125rem;
}

.gtr-year {
  color: rgb(var(--fg-faint));
  font-weight: 400;
}

.gtr-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.375rem;
  margin-top: 0.25rem;
}

.gtr-cat {
  font-size: 0.5625rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: var(--radius-xs);
  background: rgb(167 139 250 / 0.15);
  color: rgb(196 181 253);
  white-space: nowrap;
}

.gtr-scope {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  font: inherit;
  font-size: 0.625rem;
  font-weight: 500;
  padding: 2px 6px;
  border-radius: var(--radius-xs);
  border: 1px solid rgb(var(--line-strong));
  background: transparent;
  color: rgb(var(--fg-muted));
  cursor: pointer;
  white-space: nowrap;
  transition:
    border-color var(--dur-1) ease,
    color var(--dur-1) ease,
    background-color var(--dur-1) ease;
}

.gtr-scope:hover {
  color: rgb(var(--fg-default));
  border-color: rgb(var(--fg-faint));
}

/* Lit: the cut a plain row click will open. Filled: the cut currently showing. */
.gtr-scope--default {
  background: rgb(167 139 250 / 0.09);
  border-color: rgb(167 139 250 / 0.35);
  color: rgb(196 181 253);
}

.gtr-scope--active {
  background: rgb(167 139 250 / 0.18);
  border-color: rgb(167 139 250 / 0.5);
  color: rgb(196 181 253);
}

.gtr-partners {
  display: inline-flex;
  align-items: center;
  gap: 0.1875rem;
  font-size: 0.6875rem;
  color: rgb(var(--accent));
}

.gtr-num {
  text-align: center;
  white-space: nowrap;
}

.gtr-completed {
  font-size: 0.75rem;
  color: rgb(var(--fg-default));
  font-variant-numeric: tabular-nums;
}

.gtr-dash {
  color: rgb(var(--fg-faint));
}

.gtr-size,
.gtr-age {
  text-align: right;
  white-space: nowrap;
  font-size: 0.75rem;
  color: rgb(var(--fg-default));
  font-variant-numeric: tabular-nums;
}

.gtr-chev {
  text-align: center;
  color: rgb(var(--fg-faint));
}

.gtr-expanded > td {
  /* The releases sit inside the row's width with no cell padding of their own:
     the tree brings its own rhythm and a second inset would stack two. */
  padding: 0;
  background: rgb(var(--bg-inset));
}

.gtr-more {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.5rem 0.75rem;
  font-size: 0.75rem;
  color: rgb(var(--accent));
}

.is-dead {
  opacity: 0.55;
}
</style>
