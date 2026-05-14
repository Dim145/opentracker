<template>
  <!--
    BookMetadataCard — rich metadata panel for book / ebook torrents.

    Distinct from `MediaMetadataCard` because the surface concerns
    are different: a book cares about authors + publisher + page
    count where a film cares about runtime + cast. The cover-art
    aspect ratio sits in a tall 2:3 frame (most book covers are
    portrait) with an amber thread for visual continuity with the
    Open Library badge surfaced elsewhere. The provider chip in
    the corner names which side of the fallback chain ended up
    serving the record (`openlibrary` vs `googlebooks`) so a
    surprised operator can audit "wait, why does this look like
    Google's record?" without diffing the response.
  -->
  <article v-if="metadata" class="bcard">
    <!-- Soft backdrop wash using the cover itself — blurred + tinted
         so it reads as atmosphere rather than competing with the
         foreground cover. No-ops when the row has no cover. -->
    <div
      v-if="metadata.posterUrl"
      class="bcard-backdrop"
      :style="{ backgroundImage: `url(${metadata.posterUrl})` }"
    />

    <div class="bcard-frame">
      <span class="bcard-tag">
        <Icon name="ph:book-open-text-fill" class="bcard-tag-icon" />
        {{
          metadata.bookProvider === 'googlebooks'
            ? $t('components.bookMetadata.googleBooks')
            : $t('components.bookMetadata.openLibrary')
        }}
      </span>

      <div class="bcard-grid">
        <a
          v-if="metadata.posterUrl"
          :href="metadata.url"
          target="_blank"
          rel="noopener noreferrer"
          class="bcard-cover"
        >
          <img :src="metadata.posterUrl" :alt="metadata.title" loading="lazy" />
        </a>
        <div v-else class="bcard-cover bcard-cover--placeholder">
          <Icon name="ph:book-bold" />
        </div>

        <div class="bcard-body">
          <header class="bcard-head">
            <h3 class="bcard-title">{{ metadata.title }}</h3>
            <span v-if="metadata.year" class="bcard-year tabular-nums">
              {{ metadata.year }}
            </span>
          </header>

          <!-- Authors — comma-joined with a small "by" eyebrow so a
               glance tells you whether to read the line as a single
               author or a multi-author work. -->
          <p
            v-if="metadata.authors?.length"
            class="bcard-authors"
          >
            <span class="bcard-authors-by">{{ $t('components.bookMetadata.by') }}</span>
            {{ metadata.authors.join(', ') }}
          </p>

          <!-- Subject pills (amber). Open Library's `subjects` are
               very noisy; we cap to 6 so the row stays scannable. -->
          <div
            v-if="metadata.genres?.length"
            class="bcard-genres"
          >
            <span
              v-for="genre in metadata.genres.slice(0, 6)"
              :key="genre"
              class="bcard-genre"
            >
              {{ genre }}
            </span>
          </div>

          <!-- Stats row: publisher · page count · rating (rare on
               Open Library; populated by Google Books). -->
          <div
            v-if="
              metadata.publisher ||
                metadata.pageCount ||
                metadata.voteAverage !== null
            "
            class="bcard-stats"
          >
            <span v-if="metadata.publisher" class="bcard-stat">
              <Icon name="ph:buildings-fill" class="bcard-stat-icon" />
              {{ metadata.publisher }}
            </span>
            <span v-if="metadata.pageCount" class="bcard-stat tabular-nums">
              <Icon name="ph:bookmarks-simple-fill" class="bcard-stat-icon" />
              {{ $t('components.bookMetadata.pages', { n: metadata.pageCount }) }}
            </span>
            <span
              v-if="metadata.voteAverage !== null"
              class="bcard-stat"
              :title="
                $t('components.bookMetadata.votesOnGoogle', {
                  n: metadata.voteCount?.toLocaleString() ?? '?',
                })
              "
            >
              <Icon name="ph:star-fill" class="bcard-stat-icon" />
              {{ metadata.voteAverage.toFixed(1) }}
              <span class="bcard-stat-max">/ 10</span>
            </span>
          </div>

          <p v-if="metadata.overview" class="bcard-overview">
            {{ metadata.overview }}
          </p>

          <!-- ISBN row + external link. ISBN-13 is canonical; we
               show the 10-digit form as a secondary chip when only
               that is present so older libraries can still match. -->
          <footer class="bcard-foot">
            <span
              v-if="metadata.isbn13"
              class="bcard-isbn"
              :title="$t('components.bookMetadata.isbn13')"
            >
              <span class="bcard-isbn-key">ISBN-13</span>
              <span class="bcard-isbn-val tabular-nums">{{ metadata.isbn13 }}</span>
            </span>
            <span
              v-else-if="metadata.isbn10"
              class="bcard-isbn"
              :title="$t('components.bookMetadata.isbn10')"
            >
              <span class="bcard-isbn-key">ISBN-10</span>
              <span class="bcard-isbn-val tabular-nums">{{ metadata.isbn10 }}</span>
            </span>
            <a
              v-if="metadata.url"
              :href="metadata.url"
              target="_blank"
              rel="noopener noreferrer"
              class="bcard-link"
            >
              <Icon name="ph:arrow-square-out-bold" />
              {{
                metadata.bookProvider === 'googlebooks'
                  ? $t('components.bookMetadata.viewOnGoogle')
                  : $t('components.bookMetadata.viewOnOpenLibrary')
              }}
            </a>
          </footer>
        </div>
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
interface BookMetadata {
  source?: string;
  type: string;
  title: string;
  year: number | null;
  overview: string | null;
  posterUrl: string | null;
  genres?: string[];
  voteAverage: number | null;
  voteCount: number | null;
  url: string;
  authors?: string[];
  publisher?: string | null;
  pageCount?: number | null;
  isbn13?: string | null;
  isbn10?: string | null;
  openlibraryId?: string | null;
  bookProvider?: 'openlibrary' | 'googlebooks';
}

