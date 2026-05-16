<template>
  <div class="profile-page">
    <!-- ── Atmospheric background ──────────────────────────────────
         Same vocabulary as the torrent detail page so the app feels
         like one editorial product. Two soft blobs (purple + rose)
         and a faint grain overlay sit behind the content. -->
    <div class="profile-aura" aria-hidden="true">
      <span class="aura-blob aura-blob--a" />
      <span class="aura-blob aura-blob--b" />
      <span class="aura-grain" />
    </div>

    <NuxtLink to="/torrents" class="profile-back">
      <Icon name="ph:arrow-left-bold" />
      {{ $t('users.profile.backToTorrents') }}
    </NuxtLink>

    <div v-if="pending" class="profile-loader">
      <Icon name="ph:spinner-bold" class="loader-spin" />
    </div>

    <div v-else-if="error || !user" class="profile-empty">
      <Icon name="ph:user-bold" class="empty-icon" />
      <p class="empty-text">{{ $t('users.profile.notFound') }}</p>
    </div>

    <template v-else-if="user">
      <!-- ╔═══════════════════════════════════════════════════════╗
           ║  HERO — member dossier panel                          ║
           ║  Big monogram avatar (gradient derived from username) ║
           ║  + eyebrow / title / handle / role chips / bio.       ║
           ╚═══════════════════════════════════════════════════════╝ -->
      <section class="hero">
        <div class="hero-avatar" :style="avatarStyle">
          <span class="hero-avatar-letter">{{ initials }}</span>
          <span class="hero-avatar-ring" aria-hidden="true" />
        </div>

        <div class="hero-body">
          <header class="hero-eyebrow">
            <span class="hero-eyebrow-mark" aria-hidden="true">§</span>
            <span class="hero-eyebrow-label">
              {{ $t('users.profile.eyebrow') }}
            </span>
            <span class="hero-eyebrow-sep">·</span>
            <span class="hero-eyebrow-since" :title="formatDay(user.createdAt)">
              {{ formatDay(user.createdAt).toUpperCase() }}
            </span>
            <span class="hero-eyebrow-spacer" aria-hidden="true" />
            <!-- Presence indicator. Pulses green if `lastSeen` is
                 within the last 5 minutes; otherwise renders the
                 relative age (or "Masqué" when the user opted to
                 hide it). -->
            <span class="hero-presence" :class="{ 'is-online': isOnline }">
              <span class="presence-dot" aria-hidden="true" />
              {{ presenceLabel }}
            </span>
          </header>

          <h1 class="hero-title">
            {{ user.displayName || user.username }}
          </h1>

          <div class="hero-handle-row">
            <span class="hero-handle">@{{ user.username }}</span>
            <span v-if="user.isAdmin" class="role-pill role-pill--admin">
              <Icon name="ph:shield-star-bold" class="role-pill-icon" />
              {{ $t('me.permission.admin') }}
            </span>
            <span v-else-if="user.isModerator" class="role-pill role-pill--mod">
              <Icon name="ph:gavel-bold" class="role-pill-icon" />
              {{ $t('nav.mod') }}
            </span>
            <RoleBadge
              v-for="r in user.roles"
              :key="r.id"
              :role="r"
              :title="$t('users.profile.roleTitle', { name: r.name })"
            />
          </div>

          <blockquote v-if="user.bio" class="hero-bio">
            <span class="hero-bio-mark" aria-hidden="true">"</span>
            <span class="hero-bio-body">{{ user.bio }}</span>
          </blockquote>
        </div>
      </section>

      <!-- § STATISTICS ─────────────────────────────────────────── -->
      <section class="section">
        <header class="section-head">
          <span class="section-head-mark" aria-hidden="true">§</span>
          <h2 class="section-head-title">{{ $t('users.profile.stats') }}</h2>
          <span class="section-head-line" aria-hidden="true" />
        </header>

        <ul class="stats-cluster">
          <li class="stat stat--ratio" :class="`stat--ratio-${ratioTier}`">
            <Icon name="ph:scales-bold" class="stat-icon" />
            <div class="stat-body">
              <span class="stat-num">{{ ratioFormatted }}</span>
              <span class="stat-label">{{ $t('me.stats.ratio') }}</span>
            </div>
          </li>
          <li class="stat stat--uploaded">
            <Icon name="ph:arrow-up-bold" class="stat-icon" />
            <div class="stat-body">
              <span class="stat-num">{{ formatSize(user.uploaded) }}</span>
              <span class="stat-label">{{ $t('me.stats.uploaded') }}</span>
            </div>
          </li>
          <li class="stat stat--downloaded">
            <Icon name="ph:arrow-down-bold" class="stat-icon" />
            <div class="stat-body">
              <span class="stat-num">{{ formatSize(user.downloaded) }}</span>
              <span class="stat-label">{{ $t('me.stats.downloaded') }}</span>
            </div>
          </li>
          <li class="stat stat--releases">
            <Icon name="ph:upload-simple-bold" class="stat-icon" />
            <div class="stat-body">
              <span class="stat-num tabular-nums">{{
                user.uploadsCount
              }}</span>
              <span class="stat-label">{{ $t('users.profile.uploads') }}</span>
            </div>
          </li>
        </ul>
      </section>

      <!-- § UPLOADED TORRENTS ──────────────────────────────────── -->
      <section class="section">
        <header class="section-head">
          <span class="section-head-mark" aria-hidden="true">§</span>
          <h2 class="section-head-title">
            {{ $t('users.profile.uploadedTorrents') }}
          </h2>
          <span v-if="user.uploadsCount" class="section-head-count">{{
            user.uploadsCount
          }}</span>
          <span class="section-head-line" aria-hidden="true" />
        </header>

        <div v-if="uploadsPending" class="upload-loader">
          <Icon name="ph:spinner-bold" class="loader-spin" />
        </div>

        <div v-else-if="!uploads?.data?.length" class="upload-empty">
          <Icon name="ph:files-bold" class="upload-empty-icon" />
          <p>{{ $t('me.stats.noUploadsYet') }}</p>
        </div>

        <ul v-else class="upload-list">
          <li
            v-for="(t, i) in uploads.data"
            :key="t.id"
            class="upload-item"
            :style="{ '--entry-delay': `${Math.min(i * 50, 400)}ms` }"
          >
            <NuxtLink :to="`/torrents/${t.infoHash}`" class="upload-link">
              <Icon
                :name="getCategoryIcon(t.category)"
                class="upload-icon"
              />
              <div class="upload-info">
                <span class="upload-name">{{ t.name }}</span>
                <span class="upload-meta">
                  <span class="upload-cat">
                    {{
                      t.category?.name || $t('users.profile.uncategorized')
                    }}
                  </span>
                  <span class="upload-sep">·</span>
                  <span class="upload-size">{{ formatSize(t.size) }}</span>
                  <span class="upload-sep">·</span>
                  <span class="upload-sl">
                    <span class="upload-s">
                      <Icon name="ph:arrow-up-bold" />
                      {{ t.stats.seeders }}
                    </span>
                    <span class="upload-l">
                      <Icon name="ph:arrow-down-bold" />
                      {{ t.stats.leechers }}
                    </span>
                  </span>
                  <span class="upload-sep">·</span>
                  <span class="upload-age">{{ formatAge(t.createdAt) }}</span>
                </span>
              </div>
              <Icon name="ph:arrow-right-bold" class="upload-arrow" />
            </NuxtLink>
          </li>
        </ul>

        <nav
          v-if="uploads?.pagination && uploads.pagination.pages > 1"
          class="upload-pager"
        >
          <button
            type="button"
            class="pager-btn"
            :disabled="uploadsPage <= 1"
            @click="uploadsPage--"
          >
            <Icon name="ph:arrow-left-bold" />
            {{ $t('common.previous') }}
          </button>
          <span class="pager-pos tabular-nums">
            <span class="pager-cur">{{ uploadsPage }}</span>
            <span class="pager-sep">/</span>
            <span class="pager-total">{{ uploads.pagination.pages }}</span>
          </span>
          <button
            type="button"
            class="pager-btn"
            :disabled="uploadsPage >= uploads.pagination.pages"
            @click="uploadsPage++"
          >
            {{ $t('common.next') }}
            <Icon name="ph:arrow-right-bold" />
          </button>
        </nav>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { formatSize, formatDay, formatAge } from '~/utils/format';
