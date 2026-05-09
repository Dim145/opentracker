<template>
  <div class="me-page">
    <!-- ── Hero ───────────────────────────────────────────────── -->
    <section v-if="profile" class="hero">
      <div class="hero-shell">
        <div class="hero-grid">
          <div class="hero-id">
            <div
              class="hero-avatar"
              :style="avatarStyle"
              :title="profile.id"
            >
              <span>{{ profile.username.slice(0, 2).toUpperCase() }}</span>
            </div>
            <div class="hero-id-body">
              <p class="hero-eyebrow">Personal dossier</p>
              <h1 class="hero-title">
                {{ profile.displayName || profile.username }}
              </h1>
              <p v-if="profile.displayName" class="hero-handle">
                @{{ profile.username }}
              </p>
              <p v-if="profile.bio" class="hero-bio">
                {{ profile.bio }}
              </p>
              <div class="hero-pills">
                <!-- Permission level only — admin / mod / member. The
                     custom role gets its own chip below so a
                     mod-with-Certified shows BOTH (matches the
                     "Team Pending + Early Adopter" pattern in the
                     brief). -->
                <span class="hero-pill" :class="permissionPillClass">
                  <Icon :name="permissionPillIcon" />
                  {{ permissionPillLabel }}
                </span>
                <RoleBadge
                  v-for="r in profile.roles"
                  :key="r.id"
                  :role="r"
                  :title="`Role · ${r.name} · attached ${formatDay(r.assignedAt)}${r.assignedManually ? ' (manual)' : ''}`"
                  class="hero-role-chip"
                />
                <span class="hero-pill hero-pill--soft">
                  <Icon name="ph:hourglass-medium-bold" />
                  Member since {{ memberSince }}
                </span>
                <span
                  v-if="profile.lastIp"
                  class="hero-pill hero-pill--soft hero-pill--mono"
                >
                  <Icon name="ph:globe-bold" />
                  {{ profile.lastIp }}
                </span>
              </div>
            </div>
          </div>

          <div class="hero-actions">
            <NuxtLink to="/torrents/upload" class="hero-btn hero-btn--primary">
              <Icon name="ph:rocket-launch-bold" />
              <span>Publish a release</span>
            </NuxtLink>
          </div>
        </div>

        <!-- KPI strip -->
        <ul class="kpi-strip">
          <li class="kpi kpi--up">
            <span class="kpi-label">
              <Icon name="ph:cloud-arrow-up-bold" />
              Uploaded
            </span>
            <span class="kpi-value">{{ formatSize(profile.uploaded) }}</span>
            <span class="kpi-sub">{{
              profile.uploaded === 0 ? 'No uploads yet' : 'Total bytes shared'
            }}</span>
          </li>
          <li class="kpi kpi--ratio" :class="ratioToneClass">
            <span class="kpi-label">
              <Icon name="ph:scales-bold" />
              Ratio
            </span>
            <span class="kpi-value">{{ formatRatio(profile.ratio) }}</span>
            <span class="kpi-sub">{{ ratioLegend }}</span>
          </li>
          <li class="kpi kpi--down">
            <span class="kpi-label">
              <Icon name="ph:cloud-arrow-down-bold" />
              Downloaded
            </span>
            <span class="kpi-value">{{ formatSize(profile.downloaded) }}</span>
            <span class="kpi-sub">{{
              profile.downloaded === 0 ? 'Nothing yet' : 'Total bytes pulled'
            }}</span>
          </li>
          <li class="kpi kpi--torrents">
            <span class="kpi-label">
              <Icon name="ph:files-bold" />
              Released
            </span>
            <span class="kpi-value">{{ profile.counts.uploads }}</span>
            <span class="kpi-sub">
              {{ profile.counts.activeSeeds }} active seed{{
                profile.counts.activeSeeds === 1 ? '' : 's'
              }}
              · {{ profile.invitesRemaining }} invite{{
                profile.invitesRemaining === 1 ? '' : 's'
              }}
            </span>
          </li>
        </ul>
      </div>
    </section>

    <!-- ── Tracker info card ──────────────────────────────────── -->
    <section v-if="profile" class="tracker-card">
      <header class="section-head">
        <span class="section-number">01</span>
        <h2 class="section-title">Tracker credentials</h2>
        <span class="section-rule" />
      </header>

      <div class="tracker-grid">
        <article class="cred">
          <div class="cred-head">
            <span class="cred-label">Passkey</span>
            <div class="cred-actions">
              <button
                type="button"
                class="cred-btn"
                :title="passkeyVisible ? 'Hide' : 'Reveal'"
                :disabled="passkeyLoading"
                @click="togglePasskey"
              >
                <Icon
                  :name="
                    passkeyLoading
                      ? 'ph:circle-notch'
                      : passkeyVisible
                        ? 'ph:eye-slash-bold'
                        : 'ph:eye-bold'
                  "
                  :class="{ 'animate-spin': passkeyLoading }"
                />
              </button>
              <button
                type="button"
                class="cred-btn"
                :title="copied === 'passkey' ? 'Copied!' : 'Copy'"
                :disabled="!passkey"
                @click="copy('passkey')"
              >
                <Icon
                  :name="
                    copied === 'passkey'
                      ? 'ph:check-bold'
                      : 'ph:copy-simple-bold'
                  "
                />
              </button>
              <button
                type="button"
                class="cred-btn cred-btn--danger"
                title="Regenerate passkey"
                :disabled="passkeyRotating"
                @click="rotatePasskey"
              >
                <Icon
                  :name="
                    passkeyRotating
                      ? 'ph:circle-notch'
                      : 'ph:arrows-clockwise-bold'
                  "
                  :class="{ 'animate-spin': passkeyRotating }"
                />
              </button>
            </div>
          </div>
          <code class="cred-value">{{
            passkeyVisible ? passkey || '…' : passkeyMask
          }}</code>
          <p class="cred-note">
            <Icon name="ph:warning-bold" />
            Never share this. Rotating it will break any torrent client still
            configured with the old announce URL.
          </p>
        </article>

        <article class="cred">
          <div class="cred-head">
            <span class="cred-label">Announce URL</span>
            <div class="cred-actions">
              <button
                type="button"
                class="cred-btn"
                :title="announceVisible ? 'Hide' : 'Reveal'"
                @click="announceVisible = !announceVisible"
              >
                <Icon
                  :name="announceVisible ? 'ph:eye-slash-bold' : 'ph:eye-bold'"
                />
              </button>
              <button
                type="button"
                class="cred-btn"
                :title="copied === 'announce' ? 'Copied!' : 'Copy'"
                :disabled="!passkey"
                @click="copy('announce')"
              >
                <Icon
                  :name="
                    copied === 'announce'
                      ? 'ph:check-bold'
                      : 'ph:copy-simple-bold'
                  "
                />
              </button>
            </div>
          </div>
          <code class="cred-value">{{
            announceVisible ? announceUrl || '…' : announceMask
          }}</code>
          <p class="cred-note cred-note--info">
            <Icon name="ph:info-bold" />
            Use this in your torrent client. Includes your passkey.
          </p>
        </article>
      </div>
    </section>

    <!-- ── Tabs ───────────────────────────────────────────────── -->
    <section v-if="profile" class="tabs-shell">
      <header class="section-head">
        <span class="section-number">02</span>
        <h2 class="section-title">Activity</h2>
        <span class="section-rule" />
      </header>

      <div class="tabs">
        <button
          v-for="t in tabs"
          :key="t.key"
          type="button"
          class="tab"
          :class="{ 'tab--active': activeTab === t.key }"
          @click="activeTab = t.key"
        >
          <Icon :name="t.icon" />
          <span>{{ t.label }}</span>
          <span v-if="t.count !== null" class="tab-count">{{ t.count }}</span>
        </button>
      </div>

      <!-- Mes uploads -->
      <div v-if="activeTab === 'uploads'" class="panel">
        <div v-if="uploadsPending" class="panel-loading">
          <Icon name="ph:circle-notch" class="animate-spin" />
        </div>
        <div
          v-else-if="!uploads || uploads.data.length === 0"
          class="panel-empty"
        >
          <Icon name="ph:upload-simple" class="panel-empty-icon" />
          <p>You haven't published any releases yet.</p>
          <NuxtLink to="/torrents/upload" class="panel-empty-link">
            <Icon name="ph:rocket-launch-bold" />
            Publish your first release
          </NuxtLink>
        </div>
        <ul v-else class="row-list">
          <li
            v-for="t in uploads.data"
            :key="t.infoHash"
            class="row row--upload"
          >
            <div class="row-icon">
              <Icon name="ph:file-archive-bold" />
            </div>
            <div class="row-body">
              <NuxtLink
                :to="`/torrents/${t.infoHash}`"
                class="row-name"
              >
                {{ t.name }}
              </NuxtLink>
              <div class="row-meta">
                <span v-if="t.category" class="row-tag">
                  {{ t.category.name }}
                </span>
                <span class="row-size">{{ formatSize(t.size) }}</span>
                <span class="row-stat row-stat--seed">
                  <Icon name="ph:arrow-up-bold" />
                  {{ t.stats?.seeders ?? 0 }}
                </span>
                <span class="row-stat row-stat--leech">
                  <Icon name="ph:arrow-down-bold" />
                  {{ t.stats?.leechers ?? 0 }}
                </span>
                <span class="row-stat">
                  <Icon name="ph:check-bold" />
                  {{ t.stats?.completed ?? 0 }} DL
                </span>
                <span class="row-age">
                  <!-- ClientOnly because relativeTime() depends on Date.now()
                       which diverges between SSR and hydration. The fallback
                       renders the deterministic absolute date so the slot
                       isn't blank during the first paint. -->
                  <ClientOnly>
                    {{ relativeTime(t.createdAt) }}
                    <template #fallback>{{ formatDay(t.createdAt) }}</template>
                  </ClientOnly>
                </span>
              </div>
            </div>
            <NuxtLink
              :to="`/torrents/${t.infoHash}`"
              class="row-action"
              title="Open"
            >
              <Icon name="ph:arrow-right-bold" />
            </NuxtLink>
          </li>
        </ul>

        <div
          v-if="uploads && uploads.pagination.total > uploadsPageSize"
          class="panel-pager"
        >
          <span class="panel-pager-summary">
            <strong>{{ uploadsRangeStart }}</strong>–
            <strong>{{ uploadsRangeEnd }}</strong> of
            <strong>{{ uploads.pagination.total }}</strong>
          </span>
          <div class="panel-pager-buttons">
            <button
              type="button"
              class="panel-pager-btn"
              :disabled="uploadsPage === 1"
              @click="uploadsPage = Math.max(1, uploadsPage - 1)"
            >
              <Icon name="ph:caret-left-bold" /> Prev
            </button>
            <button
              type="button"
              class="panel-pager-btn"
              :disabled="uploadsRangeEnd >= uploads.pagination.total"
              @click="uploadsPage = uploadsPage + 1"
            >
              Next <Icon name="ph:caret-right-bold" />
            </button>
          </div>
        </div>
      </div>

      <!-- Mes seeds -->
      <div v-else-if="activeTab === 'seeds'" class="panel">
        <div class="panel-subtabs">
          <button
            v-for="s in seedFilters"
            :key="s.key"
            type="button"
            class="subtab"
            :class="{ 'subtab--active': seedStatus === s.key }"
            @click="seedStatus = s.key"
          >
            {{ s.label }}
            <span class="subtab-count">{{
              seedsCounts?.[s.countKey] ?? '·'
            }}</span>
          </button>
        </div>

        <div v-if="seedsPending" class="panel-loading">
          <Icon name="ph:circle-notch" class="animate-spin" />
        </div>
        <div
          v-else-if="!seeds || seeds.items.length === 0"
          class="panel-empty"
        >
          <Icon name="ph:broadcast" class="panel-empty-icon" />
          <p>{{ seedEmptyCopy }}</p>
        </div>
        <ul v-else class="row-list">
          <li
            v-for="s in seeds.items"
            :key="s.id"
            class="row row--seed"
            :class="seedRowClass(s)"
          >
            <div class="row-icon">
              <Icon
                :name="
                  s.isHnr
                    ? 'ph:siren-bold'
                    : s.isExempt
                      ? 'ph:shield-check-bold'
                      : seedActiveNow(s)
                        ? 'ph:broadcast-bold'
                        : 'ph:cloud-arrow-up-bold'
                "
              />
            </div>
            <div class="row-body">
              <NuxtLink
                :to="`/torrents/${s.infoHash}`"
                class="row-name"
              >
                {{ s.name }}
              </NuxtLink>
              <div class="row-meta">
                <span v-if="s.category" class="row-tag">{{
                  s.category.name
                }}</span>
                <span class="row-size">{{ formatSize(s.size) }}</span>
                <span class="row-stat row-stat--seed">
                  <Icon name="ph:users-three-bold" />
                  {{ s.seeders }} / {{ s.leechers }}
                </span>
                <span
                  class="row-progress"
                  :title="`${formatDuration(s.seedTime)} of ${formatDuration(s.requiredSeedTime)} required`"
                >
                  <span class="row-progress-bar">
                    <span
                      class="row-progress-fill"
                      :class="seedProgressTone(s)"
                      :style="{ width: `${seedProgress(s)}%` }"
                    />
                  </span>
                  <span class="row-progress-text">
                    {{ formatDuration(s.seedTime) }}
                    <span class="row-progress-divider">/</span>
                    {{ formatDuration(s.requiredSeedTime) }}
                  </span>
                </span>
                <span class="row-status" :class="seedStatusTone(s)">
                  {{ seedStatusLabel(s) }}
                </span>
              </div>
            </div>
            <NuxtLink
              :to="`/torrents/${s.infoHash}`"
              class="row-action"
              title="Open"
            >
              <Icon name="ph:arrow-right-bold" />
            </NuxtLink>
          </li>
        </ul>

        <div
          v-if="seeds && seeds.total > seedsPageSize"
          class="panel-pager"
        >
          <span class="panel-pager-summary">
            <strong>{{ seedsRangeStart }}</strong>–
            <strong>{{ seedsRangeEnd }}</strong> of
            <strong>{{ seeds.total }}</strong>
          </span>
          <div class="panel-pager-buttons">
            <button
              type="button"
              class="panel-pager-btn"
              :disabled="seedsPage === 1"
              @click="seedsPage = Math.max(1, seedsPage - 1)"
            >
              <Icon name="ph:caret-left-bold" /> Prev
            </button>
            <button
              type="button"
              class="panel-pager-btn"
              :disabled="seedsRangeEnd >= seeds.total"
              @click="seedsPage = seedsPage + 1"
            >
              Next <Icon name="ph:caret-right-bold" />
            </button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { formatSize, formatDay } from '~/utils/format';

