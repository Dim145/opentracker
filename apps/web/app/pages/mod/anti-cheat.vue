<template>
  <div class="ac">
    <!-- ╔══════════════════════════════════════════════════════════╗
         ║  RADAR — KPI strip + live status indicator              ║
         ║  Tiles are clickable: each one filters the case feed    ║
         ║  to its own status / kind.                              ║
         ╚══════════════════════════════════════════════════════════╝ -->
    <section class="ac-radar" :class="`ac-radar--${threatLevel}`">
      <div class="ac-radar-pulse" aria-hidden="true">
        <span class="ac-radar-ring ac-radar-ring--1" />
        <span class="ac-radar-ring ac-radar-ring--2" />
        <span class="ac-radar-ring ac-radar-ring--3" />
        <span class="ac-radar-core" />
      </div>
      <div class="ac-radar-readout">
        <span class="ac-radar-label">
          {{ $t('mod.antiCheat.radar.label') }}
        </span>
        <span class="ac-radar-state">{{ threatLabel }}</span>
        <span class="ac-radar-meta">
          {{ $t('mod.antiCheat.radar.meta', { unreviewed: counts.unreviewed }) }}
        </span>
      </div>
      <div class="ac-tiles">
        <button
          v-for="tile in tiles"
          :key="tile.key"
          type="button"
          class="ac-tile"
          :class="[
            `ac-tile--${tile.tone}`,
            { 'is-active': tile.isActive() },
          ]"
          @click="tile.click()"
        >
          <span class="ac-tile-label">{{ tile.label }}</span>
          <span class="ac-tile-value tabular-nums">{{ tile.value }}</span>
        </button>
      </div>
    </section>

    <!-- ╔══════════════════════════════════════════════════════════╗
         ║  CASE FEED                                                ║
         ╚══════════════════════════════════════════════════════════╝ -->
    <header class="ac-feed-head">
      <div class="ac-feed-title">
        <span class="ac-feed-mark" aria-hidden="true">▮</span>
        <h2>{{ $t('mod.antiCheat.feed.title') }}</h2>
        <span class="ac-feed-count tabular-nums">
          {{ data?.pagination.total ?? 0 }}
        </span>
      </div>
      <button
        type="button"
        class="ac-select-all"
        :class="{ 'is-active': allOnPageSelected }"
        :disabled="rows.length === 0"
        @click="toggleAllOnPage"
      >
        <Icon
          :name="allOnPageSelected ? 'ph:check-square-fill' : 'ph:square-bold'"
        />
        <span>
          {{
            allOnPageSelected
              ? $t('mod.antiCheat.bulk.deselectAll')
              : $t('mod.antiCheat.bulk.selectAll')
          }}
        </span>
      </button>
      <div class="ac-status-seg">
        <button
          v-for="tab in statusTabs"
          :key="tab.value"
          type="button"
          class="ac-status-pill"
          :class="{ 'is-active': status === tab.value }"
          @click="setStatus(tab.value)"
        >
          {{ tab.label }}
        </button>
      </div>
    </header>

    <div class="ac-feed-loader" v-if="pending && !data">
      <Icon name="ph:circle-notch" class="ac-spin" />
      <span>{{ $t('mod.antiCheat.feed.loading') }}</span>
    </div>

    <ul v-else-if="rows.length > 0" class="ac-feed">
      <li
        v-for="(row, i) in rows"
        :key="row.id"
        class="ac-case"
        :class="[
          `ac-case--${row.kind}`,
          `ac-case--sev-${row.severity}`,
          {
            'is-reviewed': row.reviewedAt,
            'is-expanded': expandedId === row.id,
            'is-fresh': isFresh(row.createdAt),
          },
        ]"
        :style="{ '--stagger': `${Math.min(i * 30, 240)}ms` }"
      >
        <!-- Severity ribbon, full-height on the left -->
        <span class="ac-case-ribbon" aria-hidden="true" />

        <!-- Bulk selection checkbox — sits inside the ribbon margin
             so it doesn't push the case-head grid columns around.
             Its label captures the click so the surrounding row's
             expand handler doesn't fire when toggling the box. -->
        <label
          class="ac-case-select"
          :class="{ 'is-selected': selected.has(row.id) }"
          @click.stop
        >
          <input
            type="checkbox"
            :checked="selected.has(row.id)"
            :aria-label="$t('mod.antiCheat.bulk.selectRow')"
            @change="toggleSelection(row.id)"
          >
          <span class="ac-case-select-mark" aria-hidden="true">
            <Icon name="ph:check-bold" />
          </span>
        </label>

        <button
          type="button"
          class="ac-case-head"
          :aria-expanded="expandedId === row.id"
          @click="toggle(row.id)"
        >
          <span class="ac-case-num tabular-nums">
            <span class="ac-case-num-prefix">№</span>
            {{ caseNumber(row, i) }}
          </span>

          <div class="ac-case-id">
            <span class="ac-case-kind">
              <Icon :name="kindIcon(row.kind)" class="ac-case-kind-icon" />
              {{ $t(`mod.antiCheat.kind.${row.kind}`) }}
            </span>
            <span class="ac-case-evidence">
              {{ evidenceSummary(row) }}
            </span>
          </div>

          <div class="ac-case-suspect">
            <NuxtLink
              v-if="row.user"
              :to="`/users/${row.user.id}`"
              class="ac-case-user"
              @click.stop
            >
              <span class="ac-case-avatar" :style="avatarStyle(row.user.username)">
                {{ initials(row.user.username) }}
              </span>
              <span class="ac-case-user-name">@{{ row.user.username }}</span>
            </NuxtLink>
            <span v-else class="ac-case-user ac-case-user--gone">
              <span class="ac-case-avatar ac-case-avatar--gone">?</span>
              <span>{{ $t('mod.antiCheat.userGone') }}</span>
            </span>
            <NuxtLink
              v-if="row.torrent"
              :to="`/torrents/${row.torrent.infoHash}`"
              class="ac-case-target"
              :title="row.torrent.name"
              @click.stop
            >
              <Icon name="ph:file-zip-bold" />
              <span>{{ row.torrent.name }}</span>
            </NuxtLink>
            <span v-else class="ac-case-target ac-case-target--orphan">
              <Icon name="ph:question-bold" />
              <code>{{ row.infoHash.slice(0, 8) }}…</code>
            </span>
          </div>

          <div class="ac-case-meta">
            <time class="ac-case-time tabular-nums" :datetime="row.createdAt">
              {{ formatAge(row.createdAt) }}
            </time>
            <span
              v-if="row.reviewedAt"
              class="ac-case-verdict"
              :class="`ac-case-verdict--${row.reviewVerdict}`"
            >
              {{ row.reviewVerdict }}
            </span>
            <span v-else class="ac-case-verdict ac-case-verdict--open">
              <span class="ac-case-verdict-dot" />
              {{ $t('mod.antiCheat.openLabel') }}
            </span>
          </div>

          <Icon
            name="ph:caret-down-bold"
            class="ac-case-caret"
            :class="{ 'is-flipped': expandedId === row.id }"
          />
        </button>

        <!-- Stamp overlay when reviewed — paper-case-file vibe -->
        <span
          v-if="row.reviewedAt"
          class="ac-stamp"
          :class="`ac-stamp--${row.reviewVerdict}`"
          aria-hidden="true"
        >
          {{ row.reviewVerdict }}
        </span>

        <!-- Inline detail panel -->
        <div v-if="expandedId === row.id" class="ac-case-body">
          <dl class="ac-evidence">
            <div>
              <dt>{{ $t('mod.antiCheat.detail.peerId') }}</dt>
              <dd>
                <code v-if="row.peerId">{{ row.peerId }}</code>
                <span v-else class="ac-faint">—</span>
              </dd>
            </div>
            <div>
              <dt>{{ $t('mod.antiCheat.detail.ip') }}</dt>
              <dd>
                <code v-if="row.ip">{{ row.ip }}</code>
                <span v-else class="ac-faint">—</span>
              </dd>
            </div>
            <div>
              <dt>{{ $t('mod.antiCheat.detail.userAgent') }}</dt>
              <dd>
                <code v-if="row.userAgent" class="ac-evidence-ua">{{
                  row.userAgent
                }}</code>
                <span v-else class="ac-faint">—</span>
              </dd>
            </div>
            <div>
              <dt>{{ $t('mod.antiCheat.detail.firedAt') }}</dt>
              <dd>
                <code>{{ formatDate(row.createdAt) }}</code>
              </dd>
            </div>
          </dl>

          <details class="ac-raw" :open="false">
            <summary>{{ $t('mod.antiCheat.detail.rawPayload') }}</summary>
            <pre>{{ JSON.stringify(row.details, null, 2) }}</pre>
          </details>

          <!-- Already reviewed — banner + re-review affordance -->
          <div v-if="row.reviewedAt" class="ac-already">
            <Icon name="ph:seal-check-fill" class="ac-already-icon" />
            <div class="ac-already-body">
              <p class="ac-already-line">
                <strong>{{ row.reviewVerdict }}</strong>
                ·
                {{
                  $t('mod.antiCheat.detail.reviewedBy', {
                    user: row.reviewer?.username || '—',
                    date: formatAge(row.reviewedAt),
                  })
                }}
              </p>
              <p v-if="row.reviewNote" class="ac-already-note">
                {{ row.reviewNote }}
              </p>
            </div>
            <button
              type="button"
              class="ac-already-reopen"
              @click="reopenReview(row)"
            >
              {{ $t('mod.antiCheat.detail.reReview') }}
            </button>
          </div>

          <!-- Review form -->
          <form
            v-else
            class="ac-review"
            @submit.prevent="submitReview(row)"
          >
            <fieldset class="ac-verdicts">
              <legend>{{ $t('mod.antiCheat.verdictLegend') }}</legend>
              <button
                v-for="v in VERDICTS"
                :key="v.value"
                type="button"
                class="ac-stamp-btn"
                :class="[
                  `ac-stamp-btn--${v.value}`,
                  { 'is-selected': reviewForm.verdict === v.value },
                ]"
                @click="reviewForm.verdict = v.value"
              >
                <Icon :name="v.icon" />
                <span>{{ $t(`mod.antiCheat.verdict.${v.value}`) }}</span>
              </button>
            </fieldset>

            <textarea
              v-model="reviewForm.note"
              class="ac-note"
              rows="3"
              maxlength="500"
              :placeholder="$t('mod.antiCheat.notePlaceholder')"
            />

            <div class="ac-review-actions">
              <button
                type="button"
                class="ac-btn ac-btn--ghost"
                @click="toggle(row.id)"
              >
                {{ $t('common.cancel') }}
              </button>
              <button
                type="submit"
                class="ac-btn ac-btn--primary"
                :disabled="!reviewForm.verdict || submitting"
              >
                <Icon
                  :name="submitting ? 'ph:circle-notch' : 'ph:check-bold'"
                  :class="{ 'ac-spin': submitting }"
                />
                {{ $t('mod.antiCheat.submitReview') }}
              </button>
            </div>
          </form>
        </div>
      </li>
    </ul>

    <!-- Empty state — animated "all clear" pulse -->
    <div v-else class="ac-empty">
      <div class="ac-empty-radar" aria-hidden="true">
        <span class="ac-empty-ring ac-empty-ring--1" />
        <span class="ac-empty-ring ac-empty-ring--2" />
        <span class="ac-empty-ring ac-empty-ring--3" />
        <Icon name="ph:shield-check-bold" class="ac-empty-icon" />
      </div>
      <h3 class="ac-empty-title">{{ emptyTitle }}</h3>
      <p class="ac-empty-sub">{{ emptySub }}</p>
    </div>

    <nav
      v-if="data && data.pagination.pages > 1"
      class="ac-pager"
      :aria-label="$t('mod.antiCheat.pagerAria')"
    >
      <button
        type="button"
        class="ac-pager-btn"
        :disabled="page <= 1"
        @click="setPage(page - 1)"
      >
        <Icon name="ph:arrow-left-bold" />
        {{ $t('common.previous') }}
      </button>
      <span class="ac-pager-pos tabular-nums">
        <span class="ac-pager-cur">{{ page }}</span>
        <span class="ac-pager-sep">/</span>
        <span class="ac-pager-total">{{ data.pagination.pages }}</span>
      </span>
      <button
        type="button"
        class="ac-pager-btn"
        :disabled="page >= data.pagination.pages"
        @click="setPage(page + 1)"
      >
        {{ $t('common.next') }}
        <Icon name="ph:arrow-right-bold" />
      </button>
    </nav>

    <!-- ╔══════════════════════════════════════════════════════════╗
         ║  BULK ACTION BAR — sticky-bottom, slides in when ≥1 row   ║
         ║  is selected. Reuses the same verdict vocabulary as the   ║
         ║  per-case form so a "select all + apply" dispatch reads   ║
         ║  identically in the audit trail.                          ║
         ╚══════════════════════════════════════════════════════════╝ -->
    <Transition name="ac-bulkbar-slide">
      <div v-if="selectedCount > 0" class="ac-bulkbar">
        <div class="ac-bulkbar-summary">
          <span class="ac-bulkbar-count tabular-nums">{{ selectedCount }}</span>
          <span class="ac-bulkbar-label">
            {{ $t('mod.antiCheat.bulk.summary', selectedCount, { n: selectedCount }) }}
          </span>
        </div>

        <div class="ac-bulkbar-verdicts" role="group">
          <button
            v-for="v in VERDICTS"
            :key="v.value"
            type="button"
            class="ac-bulkbar-verdict"
            :class="[
              `ac-bulkbar-verdict--${v.value}`,
              { 'is-selected': bulkForm.verdict === v.value },
            ]"
            @click="bulkForm.verdict = v.value"
          >
            <Icon :name="v.icon" />
            <span>{{ $t(`mod.antiCheat.verdict.${v.value}`) }}</span>
          </button>
        </div>

        <input
          v-model="bulkForm.note"
          type="text"
          class="ac-bulkbar-note"
          maxlength="500"
          :placeholder="$t('mod.antiCheat.bulk.notePlaceholder')"
        >

        <div class="ac-bulkbar-actions">
          <button
            type="button"
            class="ac-bulkbar-cancel"
            @click="clearSelection"
          >
            {{ $t('common.cancel') }}
          </button>
          <button
            type="button"
            class="ac-bulkbar-apply"
            :disabled="!bulkForm.verdict || bulkSubmitting"
            @click="submitBulk"
          >
            <Icon
              :name="bulkSubmitting ? 'ph:circle-notch' : 'ph:check-bold'"
              :class="{ 'ac-spin': bulkSubmitting }"
            />
            <span>{{ $t('mod.antiCheat.bulk.apply') }}</span>
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { formatAge, formatDate } from '~/utils/format';