import { getCategoryIcon } from '~/utils/categoryIcon';

const { t } = useI18n();

interface UserProfile {
  id: string;
  username: string;
  displayName: string | null;
  bio: string | null;
  isAdmin: boolean;
  isModerator: boolean;
  uploaded: number;
  downloaded: number;
  createdAt: string;
  lastSeen: string | null;
  ratio: number | null;
  uploadsCount: number;
  roles: Array<{
    id: string;
    name: string;
    color: string;
    icon: string | null;
    priority: number;
    showAsBadge: boolean;
    assignedAt: string;
    assignedManually: boolean;
  }>;
}

interface TorrentItem {
  id: string;
  infoHash: string;
  name: string;
  size: number;
  createdAt: string;
  category?: {
    name: string;
    icon?: string | null;
    type?: string | null;
  } | null;
  stats: { seeders: number; leechers: number; completed: number };
}

interface UploadsResponse {
  data: TorrentItem[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

const route = useRoute();
const userId = computed(() => route.params.id as string);

// Fetch user profile
const {
  data: user,
  pending,
  error,
} = await useFetch<UserProfile>(() => `/api/users/${userId.value}`);

// Fetch user uploads with pagination
const uploadsPage = ref(1);
const { data: uploads, pending: uploadsPending } =
  await useFetch<UploadsResponse>(() => `/api/users/${userId.value}/uploads`, {
    query: { page: uploadsPage, limit: 10 },
    watch: [uploadsPage],
  });

// Initials for the monogram avatar — first letter of each "word" in
// the displayName, or the first two chars of the username when there
// is no display name. Capped at 2 chars so the glyph stays large.
const initials = computed(() => {
  if (!user.value) return '';
  const name = (user.value.displayName || user.value.username || '?').trim();
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0]! + parts[1][0]!).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
});

