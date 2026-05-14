<template>
  <!--
    GameMetadataCard — rich metadata panel for video-game torrents.

    Distinct from `MediaMetadataCard` because the surface concerns
    are different: a game cares about platforms + game modes far
    more than a per-episode runtime, and the cover-art aspect
    ratio (3:4 portrait-ish from IGDB) gives us a "case art"
    visual hook to lean into. The accent palette borrows the
    admin family's gold thread + a violet IGDB tint so a glance
    tells the operator they're looking at an IGDB-sourced entry.
  -->
  <article v-if="metadata" class="gcard">
    <!-- Screenshot wash — blurred, low-opacity backdrop bled behind
         the card. Falls back to the cover if no screenshots ship,
         and to a flat panel if neither is set. -->
    <div
      v-if="metadata.backdropUrl || metadata.posterUrl"
      class="gcard-backdrop"
      :style="{
        backgroundImage: `url(${metadata.backdropUrl || metadata.posterUrl})`,
      }"
    />

    <div class="gcard-frame">
      <span class="gcard-tag">
        <Icon name="ph:game-controller-fill" class="gcard-tag-icon" />
        IGDB
      </span>

      <div class="gcard-grid">
        <!-- Cover art — the headliner. Stays a 3:4 portrait so it
             reads as the game's own case rather than a movie poster. -->
        <a
          v-if="metadata.posterUrl"
          :href="metadata.url"
          target="_blank"
          rel="noopener noreferrer"
          class="gcard-cover"
        >
          <img :src="metadata.posterUrl" :alt="metadata.title" loading="lazy" />
        </a>
        <div v-else class="gcard-cover gcard-cover--placeholder">
          <Icon name="ph:game-controller-bold" />
        </div>

        <div class="gcard-body">
          <header class="gcard-head">
            <h3 class="gcard-title">{{ metadata.title }}</h3>
            <span v-if="metadata.year" class="gcard-year tabular-nums">
              {{ metadata.year }}
            </span>
          </header>

          <!-- Genre pills (gold). -->
          <div v-if="metadata.genres?.length" class="gcard-genres">
            <span
              v-for="genre in metadata.genres"
              :key="genre"
              class="gcard-genre"
            >
              {{ genre }}
            </span>
          </div>

          <!-- Stats row: rating + first release date. -->
          <div
            v-if="metadata.voteAverage !== null || metadata.firstReleaseDate"
            class="gcard-stats"
          >
            <span
              v-if="metadata.voteAverage !== null"
              class="gcard-stat"
              :title="
                $t('components.gameMetadata.votesOnIgdb', {
                  n: metadata.voteCount?.toLocaleString() ?? '?',
                })
              "
            >
              <Icon name="ph:star-fill" class="gcard-stat-icon" />
              <strong class="tabular-nums">{{ metadata.voteAverage.toFixed(1) }}</strong>
              <span class="gcard-stat-suffix">/10</span>
            </span>
            <span v-if="metadata.firstReleaseDate" class="gcard-stat">
              <Icon name="ph:calendar-bold" class="gcard-stat-icon" />
              {{ formatReleaseDate(metadata.firstReleaseDate) }}
            </span>
            <span v-if="metadata.platforms?.length" class="gcard-stat">
              <Icon name="ph:devices-bold" class="gcard-stat-icon" />
              {{ $t('components.gameMetadata.platformsCount', { n: metadata.platforms.length }) }}
            </span>
          </div>

          <!-- Overview / summary. -->
          <p v-if="metadata.overview" class="gcard-overview">
            {{ metadata.overview }}
          </p>

          <!-- Platforms strip — pill cluster, one per platform. -->
          <div v-if="metadata.platforms?.length" class="gcard-section">
            <span class="gcard-section-label">
              {{ $t('components.gameMetadata.platforms') }}
            </span>
            <div class="gcard-pills">
              <span
                v-for="platform in metadata.platforms"
                :key="platform"
                class="gcard-pill gcard-pill--platform"
              >
                {{ platform }}
              </span>
            </div>
          </div>

          <!-- Game modes — single-player / multi / co-op. -->
          <div v-if="metadata.gameModes?.length" class="gcard-section">
            <span class="gcard-section-label">
              {{ $t('components.gameMetadata.modes') }}
            </span>
            <div class="gcard-pills">
              <span
                v-for="mode in metadata.gameModes"
                :key="mode"
                class="gcard-pill gcard-pill--mode"
              >
                {{ mode }}
              </span>
            </div>
          </div>

          <!-- IGDB external link. -->
          <div class="gcard-links">
            <a
              :href="metadata.url"
              target="_blank"
              rel="noopener noreferrer"
              class="gcard-link"
            >
              <Icon name="ph:link" />
              {{ $t('components.gameMetadata.viewOnIgdb') }}
              <Icon name="ph:arrow-up-right-bold" class="gcard-link-arrow" />
            </a>
          </div>
        </div>
      </div>

      <!-- Screenshots strip. Below the main grid so it spans the
           full card width — IGDB ships high-res shots that read
           best at ~280px wide. -->
      <div v-if="screenshots.length" class="gcard-shots">
        <span class="gcard-section-label gcard-shots-label">
          {{ $t('components.gameMetadata.screenshots') }}
        </span>
        <div class="gcard-shots-track">
          <a
            v-for="(shot, i) in screenshots"
            :key="shot"
            :href="shot"
            target="_blank"
            rel="noopener noreferrer"
            class="gcard-shot"
            :style="{ '--stagger': `${Math.min(i, 6) * 40}ms` }"
          >
            <img :src="shot" :alt="`${metadata.title} — screenshot ${i + 1}`" loading="lazy" />
          </a>
        </div>
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
interface Props {
  metadata: {
    source?: 'tmdb' | 'imdb' | 'tvdb' | 'igdb';
    type: 'movie' | 'tv' | 'game';
    title: string;
    originalTitle: string | null;
    tagline: string | null;
    year: number | null;
    overview: string | null;
    posterUrl: string | null;
    backdropUrl: string | null;
    genres: string[];
    runtime: number | null;
    voteAverage: number | null;
    voteCount: number | null;
    igdbId?: number | null;
    platforms?: string[];
    gameModes?: string[];
    screenshots?: string[];
    firstReleaseDate?: string | null;
    url: string;
  } | null;
}

