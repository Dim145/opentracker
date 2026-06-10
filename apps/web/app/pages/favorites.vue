<template>
  <!--
    /me/favorites — Letterpress library catalogue

    Aesthetic: a private library card-catalog. Each favorited torrent
    is an index card pulled from the drawer, jittered a fraction of
    a degree off-grid so the page reads as a small pile of cards a
    librarian just set down. Punch-holes along the top edge,
    typewriter mono caption (N° XXXX · DATE), heavy Inter title, and
    a "return to shelf" stamp pinned to the bottom-right corner for
    unfavoriting.

    Palette stays in the site's dark-room vocabulary but trades the
    purple/rose accent for amber/sepia — the same gold that fills
    the star toggle on every torrent. Cards layer a parchment grain
    over the bg-elevated surface so the catalogue feels warmer than
    /me's clean press-sheet.
  -->
  <div class="fav-page">
    <!-- Atmospheric warm aura — amber + sepia blobs replace the
         release-purple / release-rose pair the other pages use. -->
    <div class="fav-aura" aria-hidden="true">
      <span class="aura-blob aura-blob--a" />
      <span class="aura-blob aura-blob--b" />
      <span class="aura-grain" />
    </div>

    <!-- ── Header strip ──────────────────────────────────────────── -->
    <header class="fav-head">
      <div class="fav-head-id">
        <p class="fav-eyebrow">
          <span class="fav-eyebrow-mark" aria-hidden="true">§</span>
          <span class="fav-eyebrow-label">
            {{ $t('me.favorites.eyebrow') }}
          </span>
          <span class="fav-eyebrow-sep" aria-hidden="true">·</span>
          <span class="fav-eyebrow-count tabular-nums">
            {{
              $t('me.favorites.cardCount', {
                n: data?.pagination.total ?? 0,
              })
            }}
          </span>
        </p>
        <h1 class="fav-title">{{ $t('me.favorites.title') }}</h1>
        <p class="fav-intro">{{ $t('me.favorites.intro') }}</p>
      </div>

      <div class="fav-sort">
        <span class="fav-sort-label">
          {{ $t('me.favorites.sort.label') }}
        </span>
        <div class="fav-sort-seg" role="radiogroup">
          <button
            v-for="opt in sortOptions"
            :key="opt.value"
            type="button"
            class="fav-sort-opt"
            :class="{ 'is-active': sort === opt.value }"
            role="radio"
            :aria-checked="sort === opt.value"
            @click="setSort(opt.value)"
          >
            <Icon :name="opt.icon" />
            <span>{{ opt.label }}</span>
          </button>
        </div>
      </div>
    </header>

    <!-- ── Loader ───────────────────────────────────────────────── -->
    <div v-if="pending && !data" class="fav-loader">
      <Icon name="ph:circle-notch" class="loader-spin" />
      <span>{{ $t('me.favorites.loading') }}</span>
    </div>

    <!-- ── Card grid ────────────────────────────────────────────── -->
    <ul v-else-if="rows.length > 0" class="fav-grid">
      <li
        v-for="(row, i) in rows"
        :key="row.id"
        class="card"
        :class="[
          `card--${row.category?.type || 'unknown'}`,
          { 'is-removing': removing.has(row.infoHash) },
        ]"
        :style="{
          '--card-skew': `${cardSkew(row.id)}deg`,
          '--stagger': `${Math.min(i * 35, 320)}ms`,
        }"
      >
        <!-- Top: 3 punch holes, like a card pulled from a binder -->
        <span class="card-punch" aria-hidden="true">
          <span class="punch" />
          <span class="punch" />
          <span class="punch" />
        </span>

        <header class="card-head">
          <span class="card-num tabular-nums">
            <span class="card-num-prefix">N°</span>
            {{ cardNumber(row, i) }}
          </span>
          <span class="card-date tabular-nums" :title="formatDate(row.favoritedAt)">
            {{ formatStamp(row.favoritedAt) }}
          </span>
        </header>

        <NuxtLink
          :to="`/torrents/${row.infoHash}`"
          class="card-body"
        >
          <span v-if="row.category" class="card-cat">
            <Icon :name="getCategoryIcon(row.category)" class="card-cat-icon" />
            <span>{{ row.category.name }}</span>
          </span>
          <span v-else class="card-cat card-cat--orphan">
            <Icon name="ph:question-bold" />
            <span>{{ $t('users.profile.uncategorized') }}</span>
          </span>
          <h3 class="card-title" :title="row.name">
            {{ row.name }}
          </h3>
          <ul class="card-stats">
            <li class="card-stat card-stat--seed">
              <Icon name="ph:arrow-up-bold" />
              <span class="tabular-nums">{{ row.stats.seeders }}</span>
            </li>
            <li class="card-stat card-stat--leech">
              <Icon name="ph:arrow-down-bold" />
              <span class="tabular-nums">{{ row.stats.leechers }}</span>
            </li>
            <li class="card-stat card-stat--size">
              {{ formatSize(row.size) }}
            </li>
          </ul>
        </NuxtLink>

        <!-- "Return to shelf" stamp — angled, red-brick, sits in
             the bottom-right corner of the card. Clicking lifts the
             card off the page with a small descent + fade. -->
        <button
          type="button"
          class="card-unfav"
          :disabled="removing.has(row.infoHash)"
          :title="$t('me.favorites.removeStampTooltip')"
          @click="unfavorite(row)"
        >
          <Icon name="ph:arrow-u-up-left-bold" class="card-unfav-icon" />
          <span class="card-unfav-label">
            {{ $t('me.favorites.removeStamp') }}
          </span>
        </button>
      </li>
    </ul>

    <!-- ── Empty state: a blank index card floats in mid-page ──── -->
    <div v-else class="fav-empty">
      <span class="empty-card" aria-hidden="true">
        <span class="empty-punch">
          <span class="punch" />
          <span class="punch" />
          <span class="punch" />
        </span>
        <span class="empty-line empty-line--1" />
        <span class="empty-line empty-line--2" />
        <span class="empty-line empty-line--3" />
        <span class="empty-stamp">{{ $t('me.favorites.empty.stamp') }}</span>
      </span>
      <h2 class="empty-title">{{ $t('me.favorites.empty.title') }}</h2>
      <p class="empty-sub">{{ $t('me.favorites.empty.sub') }}</p>
      <NuxtLink to="/torrents" class="empty-cta">
        <Icon name="ph:books-bold" />
        <span>{{ $t('me.favorites.empty.cta') }}</span>
      </NuxtLink>
    </div>

    <!-- ── Pagination ───────────────────────────────────────────── -->
    <nav
      v-if="data && data.pagination.pages > 1"
      class="fav-pager"
      :aria-label="$t('me.favorites.pagerAria')"
    >
      <button
        type="button"
        class="pager-btn"
        :disabled="page <= 1"
        @click="setPage(page - 1)"
      >
        <Icon name="ph:caret-left-bold" />
        <span>{{ $t('common.previous') }}</span>
      </button>
      <span class="pager-pos tabular-nums">
        <span class="pager-cur">{{ page }}</span>
        <span class="pager-sep">/</span>
        <span class="pager-total">{{ data.pagination.pages }}</span>
      </span>
      <button
        type="button"
        class="pager-btn"
        :disabled="page >= data.pagination.pages"
        @click="setPage(page + 1)"
      >
        <span>{{ $t('common.next') }}</span>
        <Icon name="ph:caret-right-bold" />
      </button>
    </nav>
  </div>