definePageMeta({ title: 'My profile' });
useHead({ title: 'My profile' });

const { user: session } = useUserSession();
const notifications = useNotificationStore();
const confirmDialog = useConfirm();
const runtimeConfig = useRuntimeConfig();

interface MeRole {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  priority: number;
  showAsBadge: boolean;
  assignedAt: string;
  assignedManually: boolean;
}
interface MeProfile {
  id: string;
  username: string;
  displayName: string | null;
  bio: string | null;
  isAdmin: boolean;
  isModerator: boolean;
  isBanned: boolean;
  roles: MeRole[];
  uploaded: number;
  downloaded: number;
  ratio: number | null; // null = infinite
  invitesRemaining: number;
  lastIp: string | null;
  showLastSeen: boolean;
  createdAt: string;
  lastSeen: string;
  counts: {
    uploads: number;
    seeds: number;
    activeSeeds: number;
    hnr: number;
  };
}

const { data: profile } = await useFetch<MeProfile>('/api/me', {
  default: () => null as unknown as MeProfile,
});

// ── Passkey reveal (lazy) ──────────────────────────────────────
const passkey = ref<string>('');
const passkeyVisible = ref(false);
const passkeyLoading = ref(false);
const passkeyRotating = ref(false);
const announceVisible = ref(false);
const copied = ref<'' | 'passkey' | 'announce'>('');

