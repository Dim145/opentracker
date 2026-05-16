<template>
  <!--
    /following — Dramatis Personae

    Aesthetic: a printed playbill / front-of-book cast list. Each
    followed user is a character in the viewer's personal narrative.
    Hexagonal portrait frames evoke theatrical masks, Roman numerals
    label each cast position, the title is set in Fraunces italic.

    Palette pivots toward emerald + amber spotlights to keep the
    surface distinct from /favorites (sepia/gold) and /me (purple
    rose). The cast wall layout intentionally breaks the right
    margin a touch on hover so the cards read as "characters
    stepping forward to greet the reader" rather than a grid of
    static thumbnails.
  -->
  <div class="cast">
    <!-- Atmosphere: emerald wash + amber spotlight blob + grain -->
    <div class="cast-aura" aria-hidden="true">
      <span class="aura-blob aura-blob--a" />
      <span class="aura-blob aura-blob--b" />
      <span class="aura-grain" />
      <!-- Decorative typographic ornament behind the title -
           a stage curtain swag drawn in CSS. -->
      <span class="aura-ornament" aria-hidden="true">❦</span>
    </div>

    <header class="cast-head">
      <div class="cast-head-id">
        <p class="cast-eyebrow">
          <span class="cast-eyebrow-mark" aria-hidden="true">§</span>
          <span class="cast-eyebrow-label">
            {{ $t('following.eyebrow') }}
          </span>
          <span class="cast-eyebrow-sep" aria-hidden="true">·</span>
          <span class="cast-eyebrow-count tabular-nums">
            {{
              $t('following.cast.count', {
                n: data?.pagination.total ?? 0,
              })
            }}
          </span>
        </p>
        <h1 class="cast-title">
          <span class="cast-title-prefix">Dramatis</span>
          <span class="cast-title-accent">Personæ</span>
        </h1>
        <p class="cast-intro">{{ $t('following.intro') }}</p>
      </div>

      <div class="cast-sort">
        <span class="cast-sort-label">{{ $t('following.sort.label') }}</span>
        <div class="cast-sort-seg" role="radiogroup">
          <button
            v-for="opt in sortOptions"
            :key="opt.value"
            type="button"
            class="cast-sort-opt"
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

    <!-- Loader -->
    <div v-if="pending && !data" class="cast-loader">
      <Icon name="ph:circle-notch" class="loader-spin" />
      <span>{{ $t('following.loading') }}</span>
    </div>

    <!-- Cast wall -->
    <ul v-else-if="rows.length > 0" class="cast-wall">
      <li
        v-for="(row, i) in rows"
        :key="row.id"
        class="persona"
        :style="{
          '--stagger': `${Math.min(i * 60, 480)}ms`,
        }"
      >
        <span class="persona-roman" aria-hidden="true">
          {{ toRoman(romanIndex(i)) }}
        </span>

        <!-- Spotlight + hex portrait -->
        <div class="persona-stage" aria-hidden="true">
          <span class="persona-spotlight" />
          <span class="persona-portrait" :style="portraitStyle(row.username)">
            <span class="persona-initials">{{ initials(row) }}</span>
          </span>
        </div>

        <NuxtLink :to="`/users/${row.id}`" class="persona-id">
          <h3 class="persona-name">
            {{ row.displayName || row.username }}
          </h3>
          <span class="persona-handle">@{{ row.username }}</span>
        </NuxtLink>

        <blockquote v-if="row.bio" class="persona-bio">
          {{ truncateBio(row.bio) }}
        </blockquote>

        <dl class="persona-meta">
          <div>
            <dt>{{ $t('following.persona.uploads') }}</dt>
            <dd class="tabular-nums">{{ row.uploadsCount }}</dd>
          </div>
          <div>
            <dt>{{ $t('following.persona.ratio') }}</dt>
            <dd class="tabular-nums">{{ formatRatio(row.ratio) }}</dd>
          </div>
          <div class="persona-meta-wide">
            <dt>{{ $t('following.persona.lastUpload') }}</dt>
            <dd>
              <span v-if="row.lastUploadAt" class="tabular-nums">
                {{ formatAge(row.lastUploadAt) }}
              </span>
              <span v-else class="persona-faint">
                {{ $t('following.persona.noUploads') }}
              </span>
            </dd>
          </div>
        </dl>

        <footer class="persona-foot">
          <span
            class="persona-since"
            :title="formatDay(row.followedAt)"
          >
            <Icon name="ph:bookmark-simple-fill" />
            {{
              $t('following.persona.entered', {
                date: formatStamp(row.followedAt),
              })
            }}
          </span>
          <button
            type="button"
            class="persona-exit"
            :disabled="leaving.has(row.id)"
            :title="$t('following.persona.exitTooltip', { name: row.username })"
            @click="unfollow(row)"
          >
            <Icon name="ph:sign-out-bold" />
            <span>{{ $t('following.persona.exit') }}</span>
          </button>
        </footer>
      </li>
    </ul>

    <!-- Empty stage: closed velvet curtains -->
    <div v-else class="cast-empty">
      <div class="empty-stage" aria-hidden="true">
        <span class="curtain curtain--left" />
        <span class="curtain curtain--right" />
        <span class="empty-spotlight" />
        <Icon name="ph:masks-theater-bold" class="empty-mask" />
      </div>
      <h2 class="empty-title">{{ $t('following.empty.title') }}</h2>
      <p class="empty-sub">{{ $t('following.empty.sub') }}</p>
      <NuxtLink to="/torrents" class="empty-cta">
        <Icon name="ph:compass-bold" />
        <span>{{ $t('following.empty.cta') }}</span>
      </NuxtLink>
    </div>

    <!-- Pagination -->
    <nav
      v-if="data && data.pagination.pages > 1"
      class="cast-pager"
      :aria-label="$t('following.pagerAria')"
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
import { formatAge, formatDay } from '~/utils/format';