// Stable avatar gradient — hashes the username to pick one of seven
// hand-picked colour pairs from the page palette. Same username always
// gets the same gradient, so the monogram doubles as a recognisable
// identity glyph in lists / threads that link back here.
const avatarGradients: Array<[string, string]> = [
  ['#a78bfa', '#f472b6'], // purple → rose
  ['#38bdf8', '#2dd4bf'], // cyan → teal
  ['#f472b6', '#eab308'], // rose → amber
  ['#a78bfa', '#38bdf8'], // purple → cyan
  ['#2dd4bf', '#22c55e'], // teal → green
  ['#22c55e', '#eab308'], // green → amber
  ['#818cf8', '#a78bfa'], // indigo → purple
];

const avatarStyle = computed(() => {
  const seed = user.value?.username || '';
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  const [from, to] = avatarGradients[Math.abs(hash) % avatarGradients.length]!;
  return {
    background: `linear-gradient(135deg, ${from} 0%, ${to} 100%)`,
  };
});

// Presence — online if the user re-announced or hit a navigation
// endpoint within the past 5 minutes (the same threshold used by the
// presence-touch throttle on the server).
const isOnline = computed(() => {
  if (!user.value?.lastSeen) return false;
  const diff = Date.now() - new Date(user.value.lastSeen).getTime();
  return diff < 5 * 60 * 1000;
});

const presenceLabel = computed(() => {
  if (!user.value) return '';
  if (!user.value.lastSeen) {
    return t('users.profile.lastSeenHidden').toUpperCase();
  }
  if (isOnline.value) {
    return t('users.profile.online').toUpperCase();
  }
  return formatAge(user.value.lastSeen).toUpperCase();
});

// Ratio formatting
const ratioFormatted = computed(() => {
  if (!user.value) return '0.00';
  if (user.value.ratio === null) return '∞';
  return user.value.ratio.toFixed(2);
});

// Ratio tier — drives the colour rail on the ratio chip. Same
// thresholds as the previous ratioClass mapping but expressed as a
// data-attribute hue so it can plug into the shared `--rail` system.
const ratioTier = computed<'healthy' | 'ok' | 'warn' | 'bad'>(() => {
  if (!user.value) return 'ok';
  const r = user.value.ratio;
  if (r === null || r >= 2) return 'healthy';
  if (r >= 1) return 'ok';
  if (r >= 0.5) return 'warn';
  return 'bad';
});

useHead({
  title: user.value?.username
    ? t('users.profile.titleWithName', { name: user.value.username })
    : t('users.profile.title'),
});
</script>

<style scoped>
/* ╔══════════════════════════════════════════════════════════════╗
   ║  MEMBER DOSSIER — public profile page                       ║
   ║  Vocabulary continues the torrent detail page: § Fraunces   ║
   ║  italic marks, Inter title, JetBrains Mono labels, atmosph- ║
   ║  eric gradient blobs behind everything.                     ║
   ╚══════════════════════════════════════════════════════════════╝ */

