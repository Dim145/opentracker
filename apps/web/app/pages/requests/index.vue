<template>
  <!--
    /requests — Bounty board / trading floor

    Aesthetic: a public board of open bounties. Each row reads
    like a ticker entry — status indicator (phosphor green for
    open, amber for filled, blue for validated, dashed grey for
    cancelled), category chip, title in Fraunces, reward in
    enormous mono caps stamped against a brass plate. The page's
    rhythm is the reward column: scanning down it tells you which
    bounties are worth chasing at a glance.

    Palette pivots toward brass/copper (warm metal) over the
    site's editorial purple/rose. Distinct from /favorites'
    library card sepia and /following's emerald playbill.
  -->
  <div class="board">
    <div class="board-aura" aria-hidden="true">
      <span class="aura-blob aura-blob--a" />
      <span class="aura-blob aura-blob--b" />
      <span class="aura-grain" />
    </div>

    <header class="board-head">
      <div class="board-head-id">
        <p class="board-eyebrow">
          <span class="board-eyebrow-mark" aria-hidden="true">§</span>
          <span class="board-eyebrow-label">
            {{ $t('requests.eyebrow') }}
          </span>
          <span class="board-eyebrow-sep" aria-hidden="true">·</span>
          <span class="board-eyebrow-count tabular-nums">
            {{
              $t('requests.openCount', {
                n: data?.pagination.total ?? 0,
              })
            }}
          </span>
        </p>
        <h1 class="board-title">
          {{ $t('requests.title') }}
        </h1>
        <p class="board-intro">{{ $t('requests.intro') }}</p>
      </div>

      <NuxtLink to="/requests/new" class="board-new">
        <Icon name="ph:megaphone-bold" />
        <span>{{ $t('requests.actions.create') }}</span>
      </NuxtLink>
    </header>

    <!-- Filters strip: status segmented + mine toggle + search -->
    <div class="board-filters">
      <div class="board-status-seg" role="radiogroup">
        <button
          v-for="opt in statusOptions"
          :key="String(opt.value)"
          type="button"
          class="board-status-opt"
          :class="[
            opt.value !== '' ? `board-status-opt--${opt.value}` : '',
            { 'is-active': status === opt.value },
          ]"
          role="radio"
          :aria-checked="status === opt.value"
          @click="setStatus(opt.value)"
        >
          <span class="board-status-dot" />
          <span>{{ opt.label }}</span>
        </button>
      </div>
      <label class="board-mine">
        <input v-model="mine" type="checkbox" />
        <span class="board-mine-track">
          <span class="board-mine-thumb" />
        </span>
        <span class="board-mine-label">
          {{ $t('requests.filters.mine') }}
        </span>
      </label>
      <div class="board-search">
        <Icon name="ph:magnifying-glass-bold" class="board-search-icon" />
        <input
          v-model="searchInput"
          type="search"
          class="board-search-input"
          :placeholder="$t('requests.filters.searchPlaceholder')"
        />
      </div>
    </div>

    <div v-if="pending && !data" class="board-loader">
      <Icon name="ph:circle-notch" class="loader-spin" />
      <span>{{ $t('requests.loading') }}</span>
    </div>

    <ul v-else-if="rows.length > 0" class="board-list">
      <li
        v-for="(row, i) in rows"
        :key="row.id"
        class="ticker"
        :class="`ticker--${row.status}`"
        :style="{ '--stagger': `${Math.min(i * 30, 240)}ms` }"
      >
        <NuxtLink :to="`/requests/${row.id}`" class="ticker-link">
          <div class="ticker-status">
            <span class="ticker-status-dot" />
            <span class="ticker-status-label">{{
              $t(`requests.status.${row.status}`)
            }}</span>
          </div>
          <div class="ticker-body">
            <div class="ticker-meta">
              <span class="ticker-cat">
                <Icon :name="getCategoryIcon(row.category)" />
                <span>{{ row.category.name }}</span>
              </span>
              <span class="ticker-sep" aria-hidden="true">·</span>
              <span class="ticker-requester">
                <Icon name="ph:user-bold" />
                <span>@{{ row.requester.username }}</span>
              </span>
              <span class="ticker-sep" aria-hidden="true">·</span>
              <time
                class="ticker-when tabular-nums"
                :datetime="row.createdAt"
              >
                {{ formatAge(row.createdAt) }}
              </time>
            </div>
            <h3 class="ticker-title">{{ row.title }}</h3>
          </div>
          <div class="ticker-reward">
            <span
              v-if="row.rewardPoints > 0"
              class="ticker-reward-plate"
              :title="$t('requests.rewardTooltip')"
            >
              <span class="ticker-reward-mark">⊕</span>
              <span class="ticker-reward-value tabular-nums">{{
                formatReward(row.rewardPoints)
              }}</span>
              <span class="ticker-reward-unit">{{
                $t('requests.pointsShort')
              }}</span>
            </span>
            <span v-else class="ticker-reward-empty">
              {{ $t('requests.noReward') }}
            </span>
          </div>
          <Icon name="ph:arrow-right-bold" class="ticker-caret" />
        </NuxtLink>
      </li>
    </ul>

    <!-- Empty state: stylised "marché vide" sign -->
    <div v-else class="board-empty">
      <div class="empty-plate" aria-hidden="true">
        <span class="empty-plate-line" />
        <span class="empty-plate-line empty-plate-line--short" />
        <span class="empty-plate-stamp">
          <Icon name="ph:scroll-bold" />
        </span>
      </div>
      <h2 class="empty-title">{{ $t('requests.empty.title') }}</h2>
      <p class="empty-sub">{{ $t('requests.empty.sub') }}</p>
      <NuxtLink to="/requests/new" class="empty-cta">
        <Icon name="ph:megaphone-bold" />
        {{ $t('requests.actions.create') }}
      </NuxtLink>
    </div>

    <nav
      v-if="data && data.pagination.pages > 1"
      class="board-pager"
      :aria-label="$t('requests.pagerAria')"
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
import { formatAge } from '~/utils/format';
import { getCategoryIcon } from '~/utils/categoryIcon';