definePageMeta({ title: 'Following' });

const { t, locale } = useI18n();
const notifications = useNotificationStore();
useHead({ title: () => t('following.headTitle') });

type Sort = 'recent' | 'alpha';

interface PersonaRow {
  id: string;
  username: string;
  displayName: string | null;
  bio: string | null;
  memberSince: string;
  lastSeen: string | null;
  ratio: number | null;
  uploadsCount: number;
  lastUploadAt: string | null;
  followedAt: string;
}

interface FollowingResponse {
  data: PersonaRow[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

const sort = ref<Sort>('recent');
const page = ref(1);
const leaving = ref(new Set<string>());

const { data, pending, refresh } = await useFetch<FollowingResponse>(
  '/api/me/following',
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
      label: t('following.sort.recent'),
      icon: 'ph:clock-bold',
    },
    {
      value: 'alpha',
      label: t('following.sort.alpha'),
      icon: 'ph:sort-ascending-bold',
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

function initials(row: PersonaRow): string {
  const name = (row.displayName || row.username || '?').trim();
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0]! + parts[1][0]!).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

/** Stable gradient per username — same palette as /users/:id so
 *  the persona portrait on this page matches the dossier avatar
 *  someone clicks through to. */
const portraitGradients: Array<[string, string]> = [
  ['#a78bfa', '#f472b6'],
  ['#38bdf8', '#2dd4bf'],
  ['#f472b6', '#eab308'],
  ['#a78bfa', '#38bdf8'],
  ['#2dd4bf', '#22c55e'],
  ['#22c55e', '#eab308'],
  ['#818cf8', '#a78bfa'],
];
function portraitStyle(username: string): Record<string, string> {
  let h = 0;
  for (let i = 0; i < username.length; i++) {
    h = ((h << 5) - h + username.charCodeAt(i)) | 0;
  }
  const [from, to] =
    portraitGradients[Math.abs(h) % portraitGradients.length]!;
  return { background: `linear-gradient(135deg, ${from} 0%, ${to} 100%)` };
}

/** Position-in-cast Roman numeral — uses the absolute index into
 *  the full follow list (page offset + row index) so a persona
 *  carries the same number across page navigations. */
function romanIndex(i: number): number {
  const limit = data.value?.pagination.limit ?? 24;
  return (page.value - 1) * limit + i + 1;
}

/** Compact Roman numeral converter. Caps at 3999, more than
 *  enough for any plausible follow list — beyond that we fall
 *  back to a decimal serial. */
function toRoman(num: number): string {
  if (num <= 0 || num >= 4000) return String(num);
  const map: [number, string][] = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'],
    [1, 'I'],
  ];
  let n = num;
  let out = '';
  for (const [value, glyph] of map) {
    while (n >= value) {
      out += glyph;
      n -= value;
    }
  }
  return out;
}

function truncateBio(bio: string, max = 160): string {
  if (bio.length <= max) return bio;
  return bio.slice(0, max).trimEnd() + '…';
}

function formatRatio(ratio: number | null): string {
  if (ratio === null) return '∞';
  return ratio.toFixed(2);
}

function formatStamp(iso: string): string {
  const d = new Date(iso);
  const month = d
    .toLocaleString(locale.value, { month: 'short' })
    .replace('.', '')
    .toUpperCase();
  const day = String(d.getDate()).padStart(2, '0');
  return `${month} ${day} ${d.getFullYear()}`;
}

async function unfollow(row: PersonaRow) {
  if (leaving.value.has(row.id)) return;
  leaving.value.add(row.id);
  // Brief delay so the exit animation reads before refetch.
  setTimeout(async () => {
    try {
      await $fetch(`/api/users/${row.id}/follow`, { method: 'DELETE' });
      notifications.success(t('following.toasts.left', { name: row.username }));
      await refresh();
    } catch (err: any) {
      notifications.error(
        err?.data?.message || t('following.toasts.leaveFailed'),
      );
    } finally {
      leaving.value.delete(row.id);
    }
  }, 280);
}
</script>

<style scoped>
/* ╔════════════════════════════════════════════════════════════════╗
   ║  /following — Dramatis Personae                                  ║
   ║                                                                  ║
   ║  Theatrical playbill vocabulary: emerald velvet stage, amber     ║
   ║  spotlights, hexagonal portrait masks, Fraunces italic title,    ║
   ║  Roman numerals for cast positions. Distinct from /favorites'    ║
   ║  warm-paper aesthetic and /me's clean press-sheet — three        ║
   ║  user-private surfaces, three different moods.                   ║
   ╚════════════════════════════════════════════════════════════════╝ */
.cast {
  position: relative;
  isolation: isolate;
  max-width: 1180px;
  margin: 0 auto;
  padding: 2rem 1.5rem 5rem;
  --emerald: 16 185 129;   /* primary stage tone */
  --emerald-deep: 6 78 59; /* curtain shadow */
  --amber: 245 158 11;     /* spotlight */
  --velvet: 6 19 24;       /* deep stage floor */
}
.tabular-nums { font-variant-numeric: tabular-nums; }

/* ── Atmospheric stage ──────────────────────────────────────── */
.cast-aura {
  position: absolute;
  top: -2rem;
  left: 50%;
  width: 100vw;
  margin-left: -50vw;
  height: 75vh;
  max-height: 560px;
  z-index: -1;
  overflow: hidden;
  pointer-events: none;
}
.cast-aura::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(
      ellipse 65% 55% at 25% 0%,
      rgb(var(--emerald) / 0.16),
      transparent 65%
    ),
    radial-gradient(
      ellipse 50% 45% at 85% 0%,
      rgb(var(--amber) / 0.14),
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
  width: 540px;
  height: 540px;
  top: -200px;
  left: -120px;
  background: radial-gradient(
    circle,
    rgb(var(--emerald) / 0.55),
    transparent 65%
  );
}
.aura-blob--b {
  width: 420px;
  height: 420px;
  top: 30px;
  right: -160px;
  background: radial-gradient(
    circle,
    rgb(var(--amber) / 0.5),
    transparent 65%
  );
}
.aura-grain {
  position: absolute;
  inset: 0;
  background-image:
    radial-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px);
  background-size: 3px 3px;
  opacity: 0.55;
  mix-blend-mode: overlay;
}
.aura-ornament {
  position: absolute;
  top: 4rem;
  right: 14%;
  font-family: 'Fraunces', 'Charter', Georgia, serif;
  font-size: 4.5rem;
  line-height: 1;
  color: rgb(var(--amber) / 0.15);
  pointer-events: none;
  user-select: none;
  filter: drop-shadow(0 0 12px rgb(var(--amber) / 0.18));
  transform: rotate(-8deg);
}