const passkeyMask = '••••  ••••  ••••  ••••  ••••  ••••  ••••  ••••  ••••  ••••';

const announceBase = computed(
  () => (runtimeConfig.public.trackerHttpUrl as string) || ''
);
const announceUrl = computed(() =>
  passkey.value ? `${announceBase.value}?passkey=${passkey.value}` : ''
);
const announceMask = computed(
  () => `${announceBase.value}?passkey=••••••••••••••••••••••••••••••••••••••••`
);

async function loadPasskey() {
  if (passkey.value) return;
  passkeyLoading.value = true;
  try {
    const res = await $fetch<{ passkey: string }>('/api/auth/passkey');
    passkey.value = res.passkey;
  } catch (err: any) {
    notifications.error(err?.data?.message || 'Failed to load passkey');
  } finally {
    passkeyLoading.value = false;
  }
}

async function togglePasskey() {
  if (!passkey.value) await loadPasskey();
  passkeyVisible.value = !passkeyVisible.value;
}

/**
 * Rotate the user's passkey. Requires explicit confirmation because the
 * old announce URL stops working immediately — anyone seeding from a
 * torrent client still pointed at the old key starts getting 401s on
 * every announce. After the rotation we reveal the new value so the
 * user can copy it straight into their client.
 */
async function rotatePasskey() {
  const ok = await confirmDialog({
    title: 'Regenerate passkey?',
    message:
      'Your current announce URL will stop working immediately. Any torrent client still pointed at the old passkey will need to be reconfigured with the new one.',
    confirmText: 'Regenerate',
    destructive: true,
  });
  if (!ok) return;

  passkeyRotating.value = true;
  try {
    const res = await $fetch<{ passkey: string }>('/api/auth/passkey', {
      method: 'POST',
      body: { confirm: true },
    });
    passkey.value = res.passkey;
    passkeyVisible.value = true;
    notifications.success(
      'Passkey rotated — copy the new one into your torrent client.'
    );
  } catch (err: any) {
    notifications.error(
      err?.data?.message || 'Failed to regenerate passkey'
    );
  } finally {
    passkeyRotating.value = false;
  }
}