defineProps<{
  metadata: BookMetadata;
}>();
</script>

<style scoped>
/* Surface mirrors GameMetadataCard so the page rhythm stays
   constant across renderers — the only thing that shifts is the
   accent ink. */
.bcard {
  position: relative;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  background: rgb(var(--bg-surface));
  overflow: hidden;
  isolation: isolate;
}
.bcard-backdrop {
  position: absolute;
  inset: 0;
  background-position: center;
  background-size: cover;
  opacity: 0.18;
  filter: blur(28px) saturate(1.2);
  transform: scale(1.1);
  z-index: 0;
}
.bcard-backdrop::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    rgb(var(--bg-surface) / 0.6) 0%,
    rgb(var(--bg-surface) / 0.94) 70%,
    rgb(var(--bg-surface)) 100%
  );
}
.bcard-frame {
  position: relative;
  z-index: 1;
  padding: 1.25rem;
}
.bcard-tag {
  position: absolute;
  top: 0.9rem;
  right: 0.95rem;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.22rem 0.55rem;
  border: 1px solid rgba(217, 119, 6, 0.45);
  border-radius: 9999px;
  background: rgba(217, 119, 6, 0.1);
  color: #f59e0b;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}
.bcard-tag-icon {
  font-size: 11px;
  color: #d97706;
  filter: drop-shadow(0 0 4px rgba(217, 119, 6, 0.5));
}

.bcard-grid {
  display: grid;
  grid-template-columns: 7rem minmax(0, 1fr);
  gap: 1.1rem;
  align-items: start;
}
@media (max-width: 640px) {
  .bcard-grid {
    grid-template-columns: 5rem minmax(0, 1fr);
    gap: 0.8rem;
  }
}

.bcard-cover {
  display: block;
  width: 100%;
  aspect-ratio: 2 / 3;
  border-radius: 4px;
  overflow: hidden;
  background: rgb(var(--bg-base));
  border: 1px solid rgba(217, 119, 6, 0.35);
  box-shadow: 0 10px 24px -16px rgba(0, 0, 0, 0.5);
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}
.bcard-cover:hover {
  transform: translateY(-2px);
  box-shadow: 0 14px 30px -16px rgba(0, 0, 0, 0.6);
}
.bcard-cover img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.bcard-cover--placeholder {
  display: grid;
  place-items: center;
  font-size: 1.6rem;
  color: rgb(var(--fg-faint));
}

.bcard-body {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  min-width: 0;
}
.bcard-head {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  flex-wrap: wrap;
  padding-right: 5.5rem; /* clear the absolutely-positioned tag */
}
.bcard-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.2;
  color: rgb(var(--fg-strong));
  word-break: break-word;
}
.bcard-year {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.78rem;
  font-weight: 700;
  color: rgb(var(--fg-muted));
  letter-spacing: 0.04em;
}

/* Authors are the byline; we keep them on a single italic-looking
   line for editorial feel without actually italicising (a serif
   italic would clash with the rest of the chrome). */
.bcard-authors {
  margin: 0;
  font-size: 0.85rem;
  color: rgb(var(--fg-default));
  line-height: 1.45;
}
.bcard-authors-by {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-faint));
  margin-right: 0.4rem;
}

.bcard-genres {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}
.bcard-genre {
  padding: 0.15rem 0.5rem;
  border-radius: 9999px;
  border: 1px solid rgba(217, 119, 6, 0.3);
  background: rgba(217, 119, 6, 0.06);
  color: #f59e0b;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.bcard-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem 1rem;
  font-size: 0.78rem;
  color: rgb(var(--fg-muted));
}
.bcard-stat {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}
.bcard-stat-icon {
  color: #d97706;
  font-size: 0.85rem;
}
.bcard-stat-max {
  color: rgb(var(--fg-faint));
  font-size: 0.7rem;
  margin-left: 0.05rem;
}

.bcard-overview {
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.55;
  color: rgb(var(--fg-default));
  display: -webkit-box;
  -webkit-line-clamp: 6;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.bcard-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.55rem 1rem;
  padding-top: 0.55rem;
  border-top: 1px dashed rgb(var(--line-default));
}
.bcard-isbn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.72rem;
  color: rgb(var(--fg-muted));
}
.bcard-isbn-key {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-faint));
}
.bcard-isbn-val {
  font-family: ui-monospace, SFMono-Regular, monospace;
  color: rgb(var(--fg-default));
}
.bcard-link {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.78rem;
  font-weight: 600;
  color: #f59e0b;
  transition: color 0.15s ease;
}
.bcard-link:hover {
  color: #fbbf24;
}
</style>