definePageMeta({ title: 'Requests' });

const { t } = useI18n();
useHead({ title: () => t('requests.headTitle') });

type StatusFilter =
  | ''
  | 'requested'
  | 'filled'
  | 'validated'
  | 'cancelled';

interface RequestRow {
  id: string;
  title: string;
  rewardPoints: number;
  status: 'requested' | 'filled' | 'validated' | 'cancelled';
  createdAt: string;
  filledAt: string | null;
  validatedAt: string | null;
  requester: { id: string; username: string };
  category: {
    id: string;
    name: string;
    slug: string;
    type: string | null;
    icon: string | null;
  };
}

interface RequestsResponse {
  data: RequestRow[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

const status = ref<StatusFilter>('requested');
const mine = ref(false);
const page = ref(1);
const searchInput = ref('');
// Debounced version that drives the query so every keystroke
// doesn't fire a request.
const search = ref('');
let searchTimer: ReturnType<typeof setTimeout> | null = null;
watch(searchInput, (value) => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    search.value = value.trim();
    page.value = 1;
  }, 250);
});

const { data, pending } = await useFetch<RequestsResponse>(
  '/api/requests',
  {
    query: computed(() => ({
      status: status.value || undefined,
      mine: mine.value ? '1' : undefined,
      search: search.value || undefined,
      page: page.value,
      limit: 24,
    })),
    watch: [status, mine, page, search],
  },
);

const rows = computed(() => data.value?.data ?? []);

const statusOptions = computed<
  Array<{ value: StatusFilter; label: string }>