const props = defineProps<Props>();
const { locale } = useI18n();

// Cap at 6 screenshots so the strip stays manageable on the page;
// IGDB ships up to 30 for big titles. The link sends the user to
// the full IGDB page for the rest.
const screenshots = computed(() =>
  (props.metadata?.screenshots ?? []).slice(0, 6)
);

function formatReleaseDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(locale.value === 'fr' ? 'fr-FR' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
</script>

<style scoped>
.gcard {
  position: relative;
  overflow: hidden;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  background: rgb(var(--bg-elevated));
}
.gcard::before {
  /* IGDB tint along the top edge so the panel reads as
     game-sourced at a glance. */
  content: '';
  position: absolute;
  top: 0;
  inset-inline: 1rem;
  height: 1px;
  background: linear-gradient(
    to right,
    rgba(167, 139, 250, 0) 0%,
    rgba(167, 139, 250, 0.55) 50%,
    rgba(167, 139, 250, 0) 100%
  );
  z-index: 2;
}
.gcard-backdrop {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  opacity: 0.18;
  filter: blur(20px) saturate(140%);
  pointer-events: none;
}
.gcard-frame {
  position: relative;
  padding: 1.15rem 1.15rem 1rem;
  z-index: 1;
}

.gcard-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  position: absolute;
  top: 0.65rem;
  right: 0.95rem;
  padding: 0.22rem 0.55rem;
  background: rgba(167, 139, 250, 0.12);
  border: 1px solid rgba(167, 139, 250, 0.55);
  border-radius: var(--radius-sm);
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #a78bfa;
  z-index: 2;
}
.gcard-tag-icon { font-size: 0.85rem; }