</template>

<script setup lang="ts">
import { formatSize, formatDate } from '~/utils/format';
import { getCategoryIcon } from '~/utils/categoryIcon';

definePageMeta({ title: 'Favorites' });

const { t, locale } = useI18n();
const notifications = useNotificationStore();
useHead({ title: () => t('me.favorites.headTitle') });

type Sort = 'recent' | 'name' | 'seeders';

interface FavoriteRow {
  id: string;
  infoHash: string;
  name: string;
  size: number;
  createdAt: string;
  favoritedAt: string;
  category: {
    id: string;
    name: string;
    slug: string;
    type: string | null;
    icon: string | null;
  } | null;
  stats: { seeders: number; leechers: number; completed: number };
}

interface FavoritesResponse {
  data: FavoriteRow[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

const sort = ref<Sort>('recent');
const page = ref(1);
const removing = ref(new Set<string>());

const { data, pending, refresh } = await useFetch<FavoritesResponse>(
  '/api/me/favorites',
  {
    query: computed(() => ({
      page: page.value,
      sort: sort.value,
      limit: 24,
    })),
  },
);

const rows = computed(() => data.value?.data ?? []);

const sortOptions = computed<{ value: Sort; label: string; icon: string }[]>(
  () => [
    {
      value: 'recent',
      label: t('me.favorites.sort.recent'),
      icon: 'ph:clock-bold',
    },
    {
      value: 'name',
      label: t('me.favorites.sort.name'),
      icon: 'ph:sort-ascending-bold',
    },
    {
      value: 'seeders',
      label: t('me.favorites.sort.seeders'),
      icon: 'ph:arrow-up-bold',
    },
  ],
);

function setSort(s: Sort) {
  if (sort.value === s) return;
  sort.value = s;
  page.value = 1;
}

function setPage(n: number) {
  page.value = n;
}

/** Stable per-card skew: hash the torrent id to a value in
 *  [-1.6°, +1.6°] so the same card always sits at the same angle
 *  on the page. Without a stable seed, every refresh would deal
 *  the deck differently and the layout would feel jittery. */
function cardSkew(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  }
  // [-1.6, 1.6] — small enough that the cards still align visually,
  // large enough that the off-grid feel reads.
  return ((Math.abs(h) % 33) - 16) / 10;
}

/** Card number = monotonically-increasing serial within the user's
 *  favorite list. The server orders by `favoritedAt desc` by default
 *  so the most-recent card carries the highest number — a typical
 *  acquisition catalogue numbers in the order things were filed,
 *  and we mimic that. Page offset keeps the numbering consistent
 *  across page navigation. */
function cardNumber(row: FavoriteRow, i: number): string {
  const total = data.value?.pagination.total ?? 0;
  const limit = data.value?.pagination.limit ?? 24;
  const offset = ((page.value - 1) * limit);
  // Sorted by `recent` desc → highest serial first. Other sort
  // modes keep the serial stable but break ordering — that's fine,
  // the serial still labels the card uniquely.
  const serial = sort.value === 'recent' ? total - offset - i : offset + i + 1;
  return String(Math.max(serial, 1)).padStart(4, '0');
}

/** Short stamp label "MAY 16 2026" — uppercase month abbreviation,
 *  matches the typewriter-on-card-stock vocabulary. Locale-aware
 *  so the FR build reads "MAI 16 2026". */
function formatStamp(iso: string): string {
  const d = new Date(iso);
  const month = d
    .toLocaleString(locale.value, { month: 'short' })
    .replace('.', '')
    .toUpperCase();
  const day = String(d.getDate()).padStart(2, '0');
  return `${month} ${day} ${d.getFullYear()}`;
}

async function unfavorite(row: FavoriteRow) {
  if (removing.value.has(row.infoHash)) return;
  removing.value.add(row.infoHash);
  // Brief delay so the user sees the "card lifts off" animation
  // before the row vanishes from the grid on refresh.
  setTimeout(async () => {
    try {
      await $fetch(`/api/torrents/${row.infoHash}/favorite`, {
        method: 'DELETE',
      });
      notifications.success(t('me.favorites.toasts.removed'));
      await refresh();
      // Removing the last item on the last page leaves `page` past the new
      // page count — clamp back into range so the reactive query refetches
      // a populated page instead of stranding the user on a blank one with
      // no pager (finding L24).
      if (data.value && page.value > data.value.pagination.pages) {
        page.value = Math.max(1, data.value.pagination.pages);
      }
    } catch (err: any) {
      notifications.error(
        err?.data?.message || t('me.favorites.toasts.removeFailed'),
      );
    } finally {
      removing.value.delete(row.infoHash);
    }
  }, 320);
}
</script>

<style scoped>
/* ╔════════════════════════════════════════════════════════════════╗
   ║  /me/favorites — letterpress library catalogue                  ║
   ║                                                                  ║
   ║  Palette pivots toward amber + sepia rather than the editorial   ║
   ║  press-sheet's purple/rose. Same vocabulary otherwise: §         ║
   ║  Fraunces marks, JetBrains Mono labels, atmospheric gradient     ║
   ║  blobs, grain overlay.                                           ║
   ╚════════════════════════════════════════════════════════════════╝ */
.fav-page {
  position: relative;
  isolation: isolate;
  max-width: 1180px;
  margin: 0 auto;
  padding: 2rem 1.5rem 5rem;
  --gold: 245 158 11;       /* amber-500 */
  --sepia: 217 119 6;       /* amber-600, deeper accent */
  --parchment: 254 243 199; /* amber-100, paper highlight */
  --brick: 220 38 38;       /* red-600 for the unfavorite stamp */
}

.tabular-nums { font-variant-numeric: tabular-nums; }

/* ── Atmospheric aura — amber + sepia ────────────────────────── */
.fav-aura {
  position: absolute;
  top: -2rem;
  left: 50%;
  width: 100vw;
  margin-left: -50vw;
  height: 70vh;
  max-height: 520px;
  z-index: -1;
  overflow: hidden;
  pointer-events: none;
}
.fav-aura::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(
      ellipse 80% 60% at 30% 0%,
      rgb(var(--gold) / 0.16),
      transparent 65%
    ),
    radial-gradient(
      ellipse 60% 50% at 85% 0%,
      rgb(var(--sepia) / 0.14),
      transparent 65%
    );
}
.aura-blob {
  position: absolute;
  display: block;
  filter: blur(80px);
  opacity: 0.32;
  border-radius: 50%;
}
.aura-blob--a {
  width: 520px;
  height: 520px;
  top: -180px;
  left: -120px;
  background: radial-gradient(circle, rgb(var(--sepia) / 0.55), transparent 65%);
}
.aura-blob--b {
  width: 420px;
  height: 420px;
  top: 40px;
  right: -160px;
  background: radial-gradient(circle, rgb(var(--gold) / 0.45), transparent 65%);
}
.aura-grain {
  position: absolute;
  inset: 0;
  background-image:
    radial-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px);
  background-size: 3px 3px;
  opacity: 0.5;
  mix-blend-mode: overlay;
}