>(() => [
  { value: '', label: t('requests.statusFilter.all') },
  { value: 'requested', label: t('requests.status.requested') },
  { value: 'filled', label: t('requests.status.filled') },
  { value: 'validated', label: t('requests.status.validated') },
  { value: 'cancelled', label: t('requests.status.cancelled') },
]);

function setStatus(s: StatusFilter) {
  status.value = s;
  page.value = 1;
}

function setPage(n: number) {
  page.value = n;
}

watch(mine, () => {
  page.value = 1;
});

/** Format the reward count with thin-space separators every 3
 *  digits. Reads as a real "price" on the brass plate. */
function formatReward(n: number): string {
  return n.toLocaleString('fr-FR').replace(/\s/g, ' ');
}
</script>

<style scoped>
/* ╔════════════════════════════════════════════════════════════════╗
   ║  /requests — bounty board / trading floor                        ║
   ║                                                                  ║
   ║  Brass + phosphor palette: warm metal for reward plates, cool    ║
   ║  green/amber/blue for status indicators. A subtle grid overlay   ║
   ║  evokes a trading-floor LED panel without going full retro-      ║
   ║  futuristic.                                                     ║
   ╚════════════════════════════════════════════════════════════════╝ */
.board {
  position: relative;
  isolation: isolate;
  max-width: 1180px;
  margin: 0 auto;
  padding: 2rem 1.5rem 5rem;
  --brass: 212 167 52;           /* main reward + accent tone */
  --brass-deep: 158 113 31;
  --phosphor: 110 231 183;       /* status: open */
  --status-filled: 251 191 36;
  --status-validated: 96 165 250;
  --status-cancelled: 156 163 175;
}
.tabular-nums { font-variant-numeric: tabular-nums; }

/* Aura: warm metal blob + cool phosphor blob */
.board-aura {
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
.board-aura::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(
      ellipse 70% 55% at 18% 0%,
      rgb(var(--brass) / 0.15),
      transparent 65%
    ),
    radial-gradient(
      ellipse 55% 45% at 88% 0%,
      rgb(var(--phosphor) / 0.1),
      transparent 65%
    );
}
.aura-blob {
  position: absolute;
  display: block;
  filter: blur(90px);
  opacity: 0.32;
  border-radius: 50%;
}
.aura-blob--a {
  width: 520px;
  height: 520px;
  top: -180px;
  left: -100px;
  background: radial-gradient(circle, rgb(var(--brass) / 0.55), transparent 65%);
}
.aura-blob--b {
  width: 380px;
  height: 380px;
  top: 40px;
  right: -120px;
  background: radial-gradient(circle, rgb(var(--phosphor) / 0.4), transparent 65%);
}
.aura-grain {
  position: absolute;
  inset: 0;
  background-image: radial-gradient(rgba(255,255,255,0.03) 1px, transparent 1px);
  background-size: 3px 3px;
  opacity: 0.5;
  mix-blend-mode: overlay;
}

