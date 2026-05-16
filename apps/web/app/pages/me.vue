<template>
  <div class="me-page">
    <!-- ── Atmospheric background ──────────────────────────────────
         Same vocabulary as /torrents/:hash and /users/:id — two
         soft blobs (accent + violet) plus a grain overlay. Lets
         /me read as part of the same editorial product instead of
         a flat utility page. -->
    <div class="me-aura" aria-hidden="true">
      <span class="aura-blob aura-blob--a" />
      <span class="aura-blob aura-blob--b" />
      <span class="aura-grain" />
    </div>

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
              <p class="hero-eyebrow">
                <span class="hero-eyebrow-mark" aria-hidden="true">§</span>
                <span>{{ $t('me.title') }}</span>
              </p>
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
                  :title="$t('me.roleBadgeTitle', { name: r.name, date: formatDay(r.assignedAt) }) + (r.assignedManually ? ` ${$t('me.roleBadgeManualSuffix')}` : '')"
                  class="hero-role-chip"
                />
                <span class="hero-pill hero-pill--soft">
                  <Icon name="ph:hourglass-medium-bold" />
                  {{ $t('me.memberSince', { date: memberSince }) }}
                </span>
                <!-- Invites pill — moved here from the old "Released" KPI
                     sub-line so we don't lose the at-a-glance invite count
                     when that tile got dropped (the count was redundant
                     with the Seeds-tab badge but the invites figure had
                     nowhere else to live). -->
                <span
                  v-if="profile.invitesRemaining > 0"
                  class="hero-pill hero-pill--soft"
                >
                  <Icon name="ph:envelope-simple-bold" />
                  {{ $t('me.stats.invitesPill', profile.invitesRemaining, { n: profile.invitesRemaining }) }}
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
              <span>{{ $t('me.publish') }}</span>
            </NuxtLink>
          </div>
        </div>

        <!-- KPI strip -->
        <ul class="kpi-strip">
          <li class="kpi kpi--up">
            <span class="kpi-label">
              <Icon name="ph:cloud-arrow-up-bold" />
              {{ $t('me.stats.uploaded') }}
            </span>
            <span class="kpi-value">{{ formatSize(profile.uploaded) }}</span>
            <!--
              Sub-line resolution order:
                1. nothing uploaded yet → onboarding nudge
                2. some bonus credit applied → split breakdown so the
                   user can tell ratio relief from real contribution
                3. otherwise → generic "total bytes shared" caption
              The bonus split sits on its own line with a tinted
              accent + coin glyph so it reads as derived data, not as
              another KPI value.
            -->
            <template v-if="profile.uploaded === 0">
              <span class="kpi-sub">{{ $t('me.stats.noUploadsYet') }}</span>
            </template>
            <template v-else-if="profile.bonusUploaded > 0">
              <span class="kpi-sub">{{ $t('me.stats.totalShared') }}</span>
              <span class="kpi-sub kpi-sub--bonus">
                <Icon name="ph:coin-fill" class="kpi-sub-icon" />
                {{ $t('me.stats.bonusBreakdown', { bonus: formatSize(profile.bonusUploaded) }) }}
              </span>
            </template>
            <template v-else>
              <span class="kpi-sub">{{ $t('me.stats.totalShared') }}</span>
            </template>
          </li>
          <li class="kpi kpi--ratio" :class="ratioToneClass">
            <span class="kpi-label">
              <Icon name="ph:scales-bold" />
              {{ $t('me.stats.ratio') }}
            </span>
            <span class="kpi-value">{{ formatRatio(profile.ratio) }}</span>
            <span class="kpi-sub">{{ ratioLegend }}</span>
          </li>
          <li class="kpi kpi--down">
            <span class="kpi-label">
              <Icon name="ph:cloud-arrow-down-bold" />
              {{ $t('me.stats.downloaded') }}
            </span>
            <span class="kpi-value">{{ formatSize(profile.downloaded) }}</span>
            <span class="kpi-sub">{{
              profile.downloaded === 0 ? $t('me.stats.nothingYet') : $t('me.stats.totalPulled')
            }}</span>
          </li>
          <!--
            Bonus points KPI. Replaces the old "Released" tile, whose
            value (uploads count) was already shown by the Uploads-tab
            badge below and whose sub-line (active seeds) duplicated the
            Seeds-tab badge — pure redundancy.
            Living in the strip rather than in a dedicated card pulls the
            balance back into a normal stat among peers: same row, same
            label cadence, no decorative gold accents pulling the eye.
            The deep link to /shop replaces the old standalone CTA.
          -->
          <li class="kpi kpi--bonus">
            <span class="kpi-label">
              <Icon name="ph:coin-bold" />
              {{ $t('me.stats.bonus') }}
            </span>
            <span class="kpi-value kpi-value--bonus tabular-nums">
              {{ animatedBalance }}
              <span class="kpi-value-unit">{{ $t('shop.points') }}</span>
            </span>
            <NuxtLink to="/shop" class="kpi-sub kpi-sub--link">
              {{ $t('me.bonus.spendShort') }}
              <Icon name="ph:arrow-right-bold" />
            </NuxtLink>
          </li>
        </ul>
      </div>
    </section>

    <!-- ── Bonus history (collapsed by default) ─────────────────── -->
    <!--
      The balance now lives in the hero KPI strip (kpi--bonus), so this
      section reduces to *just* the ledger access. A single toggle row
      expands the credit/debit history on demand — same lazy fetch
      behaviour as before, no eager round-trip on page load.

      Why keep it as its own section? The ledger is a long, dense
      element when open; folding it under the Activity tabs would
      compete with Uploads/Seeds for vertical real estate. As its own
      section above Credentials it stays one click away without
      shoving the rest of the page down.
    -->
    <section v-if="profile" class="bonus-vault section--bonus">
      <header class="section-head">
        <span class="section-number" aria-hidden="true">§</span>
        <h2 class="section-title">{{ $t('me.bonus.historyTitle') }}</h2>
        <span class="section-rule" />
      </header>

      <button
        type="button"
        class="bonus-history-toggle"
        :class="{ 'bonus-history-toggle--open': historyOpen }"
        :aria-expanded="historyOpen"
        aria-controls="bonus-history-panel"
        @click="toggleHistory"
      >
        <Icon name="ph:scroll-bold" class="bv-trigger-icon" aria-hidden="true" />
        <span class="bv-trigger-label">
          {{ historyOpen ? $t('me.bonus.collapseHint') : $t('me.bonus.expandHint') }}
        </span>
        <span class="bv-trigger-caption">{{ $t('me.bonus.caption') }}</span>
        <Icon
          name="ph:caret-down-bold"
          class="bonus-chevron"
          :class="{ 'bonus-chevron--open': historyOpen }"
          aria-hidden="true"
        />
      </button>

      <!--
        Transaction ledger — one row per credit (`bonus_grants`) or
        debit (`shop_purchases`), merged server-side and sorted desc.
        Lazy: the network round-trip only fires on first expansion, so
        users who never click never pay for it. Stays mounted after
        the first open, so re-toggling is instant.
      -->
      <Transition name="bv-panel">
        <section
          v-if="historyOpen"
          id="bonus-history-panel"
          class="bonus-history"
          :aria-busy="bonusHistoryPending"
        >
          <header class="bv-head">
            <span class="bv-head-num" aria-hidden="true">§</span>
            <span class="bv-head-rule" aria-hidden="true" />
            <h3 class="bv-head-title">{{ $t('me.bonus.history.title') }}</h3>
          </header>

          <div v-if="bonusHistoryPending && bonusHistory.length === 0" class="bv-loading">
            <Icon name="ph:circle-notch" class="bv-loading-spin" />
            <span>{{ $t('me.bonus.history.loading') }}</span>
          </div>

          <div v-else-if="bonusHistoryError" class="bv-error">
            <Icon name="ph:warning-bold" />
            <span>{{ $t('me.bonus.history.loadFailed') }}</span>
          </div>

          <p v-else-if="bonusHistory.length === 0" class="bv-empty">
            <Icon name="ph:scroll" />
            <span>{{ $t('me.bonus.history.empty') }}</span>
          </p>

          <ol v-else class="bv-list">
            <li
              v-for="(entry, i) in bonusHistory"
              :key="entry.id"
              class="bv-row"
              :class="`bv-row--${entry.type}`"
              :style="{ '--row-i': i }"
            >
              <time class="bv-time" :datetime="entry.createdAt">
                {{ formatHistoryTime(entry.createdAt) }}
              </time>

              <span class="bv-tag" :class="`bv-tag--${entry.type}`">
                <Icon
                  :name="entry.type === 'gain' ? 'ph:arrow-up-bold' : 'ph:arrow-down-bold'"
                />
                {{ entry.type === 'gain'
                    ? $t('me.bonus.history.gain')
                    : $t('me.bonus.history.spend') }}
              </span>

              <span class="bv-source">{{ sourceLabel(entry) }}</span>

              <span class="bv-amount" :class="`bv-amount--${entry.type}`">
                <span class="bv-amount-sign">{{ entry.type === 'gain' ? '+' : '−' }}</span>
                <span class="bv-amount-num tabular-nums">{{ formatPoints(entry.amount) }}</span>
                <span class="bv-amount-unit">{{ $t('shop.points') }}</span>
              </span>

              <span v-if="entry.message" class="bv-msg" :title="entry.message">
                {{ entry.message }}
              </span>
            </li>
          </ol>

          <button
            v-if="bonusHistoryHasMore"
            type="button"
            class="bv-more"
            :disabled="bonusHistoryPending"
            @click="loadMoreHistory"
          >
            <Icon
              :name="bonusHistoryPending ? 'ph:circle-notch' : 'ph:caret-double-down-bold'"
              :class="bonusHistoryPending ? 'bv-loading-spin' : ''"
            />
            <span>{{ $t('me.bonus.history.loadMore') }}</span>
          </button>
        </section>
      </Transition>
    </section>

    <!-- ── Tracker info card ──────────────────────────────────── -->
    <section v-if="profile" class="tracker-card section--credentials">
      <header class="section-head">
        <span class="section-number" aria-hidden="true">§</span>
        <h2 class="section-title">{{ $t('me.credentials.title') }}</h2>
        <span class="section-rule" />
      </header>

      <div class="tracker-grid">
        <article class="cred">
          <div class="cred-head">
            <span class="cred-label">{{ $t('me.credentials.passkey') }}</span>
            <div class="cred-actions">
              <button
                type="button"
                class="cred-btn"
                :title="passkeyVisible ? $t('me.credentials.hide') : $t('me.credentials.show')"
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
                :title="copied === 'passkey' ? $t('common.copied') : $t('common.copy')"
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
                :title="$t('me.credentials.rotate')"
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
            {{ $t('me.credentials.warning') }}
          </p>
        </article>

        <article class="cred">
          <div class="cred-head">
            <span class="cred-label">{{ $t('me.credentials.announceUrl') }}</span>
            <div class="cred-actions">
              <button
                type="button"
                class="cred-btn"
                :title="announceVisible ? $t('me.credentials.hide') : $t('me.credentials.show')"
                @click="announceVisible = !announceVisible"
              >
                <Icon
                  :name="announceVisible ? 'ph:eye-slash-bold' : 'ph:eye-bold'"
                />
              </button>
              <button
                type="button"
                class="cred-btn"
                :title="copied === 'announce' ? $t('common.copied') : $t('common.copy')"
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
            {{ $t('me.credentials.useInClient') }}
          </p>
        </article>
      </div>
    </section>

    <!-- ── Tabs ───────────────────────────────────────────────── -->
    <section v-if="profile" class="tabs-shell section--activity">
      <header class="section-head">
        <span class="section-number" aria-hidden="true">§</span>
        <h2 class="section-title">{{ $t('me.activity.title') }}</h2>
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
          <p>{{ $t('me.activity.noUploads') }}</p>
          <NuxtLink to="/torrents/upload" class="panel-empty-link">
            <Icon name="ph:rocket-launch-bold" />
            {{ $t('me.activity.publishFirst') }}
          </NuxtLink>
        </div>
        <ul v-else class="row-list">
          <li
            v-for="t in uploads.data"
            :key="t.infoHash"
            class="row row--upload"
          >
            <div class="row-icon">
              <Icon :name="getCategoryIcon(t.category)" />
            </div>
            <div class="row-body">
              <div class="row-name-line">
                <NuxtLink
                  :to="`/torrents/${t.infoHash}`"
                  class="row-name"
                >
                  {{ t.name }}
                </NuxtLink>
                <!-- Surface the moderation state inline so the user
                     sees at a glance which uploads are still in
                     review, in changes-requested, or rejected. -->
                <TorrentModerationBadge
                  :status="t.moderationStatus"
                  size="sm"
                />
              </div>
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
                  {{ $t('me.activity.downloadsCount', { n: t.stats?.completed ?? 0 }) }}
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
              :title="$t('common.open')"
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
            <strong>{{ uploadsRangeEnd }}</strong> {{ $t('me.activity.pagerOf') }}
            <strong>{{ uploads.pagination.total }}</strong>
          </span>
          <div class="panel-pager-buttons">
            <button
              type="button"
              class="panel-pager-btn"
              :disabled="uploadsPage === 1"
              @click="uploadsPage = Math.max(1, uploadsPage - 1)"
            >
              <Icon name="ph:caret-left-bold" /> {{ $t('common.previous') }}
            </button>
            <button
              type="button"
              class="panel-pager-btn"
              :disabled="uploadsRangeEnd >= uploads.pagination.total"
              @click="uploadsPage = uploadsPage + 1"
            >
              {{ $t('common.next') }} <Icon name="ph:caret-right-bold" />
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
                  :title="$t('me.activity.seedProgressTitle', { done: formatDuration(s.seedTime), required: formatDuration(s.requiredSeedTime) })"
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
              :title="$t('common.open')"
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
            <strong>{{ seedsRangeEnd }}</strong> {{ $t('me.activity.pagerOf') }}
            <strong>{{ seeds.total }}</strong>
          </span>
          <div class="panel-pager-buttons">
            <button
              type="button"
              class="panel-pager-btn"
              :disabled="seedsPage === 1"
              @click="seedsPage = Math.max(1, seedsPage - 1)"
            >
              <Icon name="ph:caret-left-bold" /> {{ $t('common.previous') }}
            </button>
            <button
              type="button"
              class="panel-pager-btn"
              :disabled="seedsRangeEnd >= seeds.total"
              @click="seedsPage = seedsPage + 1"
            >
              {{ $t('common.next') }} <Icon name="ph:caret-right-bold" />
            </button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { formatSize, formatDay } from '~/utils/format';