/* ── Header ──────────────────────────────────────────────────── */
.fav-head {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: end;
  gap: 1.5rem 2rem;
  margin-bottom: 2.5rem;
  animation: fav-rise 0.55s cubic-bezier(0.22, 1, 0.36, 1) both;
}
@keyframes fav-rise {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
@media (max-width: 760px) {
  .fav-head { grid-template-columns: 1fr; }
}

.fav-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  margin: 0 0 0.6rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.fav-eyebrow-mark {
  font-family: 'Fraunces', 'Charter', Georgia, serif;
  font-style: italic;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 0;
  color: rgb(var(--gold));
  line-height: 0;
  transform: translateY(2px);
  filter: drop-shadow(0 0 8px rgb(var(--gold) / 0.45));
}
.fav-eyebrow-label {
  color: rgb(var(--gold));
  font-weight: 800;
}
.fav-eyebrow-sep { opacity: 0.45; }
.fav-eyebrow-count {
  color: rgb(var(--fg-default));
  font-weight: 700;
}

.fav-title {
  margin: 0;
  font-family: 'Inter', system-ui, sans-serif;
  font-weight: 900;
  font-size: clamp(1.8rem, 3.4vw, 2.4rem);
  letter-spacing: -0.02em;
  line-height: 1.05;
  color: rgb(var(--fg-strong));
}
.fav-intro {
  margin: 0.55rem 0 0;
  max-width: 60ch;
  font-size: 13.5px;
  line-height: 1.55;
  color: rgb(var(--fg-muted));
}

/* Sort segment — small mono pills, matches the rest of the site */
.fav-sort {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  flex-wrap: wrap;
}
.fav-sort-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.fav-sort-seg {
  display: inline-flex;
  padding: 0.18rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-strong));
  border-radius: 999px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}