/* Header */
.board-head {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: end;
  gap: 1.4rem 2rem;
  margin-bottom: 2rem;
  animation: board-rise 0.55s cubic-bezier(0.22, 1, 0.36, 1) both;
}
@keyframes board-rise {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
@media (max-width: 720px) {
  .board-head { grid-template-columns: 1fr; }
}

.board-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  margin: 0 0 0.55rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.board-eyebrow-mark {
  font-family: 'Fraunces', 'Charter', Georgia, serif;
  font-style: italic;
  font-size: 18px;
  font-weight: 600;
  color: rgb(var(--brass));
  line-height: 0;
  transform: translateY(2px);
  filter: drop-shadow(0 0 8px rgb(var(--brass) / 0.4));
}
.board-eyebrow-label {
  color: rgb(var(--brass));
  font-weight: 800;
}
.board-eyebrow-sep { opacity: 0.45; }
.board-eyebrow-count {
  color: rgb(var(--fg-default));
  font-weight: 700;
}

.board-title {
  margin: 0;
  font-family: 'Fraunces', 'Charter', Georgia, serif;
  font-style: italic;
  font-weight: 600;
  font-size: clamp(1.9rem, 4vw, 2.8rem);
  line-height: 1.05;
  letter-spacing: -0.015em;
  color: rgb(var(--fg-strong));
}
.board-intro {
  margin: 0.7rem 0 0;
  max-width: 60ch;
  font-size: 14px;
  line-height: 1.55;
  color: rgb(var(--fg-muted));
}

.board-new {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.65rem 1.15rem;
  background:
    linear-gradient(180deg, rgb(var(--brass) / 0.22), rgb(var(--brass) / 0.05)),
    rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--brass) / 0.55);
  border-radius: 0.4rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgb(var(--brass));
  text-decoration: none;
  white-space: nowrap;
  transition:
    transform 0.22s cubic-bezier(0.22, 1, 0.36, 1),
    background 0.18s,
    box-shadow 0.22s;
  align-self: end;
}
.board-new:hover {
  transform: translateY(-1px);
  box-shadow: 0 12px 28px -14px rgb(var(--brass) / 0.5);
  background:
    linear-gradient(180deg, rgb(var(--brass) / 0.3), rgb(var(--brass) / 0.08)),
    rgb(var(--bg-elevated));
}

/* Filters strip */
.board-filters {
  display: flex;
  align-items: center;
  gap: 0.9rem 1.1rem;
  flex-wrap: wrap;
  margin-bottom: 1.5rem;
}
.board-status-seg {
  display: inline-flex;
  padding: 0.18rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-strong));
  border-radius: 999px;
  flex-wrap: wrap;
}
.board-status-opt {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.4rem 0.9rem;
  background: transparent;
  border: 0;
  border-radius: 999px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  cursor: pointer;
  transition: color 0.15s, background 0.18s;
}
.board-status-opt:hover { color: rgb(var(--fg-strong)); }
.board-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
  flex-shrink: 0;
  opacity: 0.55;
}
.board-status-opt.is-active {
  color: rgb(var(--brass));
  background: rgb(var(--brass) / 0.15);
  box-shadow: inset 0 0 0 1px rgb(var(--brass) / 0.32);
}
.board-status-opt.is-active .board-status-dot { opacity: 1; }
.board-status-opt--requested.is-active { color: rgb(var(--phosphor)); background: rgb(var(--phosphor) / 0.14); box-shadow: inset 0 0 0 1px rgb(var(--phosphor) / 0.35); }
.board-status-opt--filled.is-active { color: rgb(var(--status-filled)); background: rgb(var(--status-filled) / 0.16); box-shadow: inset 0 0 0 1px rgb(var(--status-filled) / 0.4); }
.board-status-opt--validated.is-active { color: rgb(var(--status-validated)); background: rgb(var(--status-validated) / 0.16); box-shadow: inset 0 0 0 1px rgb(var(--status-validated) / 0.4); }
.board-status-opt--cancelled.is-active { color: rgb(var(--status-cancelled)); background: rgb(var(--status-cancelled) / 0.15); box-shadow: inset 0 0 0 1px rgb(var(--status-cancelled) / 0.4); }

.board-mine {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  cursor: pointer;
  user-select: none;
}
.board-mine input { display: none; }
.board-mine-track {
  position: relative;
  width: 32px;
  height: 18px;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-strong));
  border-radius: 999px;
  transition: background 0.18s, border-color 0.18s;
}
.board-mine-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  background: rgb(var(--fg-muted));
  border-radius: 999px;
  transition: transform 0.22s cubic-bezier(0.22, 1, 0.36, 1), background 0.18s;
}
.board-mine input:checked + .board-mine-track {
  background: rgb(var(--brass) / 0.32);
  border-color: rgb(var(--brass) / 0.55);
}
.board-mine input:checked + .board-mine-track .board-mine-thumb {
  transform: translateX(14px);
  background: rgb(var(--brass));
}
.board-mine-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}