import { getCategoryIcon } from '~/utils/categoryIcon';
import TorrentModerationBadge from '~/components/torrent/TorrentModerationBadge.vue';

definePageMeta({ title: 'My profile' });

const { t } = useI18n();
useHead({ title: () => t('me.headTitle') });
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
  /** Subset of `uploaded` whose bytes came from a shop purchase
   * (`upload_credit`) rather than from real seeding. `> 0` swaps the
   * Uploaded KPI sub-line for a "(of which X bonus)" breakdown. */
  bonusUploaded: number;
  downloaded: number;
  ratio: number | null; // null = infinite
  invitesRemaining: number;
  bonusPoints: number;
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

// ── Animated balance counter ────────────────────────────────────
//
// Counts up from 0 to `profile.bonusPoints` on mount with rAF +
// ease-out, then snaps to whatever the live value becomes after
// hydration. Renders the number formatted with the user's locale,
// tabular-nums, so the column width doesn't jitter as digits change.
const animatedBalance = ref('0');
let counterRaf: number | null = null;

function formatPoints(n: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(
    Math.max(0, Math.round(n)),
  );
}

function runCounter(target: number) {
  if (typeof window === 'undefined') {
    // SSR: paint the final value so there's no FOUC, the client
    // animation re-runs on mount anyway.
    animatedBalance.value = formatPoints(target);
    return;
  }
  if (counterRaf !== null) cancelAnimationFrame(counterRaf);
  // Cap the animation at 900 ms so very large balances still resolve
  // quickly. Short animations feel snappier than a 2 s drift on a
  // page load.
  const duration = Math.min(900, Math.max(400, 250 + target / 8));
  const start = performance.now();
  // ease-out cubic — fast at the start, gentle landing.
  const ease = (t: number) => 1 - Math.pow(1 - t, 3);

  const tick = (now: number) => {
    const elapsed = now - start;
    const t = Math.min(1, elapsed / duration);
    animatedBalance.value = formatPoints(target * ease(t));
    if (t < 1) {
      counterRaf = requestAnimationFrame(tick);
    } else {
      counterRaf = null;
    }
  };
  counterRaf = requestAnimationFrame(tick);
}