.profile-page {
  position: relative;
  max-width: 1080px;
  margin: 0 auto;
  padding: 2rem 1.5rem 5rem;
  isolation: isolate;
  --release-purple: 167 139 250;
  --release-cyan:   var(--info);
  --release-rose:   244 114 182;
  --release-teal:   45 212 191;
}

/* ── Atmosphere ────────────────────────────────────────────────── */
.profile-aura {
  position: absolute;
  /* Break out of the centred 1080-px wrapper to span the full
     viewport width: anchor at left:50%, pull back by 50 vw via a
     negative margin so the aura's edges line up with the
     viewport's. The aura clips its own blob children
     (`overflow: hidden`); mobile is safe because the aura is
     exactly 100 vw wide — no fractional bleed that could trigger
     a stray right-scroll. */
  top: -2rem;
  left: 50%;
  width: 100vw;
  margin-left: -50vw;
  height: 70vh;
  z-index: -1;
  overflow: hidden;
  pointer-events: none;
}
.profile-aura::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(
      ellipse 80% 60% at 30% 0%,
      rgba(56, 89, 178, 0.28),
      transparent 70%
    ),
    radial-gradient(
      ellipse 60% 50% at 80% 0%,
      rgb(var(--release-purple) / 0.2),
      transparent 70%
    );
}
.aura-blob {
  position: absolute;
  display: block;
  filter: blur(80px);
  opacity: 0.38;
  border-radius: 50%;
}
.aura-blob--a {
  width: 520px;
  height: 520px;
  top: -180px;
  left: -120px;
  background: radial-gradient(
    circle,
    rgb(var(--release-rose) / 0.55),
    transparent 65%
  );
}
.aura-blob--b {
  width: 420px;
  height: 420px;
  top: 60px;
  right: -160px;
  background: radial-gradient(
    circle,
    rgb(var(--release-purple) / 0.55),
    transparent 65%
  );
}
.aura-grain {
  position: absolute;
  inset: 0;
  background-image:
    radial-gradient(rgba(255, 255, 255, 0.035) 1px, transparent 1px);
  background-size: 3px 3px;
  opacity: 0.55;
  mix-blend-mode: overlay;
}

/* ── Back link ────────────────────────────────────────────────── */
.profile-back {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1.75rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  transition: color 0.15s ease, transform 0.2s cubic-bezier(0.22, 1, 0.36, 1);
}
.profile-back:hover {
  color: rgb(var(--fg-strong));
  transform: translateX(-2px);
}

/* ── Loader + empty state ─────────────────────────────────────── */
.profile-loader {
  display: flex;
  justify-content: center;
  padding: 5rem 0;
}
.loader-spin {
  width: 2rem;
  height: 2rem;
  color: rgb(var(--fg-muted));
  animation: spin 0.9s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.profile-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 5rem 1.5rem;
  background: rgb(var(--bg-surface));
  border: 1px solid rgb(var(--line-strong));
  border-radius: 0.6rem;
  text-align: center;
}
.empty-icon {
  width: 3rem;
  height: 3rem;
  color: rgb(var(--fg-faint));
}
.empty-text {
  margin: 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}

/* ╔═══════════════════════════════════════════════════════════════╗
   ║  HERO                                                          ║
   ╚═══════════════════════════════════════════════════════════════╝ */