.fav-sort-opt {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.85rem;
  background: transparent;
  border: 0;
  border-radius: 999px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  cursor: pointer;
  transition: color 0.15s, background 0.18s;
}
.fav-sort-opt > svg { font-size: 0.85rem; flex-shrink: 0; }
.fav-sort-opt:hover { color: rgb(var(--fg-strong)); }
.fav-sort-opt.is-active {
  background: rgb(var(--gold) / 0.16);
  color: rgb(var(--gold));
  box-shadow: inset 0 0 0 1px rgb(var(--gold) / 0.3);
}

/* ── Loader ──────────────────────────────────────────────────── */
.fav-loader {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.55rem;
  padding: 2.5rem 1rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.loader-spin {
  animation: loader-spin 0.9s linear infinite;
  font-size: 1.25rem;
}
@keyframes loader-spin { to { transform: rotate(360deg); } }

/* ╔════════════════════════════════════════════════════════════════╗
   ║  GRID — letterpress index cards                                  ║
   ╚════════════════════════════════════════════════════════════════╝ */
.fav-grid {
  list-style: none;
  margin: 0;
  padding: 0.5rem 0 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1.4rem 1.25rem;
  /* The grid itself is dead-straight; jitter lives on individual
     cards so the visual rhythm reads as "a pile someone touched"
     rather than "a sloped UI". */
}

.card {
  position: relative;
  display: flex;
  flex-direction: column;
  /* Card-paper background — bg-elevated with a faint warm wash
     layered on top so the surface reads sepia-tinted rather than
     icy. The two radial gradients are the rectangle highlights of
     hand-cut cardstock under warm light. */
  background:
    radial-gradient(
      ellipse 100% 50% at 50% 0%,
      rgba(245, 158, 11, 0.06),
      transparent 70%
    ),
    radial-gradient(
      ellipse 80% 40% at 100% 100%,
      rgba(217, 119, 6, 0.07),
      transparent 70%
    ),
    rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-strong));
  border-radius: 0.45rem;
  padding: 0.95rem 1rem 0.95rem;
  transform: rotate(var(--card-skew, 0deg));
  transform-origin: center 65%;
  animation: card-deal 0.55s cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: var(--stagger, 0ms);
  transition:
    transform 0.32s cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 0.32s ease,
    border-color 0.18s,
    opacity 0.28s ease;
  box-shadow:
    0 16px 40px -22px rgba(0, 0, 0, 0.65),
    0 1px 0 rgba(255, 255, 255, 0.04) inset,
    0 -16px 24px -20px rgba(0, 0, 0, 0.45) inset;
}
@keyframes card-deal {
  from {
    opacity: 0;
    transform: rotate(calc(var(--card-skew, 0deg) - 4deg))
      translate(-6px, -10px) scale(0.94);
  }
  to {
    opacity: 1;
    transform: rotate(var(--card-skew, 0deg)) translate(0, 0) scale(1);
  }
}
.card:hover {
  transform: rotate(0deg) translateY(-3px);
  border-color: rgb(var(--gold) / 0.45);
  box-shadow:
    0 22px 50px -22px rgba(0, 0, 0, 0.7),
    0 0 0 1px rgb(var(--gold) / 0.25),
    0 1px 0 rgba(255, 255, 255, 0.06) inset;
}
/* Departing animation when the user clicks the "return to shelf"
   stamp — the card descends, fades, and slightly rotates away. */