/* ── Header ─────────────────────────────────────────────────── */
.cast-head {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: end;
  gap: 1.5rem 2rem;
  margin-bottom: 2.5rem;
  animation: cast-rise 0.55s cubic-bezier(0.22, 1, 0.36, 1) both;
}
@keyframes cast-rise {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
@media (max-width: 760px) {
  .cast-head { grid-template-columns: 1fr; }
}

.cast-eyebrow {
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
.cast-eyebrow-mark {
  font-family: 'Fraunces', 'Charter', Georgia, serif;
  font-style: italic;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 0;
  color: rgb(var(--emerald));
  line-height: 0;
  transform: translateY(2px);
  filter: drop-shadow(0 0 8px rgb(var(--emerald) / 0.4));
}
.cast-eyebrow-label {
  color: rgb(var(--emerald));
  font-weight: 800;
}
.cast-eyebrow-sep { opacity: 0.5; }
.cast-eyebrow-count {
  color: rgb(var(--fg-default));
  font-weight: 700;
}

/* Display title — Fraunces italic. The accent word ("Personæ")
   carries the amber wash so the eye lands on it first. */
.cast-title {
  margin: 0;
  font-family: 'Fraunces', 'Charter', Georgia, serif;
  font-weight: 600;
  font-style: italic;
  font-size: clamp(2.2rem, 5vw, 3.4rem);
  line-height: 1;
  letter-spacing: -0.02em;
  color: rgb(var(--fg-strong));
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  flex-wrap: wrap;
}
.cast-title-prefix { font-weight: 500; }
.cast-title-accent {
  color: rgb(var(--amber));
  text-shadow: 0 0 20px rgb(var(--amber) / 0.35);
}
.cast-intro {
  margin: 0.8rem 0 0;
  max-width: 58ch;
  font-size: 14px;
  line-height: 1.55;
  color: rgb(var(--fg-muted));
}

/* Sort segment — same vocabulary as /favorites but emerald-tinted */
.cast-sort {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  flex-wrap: wrap;
}
.cast-sort-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.cast-sort-seg {
  display: inline-flex;
  padding: 0.18rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-strong));
  border-radius: 999px;
}
.cast-sort-opt {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.95rem;
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
.cast-sort-opt > svg { font-size: 0.85rem; flex-shrink: 0; }
.cast-sort-opt:hover { color: rgb(var(--fg-strong)); }
.cast-sort-opt.is-active {
  background: rgb(var(--emerald) / 0.18);
  color: rgb(var(--emerald));
  box-shadow: inset 0 0 0 1px rgb(var(--emerald) / 0.35);
}

/* Loader */
.cast-loader {
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

/* ╔════════════════════════════════════════════════════════════════╗
   ║  CAST WALL                                                       ║
   ╚════════════════════════════════════════════════════════════════╝ */
.cast-wall {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1.6rem 1.4rem;
}

/* Persona card — vertical playbill entry. Heavy use of pseudo-
   elements creates the velvet-stage feel without extra markup. */
.persona {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 2rem 1.1rem 1rem;
  background:
    radial-gradient(
      ellipse 90% 60% at 50% 0%,
      rgb(var(--emerald) / 0.1),
      transparent 70%
    ),
    radial-gradient(
      ellipse 70% 40% at 50% 100%,
      rgb(var(--emerald-deep) / 0.18),
      transparent 70%
    ),
    rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-strong));
  border-radius: 0.6rem;
  text-align: center;
  overflow: hidden;
  animation: persona-enter 0.6s cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: var(--stagger, 0ms);
  transition:
    transform 0.32s cubic-bezier(0.22, 1, 0.36, 1),
    border-color 0.22s,
    box-shadow 0.32s ease;
  box-shadow:
    0 16px 36px -20px rgba(0, 0, 0, 0.65),
    inset 0 1px 0 rgba(255, 255, 255, 0.04);
}
@keyframes persona-enter {
  from {
    opacity: 0;
    transform: translateY(14px) scale(0.97);
    filter: blur(2px);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
    filter: blur(0);
  }
}
.persona::before {
  /* Faint emerald top-bar — like a stage proscenium arch frame. */
  content: '';
  position: absolute;
  top: 0;
  left: 1.2rem;
  right: 1.2rem;
  height: 2px;
  background: linear-gradient(
    to right,
    transparent,
    rgb(var(--emerald) / 0.55),
    rgb(var(--amber) / 0.4),
    rgb(var(--emerald) / 0.55),
    transparent
  );
}
.persona:hover {
  transform: translateY(-4px);
  border-color: rgb(var(--emerald) / 0.5);
  box-shadow:
    0 28px 60px -24px rgba(0, 0, 0, 0.7),
    0 0 0 1px rgb(var(--emerald) / 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

/* Roman cast number — top-right corner, mono caps */
.persona-roman {
  position: absolute;
  top: 0.55rem;
  right: 0.8rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.22em;
  color: rgb(var(--amber));
  opacity: 0.85;
  text-shadow: 0 0 6px rgb(var(--amber) / 0.4);
}

/* Stage zone: spotlight + hex portrait */
.persona-stage {
  position: relative;
  width: 110px;
  height: 110px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0.3rem 0 0.4rem;
}
.persona-spotlight {
  position: absolute;
  inset: -20px;
  background: radial-gradient(
    circle at 50% 30%,
    rgb(var(--amber) / 0.32),
    transparent 65%
  );
  filter: blur(6px);
  pointer-events: none;
  z-index: 0;
  animation: spotlight-warmup 1.2s ease-out both;
}
@keyframes spotlight-warmup {
  from { opacity: 0; transform: scale(0.85); }
  to   { opacity: 1; transform: scale(1); }
}
.persona:hover .persona-spotlight {
  animation: spotlight-pulse 2.4s ease-in-out infinite;
}
@keyframes spotlight-pulse {
  0%, 100% { opacity: 0.85; }
  50%      { opacity: 1; transform: scale(1.06); }
}

.persona-portrait {
  position: relative;
  width: 100px;
  height: 100px;
  display: flex;
  align-items: center;
  justify-content: center;
  /* Hexagonal mask via clip-path. A "pointy-top" hex reads more
     theatrical than the standard "flat-top". */
  clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);
  box-shadow:
    inset 0 0 0 2px rgba(255, 255, 255, 0.18),
    inset 0 -18px 24px -16px rgba(0, 0, 0, 0.4);
  z-index: 1;
}
.persona-portrait::after {
  /* Sheen — diagonal highlight that suggests a glossy lacquered
     mask under spotlight. */
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.22),
    transparent 50%
  );
  pointer-events: none;
}
.persona-initials {
  font-family: 'Fraunces', 'Charter', Georgia, serif;
  font-style: italic;
  font-size: 2.4rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: rgba(255, 255, 255, 0.96);
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  z-index: 2;
}