.hero {
  position: relative;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 1.6rem;
  margin-bottom: 2.5rem;
  padding: 1.75rem 1.85rem;
  background:
    radial-gradient(
      ellipse 90% 100% at 0% 0%,
      rgba(56, 89, 178, 0.22),
      transparent 60%
    ),
    radial-gradient(
      ellipse 70% 100% at 100% 100%,
      rgb(var(--release-rose) / 0.18),
      transparent 60%
    ),
    rgb(var(--bg-surface));
  border: 1px solid rgb(var(--line-strong));
  border-radius: 0.6rem;
  overflow: hidden;
  box-shadow:
    0 22px 60px -22px rgba(0, 0, 0, 0.7),
    0 4px 14px -8px rgba(0, 0, 0, 0.5),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
  animation: heroRise 0.65s cubic-bezier(0.22, 1, 0.36, 1) both;
}
@keyframes heroRise {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
@media (max-width: 640px) {
  .hero {
    grid-template-columns: 1fr;
    text-align: left;
    padding: 1.4rem;
  }
}

/* ── Monogram avatar ──────────────────────────────────────────── */
.hero-avatar {
  position: relative;
  width: 132px;
  height: 132px;
  border-radius: 0.7rem;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow:
    0 16px 40px -18px rgba(0, 0, 0, 0.7),
    inset 0 0 0 1px rgba(255, 255, 255, 0.12),
    inset 0 -24px 32px -16px rgba(0, 0, 0, 0.35);
  isolation: isolate;
  animation: avatarRise 0.7s 0.05s cubic-bezier(0.22, 1, 0.36, 1) both;
}
@keyframes avatarRise {
  from { opacity: 0; transform: scale(0.94); }
  to   { opacity: 1; transform: scale(1); }
}
.hero-avatar::after {
  /* Faint diagonal sheen — gives the gradient block the impression
     of a glass card lit from upper-left rather than a flat swatch. */
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.18),
    transparent 55%
  );
  pointer-events: none;
}
.hero-avatar-letter {
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 3.4rem;
  font-weight: 900;
  letter-spacing: -0.04em;
  color: rgba(255, 255, 255, 0.95);
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  z-index: 1;
}
.hero-avatar-ring {
  position: absolute;
  inset: -4px;
  border-radius: calc(0.7rem + 4px);
  border: 1px dashed rgb(var(--line-strong));
  pointer-events: none;
  opacity: 0.6;
}
@media (max-width: 640px) {
  .hero-avatar {
    width: 96px;
    height: 96px;
  }
  .hero-avatar-letter { font-size: 2.4rem; }
}

/* ── Hero body ────────────────────────────────────────────────── */
.hero-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.hero-eyebrow {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  flex-wrap: wrap;
  margin-bottom: 0.7rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  animation: heroFadeIn 0.55s 0.05s ease-out both;
}
.hero-eyebrow-mark {
  font-family: 'Fraunces', 'Charter', Georgia, serif;
  font-style: italic;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 0;
  color: rgb(var(--release-cyan));
  line-height: 0;
  transform: translateY(2px);
  filter: drop-shadow(0 0 8px rgb(var(--release-cyan) / 0.4));
}
.hero-eyebrow-label {
  color: rgb(var(--release-cyan));
  font-weight: 800;
}
.hero-eyebrow-sep { opacity: 0.5; }
.hero-eyebrow-since {
  color: rgb(var(--fg-default));
  font-weight: 700;
}
.hero-eyebrow-spacer { flex: 1 1 auto; min-width: 1ch; }

/* Presence chip. Green pulse when the user is currently online,
   neutral otherwise — same animation pattern the reports page uses
   for its "awaiting action" pulse. */
.hero-presence {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.22rem 0.55rem;
  border-radius: 999px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-strong));
  transition: color 0.18s, border-color 0.18s, background 0.18s;
}
.hero-presence .presence-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: rgb(var(--fg-muted));
  flex-shrink: 0;
}
.hero-presence.is-online {
  color: rgb(var(--online));
  background: rgb(var(--online) / 0.1);
  border-color: rgb(var(--online) / 0.4);
}
.hero-presence.is-online .presence-dot {
  background: rgb(var(--online));
  box-shadow: 0 0 0 4px rgb(var(--online) / 0.18);
  animation: presencePulse 2.2s ease-out infinite;
}
@keyframes presencePulse {
  0%   { box-shadow: 0 0 0 0 rgb(var(--online) / 0.45); }
  70%  { box-shadow: 0 0 0 8px rgb(var(--online) / 0); }
  100% { box-shadow: 0 0 0 0 rgb(var(--online) / 0); }
}

.hero-title {
  margin: 0 0 0.35rem;
  font-family: 'Inter', system-ui, sans-serif;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: rgb(var(--fg-strong));
  font-size: clamp(1.6rem, 4vw, 2.4rem);
  line-height: 1.1;
  animation: heroFadeIn 0.55s 0.15s ease-out both;
}

.hero-handle-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.55rem;
  margin-bottom: 0.95rem;
  animation: heroFadeIn 0.55s 0.22s ease-out both;
}
.hero-handle {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
  font-weight: 700;
  color: rgb(var(--release-cyan));
  letter-spacing: 0.04em;
}