// Re-trigger the animation whenever the underlying value changes (e.g.
// after a session refresh that landed a daily-login credit).
watch(
  () => profile.value?.bonusPoints,
  (next) => {
    if (typeof next !== 'number') return;
    runCounter(next);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (counterRaf !== null) cancelAnimationFrame(counterRaf);
});

// ── Bonus transaction history (lazy) ───────────────────────────
//
// The bonus reserve bar acts as the toggle: clicking it opens an
// expandable ledger of every credit (`bonus_grants`) and debit
// (`shop_purchases`) that touched the running balance. We don't
// fetch until the panel actually opens so a user who never clicks
// never pays the round-trip; once loaded the entries stay in
// memory for instant re-toggles, and `loadMoreHistory` paginates
// older rows on demand via the createdAt cursor.
interface BonusEntry {
  id: string;
  type: 'gain' | 'spend';
  amount: number;
  source: string;
  message: string | null;
  torrentCount: number | null;
  createdAt: string;
}

const historyOpen = ref(false);
const bonusHistory = ref<BonusEntry[]>([]);
const bonusHistoryPending = ref(false);
const bonusHistoryError = ref(false);
const bonusHistoryHasMore = ref(false);
const bonusHistoryCursor = ref<string | null>(null);
let bonusHistoryLoaded = false;

