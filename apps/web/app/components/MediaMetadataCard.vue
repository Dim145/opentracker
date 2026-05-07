<template>
  <div v-if="metadata" class="media-card" :class="`media-card--${size}`">
    <!-- Backdrop wash — blurred, low-opacity backdrop image bled behind
         the card. Pure decoration; falls back to a flat panel when the
         backdrop is missing. -->
    <div
      v-if="metadata.backdropUrl"
      class="media-card-backdrop"
      :style="{ backgroundImage: `url(${metadata.backdropUrl})` }"
    />

    <div class="media-card-content">
      <!-- Poster -->
      <a
        v-if="metadata.posterUrl"
        :href="metadata.url"
        target="_blank"
        rel="noopener noreferrer"
        class="media-card-poster"
      >
        <img
          :src="metadata.posterUrl"
          :alt="metadata.title"
          loading="lazy"
        />
      </a>
      <div v-else class="media-card-poster media-card-poster--placeholder">
        <Icon name="ph:film-slate" class="text-4xl text-text-muted" />
      </div>

      <!-- Body -->
      <div class="media-card-body">
        <div class="flex items-baseline flex-wrap gap-x-3 gap-y-1">
          <h3 class="media-card-title">{{ metadata.title }}</h3>
          <span
            v-if="metadata.year"
            class="media-card-year"
          >
            ({{ metadata.year }})
          </span>
          <span
            v-if="metadata.type"
            class="media-card-type"
            :class="`media-card-type--${metadata.type}`"
          >
            {{ metadata.type === 'tv' ? 'TV Series' : 'Movie' }}
          </span>
        </div>

        <p
          v-if="metadata.originalTitle"
          class="media-card-original-title"
        >
          {{ metadata.originalTitle }}
        </p>

        <p v-if="metadata.tagline" class="media-card-tagline">
          “{{ metadata.tagline }}”
        </p>

        <!-- Genre pills -->
        <div
          v-if="metadata.genres.length"
          class="media-card-genres"
        >
          <span
            v-for="genre in metadata.genres"
            :key="genre"
            class="media-card-genre"
          >
            {{ genre }}
          </span>
        </div>

        <!-- Stats row: rating · runtime -->
        <div
          v-if="metadata.voteAverage !== null || metadata.runtime"
          class="media-card-stats"
        >
          <span
            v-if="metadata.voteAverage !== null"
            class="media-card-stat"
            :title="`${metadata.voteCount?.toLocaleString() ?? '?'} votes on TMDb`"
          >
            <Icon name="ph:star-fill" class="text-amber-400" />
            <strong>{{ metadata.voteAverage.toFixed(1) }}</strong>
            <span class="text-text-muted">/ 10</span>
          </span>
          <span v-if="metadata.runtime" class="media-card-stat">
            <Icon name="ph:clock" />
            {{ formatRuntime(metadata.runtime) }}
          </span>
        </div>

        <!-- Overview -->
        <p
          v-if="metadata.overview"
          class="media-card-overview"
          :class="{ 'media-card-overview--clamp': size === 'compact' }"
        >
          {{ metadata.overview }}
        </p>

        <!-- External links -->
        <div class="media-card-links">
          <a
            :href="metadata.url"
            target="_blank"
            rel="noopener noreferrer"
            class="media-card-link"
          >
            <Icon name="ph:link" />
            View on TMDb
            <Icon name="ph:arrow-up-right-bold" class="text-[10px]" />
          </a>
          <a
            v-if="metadata.imdbId"
            :href="`https://www.imdb.com/title/${metadata.imdbId}/`"
            target="_blank"
            rel="noopener noreferrer"
            class="media-card-link"
          >
            View on IMDb
            <Icon name="ph:arrow-up-right-bold" class="text-[10px]" />
          </a>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  metadata: {
    type: 'movie' | 'tv';
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
    imdbId: string | null;
    url: string;
  } | null;
  size?: 'compact' | 'full';
}

withDefaults(defineProps<Props>(), {
  size: 'full',
});

function formatRuntime(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}
</script>

<style scoped>
.media-card {
  position: relative;
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.5rem;
  overflow: hidden;
  background: rgb(var(--bg-surface));
  isolation: isolate;
}

.media-card-backdrop {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  opacity: 0.18;
  filter: blur(12px) saturate(1.1);
  z-index: 0;
  pointer-events: none;
}
.media-card-backdrop::after {
  /* Top-bottom dim so the body text always reads. */
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    rgb(var(--bg-surface) / 0.4),
    rgb(var(--bg-surface) / 0.92)
  );
}

.media-card-content {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 1.25rem;
  padding: 1.25rem;
}

.media-card--compact .media-card-content {
  gap: 0.875rem;
  padding: 0.875rem;
}

.media-card-poster {
  width: 130px;
  aspect-ratio: 2 / 3;
  flex-shrink: 0;
  border-radius: 0.375rem;
  overflow: hidden;
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-inset));
  display: block;
  transition: transform 0.2s ease;
}
.media-card--compact .media-card-poster {
  width: 84px;
}
.media-card-poster:hover {
  transform: translateY(-2px);
}
.media-card-poster img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.media-card-poster--placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
}

.media-card-body {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
}

.media-card-title {
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: rgb(var(--fg-strong));
  margin: 0;
}
.media-card--compact .media-card-title {
  font-size: 1rem;
}
.media-card-year {
  font-size: 0.95rem;
  color: rgb(var(--fg-muted));
  font-variant-numeric: tabular-nums;
}
.media-card-type {
  display: inline-block;
  font-size: 0.625rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 0.125rem 0.5rem;
  border-radius: 9999px;
  border: 1px solid rgb(var(--line-default));
}
.media-card-type--movie {
  color: #f5c518;
  border-color: rgba(245, 197, 24, 0.4);
  background: rgba(245, 197, 24, 0.1);
}
.media-card-type--tv {
  color: #6cd161;
  border-color: rgba(108, 209, 97, 0.4);
  background: rgba(108, 209, 97, 0.1);
}

.media-card-original-title {
  font-size: 0.75rem;
  color: rgb(var(--fg-muted));
  font-style: italic;
  margin: 0;
}

.media-card-tagline {
  font-size: 0.85rem;
  color: rgb(var(--fg-default));
  font-style: italic;
  margin: 0.25rem 0 0;
  opacity: 0.85;
}

.media-card-genres {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  margin-top: 0.125rem;
}
.media-card-genre {
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: 0.125rem 0.625rem;
  border-radius: 9999px;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  color: rgb(var(--fg-default));
}

.media-card-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin-top: 0.25rem;
  font-size: 0.8125rem;
}
.media-card-stat {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  color: rgb(var(--fg-default));
}

.media-card-overview {
  font-size: 0.825rem;
  line-height: 1.55;
  color: rgb(var(--fg-default) / 0.92);
  margin: 0.25rem 0 0;
}
.media-card-overview--clamp {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.media-card-links {
  display: flex;
  gap: 0.75rem;
  margin-top: 0.5rem;
  flex-wrap: wrap;
}
.media-card-link {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgb(var(--fg-muted));
  transition: color 0.15s ease;
}
.media-card-link:hover {
  color: rgb(var(--fg-strong));
}

@media (max-width: 640px) {
  .media-card-content {
    grid-template-columns: 1fr;
    justify-items: center;
    text-align: center;
  }
  .media-card-stats,
  .media-card-genres,
  .media-card-links {
    justify-content: center;
  }
}
</style>