/* Identity block */
.persona-id {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
  text-decoration: none;
  color: inherit;
  margin-top: 0.2rem;
  max-width: 100%;
  min-width: 0;
}
.persona-name {
  margin: 0;
  max-width: 100%;
  font-family: 'Fraunces', 'Charter', Georgia, serif;
  font-weight: 600;
  font-size: 1.2rem;
  letter-spacing: -0.005em;
  line-height: 1.15;
  color: rgb(var(--fg-strong));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.18s;
}
.persona-id:hover .persona-name { color: rgb(var(--amber)); }
.persona-handle {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: rgb(var(--emerald));
}

/* Bio quote, lightly faded */
.persona-bio {
  margin: 0.35rem 0 0;
  padding: 0 0.4rem;
  font-family: 'Fraunces', 'Charter', Georgia, serif;
  font-style: italic;
  font-size: 12.5px;
  line-height: 1.45;
  color: rgb(var(--fg-muted));
  max-width: 28ch;
}

/* Stats row — two compact + one wide */
.persona-meta {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem 0.6rem;
  margin: 0.7rem 0 0.1rem;
  width: 100%;
  padding: 0.65rem 0.5rem 0.5rem;
  border-top: 1px dashed rgb(var(--line-default));
}
.persona-meta-wide { grid-column: 1 / -1; }
.persona-meta div { display: flex; flex-direction: column; gap: 0.1rem; }
.persona-meta dt {
  margin: 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 8.5px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-faint));
}
.persona-meta dd {
  margin: 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
  font-weight: 700;
  color: rgb(var(--fg-strong));
}
.persona-faint {
  font-style: italic;
  color: rgb(var(--fg-faint));
  font-size: 11px;
}