.card.is-removing {
  opacity: 0;
  transform: rotate(calc(var(--card-skew, 0deg) + 6deg)) translateY(28px)
    scale(0.96);
  pointer-events: none;
}

/* ── Punch holes along the top edge ─────────────────────────── */
.card-punch {
  position: absolute;
  top: 0.65rem;
  left: 0.95rem;
  display: inline-flex;
  gap: 0.8rem;
  pointer-events: none;
}
.punch {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background:
    radial-gradient(circle at 30% 30%, rgba(0, 0, 0, 0.55), rgba(0, 0, 0, 0.85));
  box-shadow:
    inset 0 0 0 0.5px rgba(255, 255, 255, 0.04),
    inset 0 -1px 1px rgba(255, 255, 255, 0.05);
}

/* ── Card header: serial number + filing date ──────────────── */
.card-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.8rem;
  margin-bottom: 0.7rem;
  padding-top: 0.7rem;
  border-bottom: 1px dashed rgb(var(--line-default));
  padding-bottom: 0.55rem;
}
.card-num {
  display: inline-flex;
  align-items: baseline;
  gap: 0.2rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.12em;
  color: rgb(var(--gold));
  text-shadow: 0 0 6px rgb(var(--gold) / 0.35);
}
.card-num-prefix {
  font-size: 10px;
  opacity: 0.65;
}
.card-date {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  /* Tiny "ink-stamp" treatment — the date sits in a thin border
     box, very faintly tinted, as if pressed onto the card. */
  padding: 0.22rem 0.45rem;
  border: 1px solid rgb(var(--sepia) / 0.3);
  border-radius: 0.2rem;
  background: rgb(var(--sepia) / 0.06);
}