.board-search {
  flex: 1 1 220px;
  min-width: 220px;
  position: relative;
  display: flex;
  align-items: center;
}
.board-search-icon {
  position: absolute;
  left: 0.7rem;
  color: rgb(var(--fg-muted));
  pointer-events: none;
}
.board-search-input {
  width: 100%;
  padding: 0.55rem 0.85rem 0.55rem 2.1rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-strong));
  border-radius: 0.35rem;
  color: rgb(var(--fg-default));
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
  letter-spacing: 0.04em;
  transition: border-color 0.18s, box-shadow 0.18s;
}
.board-search-input:focus {
  outline: 0;
  border-color: rgb(var(--brass) / 0.55);
  box-shadow: 0 0 0 3px rgb(var(--brass) / 0.12);
}
.board-search-input::placeholder { color: rgb(var(--fg-faint)); }

/* Loader */
.board-loader {
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
.loader-spin { font-size: 1.25rem; animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ── List rows ─────────────────────────────────────────────── */
.board-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.ticker {
  position: relative;
  overflow: hidden;
  background:
    linear-gradient(180deg, rgba(255,255,255,0.025), transparent 50%),
    rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-strong));
  border-radius: 0.5rem;
  animation: ticker-enter 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: var(--stagger, 0ms);
  transition: transform 0.25s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.2s, box-shadow 0.22s;
}
@keyframes ticker-enter {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
.ticker:hover {
  transform: translateY(-2px);
  border-color: rgb(var(--brass) / 0.45);
  box-shadow: 0 16px 36px -22px rgba(0,0,0,0.7), 0 0 0 1px rgb(var(--brass) / 0.2);
}
/* Status accent: left rail in the matching tone */
.ticker::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 3px;
  background: rgb(var(--phosphor));
}
.ticker--filled::before    { background: rgb(var(--status-filled)); }
.ticker--validated::before { background: rgb(var(--status-validated)); }
.ticker--cancelled::before { background: rgb(var(--status-cancelled)); opacity: 0.55; }

.ticker-link {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: center;
  gap: 0.85rem 1rem;
  width: 100%;
  padding: 0.85rem 1rem 0.85rem 1.1rem;
  text-decoration: none;
  color: inherit;
}
@media (max-width: 720px) {
  .ticker-link {
    grid-template-columns: auto 1fr auto;
  }
  .ticker-caret { display: none; }
}

.ticker-status {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.28rem 0.55rem;
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--phosphor) / 0.35);
  border-radius: 999px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--phosphor));
  white-space: nowrap;
}
.ticker--filled .ticker-status    { color: rgb(var(--status-filled));    border-color: rgb(var(--status-filled) / 0.4); }
.ticker--validated .ticker-status { color: rgb(var(--status-validated)); border-color: rgb(var(--status-validated) / 0.4); }
.ticker--cancelled .ticker-status { color: rgb(var(--status-cancelled)); border-color: rgb(var(--status-cancelled) / 0.4); opacity: 0.8; }

.ticker-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
  flex-shrink: 0;
}
.ticker--requested .ticker-status-dot {
  box-shadow: 0 0 8px currentColor;
  animation: status-pulse 2s ease-in-out infinite;
}
@keyframes status-pulse {
  0%, 100% { opacity: 0.65; transform: scale(1); }
  50%      { opacity: 1;    transform: scale(1.15); }
}

