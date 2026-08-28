<template>
  <div class="tree">
    <p v-if="initialPending" class="tree-loading">
      <Icon name="ph:circle-notch" class="animate-spin" />
      {{ $t('common.loading') }}
    </p>

    <template v-else>
      <!-- ── Seasons ──────────────────────────────────────────────────────
           Present for the two scopes that have them. A season nobody has
           opened still says how much it holds and how alive it is, so
           choosing one never requires opening three. -->
      <template v-for="s in seasons" :key="s.season ?? 'none'">
        <button
          type="button"
          class="lvl lvl--season"
          :class="{ 'lvl--open': openSeasons.has(s.season) }"
          :aria-expanded="openSeasons.has(s.season)"
          @click="toggleSeason(s.season)"
        >
          <span class="lvl-label">
            {{
              s.season === null
                ? $t('search.group.seasonUnknown')
                : $t('search.group.season', { n: s.season })
            }}
          </span>
          <!-- Episodes when the season HAS episodes, releases otherwise. What
               a member is judging in the episode scope is how much of the
               season exists, not how many encodes it adds up to. -->
          <span class="lvl-count">
            {{
              scope === 'episode'
                ? $t('search.group.nEpisodes', s.episodeCount)
                : $t('search.group.nReleases', s.releaseCount)
            }}
          </span>

          <!-- The ladder answers "what am I missing", which is the question a
               season list exists for. Only drawable once we hold the episode
               buckets, i.e. on a season that has been opened at least once. -->
          <TorrentGroupLadder
            v-if="scope === 'episode' && episodeNumbers(s.season).length"
            class="lvl-ladder"
            :episodes="episodeNumbers(s.season)"
            :season="s.season"
          />
          <TorrentGroupLadder
            v-else-if="s.resolutions.length"
            class="lvl-ladder"
            :resolutions="s.resolutions"
            :season="null"
          />

          <span class="lvl-seed">{{ s.seeders }}</span>
          <Icon
            :name="openSeasons.has(s.season) ? 'ph:caret-up-bold' : 'ph:caret-down-bold'"
            class="lvl-chev"
          />
        </button>

        <template v-if="openSeasons.has(s.season)">
          <p v-if="loading.has(bucketKey(s.season, null))" class="tree-loading">
            <Icon name="ph:circle-notch" class="animate-spin" />
            {{ $t('common.loading') }}
          </p>

          <!-- Episode scope: one more level down. -->
          <template v-else-if="scope === 'episode'">
            <template
              v-for="e in episodes.get(s.season) ?? []"
              :key="e.episode ?? 'none'"
            >
              <button
                type="button"
                class="lvl lvl--episode"
                :class="{ 'lvl--open': openEpisodes.has(bucketKey(s.season, e.episode)) }"
                :aria-expanded="openEpisodes.has(bucketKey(s.season, e.episode))"
                @click="toggleEpisode(s.season, e.episode)"
              >
                <span class="lvl-label lvl-label--ep">
                  {{ e.episode === null ? '—' : `E${String(e.episode).padStart(2, '0')}` }}
                </span>
                <span class="lvl-res">
                  {{
                    bestResolution(e.resolutions)
                      ? `${bestResolution(e.resolutions)} (${e.releaseCount})`
                      : e.releaseCount
                  }}
                </span>
                <span class="lvl-spacer" />
                <span class="lvl-seed">{{ e.seeders }}</span>
                <Icon
                  :name="
                    openEpisodes.has(bucketKey(s.season, e.episode))
                      ? 'ph:caret-up-bold'
                      : 'ph:caret-down-bold'
                  "
                  class="lvl-chev"
                />
              </button>

              <div
                v-if="openEpisodes.has(bucketKey(s.season, e.episode))"
                class="tree-releases"
              >
                <p
                  v-if="loading.has(bucketKey(s.season, e.episode))"
                  class="tree-loading"
                >
                  <Icon name="ph:circle-notch" class="animate-spin" />
                  {{ $t('common.loading') }}
                </p>
                <TorrentReleaseRow
                  v-for="r in releases.get(bucketKey(s.season, e.episode)) ?? []"
                  :key="r.id"
                  :release="r"
                />
              </div>
            </template>

            <p v-if="truncated.has(s.season)" class="tree-note">
              {{ $t('search.group.episodesTruncated') }}
            </p>
          </template>

          <!-- A season pack has no episode level: the season holds releases. -->
          <div v-else class="tree-releases">
            <TorrentReleaseRow
              v-for="r in releases.get(bucketKey(s.season, null)) ?? []"
              :key="r.id"
              :release="r"
            />
          </div>
        </template>
      </template>

      <!-- ── Flat scopes ─────────────────────────────────────────────────
           An integral, or anything that is not a series. Nothing to navigate;
           the releases are the whole answer. -->
      <div v-if="!seasons.length" class="tree-releases">
        <TorrentReleaseRow
          v-for="r in releases.get(FLAT) ?? []"
          :key="r.id"
          :release="r"
        />
        <p v-if="!(releases.get(FLAT) ?? []).length" class="tree-note">
          {{ $t('search.group.empty') }}
        </p>
      </div>

      <p v-if="releasesTruncated" class="tree-note">
        {{ $t('search.group.truncated') }}
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * One scope of one group, fetched bucket by bucket.
 *
 * The server returns a SKELETON — every season, the episodes of one season,
 * the releases of one episode — because a long-running series has more than a
 * thousand episodes and a listing page holds twenty-five groups.
 *
 * What is open is decided HERE, not by the server. An earlier version mirrored
 * the server's "one open bucket" directly, and it produced two surprises:
 * opening season 1 after browsing season 2 kept episode 3 expanded, because
 * the server had independently picked episode 3 as the newest one; and
 * clicking an open season or episode a second time did nothing, because there
 * was no state that could represent "closed". Both disappear once open-ness is
 * a set of buckets the member controls: seasons and episodes toggle
 * independently, several can be open at once, and what has been fetched stays
 * cached so re-opening costs nothing.
 *
 * The server's choice of bucket is still used, once: the first response opens
 * the newest season and its newest episode, so a member who expands a group
 * lands on releases rather than on a list of closed rows.
 */