definePageMeta({ title: 'Anti-cheat' });

const { t } = useI18n();
const notifications = useNotificationStore();
useHead({ title: () => t('mod.antiCheat.title') });

type Kind = 'velocity' | 'no_leecher' | 'unknown_client';
type Status = 'unreviewed' | 'reviewed' | 'all';
type Severity = 'low' | 'medium' | 'high';
type Verdict = 'clean' | 'warned' | 'banned' | 'monitoring';

interface FlagRow {
  id: string;
  kind: Kind;
  severity: Severity;
  details: Record<string, unknown>;
  peerId: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewVerdict: string | null;
  reviewNote: string | null;
  infoHash: string;
  user: { id: string; username: string } | null;
  torrent: { id: string; name: string; infoHash: string } | null;
  reviewer: { id: string; username: string } | null;
}

interface FlagsResponse {
  data: FlagRow[];
  counts: {
    unreviewed: number;
    reviewed: number;
    velocity: number;
    noLeecher: number;
    unknownClient: number;
  };
  pagination: { page: number; limit: number; total: number; pages: number };
}

const status = ref<Status>('unreviewed');
const kind = ref<Kind | null>(null);
const page = ref(1);
const expandedId = ref<string | null>(null);

const { data, pending, refresh } = await useFetch<FlagsResponse>(
  '/api/mod/anti-cheat/flags',
  {
    query: computed(() => ({
      status: status.value,
      kind: kind.value ?? undefined,
      page: page.value,
    })),
  },
);