async function copy(kind: 'passkey' | 'announce') {
  if (!passkey.value) await loadPasskey();
  if (!passkey.value) return;
  const text = kind === 'passkey' ? passkey.value : announceUrl.value;
  try {
    await navigator.clipboard.writeText(text);
    copied.value = kind;
    setTimeout(() => {
      if (copied.value === kind) copied.value = '';
    }, 1500);
  } catch {
    notifications.error('Could not copy to clipboard');
  }
}

// ── Hero pills ─────────────────────────────────────────────────
// Use the shared `formatDay` helper which pins the locale to 'en-US' —
// undefined locale picks Node's locale on SSR and the browser's on the
// client, which produced a hydration mismatch warning on this page.
const memberSince = computed(() =>
  profile.value ? formatDay(profile.value.createdAt) : ''
);

// Permission level pill — admin / moderator / member. Decoupled from
// the custom role chip so a moderator with a "Certified" badge shows
// BOTH chips next to each other instead of one swallowing the other.
const permissionPillClass = computed(() => {
  const p = profile.value;
  if (!p) return 'hero-pill--member';
  if (p.isAdmin) return 'hero-pill--admin';
  if (p.isModerator) return 'hero-pill--mod';
  return 'hero-pill--member';
});
const permissionPillIcon = computed(() => {
  const p = profile.value;
  if (!p) return 'ph:user';
  if (p.isAdmin) return 'ph:crown-fill';
  if (p.isModerator) return 'ph:shield-chevron-fill';
  return 'ph:user';
});
const permissionPillLabel = computed(() => {
  const p = profile.value;
  if (!p) return 'Member';
  if (p.isAdmin) return 'Admin';
  if (p.isModerator) return 'Moderator';
  return 'Member';
});