async function loadHistory(cursor: string | null) {
  bonusHistoryPending.value = true;
  bonusHistoryError.value = false;
  try {
    const res = await $fetch<{
      items: BonusEntry[];
      hasMore: boolean;
      nextCursor: string | null;
    }>('/api/me/bonus-history', {
      query: cursor ? { cursor, limit: 50 } : { limit: 50 },
    });
    if (cursor) {
      // Append on "load more". We trust the server's cursor-based
      // pagination — no need to dedupe locally.
      bonusHistory.value = [...bonusHistory.value, ...res.items];
    } else {
      bonusHistory.value = res.items;
    }
    bonusHistoryHasMore.value = res.hasMore;
    bonusHistoryCursor.value = res.nextCursor;
    bonusHistoryLoaded = true;
  } catch {
    bonusHistoryError.value = true;
  } finally {
    bonusHistoryPending.value = false;
  }
}

function toggleHistory() {
  historyOpen.value = !historyOpen.value;
  // First open triggers the fetch; subsequent toggles are
  // memo-cheap. Refetching every open would feel snappy but we'd
  // hit the DB twice on a typical "expand → glance → collapse"
  // pattern, which is the most common interaction.
  if (historyOpen.value && !bonusHistoryLoaded) {
    loadHistory(null);
  }
}

function loadMoreHistory() {
  if (!bonusHistoryCursor.value || bonusHistoryPending.value) return;
  loadHistory(bonusHistoryCursor.value);
}

function sourceLabel(entry: BonusEntry): string {
  // Whitelist the keys we have explicit translations for; anything
  // else falls back to a generic "Adjustment" label so a future
  // bonus-rule kind never renders as a raw snake_case string.
  const known = new Set([
    'seeding',
    'first_seeder',
    'milestone',
    'account_age_monthly',
    'daily_login',
    'admin_adjust',
    'shop_purchase',
  ]);
  // Seeding rows roll up every torrent the user was seeding into a
  // single per-tick line. Suffix the count so the operator sees
  // "seed cadence for 17 torrents" instead of 17 identical rows.
  if (entry.source === 'seeding' && entry.torrentCount && entry.torrentCount > 1) {
    return t('me.bonus.history.source.seedingMany', {
      n: entry.torrentCount,
    });
  }
  const key = known.has(entry.source)
    ? `me.bonus.history.source.${entry.source}`
    : 'me.bonus.history.source.unknown';
  return t(key);
}

// Compact, locale-aware date for ledger rows. Two formats:
//  - Same day  → "14:32"   (just the time)
//  - Otherwise → "10 May 14:32"
// Long enough to disambiguate the entry, short enough to stay in a
// 6-column grid without wrapping.
function formatHistoryTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
  if (sameDay) return time;
  const date = d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
  return `${date} ${time}`;
}

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
    notifications.error(err?.data?.message || t('me.credentials.loadFailed'));
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
    title: t('me.credentials.rotateConfirmTitle'),
    message: t('me.credentials.rotateConfirmMessage'),
    confirmText: t('me.credentials.rotateConfirmAction'),
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
    notifications.success(t('me.credentials.rotateSuccess'));
  } catch (err: any) {
    notifications.error(
      err?.data?.message || t('me.credentials.rotateFailed')
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
    notifications.error(t('me.credentials.copyFailed'));
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
  if (!p) return t('me.permission.member');
  if (p.isAdmin) return t('me.permission.admin');
  if (p.isModerator) return t('me.permission.moderator');
  return t('me.permission.member');
});

// Avatar — deterministic accent hue from username, or the highest-
// priority role's colour when one is attached. `roles[0]` is already
// the top-priority entry thanks to the API's ORDER BY priority desc.
// Stable gradient palette — matches /users/:id so the same monogram
// renders the same way regardless of which surface you see it on.
// Falls back to the top role's colour when one is attached so an
// admin/mod's brand colour overrides the hash.
const meAvatarGradients: Array<[string, string]> = [
  ['#a78bfa', '#f472b6'], // purple → rose
  ['#38bdf8', '#2dd4bf'], // cyan → teal
  ['#f472b6', '#eab308'], // rose → amber
  ['#a78bfa', '#38bdf8'], // purple → cyan
  ['#2dd4bf', '#22c55e'], // teal → green
  ['#22c55e', '#eab308'], // green → amber
  ['#818cf8', '#a78bfa'], // indigo → purple
];