const rows = computed(() => data.value?.data ?? []);
const counts = computed(
  () =>
    data.value?.counts ?? {
      unreviewed: 0,
      reviewed: 0,
      velocity: 0,
      noLeecher: 0,
      unknownClient: 0,
    },
);

// Threat level → drives the radar pulse colour.
const threatLevel = computed<'calm' | 'elevated' | 'critical'>(() => {
  const u = counts.value.unreviewed;
  if (u === 0) return 'calm';
  // Treat any unreviewed velocity flag as critical — that's the
  // signature of an active cheat-flood. Anything else is "elevated".
  if (counts.value.velocity > 0) return 'critical';
  return 'elevated';
});

const threatLabel = computed(() => {
  switch (threatLevel.value) {
    case 'critical':
      return t('mod.antiCheat.radar.critical');
    case 'elevated':
      return t('mod.antiCheat.radar.elevated');
    default:
      return t('mod.antiCheat.radar.calm');
  }
});

// Tiles in the radar strip. Each one carries its own filter side-
// effect so clicking jumps into the focused view.
const tiles = computed(() => [
  {
    key: 'unreviewed',
    label: t('mod.antiCheat.tile.unreviewed'),
    value: counts.value.unreviewed,
    tone: 'danger',
    isActive: () => status.value === 'unreviewed' && kind.value === null,
    click: () => {
      status.value = 'unreviewed';
      kind.value = null;
      page.value = 1;
    },
  },
  {
    key: 'velocity',
    label: t('mod.antiCheat.kind.velocity'),
    value: counts.value.velocity,
    tone: 'velocity',
    isActive: () => status.value === 'unreviewed' && kind.value === 'velocity',
    click: () => {
      status.value = 'unreviewed';
      kind.value = 'velocity';
      page.value = 1;
    },
  },
  {
    key: 'no_leecher',
    label: t('mod.antiCheat.kind.no_leecher'),
    value: counts.value.noLeecher,
    tone: 'no-leecher',
    isActive: () =>
      status.value === 'unreviewed' && kind.value === 'no_leecher',
    click: () => {
      status.value = 'unreviewed';
      kind.value = 'no_leecher';
      page.value = 1;
    },
  },
  {
    key: 'unknown_client',
    label: t('mod.antiCheat.kind.unknown_client'),
    value: counts.value.unknownClient,
    tone: 'unknown',
    isActive: () =>
      status.value === 'unreviewed' && kind.value === 'unknown_client',
    click: () => {
      status.value = 'unreviewed';
      kind.value = 'unknown_client';
      page.value = 1;
    },
  },
  {
    key: 'reviewed',
    label: t('mod.antiCheat.tile.reviewed'),
    value: counts.value.reviewed,
    tone: 'cleared',
    isActive: () => status.value === 'reviewed',
    click: () => {
      status.value = 'reviewed';
      kind.value = null;
      page.value = 1;
    },
  },
]);

const statusTabs = computed(() => [
  { value: 'unreviewed' as Status, label: t('mod.antiCheat.tab.unreviewed') },
  { value: 'reviewed' as Status, label: t('mod.antiCheat.tab.reviewed') },
  { value: 'all' as Status, label: t('mod.antiCheat.tab.all') },
]);

function setStatus(s: Status) {
  if (status.value === s) return;
  status.value = s;
  page.value = 1;
  expandedId.value = null;
}
function setPage(n: number) {
  page.value = n;
  expandedId.value = null;
}

function kindIcon(k: Kind): string {
  switch (k) {
    case 'velocity':
      return 'ph:gauge-bold';
    case 'no_leecher':
      return 'ph:users-three-bold';
    case 'unknown_client':
      return 'ph:fingerprint-bold';
  }
}

/** One-glance evidence line per kind — the number the moderator
 *  needs to decide before opening the case. Falls back to the raw
 *  details if the detector emitted something unexpected. */