// Avatar — deterministic accent hue from username, or the highest-
// priority role's colour when one is attached. `roles[0]` is already
// the top-priority entry thanks to the API's ORDER BY priority desc.
const avatarStyle = computed(() => {
  const p = profile.value;
  if (!p) return {};
  const top = p.roles?.[0];
  if (top?.color) {
    return {
      background: `${top.color}24`,
      color: top.color,
      borderColor: `${top.color}66`,
    };
  }
  let hash = 0;
  for (let i = 0; i < p.username.length; i++) {
    hash = (hash * 31 + p.username.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return {
    background: `hsl(${hue} 45% 18%)`,
    color: `hsl(${hue} 70% 70%)`,
    borderColor: `hsl(${hue} 50% 32%)`,
  };
});

// ── Ratio styling ──────────────────────────────────────────────
function formatRatio(r: number | null) {
  if (r === null) return '∞';
  if (r === 0) return '0.00';
  return r.toFixed(2);
}
const ratioToneClass = computed(() => {
  const r = profile.value?.ratio;
  if (r === null) return 'kpi--ratio-great';
  if (r === undefined || r === 0) return 'kpi--ratio-zero';
  if (r >= 1) return 'kpi--ratio-great';
  if (r >= 0.5) return 'kpi--ratio-ok';
  return 'kpi--ratio-low';
});
const ratioLegend = computed(() => {
  const r = profile.value?.ratio;
  if (r === null) return 'Pure giver — no downloads';
  if (r === undefined || r === 0) return 'Build up some seed time';
  if (r >= 1) return 'Healthy — keep it up';
  if (r >= 0.5) return 'Below 1.0 — seed more';
  return 'Critical — seeding required';
});

// ── Tabs ───────────────────────────────────────────────────────
const activeTab = ref<'uploads' | 'seeds'>('uploads');
const tabs = computed(() => [
  {
    key: 'uploads' as const,
    label: 'My uploads',
    icon: 'ph:cloud-arrow-up-bold',
    count: profile.value?.counts.uploads ?? null,
  },
  {
    key: 'seeds' as const,
    label: 'My seeds',
    icon: 'ph:broadcast-bold',
    count: profile.value?.counts.activeSeeds ?? null,
  },
]);

// ── Uploads tab ────────────────────────────────────────────────
interface UploadRow {
  infoHash: string;
  name: string;
  size: number;
  createdAt: string;
  category?: { id: string; name: string } | null;
  stats?: { seeders: number; leechers: number; completed: number };
}
interface UploadsResponse {
  data: UploadRow[];
  pagination: { total: number; page: number; limit: number };
}
const uploadsPage = ref(1);
const uploadsPageSize = 10;
const uploadsQuery = computed(() => ({
  page: uploadsPage.value,
  limit: uploadsPageSize,
}));
const userId = computed(() => profile.value?.id ?? '');
const { data: uploads, pending: uploadsPending } =
  await useFetch<UploadsResponse>(
    () =>
      userId.value ? `/api/users/${userId.value}/uploads` : '/api/me',
    {
      query: uploadsQuery,
      watch: [uploadsQuery, userId],
      default: () => null as unknown as UploadsResponse,
    }
  );

// ── Seeds tab ──────────────────────────────────────────────────
interface SeedRow {
  id: string;
  infoHash: string;
  name: string;
  size: number;
  category: { id: string; name: string } | null;
  downloadedAt: string;
  completedAt: string | null;
  seedTime: number;
  requiredSeedTime: number;
  isHnr: boolean;
  isExempt: boolean;
  seeders: number;
  leechers: number;
  completed: number;
}
interface SeedsResponse {
  items: SeedRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: {
    active: number;
    pending: number;
    completed: number;
    hnr: number;
    all: number;
  };
}
const seedStatus = ref<'active' | 'pending' | 'completed' | 'hnr' | 'all'>(
  'active'
);
const seedsPage = ref(1);
const seedsPageSize = 10;
const seedsQuery = computed(() => ({
  page: seedsPage.value,
  pageSize: seedsPageSize,
  status: seedStatus.value,
}));
watch(seedStatus, () => {
  seedsPage.value = 1;
});
const { data: seeds, pending: seedsPending } = await useFetch<SeedsResponse>(
  '/api/me/seeds',
  {
    query: seedsQuery,
    watch: [seedsQuery],
    default: () => null as unknown as SeedsResponse,
  }
);

const seedsCounts = computed(() => seeds.value?.counts ?? null);

const uploadsRangeStart = computed(() =>
  uploads.value && uploads.value.pagination.total > 0
    ? (uploadsPage.value - 1) * uploadsPageSize + 1
    : 0
);
const uploadsRangeEnd = computed(() =>
  uploads.value
    ? Math.min(uploadsPage.value * uploadsPageSize, uploads.value.pagination.total)
    : 0
);
const seedsRangeStart = computed(() =>
  seeds.value && seeds.value.total > 0
    ? (seedsPage.value - 1) * seedsPageSize + 1
    : 0
);
const seedsRangeEnd = computed(() =>
  seeds.value ? Math.min(seedsPage.value * seedsPageSize, seeds.value.total) : 0
);

const seedFilters: Array<{
  key: 'active' | 'pending' | 'completed' | 'hnr' | 'all';
  label: string;
  countKey: 'active' | 'pending' | 'completed' | 'hnr' | 'all';
}> = [
  { key: 'active', label: 'Active', countKey: 'active' },
  { key: 'pending', label: 'Pending', countKey: 'pending' },
  { key: 'completed', label: 'Met', countKey: 'completed' },
  { key: 'hnr', label: 'HnR', countKey: 'hnr' },
  { key: 'all', label: 'All', countKey: 'all' },
];

const seedEmptyCopy = computed(() => {
  switch (seedStatus.value) {
    case 'pending':
      return 'No seeds currently building up time.';
    case 'completed':
      return "You haven't met any seed obligations yet.";
    case 'hnr':
      return 'No hit-and-run violations — well done.';
    case 'all':
      return "You haven't downloaded anything yet.";
    case 'active':
    default:
      return 'No active seeds yet — grab a torrent from the index to get going.';
  }
});

function seedActiveNow(s: SeedRow) {
  return s.seeders > 0 || s.leechers > 0;
}
function seedRowClass(s: SeedRow) {
  if (s.isHnr) return 'row--hnr';
  if (s.isExempt) return 'row--exempt';
  if (seedActiveNow(s)) return 'row--live';
  return '';
}
function seedProgress(s: SeedRow) {
  if (s.requiredSeedTime <= 0) return 100;
  const pct = Math.min(100, Math.round((s.seedTime / s.requiredSeedTime) * 100));
  return Math.max(0, pct);
}
function seedProgressTone(s: SeedRow) {
  if (s.isHnr) return 'tone-danger';
  if (s.completedAt || s.isExempt) return 'tone-great';
  const pct = seedProgress(s);
  if (pct >= 80) return 'tone-great';
  if (pct >= 40) return 'tone-ok';
  return 'tone-low';
}
function seedStatusLabel(s: SeedRow) {
  if (s.isHnr) return 'HnR violation';
  if (s.isExempt) return 'Exempt';
  if (s.completedAt) return 'Met';
  if (s.seedTime > 0) return 'Seeding';
  return 'Pending';
}
function seedStatusTone(s: SeedRow) {
  if (s.isHnr) return 'status-danger';
  if (s.isExempt) return 'status-info';
  if (s.completedAt) return 'status-great';
  if (s.seedTime > 0) return 'status-ok';
  return 'status-pending';
}

// ── Helpers ────────────────────────────────────────────────────
function relativeTime(iso: string) {
  const t = new Date(iso).getTime();
  const delta = Date.now() - t;
  if (delta < 60_000) return 'just now';
  const min = Math.floor(delta / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.floor(day / 365);
  return `${yr}y ago`;
}
function formatDuration(seconds: number) {
  if (seconds <= 0) return '—';
  const day = Math.floor(seconds / 86_400);
  if (day >= 1) return `${day}d`;
  const hr = Math.floor(seconds / 3600);
  if (hr >= 1) return `${hr}h`;
  const min = Math.floor(seconds / 60);
  return `${min}m`;
}
</script>

<style scoped>
.me-page {
  max-width: 1280px;
  margin: 0 auto;
  padding: 0 0.25rem 4rem;
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

/* ─── Hero ──────────────────────────────────────────────────── */
.hero {
  position: relative;
  border-radius: 0.75rem;
  overflow: hidden;
  background:
    radial-gradient(
      ellipse at 12% 0%,
      rgb(var(--accent-primary, var(--fg-strong)) / 0.18),
      transparent 60%
    ),
    radial-gradient(
      ellipse at 90% 100%,
      rgba(108, 209, 97, 0.12),
      transparent 60%
    ),
    rgb(var(--bg-secondary));
  border: 1px solid rgb(var(--line-default));
}
.hero::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image: linear-gradient(
      to right,
      rgb(var(--line-default) / 0.4) 1px,
      transparent 1px
    ),
    linear-gradient(
      to bottom,
      rgb(var(--line-default) / 0.4) 1px,
      transparent 1px
    );
  background-size: 32px 32px;
  mask-image: radial-gradient(ellipse at top left, black 0%, transparent 70%);
  pointer-events: none;
  opacity: 0.5;
}
.hero-shell {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 2rem;
  padding: 2rem 2rem 1.75rem;
}
.hero-grid {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 2rem;
  flex-wrap: wrap;
}
.hero-id {
  display: flex;
  align-items: center;
  gap: 1.25rem;
}
.hero-avatar {
  width: 4.5rem;
  height: 4.5rem;
  border-radius: 0.6rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 1.4rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  border: 1px solid;
  flex-shrink: 0;
}
.hero-id-body {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
}
.hero-eyebrow {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  margin: 0;
}
.hero-title {
  font-size: clamp(1.75rem, 4vw, 2.75rem);
  font-weight: 900;
  letter-spacing: -0.025em;
  text-transform: uppercase;
  margin: 0;
  line-height: 1;
  color: rgb(var(--fg-strong));
  word-break: break-all;
}
.hero-handle {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  letter-spacing: 0.04em;
  color: rgb(var(--fg-muted));
  margin: 0;
}
.hero-bio {
  margin: 0.4rem 0 0;
  max-width: 38rem;
  font-size: 0.85rem;
  line-height: 1.5;
  color: rgb(var(--fg-default));
  white-space: pre-line;
  word-break: break-word;
}
.hero-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.25rem;
}
.hero-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.7rem;
  border-radius: 9999px;
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-elevated));
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgb(var(--fg-default));
}
.hero-pill--mono {
  text-transform: none;
  letter-spacing: 0.04em;
}
.hero-pill--soft {
  color: rgb(var(--fg-muted));
}
.hero-pill--admin {
  border-color: rgba(229, 62, 62, 0.4);
  background: rgba(229, 62, 62, 0.1);
  color: #ff6b6b;
}
.hero-pill--mod {
  border-color: rgba(52, 212, 216, 0.4);
  background: rgba(52, 212, 216, 0.1);
  color: #34d4d8;
}
.hero-pill--custom {
  border-color: rgba(245, 197, 24, 0.4);
  background: rgba(245, 197, 24, 0.1);
  color: #f5c518;
}
.hero-pill--member {
  color: rgb(var(--fg-default));
}