import type { GroupScope } from '~/utils/groupScopes';

const props = withDefaults(
  defineProps<{
    groupKey: string;
    scope: GroupScope;
    /**
     * Which catalogue to read. The local and federated endpoints answer in the
     * same shape on purpose — the two navigate identically, which is most of
     * the value of grouping the mirror at all.
     */
    endpoint?: string;
  }>(),
  { endpoint: '/api/torrents/group' },
);

interface Release {
  id: string;
  infoHash: string;
  name: string;
  size: number;
  seeders: number;
  leechers: number;
  createdAt: string | null;
  moderatedAt: string | null;
  /** Present only on federated releases — see `TorrentReleaseRow`. */
  remote?: { detailUrl: string | null; peers: string[] } | null;
}

interface SeasonBucket {
  season: number | null;
  releaseCount: number;
  episodeCount: number;
  latest: string;
  seeders: number;
  resolutions: string[];
}

interface EpisodeBucket {
  episode: number | null;
  releaseCount: number;
  latest: string;
  seeders: number;
  resolutions: string[];
}

interface ScopePayload {
  scope: GroupScope;
  seasons: SeasonBucket[];
  openSeason: number | null;
  episodes: EpisodeBucket[];
  episodesTruncated: boolean;
  openEpisode: number | null;
  releases: Release[];
  releasesTruncated: boolean;
}

/** The single implicit bucket of a scope with no seasons. */
const FLAT = 'flat';

const seasons = ref<SeasonBucket[]>([]);
const episodes = ref(new Map<number | null, EpisodeBucket[]>());
const releases = ref(new Map<string, Release[]>());
const truncated = ref(new Set<number | null>());

const openSeasons = ref(new Set<number | null>());
const openEpisodes = ref(new Set<string>());
const loading = ref(new Set<string>());

const initialPending = ref(true);
const releasesTruncated = ref(false);

function bucketKey(season: number | null, episode: number | null): string {
  return `${season ?? 'n'}:${episode ?? 'n'}`;
}

async function fetchBucket(
  season?: number | null,
  episode?: number | null,
): Promise<ScopePayload | null> {
  try {
    return await $fetch<ScopePayload>(props.endpoint, {
      query: {
        key: props.groupKey,
        scope: props.scope,
        season: season ?? undefined,
        episode: episode ?? undefined,
      },
    });
  } catch {
    // A bucket that fails to load stays closed and silent. An error banner
    // inside a listing row would be louder than the problem — the rest of the
    // group is still perfectly usable.
    return null;
  }
}

/**
 * First load. Takes the server's pick for the opening position so the member
 * lands on releases, then hands control of every bucket to the sets above.
 */
async function loadInitial() {
  initialPending.value = true;
  seasons.value = [];
  episodes.value = new Map();
  releases.value = new Map();
  truncated.value = new Set();
  openSeasons.value = new Set();
  openEpisodes.value = new Set();

  const data = await fetchBucket();
  initialPending.value = false;
  if (!data) return;

  seasons.value = data.seasons;
  releasesTruncated.value = data.releasesTruncated;

  if (!data.seasons.length) {
    releases.value.set(FLAT, data.releases);
    return;
  }

  absorb(data, data.openSeason);
  openSeasons.value = new Set([data.openSeason]);
  if (props.scope === 'episode' && data.openEpisode !== null) {
    openEpisodes.value = new Set([bucketKey(data.openSeason, data.openEpisode)]);
  }
}

/**
 * File a response under the season it describes. Every response carries the
 * episodes of one season AND the releases of one bucket inside it, so opening
 * a season also arrives with something to read.
 */
function absorb(data: ScopePayload, season: number | null) {
  if (props.scope === 'episode') {
    episodes.value.set(season, data.episodes);
    if (data.episodesTruncated) truncated.value.add(season);
    if (data.openEpisode !== null) {
      releases.value.set(bucketKey(season, data.openEpisode), data.releases);
    }
  } else {
    releases.value.set(bucketKey(season, null), data.releases);
  }
  // Maps and Sets are not deeply reactive; replace the reference.
  episodes.value = new Map(episodes.value);
  releases.value = new Map(releases.value);
  truncated.value = new Set(truncated.value);
}