function evidenceSummary(row: FlagRow): string {
  const d = row.details as Record<string, number | string | undefined>;
  switch (row.kind) {
    case 'velocity': {
      const bps = Number(d.bytesPerSec ?? 0);
      const cap = Number(d.capBytesPerS ?? 0);
      const mb = (bps / 1_000_000).toFixed(1);
      const capMb = (cap / 1_000_000).toFixed(0);
      return t('mod.antiCheat.evidence.velocity', { rate: mb, cap: capMb });
    }
    case 'no_leecher': {
      const deltaUp = Number(d.deltaUp ?? 0);
      const mb = (deltaUp / 1_000_000).toFixed(1);
      return t('mod.antiCheat.evidence.noLeecher', { mb });
    }
    case 'unknown_client': {
      const prefix = String(d.prefix ?? '?');
      return t('mod.antiCheat.evidence.unknownClient', { prefix });
    }
  }
}

/** Stable case number based on creation timestamp — gives the
 *  moderator a stable shorthand to refer to a case in chat ("flag
 *  №042 is a false positive"). Three-digit padding keeps the
 *  column aligned. */
function caseNumber(row: FlagRow, _i: number): string {
  // Use the last 4 chars of the id, formatted as a hex case number.
  // Truncating the id is fine for display — full id stays available
  // for the moderation API and `key=` Vue prop.
  return row.id.slice(-4).toUpperCase();
}

function isFresh(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() < 5 * 60 * 1000; // 5 minutes
}

const VERDICTS = [
  { value: 'clean', icon: 'ph:check-bold' },
  { value: 'warned', icon: 'ph:warning-bold' },
  { value: 'banned', icon: 'ph:prohibit-bold' },
  { value: 'monitoring', icon: 'ph:eye-bold' },
] as const;

const reviewForm = reactive<{ verdict: Verdict | ''; note: string }>({
  verdict: '',
  note: '',
});
const submitting = ref(false);

function toggle(id: string) {
  if (expandedId.value === id) {
    expandedId.value = null;
  } else {
    expandedId.value = id;
    reviewForm.verdict = '';
    reviewForm.note = '';
  }
}

async function submitReview(row: FlagRow) {
  if (!reviewForm.verdict || submitting.value) return;
  submitting.value = true;
  try {
    await $fetch(`/api/mod/anti-cheat/flags/${row.id}`, {
      method: 'PUT',
      body: {
        verdict: reviewForm.verdict,
        note: reviewForm.note.trim() || null,
      },
    });
    notifications.success(t('mod.antiCheat.toastReviewed'));
    expandedId.value = null;
    await refresh();
  } catch (err: any) {
    notifications.error(
      err?.data?.message || err?.message || t('common.errors.generic'),
    );
  } finally {
    submitting.value = false;
  }
}

function reopenReview(row: FlagRow) {
  reviewForm.verdict = '';
  reviewForm.note = '';
  row.reviewedAt = null as unknown as string;
}

// ── Bulk selection ──────────────────────────────────────────
// A `Set<string>` of flag ids the moderator has ticked. The bulk
// action bar appears whenever the set is non-empty. Selection
// resets on any filter change (status / kind / page) because
// tracking IDs that aren't on the visible page would confuse the
// "N sélectionnés" count.
const selected = ref<Set<string>>(new Set());
const bulkForm = reactive<{ verdict: Verdict | ''; note: string }>({
  verdict: '',
  note: '',
});
const bulkSubmitting = ref(false);

const selectedCount = computed(() => selected.value.size);
const allOnPageSelected = computed(() => {
  if (rows.value.length === 0) return false;
  return rows.value.every((r) => selected.value.has(r.id));
});

function toggleSelection(id: string) {
  const next = new Set(selected.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  selected.value = next;
}

function toggleAllOnPage() {
  const next = new Set(selected.value);
  if (allOnPageSelected.value) {
    for (const r of rows.value) next.delete(r.id);
  } else {
    for (const r of rows.value) next.add(r.id);
  }
  selected.value = next;
}

function clearSelection() {
  selected.value = new Set();
  bulkForm.verdict = '';
  bulkForm.note = '';
}

async function submitBulk() {
  if (!bulkForm.verdict || selectedCount.value === 0 || bulkSubmitting.value)
    return;
  bulkSubmitting.value = true;
  try {
    const ids = Array.from(selected.value);
    const res = await $fetch<{ updated: number; ids: string[] }>(
      '/api/mod/anti-cheat/flags/bulk',
      {
        method: 'PUT',
        body: {
          flagIds: ids,
          verdict: bulkForm.verdict,
          note: bulkForm.note.trim() || null,
        },
      },
    );
    notifications.success(
      t('mod.antiCheat.bulk.toastDone', res.updated, { n: res.updated }),
    );
    clearSelection();
    await refresh();
  } catch (err: any) {
    notifications.error(
      err?.data?.message || err?.message || t('common.errors.generic'),
    );
  } finally {
    bulkSubmitting.value = false;
  }
}

// Clear selection on any filter change — ids that disappear from
// the visible page would otherwise stay ticked and confuse the
// "N sélectionnés" count.
watch([status, kind, page], () => {
  if (selected.value.size > 0) {
    selected.value = new Set();
    bulkForm.verdict = '';
    bulkForm.note = '';
  }
});

/* User-monogram avatar: stable two-letter initials + a hashed hue,
 * same approach used on /users and /me so the same user looks the
 * same wherever they appear. */
function initials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}
function avatarStyle(name: string): Record<string, string> {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  }
  const palettes: Array<[string, string]> = [
    ['#a78bfa', '#f472b6'],
    ['#38bdf8', '#2dd4bf'],
    ['#f472b6', '#eab308'],
    ['#a78bfa', '#38bdf8'],
    ['#2dd4bf', '#22c55e'],
    ['#22c55e', '#eab308'],
    ['#818cf8', '#a78bfa'],
  ];
  const [from, to] = palettes[Math.abs(h) % palettes.length]!;
  return { background: `linear-gradient(135deg, ${from} 0%, ${to} 100%)` };
}

const emptyTitle = computed(() => {
  if (status.value === 'unreviewed' && !kind.value) {
    return t('mod.antiCheat.empty.allClearTitle');
  }
  return t('mod.antiCheat.empty.genericTitle');
});
const emptySub = computed(() => {
  if (status.value === 'unreviewed' && !kind.value) {
    return t('mod.antiCheat.empty.allClearSub');
  }
  return t('mod.antiCheat.empty.genericSub');
});
</script>

<style scoped>
.ac {
  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  padding-bottom: 4rem;
  --vel: var(--danger);
  --nol: var(--warning);
  --unk: 167 139 250;
  --cleared: var(--online);
}

.tabular-nums { font-variant-numeric: tabular-nums; }

/* ╔═══════════════════════════════════════════════════════════════╗
   ║  RADAR — top KPI + status indicator                            ║
   ╚═══════════════════════════════════════════════════════════════╝ */