.ticker-body {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}
.ticker-meta {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.ticker-meta > svg { font-size: 0.85rem; }
.ticker-cat, .ticker-requester, .ticker-when {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}
.ticker-cat { color: rgb(var(--fg-default)); }
.ticker-sep { opacity: 0.4; }

.ticker-title {
  margin: 0;
  font-family: 'Fraunces', 'Charter', Georgia, serif;
  font-weight: 600;
  font-size: 1.05rem;
  line-height: 1.25;
  letter-spacing: -0.005em;
  color: rgb(var(--fg-strong));
  overflow-wrap: anywhere;
  text-wrap: pretty;
}

/* Brass reward plate — the visual centerpiece. Mono caps "REWARD"
   stamped onto a warm metal gradient, count in oversize mono. */
.ticker-reward {
  display: inline-flex;
  justify-content: flex-end;
  flex-shrink: 0;
}
.ticker-reward-plate {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.4rem 0.75rem;
  background:
    linear-gradient(180deg, rgb(var(--brass) / 0.25), rgb(var(--brass-deep) / 0.15)),
    rgb(var(--bg-base));
  border: 1px solid rgb(var(--brass) / 0.55);
  border-radius: 0.3rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  color: rgb(var(--brass));
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.1),
    0 4px 10px -6px rgb(var(--brass) / 0.4);
}
.ticker-reward-mark {
  font-size: 0.95rem;
  font-weight: 900;
  opacity: 0.65;
}
.ticker-reward-value {
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.04em;
}
.ticker-reward-unit {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  opacity: 0.75;
}
.ticker-reward-empty {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgb(var(--fg-faint));
  padding: 0.4rem 0.55rem;
  border: 1px dashed rgb(var(--line-default));
  border-radius: 0.3rem;
}

.ticker-caret {
  color: rgb(var(--fg-muted));
  font-size: 1.05rem;
  transition: transform 0.2s, color 0.18s;
}
.ticker:hover .ticker-caret {
  color: rgb(var(--brass));
  transform: translateX(2px);
}

/* Empty state */
.board-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 3rem 1.5rem 4rem;
  text-align: center;
}
.empty-plate {
  position: relative;
  width: 200px;
  height: 130px;
  padding: 1.2rem 1rem;
  background:
    linear-gradient(180deg, rgb(var(--brass) / 0.12), transparent 80%),
    rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--brass) / 0.4);
  border-radius: 0.45rem;
  box-shadow: 0 16px 36px -18px rgba(0,0,0,0.65);
}
.empty-plate-line {
  display: block;
  height: 8px;
  background: rgb(var(--line-default));
  border-radius: 999px;
  margin-top: 0.6rem;
}
.empty-plate-line--short { width: 60%; }
.empty-plate-stamp {
  position: absolute;
  right: 0.85rem;
  bottom: 0.7rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border: 1.5px solid rgb(var(--brass) / 0.55);
  border-radius: 999px;
  color: rgb(var(--brass));
  font-size: 1.05rem;
  transform: rotate(-10deg);
}
.empty-title {
  margin: 0.4rem 0 0;
  font-family: 'Fraunces', 'Charter', Georgia, serif;
  font-style: italic;
  font-weight: 600;
  font-size: 1.3rem;
  color: rgb(var(--fg-strong));
}
.empty-sub {
  margin: 0;
  max-width: 48ch;
  font-size: 13.5px;
  line-height: 1.55;
  color: rgb(var(--fg-muted));
}
.empty-cta {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.4rem;
  padding: 0.55rem 1.1rem;
  background: rgb(var(--brass) / 0.18);
  color: rgb(var(--brass));
  border: 1px solid rgb(var(--brass) / 0.55);
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
  background: rgb(var(--brass));
  color: rgb(var(--bg-base));
  transform: translateY(-1px);
}

/* Pager */
.board-pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.85rem;
  margin-top: 2rem;
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
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.pager-btn:hover:not(:disabled) {
  border-color: rgb(var(--brass) / 0.5);
  color: rgb(var(--brass));
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
.pager-cur { color: rgb(var(--brass)); font-size: 14px; }
.pager-sep { opacity: 0.4; }

@media (prefers-reduced-motion: reduce) {
  .ticker { animation: none !important; }
  .ticker--requested .ticker-status-dot { animation: none !important; }
}
</style>