async function toggleSeason(season: number | null) {
  if (openSeasons.value.has(season)) {
    openSeasons.value.delete(season);
    openSeasons.value = new Set(openSeasons.value);
    return;
  }
  openSeasons.value = new Set(openSeasons.value).add(season);

  // Already fetched once — re-opening is free.
  const cached =
    props.scope === 'episode'
      ? episodes.value.has(season)
      : releases.value.has(bucketKey(season, null));
  if (cached) return;

  const marker = bucketKey(season, null);
  loading.value = new Set(loading.value).add(marker);
  const data = await fetchBucket(season);
  loading.value.delete(marker);
  loading.value = new Set(loading.value);
  if (!data) return;

  absorb(data, season);
  // The response opened a bucket for us; show it rather than leaving the
  // season expanded onto a list of closed episodes.
  if (props.scope === 'episode' && data.openEpisode !== null) {
    openEpisodes.value = new Set(openEpisodes.value).add(
      bucketKey(season, data.openEpisode),
    );
  }
}

async function toggleEpisode(season: number | null, episode: number | null) {
  const key = bucketKey(season, episode);
  if (openEpisodes.value.has(key)) {
    openEpisodes.value.delete(key);
    openEpisodes.value = new Set(openEpisodes.value);
    return;
  }
  openEpisodes.value = new Set(openEpisodes.value).add(key);
  if (releases.value.has(key)) return;

  loading.value = new Set(loading.value).add(key);
  const data = await fetchBucket(season, episode);
  loading.value.delete(key);
  loading.value = new Set(loading.value);
  if (!data) return;

  releases.value.set(key, data.releases);
  releases.value = new Map(releases.value);
}

// Changing scope starts over: the seasons of "season packs" and the seasons of
// "per episode" are different sets, and an episode number carried across would
// point at a bucket that may not exist.
watch(
  () => [props.groupKey, props.scope, props.endpoint],
  loadInitial,
  { immediate: true },
);

function episodeNumbers(season: number | null): number[] {
  return (episodes.value.get(season) ?? [])
    .map((e) => e.episode)
    .filter((e): e is number => e != null);
}

const TIERS = ['2160p', '1440p', '1080p', '720p', '480p'];
function bestResolution(list: string[]): string | null {
  return TIERS.find((t) => list.includes(t)) ?? null;
}
</script>

<style scoped>
.tree-loading,
.tree-note {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  padding: 0.6rem 1rem;
  font-size: 0.6875rem;
  color: rgb(var(--fg-faint));
}

/* ── Navigation levels ────────────────────────────────────────────────────
   Season and episode share one grammar and differ only in weight and in the
   colour of the rule at their left edge, so the nesting reads as depth
   rather than as two unrelated kinds of row. */
.lvl {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  width: 100%;
  text-align: left;
  border: 0;
  border-top: 1px solid rgb(var(--line-default) / 0.6);
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  transition: background-color var(--dur-1) ease;
}
.lvl:hover {
  background: rgb(var(--bg-hover));
}

.lvl--season {
  padding: 0.5rem 1rem;
  border-left: 2px solid rgb(167 139 250 / 0.55);
}
.lvl--episode {
  padding: 0.3rem 1rem 0.3rem 1.75rem;
  border-left: 2px solid rgb(129 140 248 / 0.4);
}

.lvl-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: rgb(var(--fg-default));
  white-space: nowrap;
}
.lvl-label--ep {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.6875rem;
  font-weight: 500;
  min-width: 2.5rem;
}
.lvl--open .lvl-label {
  color: rgb(var(--fg-strong));
}

.lvl-count,
.lvl-res {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.5625rem;
  letter-spacing: calc(0.06em * var(--tracking-scale));
  color: rgb(var(--fg-faint));
  padding: 2px 5px;
  border-radius: var(--radius-xs);
  background: rgb(var(--fg-default) / 0.05);
  white-space: nowrap;
}

.lvl-ladder {
  margin-left: auto;
}
.lvl-spacer {
  flex: 1;
}

.lvl-seed {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.625rem;
  color: rgb(var(--online));
  min-width: 2.4rem;
  text-align: right;
}
/* When the ladder is present it has already taken the slack, so the seed
   count needs its own separation from it. */
.lvl-ladder + .lvl-seed {
  margin-left: 0.75rem;
}

.lvl-chev {
  width: 0.75rem;
  height: 0.75rem;
  color: rgb(var(--fg-faint));
  flex-shrink: 0;
}

.tree-releases {
  border-top: 1px solid rgb(var(--line-default) / 0.4);
  background: rgb(var(--bg-base) / 0.4);
}

@media (max-width: 720px) {
  .lvl--season,
  .lvl--episode {
    padding-inline: 0.75rem;
  }
  .lvl--episode {
    padding-left: 1.25rem;
  }
  /* The ladder is worth more here than the seed count — it is the answer to
     "what am I missing" and there is no room for both. */
  .lvl-seed {
    display: none;
  }
}
</style>