.ac-radar {
  display: grid;
  grid-template-columns: auto auto 1fr;
  align-items: center;
  gap: 1.25rem;
  padding: 1.1rem 1.25rem;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.025), transparent 60%),
    rgb(var(--bg-surface));
  border: 1px solid rgb(var(--line-strong));
  border-radius: 0.55rem;
  box-shadow:
    0 6px 24px -16px rgba(0, 0, 0, 0.55),
    inset 0 1px 0 rgba(255, 255, 255, 0.04);
}
@media (max-width: 880px) {
  .ac-radar {
    grid-template-columns: auto 1fr;
  }
  .ac-radar-readout { grid-column: 1 / -1; }
}

/* Pulse */
.ac-radar-pulse {
  position: relative;
  width: 3.25rem;
  height: 3.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.ac-radar-core {
  position: relative;
  width: 0.85rem;
  height: 0.85rem;
  border-radius: 999px;
  background: rgb(var(--tone, var(--online)));
  box-shadow: 0 0 12px rgb(var(--tone, var(--online)) / 0.7);
}
.ac-radar-ring {
  position: absolute;
  inset: 0;
  border: 1px solid rgb(var(--tone, var(--online)) / 0.55);
  border-radius: 999px;
  opacity: 0;
}
.ac-radar--calm { --tone: var(--online); }
.ac-radar--elevated { --tone: var(--warning); }
.ac-radar--critical { --tone: var(--danger); }
.ac-radar--elevated .ac-radar-ring,
.ac-radar--critical .ac-radar-ring {
  animation: radar-pulse 2.4s ease-out infinite;
}
.ac-radar--calm .ac-radar-ring--1 {
  animation: radar-pulse 4s ease-out infinite;
}
.ac-radar-ring--2 { animation-delay: 0.8s !important; }
.ac-radar-ring--3 { animation-delay: 1.6s !important; }
@keyframes radar-pulse {
  0%   { opacity: 0.7; transform: scale(0.4); }
  80%  { opacity: 0;   transform: scale(2.2); }
  100% { opacity: 0;   transform: scale(2.2); }
}

/* Readout */
.ac-radar-readout {
  display: flex;
  flex-direction: column;
  gap: 0.18rem;
  min-width: 0;
}
.ac-radar-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.ac-radar-state {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgb(var(--tone, var(--online)));
}
.ac-radar-meta {
  font-size: 11px;
  color: rgb(var(--fg-muted));
}

/* Tiles */
.ac-tiles {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.45rem;
}
@media (max-width: 980px) {
  .ac-tiles {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (max-width: 540px) {
  .ac-tiles {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
.ac-tile {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.18rem;
  padding: 0.6rem 0.75rem 0.55rem;
  border-radius: 0.35rem;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.035), transparent 60%),
    rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  color: rgb(var(--fg-muted));
  cursor: pointer;
  transition:
    background 0.18s, border-color 0.18s, color 0.18s,
    transform 0.2s cubic-bezier(0.22, 1, 0.36, 1);
}
.ac-tile:hover {
  transform: translateY(-1px);
  border-color: rgb(var(--fg-default) / 0.32);
}
.ac-tile.is-active {
  background:
    linear-gradient(135deg, rgb(var(--tile-tone, var(--accent)) / 0.18), transparent 60%),
    rgb(var(--bg-elevated));
  border-color: rgb(var(--tile-tone, var(--accent)) / 0.55);
  color: rgb(var(--tile-tone, var(--accent)));
  box-shadow: 0 8px 20px -12px rgb(var(--tile-tone, var(--accent)) / 0.6);
}
.ac-tile-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}
.ac-tile-value {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 1.55rem;
  font-weight: 900;
  letter-spacing: -0.025em;
  color: rgb(var(--fg-strong));
  line-height: 1;
}
.ac-tile.is-active .ac-tile-value { color: rgb(var(--tile-tone)); }
.ac-tile--danger    { --tile-tone: var(--danger); }
.ac-tile--velocity  { --tile-tone: var(--danger); }
.ac-tile--no-leecher{ --tile-tone: var(--warning); }
.ac-tile--unknown   { --tile-tone: var(--unk); }
.ac-tile--cleared   { --tile-tone: var(--online); }

/* ╔═══════════════════════════════════════════════════════════════╗
   ║  FEED HEAD                                                      ║
   ╚═══════════════════════════════════════════════════════════════╝ */
.ac-feed-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.85rem;
  justify-content: space-between;
}
.ac-feed-title {
  display: inline-flex;
  align-items: baseline;
  gap: 0.55rem;
}
.ac-feed-mark {
  font-size: 1rem;
  color: rgb(var(--danger));
  filter: drop-shadow(0 0 6px rgb(var(--danger) / 0.5));
}
.ac-feed-title h2 {
  margin: 0;
  font-family: 'Inter', system-ui, sans-serif;
  font-weight: 800;
  font-size: 1.05rem;
  letter-spacing: -0.01em;
  color: rgb(var(--fg-strong));
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.ac-feed-count {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.16em;
  color: rgb(var(--fg-muted));
  padding: 0.15rem 0.55rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 999px;
}
.ac-status-seg {
  display: inline-flex;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: 999px;
  padding: 0.15rem;
}
.ac-status-pill {
  padding: 0.35rem 0.85rem;
  background: transparent;
  border: 0;
  border-radius: 999px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.ac-status-pill:hover { color: rgb(var(--fg-strong)); }
.ac-status-pill.is-active {
  background: rgb(var(--danger) / 0.18);
  color: rgb(var(--danger));
}

/* Loader */
.ac-feed-loader {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.55rem;
  padding: 2rem 1rem;
  background: rgb(var(--bg-elevated));
  border: 1px dashed rgb(var(--line-default));
  border-radius: 0.5rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.ac-spin { animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ╔═══════════════════════════════════════════════════════════════╗
   ║  CASE FEED                                                      ║
   ╚═══════════════════════════════════════════════════════════════╝ */
.ac-feed {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}
.ac-case {
  position: relative;
  overflow: hidden;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.025), transparent 60%),
    rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-strong));
  border-radius: 0.5rem;
  animation: case-rise 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: var(--stagger, 0ms);
  transition: border-color 0.2s, box-shadow 0.2s;
}
@keyframes case-rise {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
.ac-case.is-expanded {
  border-color: rgb(var(--kind-tone, var(--danger)) / 0.55);
  box-shadow: 0 10px 28px -14px rgb(var(--kind-tone, var(--danger)) / 0.5);
}
.ac-case.is-reviewed { opacity: 0.65; }
.ac-case.is-reviewed:hover { opacity: 1; }
.ac-case.is-fresh::after {
  /* fresh = within last 5 min: thin pulsing inner border to call
     attention without colour-flooding the row. */
  content: '';
  position: absolute;
  inset: 0;
  border: 1px solid rgb(var(--kind-tone, var(--danger)) / 0.45);
  border-radius: inherit;
  pointer-events: none;
  animation: fresh-pulse 2s ease-in-out infinite;
}
@keyframes fresh-pulse {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 0.9; }
}

.ac-case--velocity        { --kind-tone: var(--vel); }
.ac-case--no_leecher      { --kind-tone: var(--nol); }
.ac-case--unknown_client  { --kind-tone: var(--unk); }

/* Severity ribbon — vertical accent strip pinned to the left edge.
   Width scales with severity so the moderator's eye lands first on
   the cases that need them most. */
.ac-case-ribbon {
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: rgb(var(--kind-tone, var(--danger)));
  opacity: 0.5;
}
.ac-case--sev-medium .ac-case-ribbon { width: 4px; opacity: 0.7; }
.ac-case--sev-high .ac-case-ribbon { width: 5px; opacity: 1; }

.ac-case-head {
  display: grid;
  grid-template-columns:
    auto             /* case number */
    minmax(180px, 1.2fr)   /* kind + evidence */
    minmax(220px, 1.6fr)   /* suspect + target */
    auto             /* time + verdict */
    auto;            /* caret */
  align-items: center;
  gap: 0.85rem;
  width: 100%;
  padding: 0.85rem 1rem 0.85rem 1.1rem;
  background: transparent;
  border: 0;
  text-align: left;
  cursor: pointer;
  color: rgb(var(--fg-default));
  font: inherit;
  transition: background 0.15s ease;
}
.ac-case-head:hover {
  background: rgb(var(--fg-default) / 0.03);
}
@media (max-width: 880px) {
  .ac-case-head {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: auto auto auto;
  }
  .ac-case-num { grid-column: 1; grid-row: 1; }
  .ac-case-id { grid-column: 1 / -1; grid-row: 2; }
  .ac-case-suspect { grid-column: 1 / -1; grid-row: 3; }
  .ac-case-meta { grid-column: 2; grid-row: 1; justify-self: end; }
  .ac-case-caret { display: none; }
}

.ac-case-num {
  display: inline-flex;
  align-items: baseline;
  gap: 0.15rem;
  padding: 0.18rem 0.45rem;
  background: rgb(var(--kind-tone, var(--danger)) / 0.1);
  border: 1px solid rgb(var(--kind-tone, var(--danger)) / 0.4);
  border-radius: 0.25rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: rgb(var(--kind-tone, var(--danger)));
}
.ac-case-num-prefix { font-size: 9.5px; opacity: 0.7; }

.ac-case-id {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}
.ac-case-kind {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--kind-tone, var(--danger)));
}
.ac-case-kind-icon { font-size: 0.95rem; }
.ac-case-evidence {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11.5px;
  color: rgb(var(--fg-default));
  font-variant-numeric: tabular-nums;
}