.role-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.32rem;
  padding: 0.22rem 0.55rem;
  border-radius: 0.3rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  border: 1px solid;
}
.role-pill-icon { font-size: 11px; }
.role-pill--admin {
  color: rgb(var(--danger));
  background: rgb(var(--danger) / 0.12);
  border-color: rgb(var(--danger) / 0.5);
}
.role-pill--mod {
  color: rgb(var(--release-cyan));
  background: rgb(var(--release-cyan) / 0.12);
  border-color: rgb(var(--release-cyan) / 0.5);
}

/* ── Bio pull-quote ───────────────────────────────────────────── */
.hero-bio {
  position: relative;
  margin: 0.6rem 0 0;
  padding: 1.05rem 1.15rem 1.05rem 2.1rem;
  background:
    linear-gradient(
      135deg,
      rgb(var(--release-rose) / 0.06),
      transparent 60%
    ),
    rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-strong));
  border-left: 3px solid rgb(var(--release-rose));
  border-radius: 0 0.35rem 0.35rem 0;
  font-family: 'Fraunces', 'Charter', Georgia, serif;
  font-style: italic;
  font-size: 14.5px;
  font-weight: 400;
  line-height: 1.55;
  color: rgb(var(--fg-default));
  max-width: 64ch;
  white-space: pre-line;
  word-break: break-word;
  animation: heroFadeIn 0.55s 0.3s ease-out both;
}
.hero-bio-mark {
  position: absolute;
  top: 0.4rem;
  left: 0.7rem;
  font-family: 'Fraunces', 'Charter', Georgia, serif;
  font-size: 2.4rem;
  line-height: 1;
  font-weight: 600;
  color: rgb(var(--release-rose) / 0.32);
  pointer-events: none;
}
.hero-bio-body { display: inline; }

@keyframes heroFadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ╔═══════════════════════════════════════════════════════════════╗
   ║  SECTIONS                                                      ║
   ╚═══════════════════════════════════════════════════════════════╝ */
.section {
  margin-bottom: 2.25rem;
  animation: sectionRise 0.6s cubic-bezier(0.22, 1, 0.36, 1) both;
}
.section:nth-of-type(2) { animation-delay: 0.05s; }
.section:nth-of-type(3) { animation-delay: 0.1s; }
@keyframes sectionRise {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

.section-head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1.1rem;
  padding-bottom: 0.4rem;
}
.section-head-mark {
  font-family: 'Fraunces', 'Charter', Georgia, serif;
  font-style: italic;
  font-weight: 600;
  font-size: 1.85rem;
  line-height: 1;
  color: rgb(var(--release-purple));
  transform: translateY(-2px);
  flex-shrink: 0;
  filter: drop-shadow(0 0 10px rgb(var(--release-purple) / 0.35));
}
.section-head-title {
  margin: 0;
  font-family: 'Fraunces', 'Charter', Georgia, serif;
  font-style: italic;
  font-weight: 500;
  font-size: clamp(1.15rem, 2.2vw, 1.6rem);
  letter-spacing: -0.01em;
  color: rgb(var(--fg-strong));
}
.section-head-count {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.16em;
  color: rgb(var(--fg-muted));
  padding: 0.18rem 0.55rem;
  border: 1px solid rgb(var(--line-strong));
  border-radius: 999px;
  font-variant-numeric: tabular-nums;
}
.section-head-line {
  flex: 1 1 auto;
  height: 1px;
  background: linear-gradient(
    90deg,
    rgb(var(--release-purple) / 0.4),
    transparent 75%
  );
  min-width: 1rem;
}

/* ╔═══════════════════════════════════════════════════════════════╗
   ║  STATS                                                         ║
   ╚═══════════════════════════════════════════════════════════════╝ */
.stats-cluster {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 0.65rem;
}
.stat {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding: 0.85rem 1rem;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.04), transparent 60%),
    linear-gradient(
      rgb(var(--rail, var(--fg-muted)) / 0.16),
      rgb(var(--rail, var(--fg-muted)) / 0.16)
    ),
    rgb(var(--bg-surface));
  border: 1px solid rgb(var(--rail, var(--fg-muted)) / 0.55);
  border-radius: 0.55rem;
  box-shadow:
    0 6px 16px -10px rgba(0, 0, 0, 0.55),
    inset 0 0 0 1px rgba(255, 255, 255, 0.025);
  transition:
    background 0.2s ease,
    border-color 0.2s ease,
    transform 0.25s cubic-bezier(0.22, 1, 0.36, 1);
}
.stat:hover {
  border-color: rgb(var(--rail, var(--fg-muted)) / 0.8);
  transform: translateY(-1px);
}
.stat-icon {
  font-size: 1.1rem;
  color: rgb(var(--rail, var(--fg-muted)));
  flex-shrink: 0;
  filter: drop-shadow(0 0 8px rgb(var(--rail, var(--fg-muted)) / 0.45));
}
.stat-num {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: clamp(1.35rem, 2.4vw, 1.7rem);
  font-weight: 800;
  line-height: 1;
  color: rgb(var(--rail, var(--fg-strong)));
  letter-spacing: -0.025em;
  word-break: break-word;
}
.stat-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  margin-top: 0.2rem;
}
.stat-body {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-width: 0;
}