const avatarStyle = computed(() => {
  const p = profile.value;
  if (!p) return {};
  const top = p.roles?.[0];
  if (top?.color) {
    return {
      background: `linear-gradient(135deg, ${top.color}, ${top.color}cc)`,
    };
  }
  let hash = 0;
  for (let i = 0; i < p.username.length; i++) {
    hash = ((hash << 5) - hash + p.username.charCodeAt(i)) | 0;
  }
  const [from, to] = meAvatarGradients[
    Math.abs(hash) % meAvatarGradients.length
  ]!;
  return {
    background: `linear-gradient(135deg, ${from} 0%, ${to} 100%)`,
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
  if (r === null) return t('me.ratioLegend.pureGiver');
  if (r === undefined || r === 0) return t('me.stats.buildSeedTime');
  if (r >= 1) return t('me.ratioLegend.healthy');
  if (r >= 0.5) return t('me.ratioLegend.belowOne');
  return t('me.ratioLegend.critical');
});

// ── Tabs ───────────────────────────────────────────────────────
const activeTab = ref<'uploads' | 'seeds'>('uploads');
const tabs = computed(() => [
  {
    key: 'uploads' as const,
    label: t('me.activity.myUploads'),
    icon: 'ph:cloud-arrow-up-bold',
    count: profile.value?.counts.uploads ?? null,
  },
  {
    key: 'seeds' as const,
    label: t('me.activity.mySeeds'),
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
  category?: {
    id: string;
    name: string;
    icon?: string | null;
    type?: string | null;
  } | null;
  stats?: { seeders: number; leechers: number; completed: number };
  // Pipeline state of the torrent for the current viewer (the user
  // browsing /me sees their own rows so the status mirrors what /me
  // should show in the badge column).
  moderationStatus?: 'pending' | 'accepted' | 'changes_requested' | 'rejected';
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

const seedFilters = computed<Array<{
  key: 'active' | 'pending' | 'completed' | 'hnr' | 'all';
  label: string;
  countKey: 'active' | 'pending' | 'completed' | 'hnr' | 'all';
}>>(() => [
  { key: 'active', label: t('me.activity.seedFilters.active'), countKey: 'active' },
  { key: 'pending', label: t('me.activity.seedFilters.pending'), countKey: 'pending' },
  { key: 'completed', label: t('me.activity.seedFilters.met'), countKey: 'completed' },
  { key: 'hnr', label: t('me.activity.seedFilters.hnr'), countKey: 'hnr' },
  { key: 'all', label: t('me.activity.seedFilters.all'), countKey: 'all' },
]);

const seedEmptyCopy = computed(() => {
  switch (seedStatus.value) {
    case 'pending':
      return t('me.activity.seedEmpty.pending');
    case 'completed':
      return t('me.activity.seedEmpty.completed');
    case 'hnr':
      return t('me.activity.seedEmpty.hnr');
    case 'all':
      return t('me.activity.seedEmpty.all');
    case 'active':
    default:
      return t('me.activity.seedEmpty.active');
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
  if (s.isHnr) return t('me.activity.seedStatus.hnrViolation');
  if (s.isExempt) return t('me.activity.seedStatus.exempt');
  if (s.completedAt) return t('me.activity.seedStatus.met');
  if (s.seedTime > 0) return t('me.activity.seedStatus.seeding');
  return t('me.activity.seedStatus.pending');
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
  const ts = new Date(iso).getTime();
  const delta = Date.now() - ts;
  if (delta < 60_000) return t('me.relativeTime.justNow');
  const min = Math.floor(delta / 60_000);
  if (min < 60) return t('me.relativeTime.minutesAgo', { n: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t('me.relativeTime.hoursAgo', { n: hr });
  const day = Math.floor(hr / 24);
  if (day < 30) return t('me.relativeTime.daysAgo', { n: day });
  const mo = Math.floor(day / 30);
  if (mo < 12) return t('me.relativeTime.monthsAgo', { n: mo });
  const yr = Math.floor(day / 365);
  return t('me.relativeTime.yearsAgo', { n: yr });
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
  position: relative;
  max-width: 1280px;
  margin: 0 auto;
  padding: 2rem 0.25rem 4rem;
  display: flex;
  flex-direction: column;
  gap: 2rem;
  isolation: isolate;
  /* Local hue palette shared with /torrents/:hash and /users/:id —
     keeps the editorial vocabulary threaded across surfaces. */
  --release-purple: 167 139 250;
  --release-cyan:   var(--info);
  --release-rose:   244 114 182;
  --release-teal:   45 212 191;
}

/* ── Atmospheric background ─────────────────────────────────────
   Full-bleed aura with the standard "100 vw + margin shift" trick
   so the gradient escapes the centred 1280-px wrapper and the page
   reads edge-to-edge on wide viewports. */
.me-aura {
  position: absolute;
  top: -2rem;
  left: 50%;
  width: 100vw;
  margin-left: -50vw;
  height: 70vh;
  z-index: -1;
  overflow: hidden;
  pointer-events: none;
}
.me-aura::before {
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
  left: 5%;
  background: radial-gradient(
    circle,
    rgb(var(--release-teal) / 0.5),
    transparent 65%
  );
}
.aura-blob--b {
  width: 420px;
  height: 420px;
  top: 60px;
  right: 6%;
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
  position: relative;
  width: 5rem;
  height: 5rem;
  border-radius: 0.7rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 1.85rem;
  font-weight: 900;
  letter-spacing: -0.04em;
  color: rgba(255, 255, 255, 0.95);
  flex-shrink: 0;
  isolation: isolate;
  box-shadow:
    0 14px 38px -16px rgba(0, 0, 0, 0.7),
    inset 0 0 0 1px rgba(255, 255, 255, 0.12),
    inset 0 -20px 30px -16px rgba(0, 0, 0, 0.35);
  text-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
}
.hero-avatar::after {
  /* Diagonal sheen — gives the gradient block a soft-lit glass card
     vibe rather than a flat swatch. Mirrors the /users/:id avatar. */
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
.hero-id-body {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
}
.hero-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: rgb(var(--release-cyan));
  margin: 0;
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
.hero-title {
  font-family: 'Inter', system-ui, sans-serif;
  font-size: clamp(1.75rem, 4vw, 2.75rem);
  font-weight: 800;
  letter-spacing: -0.025em;
  margin: 0;
  line-height: 1.05;
  color: rgb(var(--fg-strong));
  overflow-wrap: anywhere;
  text-wrap: pretty;
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
/* Second sub-line — coin tone, used for the "(of which X bonus)"
   breakdown on the Uploaded KPI. Reads as derived data, not as a
   second value. The colour matches the kpi--bonus tile and the
   /shop low-stock rail so the three surfaces stay threaded. */
.kpi-sub--bonus {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  /* Pull tight against the line above so the two sub-rows read as
     a single block (caption + breakdown) rather than two
     independent stats — the parent `.kpi` flex gap is wider than
     we want here. */
  margin-top: -0.25rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  letter-spacing: 0.02em;
  color: #d4a734;
}
.kpi-sub-icon {
  font-size: 0.85em;
  flex-shrink: 0;
}
.kpi--up .kpi-value {
  color: #6cd161;
}
.kpi--down .kpi-value {
  color: rgb(var(--fg-strong));
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

/* Bonus KPI — replaces the old "Released" tile. The value is
   deliberately a hair smaller than its peers (the points balance is
   a derived stat, not a tracker-of-record number), and the tile gets
   the same coin-gold accent that threads /shop and the ledger
   toggle below. The inline "PTS" unit lives on the same line as the
   number with a smaller, muted treatment. */
.kpi--bonus .kpi-value {
  display: inline-flex;
  align-items: baseline;
  gap: 0.32rem;
  font-size: clamp(1.05rem, 2vw, 1.35rem);
  color: #d4a734;
  font-weight: 800;
  letter-spacing: -0.01em;
}
.kpi-value-unit {
  font-size: 9px;
  font-weight: 500;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.kpi-sub--link {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  color: rgb(var(--fg-muted));
  text-decoration: none;
  letter-spacing: 0.1em;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  font-weight: 700;
  text-transform: uppercase;
  transition: color 0.16s ease, gap 0.2s ease;
}
.kpi-sub--link:hover {
  color: #d4a734;
  gap: 0.4rem;
}
.kpi-sub--link :deep(svg),
.kpi-sub--link svg {
  font-size: 0.85em;
  transition: transform 0.2s;
}
.kpi-sub--link:hover :deep(svg),
.kpi-sub--link:hover svg {
  transform: translateX(1px);
}

/* ─── Sections ──────────────────────────────────────────────
   Switched from the 01/02/03 chip pattern to the § Fraunces-italic
   chapter mark used by /torrents/:hash and /users/:id. Each parent
   section carries its own `--section-tint` so the mark and the
   horizontal rule pick up a different hue per chapter — gold for
   bonus, cyan for credentials, violet for activity.
*/
.section-head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1.1rem;
  padding-bottom: 0.4rem;
}
.section-number {
  font-family: 'Fraunces', 'Charter', Georgia, serif;
  font-style: italic;
  font-weight: 600;
  font-size: 1.85rem;
  line-height: 1;
  color: rgb(var(--section-tint, var(--accent)));
  transform: translateY(-2px);
  flex-shrink: 0;
  background: transparent;
  border: 0;
  padding: 0;
  filter: drop-shadow(0 0 10px rgb(var(--section-tint, var(--accent)) / 0.35));
}
.section-title {
  font-family: 'Fraunces', 'Charter', Georgia, serif;
  font-style: italic;
  font-weight: 500;
  font-size: clamp(1.15rem, 2.2vw, 1.55rem);
  letter-spacing: -0.01em;
  text-transform: none;
  color: rgb(var(--fg-strong));
  margin: 0;
}
.section-rule {
  flex: 1;
  height: 1px;
  background: linear-gradient(
    90deg,
    rgb(var(--section-tint, var(--line-default)) / 0.4),
    transparent 75%
  );
  min-width: 1rem;
}

/* Per-section accent tints — fed to `--section-tint` so the chapter
   mark and the rule line take a distinct hue per section. */
.section--bonus       { --section-tint: var(--warning); }
.section--credentials { --section-tint: var(--release-cyan); }
.section--activity    { --section-tint: var(--release-purple); }

/* ─── Bonus reserve ────────────────────────────────────────── */
/*
 * Compact wallet readout. One horizontal bar that fits a financial
 * dashboard register more than a vault display: coin glyph + balance
 * stack on the left, in-line caption in the middle, /shop CTA on the
 * right. Wraps cleanly to two/three rows on narrow viewports.
 *
 * Hero KPI strip already carries active-seeds + released, so the
 * previous mini-stats grid was duplication and got dropped. The
 * decorative tick marks went too — the typography of the number
 * carries the page on its own.
 */
.bonus-vault {
  margin-bottom: 1.75rem;
}

/*
 * Compact ledger trigger — a single-line button that replaces the old
 * "wallet bar". The balance lives in the KPI strip now, so this is
 * pure affordance: icon, label, optional caption, chevron. Hover
 * pulls the row forward subtly; open state tints the border + chevron
 * gold so the user can see at a glance that the panel below belongs
 * to this control.
 */
.bonus-history-toggle {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  width: 100%;
  padding: 0.7rem 1rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.5rem;
  background: rgb(var(--bg-elevated));
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.18s ease, background 0.16s ease;
}
.bonus-history-toggle:hover {
  border-color: rgb(212, 167, 52, 0.45);
  background: rgb(var(--fg-default) / 0.03);
}
.bonus-history-toggle:focus-visible {
  outline: 2px solid rgb(212, 167, 52, 0.55);
  outline-offset: -2px;
}
.bonus-history-toggle--open {
  border-color: rgb(212, 167, 52, 0.6);
}

.bv-trigger-icon {
  flex-shrink: 0;
  font-size: 1.05rem;
  color: #d4a734;
}
.bv-trigger-label {
  flex-shrink: 0;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
}
.bv-trigger-caption {
  flex: 1;
  font-size: 0.72rem;
  color: rgb(var(--fg-muted));
  line-height: 1.45;
  border-left: 1px dashed rgb(var(--line-default) / 0.7);
  padding-left: 0.85rem;
  min-width: 0;
  /* Two-line clamp so a long caption doesn't blow the row open on
     narrow viewports — the user can still see the full text in the
     hero KPI tooltip / shop page. */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
@media (max-width: 720px) {
  .bv-trigger-caption {
    display: none;
  }
}

.bonus-chevron {
  flex-shrink: 0;
  font-size: 0.95rem;
  color: rgb(var(--fg-muted));
  transition: transform 0.24s cubic-bezier(0.4, 0, 0.2, 1), color 0.16s ease;
}
.bonus-history-toggle:hover .bonus-chevron {
  color: rgb(var(--fg-strong));
}
.bonus-chevron--open {
  transform: rotate(-180deg);
  color: #d4a734;
}

/* ─── Bonus transaction ledger (expandable) ────────────────────
 *
 * Sits directly below the bar. Each entry is a single grid row that
 * reads left-to-right: time, gain/spend tag, source label, amount,
 * free-text note. The grid template stays consistent across rows so
 * a long ledger reads as a register, not a stack of cards.
 *
 * The panel slides in via a max-height + opacity transition (no JS
 * height measurement — keeps the animation cheap and snaps cleanly
 * even when the viewport reflows mid-animation).
 */
.bonus-history {
  margin-top: 0.65rem;
  padding: 1rem 1rem 1.1rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.5rem;
  background: rgb(var(--bg-elevated) / 0.4);
  position: relative;
  overflow: hidden;
}
.bonus-history::before {
  /* Match the bar's coin sheen so the two surfaces feel like one
     continuous panel that's been hinged open. */
  content: '';
  position: absolute;
  inset-inline: 1rem;
  top: 0;
  height: 1px;
  background: linear-gradient(
    to right,
    rgba(212, 167, 52, 0.4) 0%,
    rgba(212, 167, 52, 0.1) 60%,
    rgba(212, 167, 52, 0) 100%
  );
}

/* Slide + fade transition for the whole panel. We deliberately use
   a generous max-height (2000px) so a long ledger stays uncapped;
   the actual panel height is content-driven. */
.bv-panel-enter-active,
.bv-panel-leave-active {
  transition: max-height 0.32s ease, opacity 0.22s ease,
    margin-top 0.22s ease;
  overflow: hidden;
}
.bv-panel-enter-from,
.bv-panel-leave-to {
  max-height: 0;
  opacity: 0;
  margin-top: 0;
}
.bv-panel-enter-to,
.bv-panel-leave-from {
  max-height: 2000px;
  opacity: 1;
}

/* Sub-section header inside the bonus history drawer — same § mark
   as the page sections but at a smaller scale (the drawer is nested
   under the main "Bonus" section, so its mark should read as a
   sub-mark visually). */
.bv-head {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  margin-bottom: 0.85rem;
}
.bv-head-num {
  font-family: 'Fraunces', 'Charter', Georgia, serif;
  font-style: italic;
  font-weight: 600;
  font-size: 1.25rem;
  line-height: 1;
  color: rgb(var(--warning));
  transform: translateY(-1px);
  filter: drop-shadow(0 0 6px rgb(var(--warning) / 0.35));
}
.bv-head-rule {
  flex: 0 0 1.5rem;
  height: 1px;
  background: linear-gradient(
    90deg,
    rgb(var(--warning) / 0.35),
    transparent 80%
  );
}
.bv-head-title {
  margin: 0;
  font-family: 'Fraunces', 'Charter', Georgia, serif;
  font-style: italic;
  font-weight: 500;
  font-size: 1rem;
  letter-spacing: -0.005em;
  text-transform: none;
  color: rgb(var(--fg-strong));
}

.bv-loading,
.bv-error,
.bv-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.55rem;
  padding: 1.25rem 1rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.bv-loading-spin {
  animation: bv-spin 0.9s linear infinite;
  color: rgb(var(--fg-muted));
}
@keyframes bv-spin {
  to { transform: rotate(360deg); }
}
.bv-error {
  color: rgb(var(--danger));
}
.bv-empty {
  font-style: italic;
  text-transform: none;
  letter-spacing: 0.02em;
  font-size: 12px;
  color: rgb(var(--fg-faint));
}
.bv-empty svg {
  font-size: 1rem;
}

.bv-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: rgb(var(--line-default));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.4rem;
  overflow: hidden;
}

/* Each row: 5-column grid that reads as a register entry. The amount
   anchors the right side; the free-text note flows on row 2 of the
   same row when present (we use grid-template-rows: auto auto). */
.bv-row {
  display: grid;
  grid-template-columns:
    minmax(5rem, auto)   /* time */
    auto                 /* gain/spend tag */
    minmax(0, 1fr)       /* source label */
    auto;                /* amount */
  grid-template-rows: auto;
  gap: 0.4rem 0.85rem;
  align-items: center;
  padding: 0.65rem 0.9rem;
  background: rgb(var(--bg-elevated));
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 12px;
  /* Stagger entry — each row arrives ~30ms after the previous so the
     panel feels like it's being typed in. Caps via a class-bound max
     so a 100-row ledger doesn't take 3s to settle. */
  animation: bv-row-in 0.28s ease both;
  animation-delay: calc(var(--row-i, 0) * 24ms);
  transition: background 0.14s ease, transform 0.14s ease;
  position: relative;
}
.bv-row:hover {
  background: rgb(var(--bg-surface));
}
.bv-row::before {
  /* Tiny vertical bar on the left, coloured by gain/spend. Two pixels
     wide, full row height — works as a quiet visual key. */
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: 2px;
}
.bv-row--gain::before {
  background: rgb(var(--online));
}
.bv-row--spend::before {
  background: #d4a734;
}
@keyframes bv-row-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}

.bv-time {
  color: rgb(var(--fg-faint));
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

/* Tag pill — small, outlined, gain or spend tinted. Reads as the
   "verb" of the row at a glance without overwhelming the readout. */
.bv-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.18rem 0.5rem;
  border-radius: 9999px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  border: 1px solid;
  white-space: nowrap;
}
.bv-tag--gain {
  color: rgb(var(--online));
  border-color: rgb(var(--online) / 0.4);
  background: rgb(var(--online) / 0.08);
}
.bv-tag--spend {
  color: #d4a734;
  border-color: rgba(212, 167, 52, 0.4);
  background: rgba(212, 167, 52, 0.08);
}
.bv-tag svg {
  font-size: 9px;
}

.bv-source {
  color: rgb(var(--fg-default));
  font-weight: 500;
  letter-spacing: 0.02em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bv-amount {
  display: inline-flex;
  align-items: baseline;
  gap: 0.3rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  justify-self: end;
}
.bv-amount-sign {
  font-size: 1rem;
  font-weight: 700;
  line-height: 1;
}
.bv-amount-num {
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.bv-amount-unit {
  font-size: 9px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.bv-amount--gain {
  color: rgb(var(--online));
}
.bv-amount--spend {
  color: #d4a734;
}

/* Free-text note — when present it slips onto a second line of the
   same grid row, full-width, smaller, muted. Italic so it reads as
   commentary rather than another data column. */
.bv-msg {
  grid-column: 1 / -1;
  margin-top: 0.15rem;
  padding-top: 0.4rem;
  border-top: 1px dashed rgb(var(--line-default));
  font-style: italic;
  font-size: 11px;
  color: rgb(var(--fg-muted));
  font-family: 'Inter', system-ui, sans-serif;
  letter-spacing: 0;
  /* Truncate to a reasonable upper bound — admins occasionally write
     paragraph-long reasons; we want the bar to stay within the ledger
     rather than push other rows around. Click to read the full text
     via the title attribute. */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* "Older entries" pagination button — sits centred below the list.
   `margin: 0.85rem auto 0` does the centring; flex enables the icon
   alignment without an extra wrapper element. */
.bv-more {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0.85rem auto 0;
  padding: 0.5rem 0.95rem;
  background: transparent;
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.4rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  cursor: pointer;
  transition: all 0.16s ease;
}
.bv-more:hover:not(:disabled) {
  border-color: rgb(var(--fg-default) / 0.5);
  color: rgb(var(--fg-strong));
}
.bv-more:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Mobile reflow — collapse the row into a 2-line stack so the source
   and message wrap cleanly without horizontal overflow. */
@media (max-width: 640px) {
  .bv-row {
    grid-template-columns: auto 1fr auto;
    grid-template-areas:
      'time tag amount'
      'src  src src';
  }
  .bv-time { grid-area: time; }
  .bv-tag { grid-area: tag; }
  .bv-amount { grid-area: amount; }
  .bv-source {
    grid-area: src;
    font-size: 11px;
    color: rgb(var(--fg-muted));
  }
  .bv-msg {
    grid-column: 1 / -1;
  }
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
/* Below sm, the row reflows to two stacked sections so the progress bar
   doesn't fight the torrent name + meta + chevron for ~120 px of usable
   space. The icon stays as a leading column; everything else stacks. */
@media (max-width: 640px) {
  .row {
    grid-template-columns: auto 1fr;
    gap: 0.75rem;
    padding: 0.7rem 0.85rem;
  }
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
.row-name-line {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  min-width: 0;
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
@media (max-width: 640px) {
  /* Below sm the progress bar wraps under the meta line — keeping it
     inline starves both for space. Drop the min-width and let it own a
     full row. */
  .row-progress {
    min-width: 0;
    width: 100%;
    max-width: none;
  }
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