.gcard-grid {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 1.1rem;
}
@media (max-width: 600px) {
  .gcard-grid { grid-template-columns: 1fr; }
}

.gcard-cover {
  display: block;
  width: 168px;
  aspect-ratio: 3 / 4;
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  flex-shrink: 0;
  transition: transform 0.2s ease, border-color 0.2s ease;
}
.gcard-cover:hover {
  transform: translateY(-2px);
  border-color: rgba(167, 139, 250, 0.4);
  box-shadow: 0 14px 28px -16px rgba(0, 0, 0, 0.6);
}
.gcard-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.gcard-cover--placeholder {
  display: grid;
  place-items: center;
  font-size: 2.5rem;
  color: rgb(var(--fg-muted));
}
@media (max-width: 600px) {
  .gcard-cover {
    width: 140px;
    justify-self: center;
  }
}

.gcard-body {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  min-width: 0;
}

.gcard-head {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.gcard-title {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: rgb(var(--fg-strong));
  line-height: 1.15;
  word-break: break-word;
}
.gcard-year {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 1rem;
  color: rgb(var(--fg-muted));
  font-weight: 600;
}

.gcard-genres {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.gcard-genre {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  padding: 0.2rem 0.5rem;
  border-radius: var(--radius-sm);
  background: rgba(212, 167, 52, 0.08);
  border: 1px solid rgba(212, 167, 52, 0.35);
  color: #d4a734;
}

.gcard-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 0.85rem;
  align-items: center;
}
.gcard-stat {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.85rem;
  color: rgb(var(--fg-strong));
  letter-spacing: 0.01em;
}
.gcard-stat-icon {
  font-size: 0.95rem;
  color: rgb(var(--fg-muted));
}
.gcard-stat strong { font-weight: 700; }
.gcard-stat-suffix {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  color: rgb(var(--fg-muted));
}

.gcard-overview {
  margin: 0;
  font-size: 0.86rem;
  line-height: 1.55;
  color: rgb(var(--fg-default));
}

.gcard-section {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.gcard-section-label {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.gcard-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}
.gcard-pill {
  font-size: 0.74rem;
  font-weight: 600;
  padding: 0.18rem 0.55rem;
  border-radius: var(--radius-sm);
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-base));
  color: rgb(var(--fg-strong));
  letter-spacing: 0.01em;
}
.gcard-pill--platform {
  border-color: rgba(96, 165, 250, 0.35);
  background: rgba(96, 165, 250, 0.06);
  color: #60a5fa;
}
.gcard-pill--mode {
  border-color: rgba(108, 209, 97, 0.4);
  background: rgba(108, 209, 97, 0.06);
  color: #6cd161;
}

.gcard-links {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 0.85rem;
  padding-top: 0.15rem;
}
.gcard-link {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #a78bfa;
  text-decoration: none;
  transition: color 0.18s ease;
}
.gcard-link:hover { color: #c4b5fd; }
.gcard-link-arrow {
  font-size: 0.7rem;
  transition: transform 0.18s ease;
}
.gcard-link:hover .gcard-link-arrow {
  transform: translate(1px, -1px);
}

/* ── Screenshots strip ──────────────────────────────────── */
.gcard-shots {
  margin-top: 1.05rem;
  padding-top: 0.95rem;
  border-top: 1px solid rgb(var(--line-default));
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.gcard-shots-label { margin-bottom: 0.1rem; }
.gcard-shots-track {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 0.55rem;
}
.gcard-shot {
  display: block;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: var(--radius-sm);
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-base));
  transition: transform 0.2s ease, border-color 0.2s ease;
  animation: shot-in 0.4s cubic-bezier(0.2, 0.7, 0.2, 1) backwards;
  animation-delay: var(--stagger, 0ms);
}
.gcard-shot:hover {
  transform: translateY(-1px) scale(1.01);
  border-color: rgba(167, 139, 250, 0.45);
}
.gcard-shot img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.25s ease;
}
.gcard-shot:hover img {
  transform: scale(1.03);
}
@keyframes shot-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