/* ── Body (the clickable link) ─────────────────────────────── */
.card-body {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  text-decoration: none;
  color: inherit;
  flex: 1 1 auto;
  min-width: 0;
  margin-bottom: 0.75rem;
}
.card-cat {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  width: max-content;
  max-width: 100%;
  padding: 0.18rem 0.5rem;
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.2rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  overflow: hidden;
}
.card-cat > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-cat-icon { font-size: 0.85rem; flex-shrink: 0; }
.card-cat--orphan { color: rgb(var(--fg-faint)); }

.card-title {
  margin: 0.1rem 0 0.2rem;
  font-family: 'Inter', system-ui, sans-serif;
  font-weight: 800;
  font-size: 0.98rem;
  line-height: 1.25;
  letter-spacing: -0.005em;
  color: rgb(var(--fg-strong));
  overflow-wrap: anywhere;
  text-wrap: pretty;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  transition: color 0.18s;
}
.card-body:hover .card-title {
  color: rgb(var(--gold));
}

.card-stats {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.6rem;
  margin: 0;
  padding: 0;
  list-style: none;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
}
.card-stat {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.18rem 0.42rem;
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.22rem;
  color: rgb(var(--fg-muted));
}
.card-stat > svg { font-size: 0.78rem; }
.card-stat--seed { color: rgb(var(--online)); border-color: rgb(var(--online) / 0.35); background: rgb(var(--online) / 0.06); }
.card-stat--leech { color: rgb(var(--warning)); border-color: rgb(var(--warning) / 0.35); background: rgb(var(--warning) / 0.06); }
.card-stat--size { color: rgb(var(--fg-default)); }

/* ── Unfavorite stamp (bottom-right corner) ─────────────────── */
.card-unfav {
  align-self: flex-end;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.32rem 0.55rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgb(var(--brick));
  background: rgb(var(--brick) / 0.06);
  border: 1.5px solid rgb(var(--brick) / 0.45);
  border-radius: 0.22rem;
  cursor: pointer;
  transform: rotate(-3deg);
  transition: background 0.15s, color 0.15s, border-color 0.18s,
    transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.card-unfav-icon { font-size: 0.85rem; }
.card-unfav:hover {
  color: #fff;
  background: rgb(var(--brick));
  border-color: rgb(var(--brick));
  transform: rotate(-1deg) scale(1.04);
}
.card-unfav:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  transform: rotate(-3deg);
}