/* Ratio — colour follows health tier so a glance tells the user
   whether the member is keeping their share up. */
.stat--ratio-healthy { --rail: var(--online); }
.stat--ratio-ok      { --rail: var(--release-cyan); }
.stat--ratio-warn    { --rail: var(--warning); }
.stat--ratio-bad     { --rail: var(--danger); }

.stat--uploaded   { --rail: var(--online); }
.stat--downloaded { --rail: var(--release-rose); }
.stat--releases   { --rail: var(--release-purple); }

.tabular-nums { font-variant-numeric: tabular-nums; }

/* ╔═══════════════════════════════════════════════════════════════╗
   ║  UPLOAD LIST                                                   ║
   ╚═══════════════════════════════════════════════════════════════╝ */
.upload-loader,
.upload-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 3.5rem 1rem;
  background: rgb(var(--bg-elevated));
  border: 1px dashed rgb(var(--line-strong));
  border-radius: 0.5rem;
  text-align: center;
}
.upload-empty-icon {
  width: 2.2rem;
  height: 2.2rem;
  color: rgb(var(--fg-faint));
}
.upload-empty p {
  margin: 0;
  font-family: 'Fraunces', 'Charter', Georgia, serif;
  font-style: italic;
  font-size: 1rem;
  color: rgb(var(--fg-muted));
}

.upload-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.upload-item {
  animation: itemRise 0.55s cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: var(--entry-delay, 0ms);
}
@keyframes itemRise {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
.upload-link {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding: 0.85rem 1rem;
  background:
    linear-gradient(
      rgb(var(--release-purple) / 0.05),
      rgb(var(--release-purple) / 0.05)
    ),
    rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-strong));
  border-radius: 0.4rem;
  text-decoration: none;
  color: rgb(var(--fg-default));
  box-shadow: 0 4px 12px -8px rgba(0, 0, 0, 0.5);
  transition:
    background 0.18s ease,
    border-color 0.18s ease,
    transform 0.22s cubic-bezier(0.22, 1, 0.36, 1);
}
.upload-link:hover {
  background:
    linear-gradient(
      rgb(var(--release-purple) / 0.14),
      rgb(var(--release-purple) / 0.14)
    ),
    rgb(var(--bg-elevated));
  border-color: rgb(var(--release-purple) / 0.55);
  transform: translateX(2px);
}
/* Category glyph on the left of each row — picks up
   `category.icon` when the admin has overridden it, otherwise the
   type-derived default from `getCategoryIcon`. Stays muted at rest
   and warms up to the section accent on hover so it tracks the
   rest of the card. */
.upload-icon {
  flex-shrink: 0;
  font-size: 1.15rem;
  color: rgb(var(--fg-muted));
  transition: color 0.18s ease, transform 0.22s ease;
}
.upload-link:hover .upload-icon {
  color: rgb(var(--release-purple));
}
.upload-info {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.upload-name {
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 14px;
  font-weight: 600;
  color: rgb(var(--fg-strong));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.15s ease;
}
.upload-link:hover .upload-name { color: rgb(var(--release-purple)); }
.upload-meta {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  font-variant-numeric: tabular-nums;
}
.upload-cat {
  color: rgb(var(--fg-default));
  font-weight: 700;
}
.upload-sep { opacity: 0.4; }
.upload-sl {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}
.upload-s {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  color: rgb(var(--online));
  font-weight: 700;
}
.upload-l {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  color: rgb(var(--danger));
  font-weight: 700;
}
.upload-s :deep(svg),
.upload-l :deep(svg) { font-size: 9px; }
.upload-arrow {
  flex-shrink: 0;
  color: rgb(var(--fg-faint));
  font-size: 0.9rem;
  transition: color 0.18s, transform 0.18s;
}
.upload-link:hover .upload-arrow {
  color: rgb(var(--release-purple));
  transform: translateX(2px);
}

/* ── Pager ────────────────────────────────────────────────────── */
.upload-pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  margin-top: 1.5rem;
  padding-top: 1.25rem;
  border-top: 1px dashed rgb(var(--line-strong));
}
.pager-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 0.95rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-strong));
  border-radius: 0.3rem;
  color: rgb(var(--fg-default));
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s, transform 0.15s;
}
.pager-btn:hover:not(:disabled) {
  background: rgb(var(--bg-hover));
  border-color: rgb(var(--fg-default) / 0.35);
  transform: translateY(-1px);
}
.pager-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.pager-pos {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: rgb(var(--fg-muted));
  display: inline-flex;
  align-items: baseline;
  gap: 0.3rem;
}
.pager-cur { color: rgb(var(--fg-strong)); font-size: 15px; }
.pager-sep { opacity: 0.4; }