.ac-case-suspect {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}
.ac-case-user {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  text-decoration: none;
  color: rgb(var(--fg-strong));
}
.ac-case-user:hover .ac-case-user-name { color: rgb(var(--info)); }
.ac-case-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 0.3rem;
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 9.5px;
  font-weight: 900;
  letter-spacing: -0.02em;
  color: rgba(255, 255, 255, 0.95);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
  flex-shrink: 0;
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.15),
    inset 0 -6px 8px -6px rgba(0, 0, 0, 0.3);
}
.ac-case-avatar--gone {
  background: rgb(var(--bg-base)) !important;
  color: rgb(var(--fg-faint));
  border: 1px dashed rgb(var(--line-strong));
  box-shadow: none;
}
.ac-case-user-name {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11.5px;
  font-weight: 700;
  transition: color 0.15s;
}
.ac-case-user--gone {
  color: rgb(var(--fg-faint));
  font-style: italic;
}
.ac-case-target {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  color: rgb(var(--fg-muted));
  text-decoration: none;
  max-width: 100%;
  overflow: hidden;
}
.ac-case-target > svg { font-size: 11px; flex-shrink: 0; }
.ac-case-target > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ac-case-target:hover { color: rgb(var(--fg-strong)); }
.ac-case-target--orphan code {
  color: rgb(var(--fg-faint));
  font-size: 10.5px;
}

.ac-case-meta {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
}
.ac-case-time {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  letter-spacing: 0.08em;
  color: rgb(var(--fg-muted));
}
.ac-case-verdict {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.18rem 0.5rem;
  border: 1px solid;
  border-radius: 0.25rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}
.ac-case-verdict--open {
  color: rgb(var(--warning));
  background: rgb(var(--warning) / 0.1);
  border-color: rgb(var(--warning) / 0.45);
}
.ac-case-verdict-dot {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: currentColor;
  animation: fresh-pulse 2s ease-in-out infinite;
}
.ac-case-verdict--clean      { color: rgb(var(--online));  background: rgb(var(--online) / 0.1);  border-color: rgb(var(--online) / 0.45); }
.ac-case-verdict--warned     { color: rgb(var(--warning)); background: rgb(var(--warning) / 0.1); border-color: rgb(var(--warning) / 0.45); }
.ac-case-verdict--banned     { color: rgb(var(--danger));  background: rgb(var(--danger) / 0.1);  border-color: rgb(var(--danger) / 0.45); }
.ac-case-verdict--monitoring { color: rgb(var(--info));    background: rgb(var(--info) / 0.1);    border-color: rgb(var(--info) / 0.45); }

.ac-case-caret {
  color: rgb(var(--fg-muted));
  transition: transform 0.2s;
}
.ac-case-caret.is-flipped { transform: rotate(180deg); }

/* Paper-case-file stamp overlay */
.ac-stamp {
  position: absolute;
  top: 0.6rem;
  right: 1rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 1.05rem;
  font-weight: 900;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  padding: 0.18rem 0.55rem;
  border: 2px solid currentColor;
  border-radius: 0.25rem;
  transform: rotate(-7deg);
  opacity: 0.16;
  pointer-events: none;
  user-select: none;
}
.ac-stamp--clean      { color: rgb(var(--online)); }
.ac-stamp--warned     { color: rgb(var(--warning)); }
.ac-stamp--banned     { color: rgb(var(--danger)); }
.ac-stamp--monitoring { color: rgb(var(--info)); }