.hero-actions {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  align-items: flex-end;
}
@media (max-width: 720px) {
  .hero-actions {
    align-items: flex-start;
    flex-direction: row;
    flex-wrap: wrap;
  }
}
.hero-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.65rem 1rem;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  border: 1px solid;
  transition: all 0.15s;
}
.hero-btn--primary {
  background: rgb(var(--fg-strong));
  color: rgb(var(--bg-base));
  border-color: rgb(var(--fg-strong));
}
.hero-btn--primary:hover {
  filter: brightness(0.92);
}
.hero-btn--ghost {
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-default));
  border-color: rgb(var(--line-default));
}
.hero-btn--ghost:hover:not(:disabled) {
  border-color: rgb(var(--fg-default) / 0.4);
  color: rgb(var(--fg-strong));
}
.hero-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* KPI strip — sits inside the hero card */
.kpi-strip {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0;
  border-top: 1px solid rgb(var(--line-default));
  border-radius: 0 0 0.6rem 0.6rem;
  margin-left: -2rem;
  margin-right: -2rem;
  margin-bottom: -1.75rem;
  background: rgb(var(--bg-base) / 0.6);
}
@media (max-width: 720px) {
  .kpi-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
.kpi {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 1.2rem 1.4rem;
  border-right: 1px solid rgb(var(--line-default));
  position: relative;
}
.kpi:last-child {
  border-right: 0;
}
@media (max-width: 720px) {
  .kpi {
    border-right: 0;
    border-bottom: 1px solid rgb(var(--line-default));
  }
  .kpi:nth-child(odd) {
    border-right: 1px solid rgb(var(--line-default));
  }
  .kpi:nth-last-child(-n + 2) {
    border-bottom: 0;
  }
}
.kpi-label {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.kpi-value {
  font-size: clamp(1.4rem, 2.8vw, 1.85rem);
  font-weight: 900;
  letter-spacing: -0.02em;
  line-height: 1;
  color: rgb(var(--fg-strong));
  font-variant-numeric: tabular-nums;
}
.kpi-sub {
  font-size: 10.5px;
  color: rgb(var(--fg-muted));
  letter-spacing: 0.04em;
}
.kpi--up .kpi-value {
  color: #6cd161;
}
.kpi--down .kpi-value {
  color: rgb(var(--fg-strong));
}
.kpi--torrents .kpi-value {
  color: #34d4d8;
}
.kpi--ratio-great .kpi-value {
  color: #6cd161;
}
.kpi--ratio-ok .kpi-value {
  color: rgb(var(--fg-strong));
}
.kpi--ratio-low .kpi-value {
  color: #f5c518;
}
.kpi--ratio-zero .kpi-value {
  color: #ff6b6b;
}

/* ─── Sections ────────────────────────────────────────────── */
.section-head {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  margin-bottom: 1rem;
}
.section-number {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: rgb(var(--fg-muted));
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.25rem;
  padding: 0.2rem 0.5rem;
}
.section-title {
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
  margin: 0;
}
.section-rule {
  flex: 1;
  height: 1px;
  background: linear-gradient(
    to right,
    rgb(var(--line-default)),
    rgb(var(--line-default) / 0)
  );
}

/* ─── Tracker card ─────────────────────────────────────────── */
.tracker-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}
@media (max-width: 720px) {
  .tracker-grid {
    grid-template-columns: 1fr;
  }
}
.cred {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 1rem 1.1rem;
  background: rgb(var(--bg-secondary));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.5rem;
}
.cred-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.cred-label {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.cred-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}
.cred-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.85rem;
  height: 1.85rem;
  border-radius: 0.35rem;
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-muted));
  transition: all 0.15s;
}
.cred-btn:hover:not(:disabled) {
  color: rgb(var(--fg-strong));
  border-color: rgb(var(--fg-default) / 0.3);
}
.cred-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.cred-btn--danger:hover:not(:disabled) {
  color: rgb(var(--danger));
  border-color: rgb(var(--danger) / 0.5);
  background: rgb(var(--danger) / 0.08);
}
.cred-value {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.78rem;
  letter-spacing: 0.02em;
  color: #6cd161;
  word-break: break-all;
  user-select: all;
  padding: 0.6rem 0.75rem;
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.35rem;
}
.cred-note {
  margin: 0;
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  color: rgb(var(--fg-muted));
}
.cred-note--info {
  color: #34d4d8;
  opacity: 0.85;
}
.cred-note:not(.cred-note--info) {
  color: #f5c518;
}