/* ╔═══════════════════════════════════════════════════════════════╗
   ║  MOBILE LAYOUT                                                 ║
   ║  Treats <=640 px viewports as the primary mobile case. Hero    ║
   ║  centres the avatar and the body underneath; stats collapse to ║
   ║  two columns so the row stays informative without becoming a   ║
   ║  five-row stack; upload rows wrap their meta to a second line. ║
   ╚═══════════════════════════════════════════════════════════════╝ */
@media (max-width: 640px) {
  .profile-page {
    padding: 1.25rem 0.9rem 4rem;
  }

  /* Hero: avatar centred above the body so the monogram lands as
     the visual anchor instead of fighting for horizontal space with
     a narrow text column. */
  .hero {
    grid-template-columns: 1fr;
    justify-items: center;
    text-align: center;
    padding: 1.4rem 1.1rem 1.3rem;
    gap: 1.1rem;
  }
  .hero-avatar {
    width: 104px;
    height: 104px;
  }
  .hero-avatar-letter { font-size: 2.6rem; }

  .hero-body {
    align-items: center;
    width: 100%;
  }
  .hero-eyebrow {
    justify-content: center;
    gap: 0.45rem;
    font-size: 9.5px;
    letter-spacing: 0.2em;
  }
  /* Push the presence chip onto its own line on mobile — the
     `flex: 1 1 auto` spacer can't carve a usable gap on a narrow
     row, so a manual line break reads cleaner. */
  .hero-eyebrow-spacer { display: none; }
  .hero-presence {
    flex-basis: 100%;
    justify-content: center;
  }
  .hero-title { font-size: clamp(1.4rem, 7vw, 1.9rem); }
  .hero-handle-row { justify-content: center; }
  .hero-bio {
    text-align: left;
    width: 100%;
    padding: 1.9rem 1rem 1rem 1.7rem;
    font-size: 13.5px;
  }
  .hero-bio-mark { font-size: 2rem; left: 0.55rem; }

  /* Section heads tighten so they don't dominate the screen. */
  .section { margin-bottom: 1.75rem; }
  .section-head {
    gap: 0.5rem;
    margin-bottom: 0.85rem;
  }
  .section-head-mark { font-size: 1.5rem; }
  .section-head-title { font-size: 1.1rem; }

  /* Stats: two columns. Auto-fit at 160px would already give two
     on most phones, but locking the value forces a clean 2×2 even
     on narrow ones (vs the 2×1×2×1 mess that some 360-px viewports
     produced). */
  .stats-cluster {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem;
  }
  .stat { padding: 0.7rem 0.75rem; gap: 0.55rem; }
  .stat-icon { font-size: 0.95rem; }
  .stat-num { font-size: clamp(1.05rem, 4.5vw, 1.4rem); }
  .stat-label { font-size: 8.5px; letter-spacing: 0.18em; }

  /* Upload rows wrap the meta onto a second line so the name stays
     legible and the meta doesn't get cropped. */
  .upload-link { padding: 0.7rem 0.85rem; gap: 0.55rem; }
  .upload-info { gap: 0.25rem; }
  .upload-name { font-size: 13px; white-space: normal; }
  .upload-meta {
    font-size: 9.5px;
    letter-spacing: 0.08em;
    gap: 0.3rem;
  }
  .upload-arrow { display: none; }
}
</style>