/* ╔════════════════════════════════════════════════════════════════╗
   ║  EMPTY STATE — a single blank card under a label                ║
   ╚════════════════════════════════════════════════════════════════╝ */
.fav-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 3.5rem 1.5rem 4rem;
  text-align: center;
}
.empty-card {
  position: relative;
  width: 220px;
  height: 130px;
  padding: 1.1rem 1rem 1rem;
  background:
    radial-gradient(
      ellipse 80% 50% at 50% 0%,
      rgba(245, 158, 11, 0.08),
      transparent 70%
    ),
    rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-strong));
  border-radius: 0.45rem;
  box-shadow: 0 18px 40px -18px rgba(0, 0, 0, 0.65);
  animation:
    empty-drop 0.9s cubic-bezier(0.22, 1, 0.36, 1) both,
    empty-sway 4.5s ease-in-out 0.9s infinite;
  transform-origin: top center;
}
@keyframes empty-drop {
  from { opacity: 0; transform: translateY(-32px) rotate(-12deg) scale(0.92); }
  to   { opacity: 1; transform: translateY(0) rotate(-2deg) scale(1); }
}
@keyframes empty-sway {
  0%, 100% { transform: rotate(-2deg); }
  50%      { transform: rotate(2deg); }
}
.empty-punch {
  position: absolute;
  top: 0.6rem;
  left: 1rem;
  display: inline-flex;
  gap: 0.7rem;
}
.empty-line {
  display: block;
  height: 6px;
  background: rgb(var(--line-default));
  border-radius: 999px;
  margin-top: 0.6rem;
}
.empty-line--1 { width: 60%; margin-top: 1.1rem; }
.empty-line--2 { width: 85%; }
.empty-line--3 { width: 45%; }
.empty-stamp {
  position: absolute;
  right: 0.7rem;
  bottom: 0.5rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 8.5px;
  font-weight: 800;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--brick) / 0.6);
  border: 1.5px solid rgb(var(--brick) / 0.45);
  padding: 0.1rem 0.35rem;
  border-radius: 0.2rem;
  transform: rotate(-7deg);
}

.empty-title {
  margin: 0.4rem 0 0;
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 1.15rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: rgb(var(--fg-strong));
}
.empty-sub {
  margin: 0;
  max-width: 50ch;
  font-size: 13.5px;
  line-height: 1.55;
  color: rgb(var(--fg-muted));
}
.empty-cta {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.4rem;
  padding: 0.55rem 1rem;
  background: rgb(var(--gold) / 0.16);
  color: rgb(var(--gold));
  border: 1px solid rgb(var(--gold) / 0.55);
  border-radius: 0.3rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  text-decoration: none;
  transition: background 0.18s, color 0.15s, transform 0.18s;
}
.empty-cta:hover {
  background: rgb(var(--gold));
  color: rgb(var(--bg-base));
  transform: translateY(-1px);
}

/* ── Pager ───────────────────────────────────────────────────── */
.fav-pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.85rem;
  margin-top: 2.5rem;
}
.pager-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 0.85rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.3rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-default));
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.pager-btn:hover:not(:disabled) {
  background: rgb(var(--bg-hover, var(--bg-elevated)));
  border-color: rgb(var(--gold) / 0.45);
  color: rgb(var(--gold));
}
.pager-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.pager-pos {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: rgb(var(--fg-muted));
  display: inline-flex;
  align-items: baseline;
  gap: 0.3rem;
}
.pager-cur { color: rgb(var(--gold)); font-size: 14px; }
.pager-sep { opacity: 0.4; }

@media (prefers-reduced-motion: reduce) {
  .card, .empty-card { animation: none !important; }
  .card-unfav { transition: none; }
}
</style>