/* Footer — entered date + exit button */
.persona-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  margin-top: 0.45rem;
  padding-top: 0.55rem;
  border-top: 1px solid rgb(var(--line-default));
  gap: 0.4rem;
}
.persona-since {
  display: inline-flex;
  align-items: center;
  gap: 0.32rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--emerald));
  opacity: 0.75;
}
.persona-since > svg { font-size: 0.8rem; color: rgb(var(--amber)); }
.persona-exit {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.28rem 0.55rem;
  background: transparent;
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.25rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  cursor: pointer;
  transition:
    color 0.15s,
    background 0.18s,
    border-color 0.18s,
    transform 0.18s;
}
.persona-exit:hover:not(:disabled) {
  color: rgb(var(--bg-base));
  background: rgb(var(--amber));
  border-color: rgb(var(--amber));
  transform: translateY(-1px);
}
.persona-exit:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.persona-exit > svg { font-size: 0.85rem; }

/* ╔════════════════════════════════════════════════════════════════╗
   ║  EMPTY STAGE                                                     ║
   ╚════════════════════════════════════════════════════════════════╝ */
.cast-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 2rem 1.5rem 4rem;
  text-align: center;
}
.empty-stage {
  position: relative;
  width: 240px;
  height: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 0.4rem;
  overflow: hidden;
  border-radius: 0.5rem 0.5rem 0 0;
  background:
    radial-gradient(
      ellipse 60% 40% at 50% 100%,
      rgb(var(--emerald-deep) / 0.4),
      transparent 70%
    ),
    rgb(var(--bg-base));
}
.curtain {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 40%;
  background:
    repeating-linear-gradient(
      to right,
      rgba(127, 29, 29, 0.85),
      rgba(127, 29, 29, 0.85) 8px,
      rgba(76, 5, 25, 0.95) 8px,
      rgba(76, 5, 25, 0.95) 16px
    );
  box-shadow: inset 0 0 30px rgba(0, 0, 0, 0.55);
  animation: curtain-sway 5s ease-in-out infinite;
}
.curtain--left { left: 0; transform-origin: top left; }
.curtain--right { right: 0; transform-origin: top right; }
.curtain--right { animation-delay: -2.5s; }
@keyframes curtain-sway {
  0%, 100% { transform: skewY(-0.5deg); }
  50%      { transform: skewY(0.5deg); }
}
.empty-spotlight {
  position: absolute;
  bottom: -30%;
  left: 50%;
  width: 60%;
  height: 140%;
  transform: translateX(-50%);
  background: radial-gradient(
    ellipse at 50% 100%,
    rgb(var(--amber) / 0.4),
    transparent 60%
  );
  filter: blur(8px);
}
.empty-mask {
  position: relative;
  z-index: 2;
  font-size: 3.5rem;
  color: rgb(var(--amber));
  filter: drop-shadow(0 0 14px rgb(var(--amber) / 0.45));
}

.empty-title {
  margin: 0.4rem 0 0;
  font-family: 'Fraunces', 'Charter', Georgia, serif;
  font-style: italic;
  font-weight: 600;
  font-size: 1.4rem;
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
  padding: 0.55rem 1.1rem;
  background: rgb(var(--emerald) / 0.18);
  color: rgb(var(--emerald));
  border: 1px solid rgb(var(--emerald) / 0.55);
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
  background: rgb(var(--emerald));
  color: rgb(var(--bg-base));
  transform: translateY(-1px);
}

/* ── Pager ───────────────────────────────────────────────────── */
.cast-pager {
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
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.pager-btn:hover:not(:disabled) {
  background: rgb(var(--bg-hover, var(--bg-elevated)));
  border-color: rgb(var(--emerald) / 0.5);
  color: rgb(var(--emerald));
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
.pager-cur { color: rgb(var(--emerald)); font-size: 14px; }
.pager-sep { opacity: 0.4; }

@media (prefers-reduced-motion: reduce) {
  .persona,
  .persona-spotlight,
  .curtain { animation: none !important; }
  .persona:hover .persona-spotlight { animation: none !important; }
}
</style>