/* Body */
.ac-case-body {
  position: relative;
  padding: 0.85rem 1.1rem 1rem;
  border-top: 1px dashed rgb(var(--line-default));
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  animation: case-open 0.22s cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes case-open {
  from { opacity: 0; transform: translateY(-2px); }
  to   { opacity: 1; transform: translateY(0); }
}

.ac-evidence {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0.6rem 1rem;
  margin: 0;
}
.ac-evidence div { min-width: 0; }
.ac-evidence dt {
  margin: 0 0 0.18rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.ac-evidence dd { margin: 0; }
.ac-evidence code {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  color: rgb(var(--fg-default));
  word-break: break-all;
  user-select: all;
}
.ac-evidence-ua {
  font-size: 10.5px !important;
  line-height: 1.4;
  display: inline-block;
}
.ac-faint {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  color: rgb(var(--fg-faint));
}

.ac-raw {
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.35rem;
  background: rgb(var(--bg-inset, var(--bg-base)));
}
.ac-raw summary {
  cursor: pointer;
  padding: 0.5rem 0.75rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  user-select: none;
}
.ac-raw summary:hover { color: rgb(var(--fg-strong)); }
.ac-raw pre {
  margin: 0;
  padding: 0 0.85rem 0.85rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  line-height: 1.5;
  color: rgb(var(--fg-default));
  overflow-x: auto;
  white-space: pre;
}

/* Already-reviewed banner */
.ac-already {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.7rem 0.85rem;
  background: rgb(var(--online) / 0.08);
  border: 1px solid rgb(var(--online) / 0.42);
  border-radius: 0.35rem;
}
.ac-already-icon {
  font-size: 1.3rem;
  color: rgb(var(--online));
  flex-shrink: 0;
}
.ac-already-body { flex: 1; min-width: 0; }
.ac-already-line {
  margin: 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  letter-spacing: 0.06em;
  color: rgb(var(--fg-default));
}
.ac-already-line strong {
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: rgb(var(--online));
}
.ac-already-note {
  margin: 0.3rem 0 0;
  font-size: 12.5px;
  font-style: italic;
  color: rgb(var(--fg-muted));
}
.ac-already-reopen {
  background: transparent;
  border: 1px solid rgb(var(--line-default));
  color: rgb(var(--fg-default));
  border-radius: 0.25rem;
  padding: 0.35rem 0.7rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.ac-already-reopen:hover {
  color: rgb(var(--info));
  border-color: rgb(var(--info) / 0.5);
}

/* Review form — verdict stamps */
.ac-review {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}
.ac-verdicts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 0.5rem;
  border: 0;
  padding: 0;
  margin: 0;
}
.ac-verdicts legend {
  /* Hidden but accessible. */
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.ac-stamp-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  padding: 0.55rem 0.85rem;
  background: rgb(var(--bg-inset, var(--bg-base)));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.3rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s, transform 0.18s;
}
.ac-stamp-btn:hover {
  color: rgb(var(--fg-strong));
  border-color: rgb(var(--fg-default) / 0.35);
  transform: translateY(-1px);
}
.ac-stamp-btn--clean.is-selected      { color: rgb(var(--online));  background: rgb(var(--online) / 0.14);  border-color: rgb(var(--online)); }
.ac-stamp-btn--warned.is-selected     { color: rgb(var(--warning)); background: rgb(var(--warning) / 0.14); border-color: rgb(var(--warning)); }
.ac-stamp-btn--banned.is-selected     { color: rgb(var(--danger));  background: rgb(var(--danger) / 0.14);  border-color: rgb(var(--danger)); }
.ac-stamp-btn--monitoring.is-selected { color: rgb(var(--info));    background: rgb(var(--info) / 0.14);    border-color: rgb(var(--info)); }

.ac-note {
  width: 100%;
  padding: 0.55rem 0.75rem;
  background: rgb(var(--bg-inset, var(--bg-base)));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.35rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
  color: rgb(var(--fg-default));
  resize: vertical;
  outline: 0;
  transition: border-color 0.15s;
}
.ac-note:focus { border-color: rgb(var(--fg-default) / 0.4); }
.ac-note::placeholder { color: rgb(var(--fg-faint)); }

.ac-review-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
.ac-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.55rem 1rem;
  border-radius: 0.3rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  border: 1px solid;
  cursor: pointer;
  transition: background 0.15s, transform 0.18s, opacity 0.15s;
}
.ac-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.ac-btn--ghost {
  background: transparent;
  color: rgb(var(--fg-muted));
  border-color: rgb(var(--line-default));
}
.ac-btn--ghost:hover {
  color: rgb(var(--fg-strong));
  border-color: rgb(var(--fg-default) / 0.35);
}
.ac-btn--primary {
  background: rgb(var(--danger));
  color: #fff;
  border-color: rgb(var(--danger));
  filter: drop-shadow(0 6px 16px rgb(var(--danger) / 0.35));
}
.ac-btn--primary:hover:not(:disabled) {
  filter: brightness(1.08) drop-shadow(0 8px 20px rgb(var(--danger) / 0.45));
  transform: translateY(-1px);
}

/* ╔═══════════════════════════════════════════════════════════════╗
   ║  EMPTY                                                          ║
   ╚═══════════════════════════════════════════════════════════════╝ */
.ac-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.7rem;
  padding: 3rem 1.5rem 3.5rem;
  background:
    radial-gradient(circle at center top, rgb(var(--online) / 0.12), transparent 60%),
    rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-strong));
  border-radius: 0.55rem;
  text-align: center;
}
.ac-empty-radar {
  position: relative;
  width: 5rem;
  height: 5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 0.4rem;
}
.ac-empty-icon {
  position: relative;
  z-index: 1;
  font-size: 2.4rem;
  color: rgb(var(--online));
  filter: drop-shadow(0 0 14px rgb(var(--online) / 0.45));
}
.ac-empty-ring {
  position: absolute;
  inset: 0;
  border: 1px solid rgb(var(--online) / 0.45);
  border-radius: 999px;
  animation: empty-pulse 3.6s ease-out infinite;
}
.ac-empty-ring--2 { animation-delay: 1.2s; }
.ac-empty-ring--3 { animation-delay: 2.4s; }
@keyframes empty-pulse {
  0%   { opacity: 0.6; transform: scale(0.5); }
  90%  { opacity: 0;   transform: scale(2);   }
  100% { opacity: 0;   transform: scale(2);   }
}
.ac-empty-title {
  margin: 0;
  font-family: 'Inter', system-ui, sans-serif;
  font-weight: 800;
  font-size: 1.05rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgb(var(--fg-strong));
}
.ac-empty-sub {
  margin: 0;
  font-size: 13px;
  color: rgb(var(--fg-muted));
  max-width: 42ch;
  line-height: 1.55;
}

/* ╔═══════════════════════════════════════════════════════════════╗
   ║  PAGER                                                          ║
   ╚═══════════════════════════════════════════════════════════════╝ */