/* ─── Tabs ─────────────────────────────────────────────────── */
.tabs-shell {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.tabs {
  display: inline-flex;
  gap: 0.4rem;
  flex-wrap: wrap;
  padding: 0.4rem;
  background: rgb(var(--bg-secondary));
  border: 1px solid rgb(var(--line-default));
  border-radius: 9999px;
  align-self: flex-start;
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.95rem;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  transition: all 0.15s;
  border: 1px solid transparent;
}
.tab:hover:not(.tab--active) {
  color: rgb(var(--fg-strong));
  background: rgb(var(--bg-elevated));
}
.tab--active {
  background: rgb(var(--fg-strong));
  color: rgb(var(--bg-base));
}
.tab-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.4rem;
  height: 1.4rem;
  padding: 0 0.4rem;
  border-radius: 9999px;
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-default));
  font-size: 9.5px;
}
.tab--active .tab-count {
  background: rgb(var(--bg-base));
  color: rgb(var(--fg-strong));
}

/* ─── Panel ────────────────────────────────────────────────── */
.panel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  background: rgb(var(--bg-secondary));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.6rem;
  padding: 1rem 1rem 1.25rem;
  min-height: 12rem;
}
.panel-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 3rem 0;
  color: rgb(var(--fg-muted));
  font-size: 1.5rem;
}
.panel-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.6rem;
  padding: 2.5rem 1rem;
  color: rgb(var(--fg-muted));
}
.panel-empty-icon {
  font-size: 2rem;
  opacity: 0.5;
}
.panel-empty p {
  margin: 0;
  font-size: 0.85rem;
}
.panel-empty-link {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.5rem;
  padding: 0.55rem 0.95rem;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  background: rgb(var(--fg-strong));
  color: rgb(var(--bg-base));
  transition: filter 0.15s;
}
.panel-empty-link:hover {
  filter: brightness(0.92);
}