.ac-pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.85rem;
  padding-top: 0.5rem;
}
.ac-pager-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 0.85rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.3rem;
  color: rgb(var(--fg-default));
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.ac-pager-btn:hover:not(:disabled) {
  background: rgb(var(--bg-hover, var(--bg-elevated)));
  border-color: rgb(var(--fg-default) / 0.3);
}
.ac-pager-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.ac-pager-pos {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: rgb(var(--fg-muted));
  display: inline-flex;
  align-items: baseline;
  gap: 0.3rem;
}
.ac-pager-cur { color: rgb(var(--fg-strong)); font-size: 14px; }
.ac-pager-sep { opacity: 0.4; }

/* ╔═══════════════════════════════════════════════════════════════╗
   ║  BULK SELECTION                                                ║
   ╚═══════════════════════════════════════════════════════════════╝ */

/* Per-row checkbox — sits in the gutter between the ribbon and the
   case-head grid. Custom mark so it picks up the same kind-tone
   accent as the surrounding row when ticked. */
.ac-case {
  /* Leave room on the left for the absolute-positioned checkbox so
     the case-head grid doesn't have to know about it. */
  padding-left: 2.6rem;
}
.ac-case-select {
  position: absolute;
  top: 1.05rem;
  left: 1rem;
  z-index: 5;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.ac-case-select input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.ac-case-select-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  background: rgb(var(--bg-base));
  border: 1.5px solid rgb(var(--line-strong));
  border-radius: 4px;
  color: transparent;
  transition:
    background 0.18s ease,
    border-color 0.18s ease,
    color 0.18s ease;
}
.ac-case-select-mark > svg,
.ac-case-select-mark > .iconify {
  font-size: 0.85rem;
}
.ac-case-select:hover .ac-case-select-mark {
  border-color: rgb(var(--kind-tone, var(--fg-faint)));
}
.ac-case-select.is-selected .ac-case-select-mark {
  background: rgb(var(--kind-tone, var(--fg-default)));
  border-color: rgb(var(--kind-tone, var(--fg-default)));
  color: rgb(var(--bg-base));
}

/* Select-all toggle in the feed header. */
.ac-select-all {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.7rem;
  background: transparent;
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.3rem;
  color: rgb(var(--fg-muted));
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.01em;
  cursor: pointer;
  transition: all 0.18s ease;
}
.ac-select-all:hover:not(:disabled) {
  color: rgb(var(--fg-strong));
  border-color: rgb(var(--fg-faint));
}
.ac-select-all.is-active {
  color: rgb(var(--accent));
  border-color: rgb(var(--accent) / 0.5);
  background: rgb(var(--accent) / 0.05);
}
.ac-select-all:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ╔═══════════════════════════════════════════════════════════════╗
   ║  BULK ACTION BAR                                               ║
   ╚═══════════════════════════════════════════════════════════════╝ */

.ac-bulkbar {
  position: fixed;
  left: 50%;
  bottom: 1.2rem;
  z-index: 30;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.7rem;
  padding: 0.7rem 0.85rem;
  max-width: calc(100vw - 2rem);
  background: rgb(var(--bg-elevated) / 0.96);
  border: 1px solid rgb(var(--line-strong));
  border-radius: 0.6rem;
  box-shadow:
    0 18px 48px -16px rgba(0, 0, 0, 0.7),
    0 4px 18px -6px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  transform: translateX(-50%);
}
.ac-bulkbar-summary {
  display: inline-flex;
  align-items: baseline;
  gap: 0.4rem;
  padding-right: 0.85rem;
  border-right: 1px solid rgb(var(--line-default));
  color: rgb(var(--fg-default));
}
.ac-bulkbar-count {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 1.15rem;
  font-weight: 800;
  color: rgb(var(--fg-strong));
}
.ac-bulkbar-label {
  font-size: 0.82rem;
  color: rgb(var(--fg-muted));
}

.ac-bulkbar-verdicts {
  display: inline-flex;
  gap: 0.3rem;
}
.ac-bulkbar-verdict {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.45rem 0.7rem;
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.35rem;
  color: rgb(var(--fg-muted));
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.16s ease;
}
.ac-bulkbar-verdict:hover {
  color: rgb(var(--fg-strong));
  border-color: rgb(var(--fg-faint));
}
.ac-bulkbar-verdict.is-selected {
  background: rgb(var(--verdict-tone, var(--accent)));
  border-color: rgb(var(--verdict-tone, var(--accent)));
  color: rgb(var(--bg-base));
}
.ac-bulkbar-verdict--clean       { --verdict-tone: var(--online); }
.ac-bulkbar-verdict--warned      { --verdict-tone: var(--warning); }
.ac-bulkbar-verdict--banned      { --verdict-tone: var(--danger); }
.ac-bulkbar-verdict--monitoring  { --verdict-tone: 125 211 252; }

.ac-bulkbar-note {
  flex: 1;
  min-width: 180px;
  max-width: 280px;
  padding: 0.45rem 0.75rem;
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.35rem;
  color: rgb(var(--fg-default));
  font-size: 0.85rem;
  outline: 0;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}
.ac-bulkbar-note::placeholder {
  color: rgb(var(--fg-faint));
}
.ac-bulkbar-note:focus {
  border-color: rgb(var(--accent));
  box-shadow: 0 0 0 3px rgb(var(--accent) / 0.18);
}

.ac-bulkbar-actions {
  display: inline-flex;
  gap: 0.35rem;
}
.ac-bulkbar-cancel,
.ac-bulkbar-apply {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 0.95rem;
  border-radius: 0.35rem;
  font-size: 0.82rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.18s ease;
}
.ac-bulkbar-cancel {
  background: transparent;
  border: 1px solid rgb(var(--line-default));
  color: rgb(var(--fg-muted));
}
.ac-bulkbar-cancel:hover {
  color: rgb(var(--fg-strong));
  border-color: rgb(var(--fg-faint));
}
.ac-bulkbar-apply {
  background: rgb(var(--accent));
  border: 1px solid rgb(var(--accent));
  color: rgb(var(--accent-fg));
}
.ac-bulkbar-apply:hover:not(:disabled) {
  background: rgb(var(--accent-hover));
  border-color: rgb(var(--accent-hover));
}
.ac-bulkbar-apply:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* Slide-up + fade transition. */
.ac-bulkbar-slide-enter-active,
.ac-bulkbar-slide-leave-active {
  transition:
    transform 0.32s cubic-bezier(0.2, 0.7, 0.2, 1),
    opacity 0.22s ease;
}
.ac-bulkbar-slide-enter-from,
.ac-bulkbar-slide-leave-to {
  transform: translateX(-50%) translateY(28px);
  opacity: 0;
}

@media (max-width: 720px) {
  .ac-bulkbar {
    left: 0.6rem;
    right: 0.6rem;
    max-width: none;
    transform: none;
    bottom: 0.6rem;
  }
  .ac-bulkbar-slide-enter-from,
  .ac-bulkbar-slide-leave-to {
    transform: translateY(28px);
  }
}
</style>