.panel-subtabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: -0.25rem;
}
.subtab {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.7rem;
  border-radius: 0.3rem;
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-muted));
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  transition: all 0.15s;
}
.subtab:hover {
  color: rgb(var(--fg-strong));
  border-color: rgb(var(--fg-default) / 0.3);
}
.subtab--active {
  background: rgb(var(--bg-base));
  color: rgb(var(--fg-strong));
  border-color: rgb(var(--fg-strong));
}
.subtab-count {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  color: rgb(var(--fg-muted));
}

/* ─── Row list ─────────────────────────────────────────────── */
.row-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 1rem;
  padding: 0.85rem 1rem;
  background: rgb(var(--bg-base) / 0.5);
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.5rem;
  transition: all 0.12s;
}
.row:hover {
  border-color: rgb(var(--fg-default) / 0.25);
  background: rgb(var(--bg-base));
}
.row--live {
  border-left: 3px solid #6cd161;
}
.row--hnr {
  border-left: 3px solid rgb(var(--danger));
  background: rgba(229, 62, 62, 0.04);
}
.row--exempt {
  border-left: 3px solid #34d4d8;
}
.row-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 0.4rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  color: rgb(var(--fg-muted));
  font-size: 1.05rem;
  flex-shrink: 0;
}
.row--live .row-icon {
  color: #6cd161;
  border-color: rgba(108, 209, 97, 0.4);
  background: rgba(108, 209, 97, 0.08);
}
.row--hnr .row-icon {
  color: #ff6b6b;
  border-color: rgba(229, 62, 62, 0.4);
  background: rgba(229, 62, 62, 0.08);
}
.row--exempt .row-icon {
  color: #34d4d8;
  border-color: rgba(52, 212, 216, 0.4);
  background: rgba(52, 212, 216, 0.08);
}
.row-body {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
}
.row-name {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.82rem;
  font-weight: 700;
  color: rgb(var(--fg-strong));
  text-decoration: none;
  word-break: break-all;
  line-height: 1.3;
}
.row-name:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}
.row-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.55rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  color: rgb(var(--fg-muted));
}
.row-tag {
  padding: 0.1rem 0.4rem;
  border-radius: 0.25rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  color: rgb(var(--fg-default));
  letter-spacing: 0.04em;
  font-size: 10px;
  text-transform: uppercase;
  font-weight: 700;
}
.row-size {
  color: rgb(var(--fg-default));
  font-weight: 700;
}
.row-stat {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
}
.row-stat--seed {
  color: #6cd161;
}
.row-stat--leech {
  color: #ff6b6b;
}
.row-age {
  margin-left: auto;
  font-size: 10.5px;
}
.row-progress {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  flex: 1 1 auto;
  min-width: 8rem;
  max-width: 16rem;
}
.row-progress-bar {
  position: relative;
  flex: 1;
  height: 0.4rem;
  border-radius: 9999px;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  overflow: hidden;
}
.row-progress-fill {
  display: block;
  height: 100%;
  border-radius: 9999px;
  transition: width 0.3s ease;
}
.row-progress-fill.tone-great {
  background: #6cd161;
}
.row-progress-fill.tone-ok {
  background: #f5c518;
}
.row-progress-fill.tone-low {
  background: rgb(var(--fg-muted));
}
.row-progress-fill.tone-danger {
  background: rgb(var(--danger));
}
.row-progress-text {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: rgb(var(--fg-muted));
  white-space: nowrap;
}
.row-progress-divider {
  margin: 0 0.2rem;
  opacity: 0.5;
}
.row-status {
  display: inline-flex;
  align-items: center;
  padding: 0.15rem 0.5rem;
  border-radius: 9999px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-elevated));
}
.row-status.status-great {
  border-color: rgba(108, 209, 97, 0.4);
  background: rgba(108, 209, 97, 0.08);
  color: #6cd161;
}
.row-status.status-ok {
  border-color: rgba(245, 197, 24, 0.4);
  background: rgba(245, 197, 24, 0.08);
  color: #f5c518;
}
.row-status.status-pending {
  color: rgb(var(--fg-muted));
}
.row-status.status-info {
  border-color: rgba(52, 212, 216, 0.4);
  background: rgba(52, 212, 216, 0.08);
  color: #34d4d8;
}
.row-status.status-danger {
  border-color: rgba(229, 62, 62, 0.4);
  background: rgba(229, 62, 62, 0.08);
  color: #ff6b6b;
}

.row-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 9999px;
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-muted));
  transition: all 0.15s;
}
.row-action:hover {
  color: rgb(var(--fg-strong));
  border-color: rgb(var(--fg-default) / 0.3);
}

/* ─── Panel pager ──────────────────────────────────────────── */
.panel-pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.75rem;
  padding-top: 0.75rem;
  margin-top: 0.25rem;
  border-top: 1px solid rgb(var(--line-default));
}
.panel-pager-summary {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  letter-spacing: 0.04em;
  color: rgb(var(--fg-muted));
}
.panel-pager-summary strong {
  color: rgb(var(--fg-strong));
  font-weight: 700;
}
.panel-pager-buttons {
  display: inline-flex;
  gap: 0.4rem;
}
.panel-pager-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.4rem 0.8rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 9999px;
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-default));
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  transition: all 0.15s;
}
.panel-pager-btn:hover:not(:disabled) {
  color: rgb(var(--fg-strong));
  border-color: rgb(var(--fg-default) / 0.3);
}
.panel-pager-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
