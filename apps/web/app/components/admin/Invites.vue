<template>
  <!--
    /admin/invites — registrar's ledger.

    The operator does three things here:
      • Hand out invite slots to a specific user (the "grant" block).
      • Read the register of every invite ever emitted, filtered by
        state.
      • Strike a row when a code needs to be invalidated.

    Visual register mirrors the rest of the admin redesigns
    (notifications, bonus rules, upload rules) — numbered blocks,
    gold-thread accents, mono labels — but each invite row reads
    like a postal-stub entry: a `N°XXXX` serial prefix in mono,
    a stamp-tinted code preview, a status pill that looks like a
    postmark, and a discreet "strike" icon at the end.
  -->
  <div class="adm">
    <!-- Intro — keeps the existing i18n with link/action -->
    <i18n-t keypath="admin.invites.intro" tag="p" class="adm-intro">
      <template #link>
        <NuxtLink to="/invites" class="adm-intro-link">{{ $t('admin.invites.introLink') }}</NuxtLink>
      </template>
      <template #action>
        <strong>{{ $t('admin.invites.introAction') }}</strong>
      </template>
    </i18n-t>

    <!-- ── Snapshot strip ─────────────────────────────────────── -->
    <section class="snapshot">
      <article class="snap snap--total">
        <span class="snap-num tabular-nums">{{ stats.total }}</span>
        <span class="snap-label">{{ $t('admin.invites.kpi.totalEmitted') }}</span>
        <Icon name="ph:envelope-simple-bold" class="snap-icon" />
      </article>
      <article class="snap snap--active">
        <span class="snap-num tabular-nums">{{ stats.active }}</span>
        <span class="snap-label">{{ $t('admin.invites.kpi.active') }}</span>
        <span class="snap-sub">{{ $t('admin.invites.kpi.activeSub') }}</span>
        <span class="snap-dot snap-dot--active" />
      </article>
      <article class="snap snap--used">
        <span class="snap-num tabular-nums">{{ stats.used }}</span>
        <span class="snap-label">{{ $t('admin.invites.kpi.used') }}</span>
        <span class="snap-sub">{{ $t('admin.invites.kpi.usedSub') }}</span>
        <span class="snap-dot snap-dot--used" />
      </article>
      <article class="snap snap--expired">
        <span class="snap-num tabular-nums">{{ stats.expired }}</span>
        <span class="snap-label">{{ $t('admin.invites.kpi.expired') }}</span>
        <Icon name="ph:hourglass-low-bold" class="snap-icon" />
      </article>
    </section>

    <!-- ── Section 01 — Grant ────────────────────────────────── -->
    <section class="block">
      <header class="block-head">
        <span class="block-num">01</span>
        <div class="block-id">
          <h2>{{ $t('admin.invites.grant.title') }}</h2>
          <p>{{ $t('admin.invites.grant.intro') }}</p>
        </div>
      </header>

      <div class="grant">
        <div class="grant-search">
          <label class="grant-label">{{ $t('admin.invites.grant.userLabel') }}</label>
          <div class="grant-input-wrap">
            <Icon name="ph:magnifying-glass" class="grant-input-icon" />
            <input
              v-model="grantSearch"
              type="text"
              :placeholder="$t('admin.invites.grant.userPlaceholder')"
              class="grant-input"
              @input="onSearchChange"
              @blur="closeSuggestionsLater"
              @focus="onSearchChange"
            />
            <span v-if="selectedUser" class="grant-chip">
              <Icon name="ph:user-check-fill" />
              {{ selectedUser.username }}
              <button type="button" class="grant-chip-close" @click="clearSelected">
                <Icon name="ph:x-bold" />
              </button>
            </span>
          </div>

          <Transition name="grant-suggest">
            <ul
              v-if="suggestions.length > 0 && suggestionsOpen"
              class="grant-suggestions"
            >
              <li
                v-for="u in suggestions"
                :key="u.id"
                class="grant-suggestion"
                @mousedown.prevent="pickUser(u)"
              >
                <Icon name="ph:user-bold" class="grant-suggestion-icon" />
                <span class="grant-suggestion-name">{{ u.username }}</span>
                <span class="grant-suggestion-quota tabular-nums">
                  {{ $t('admin.invites.grant.suggestionLeft', { n: u.invitesRemaining }) }}
                </span>
              </li>
            </ul>
          </Transition>
        </div>

        <div class="grant-count">
          <label class="grant-label">{{ $t('admin.invites.grant.addLabel') }}</label>
          <input
            v-model.number="grantCount"
            type="number"
            min="1"
            max="100"
            class="grant-count-input tabular-nums"
          />
        </div>

        <button
          type="button"
          class="grant-btn"
          :disabled="!selectedUser || !grantCount || isGranting"
          @click="grantInvites"
        >
          <Icon
            :name="isGranting ? 'ph:circle-notch' : 'ph:plus-bold'"
            :class="isGranting ? 'spin' : ''"
          />
          <span>{{ $t('admin.invites.grant.submit') }}</span>
        </button>
      </div>
    </section>

    <!-- ── Section 02 — Ledger ────────────────────────────────── -->
    <section class="block">
      <header class="block-head">
        <span class="block-num">02</span>
        <div class="block-id">
          <h2>{{ $t('admin.invites.ledger.title') }}</h2>
          <p>{{ $t('admin.invites.ledger.intro') }}</p>
        </div>
        <span class="block-meta">
          <strong>{{ visibleInvites.length }}</strong>
          / {{ stats.total }} {{ $t('admin.invites.ledger.shownOf') }}
        </span>
      </header>

      <div class="ledger-filters">
        <div class="ledger-search">
          <Icon name="ph:magnifying-glass" />
          <input
            v-model="filterText"
            type="text"
            :placeholder="$t('admin.invites.filters.searchPlaceholder')"
          />
          <button
            v-if="filterText"
            type="button"
            class="ledger-search-clear"
            :title="$t('common.clear')"
            @click="filterText = ''"
          >
            <Icon name="ph:x-bold" />
          </button>
        </div>
        <div class="ledger-segments" role="tablist">
          <button
            v-for="opt in STATUS_FILTERS"
            :key="opt.value"
            type="button"
            class="ledger-segment"
            :class="{ 'ledger-segment--active': filterStatus === opt.value }"
            @click="filterStatus = opt.value"
          >
            {{ opt.label }}
            <span
              v-if="opt.value !== 'all'"
              class="ledger-segment-count tabular-nums"
            >
              {{ segmentCount(opt.value) }}
            </span>
          </button>
        </div>
      </div>

      <ul v-if="visibleInvites.length > 0" class="ledger">
        <li
          v-for="(inv, i) in visibleInvites"
          :key="inv.id"
          class="entry"
          :class="`entry--${statusOf(inv)}`"
          :style="{ '--stagger': `${Math.min(i, 12) * 30}ms` }"
        >
          <span class="entry-serial tabular-nums">
            N°{{ serialFor(inv, i) }}
          </span>

          <div class="entry-code-wrap">
            <code class="entry-code" :title="$t('admin.invites.table.codeTitle')">
              {{ inv.codePreview }}
            </code>
          </div>

          <span class="entry-status" :class="`entry-status--${statusOf(inv)}`">
            <Icon :name="statusIcon(inv)" />
            {{ statusLabel(inv) }}
          </span>

          <div class="entry-flow">
            <span class="entry-flow-actor">
              <span class="entry-flow-label">{{ $t('admin.invites.table.issuedBy') }}</span>
              <NuxtLink
                v-if="inv.creator"
                :to="`/users/${inv.creator.id}`"
                class="entry-flow-user"
              >
                @{{ inv.creator.username }}
              </NuxtLink>
              <span v-else class="entry-flow-soft">—</span>
            </span>
            <Icon name="ph:arrow-right-bold" class="entry-flow-arrow" />
            <span class="entry-flow-actor">
              <span class="entry-flow-label">{{ $t('admin.invites.table.usedBy') }}</span>
              <NuxtLink
                v-if="inv.usedByUser"
                :to="`/users/${inv.usedByUser.id}`"
                class="entry-flow-user"
              >
                @{{ inv.usedByUser.username }}
              </NuxtLink>
              <span v-else class="entry-flow-soft">—</span>
            </span>
          </div>

          <div class="entry-dates">
            <span class="entry-date">
              <span class="entry-date-label">{{ $t('admin.invites.table.created') }}</span>
              <span class="entry-date-val tabular-nums">{{ formatDate(inv.createdAt) }}</span>
            </span>
            <span class="entry-date">
              <span class="entry-date-label">{{ $t('admin.invites.table.expires') }}</span>
              <span class="entry-date-val tabular-nums">
                {{ inv.expiresAt ? formatDate(inv.expiresAt) : $t('admin.invites.table.never') }}
              </span>
            </span>
          </div>

          <button
            type="button"
            class="entry-strike"
            :disabled="pendingDelete === inv.id"
            :title="
              statusOf(inv) === 'used'
                ? $t('admin.invites.table.strikeUsedTitle')
                : $t('admin.invites.table.strikeTitle')
            "
            @click="askDelete(inv)"
          >
            <Icon
              :name="pendingDelete === inv.id ? 'ph:circle-notch' : 'ph:trash-bold'"
              :class="pendingDelete === inv.id ? 'spin' : ''"
            />
          </button>
        </li>
      </ul>

      <div v-else class="ledger-empty">
        <Icon name="ph:envelope-open-bold" class="ledger-empty-icon" />
        <p class="ledger-empty-text">{{ $t('admin.invites.noMatch') }}</p>
      </div>

      <!-- Pagination -->
      <div
        v-if="invites?.pagination && invites.pagination.pages > 1"
        class="ledger-pager"
      >
        <button
          type="button"
          class="pager-btn"
          :disabled="page <= 1"
          @click="page--"
        >
          <Icon name="ph:caret-left-bold" />
          {{ $t('admin.invites.pager.prev') }}
        </button>
        <span class="pager-pos tabular-nums">
          {{ page }} / {{ invites.pagination.pages }}
        </span>
        <button
          type="button"
          class="pager-btn"
          :disabled="page >= invites.pagination.pages"
          @click="page++"
        >
          {{ $t('admin.invites.pager.next') }}
          <Icon name="ph:caret-right-bold" />
        </button>
      </div>
    </section>

    <!-- ── Strike confirm modal ──────────────────────────────── -->
    <Modal v-model="confirmOpen" size="sm" :title="$t('admin.invites.confirm.title')">
      <div class="confirm-body">
        <i18n-t keypath="admin.invites.confirm.intro" tag="p" class="confirm-text">
          <template #code>
            <code class="confirm-code">{{ pendingInvite?.codePreview ?? '' }}</code>
          </template>
        </i18n-t>
        <p v-if="pendingInvite" class="confirm-soft">
          <template v-if="pendingInvite.usedBy">
            {{ $t('admin.invites.confirm.alreadyRedeemed') }}
          </template>
          <template v-else-if="willRefund(pendingInvite)">
            {{ $t('admin.invites.confirm.willRefund', { at: '@', username: pendingInvite.creator?.username ?? $t('admin.invites.confirm.willRefundFallback') }) }}
          </template>
          <template v-else>
            {{ $t('admin.invites.confirm.alreadyClosed') }}
          </template>
        </p>
      </div>
      <template #footer>
        <div class="confirm-footer">
          <button type="button" class="btn btn--ghost" @click="confirmOpen = false">
            {{ $t('admin.invites.confirm.keep') }}
          </button>
          <button
            type="button"
            class="btn btn--danger"
            :disabled="pendingDelete !== null"
            @click="confirmDelete"
          >
            <Icon
              :name="pendingDelete ? 'ph:circle-notch' : 'ph:trash-bold'"
              :class="pendingDelete ? 'spin' : ''"
            />
            {{ $t('admin.invites.confirm.strike') }}
          </button>
        </div>
      </template>
    </Modal>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import Modal from '~/components/Modal.vue';
import { useNotificationStore } from '~/stores/notifications';

const { t } = useI18n();

interface UserMini {
  id: string;
  username: string;
  invitesRemaining: number;
}

interface Invitation {
  id: string;
  codePreview: string;
  createdBy: string;
  usedBy: string | null;
  createdAt: string;
  usedAt: string | null;
  expiresAt: string | null;
  creator: { id: string; username: string } | null;
  usedByUser: { id: string; username: string } | null;
}

interface InvitesResponse {
  data: Invitation[];
  pagination: { page: number; limit: number; total: number; pages: number };
  counts: { total: number; active: number; used: number; expired: number };
}

const notifications = useNotificationStore();

// ── Grant form ───────────────────────────────────────────────
const grantSearch = ref('');
const grantCount = ref(2);
const isGranting = ref(false);
const selectedUser = ref<UserMini | null>(null);
const suggestions = ref<UserMini[]>([]);
const suggestionsOpen = ref(false);

let searchTimer: ReturnType<typeof setTimeout> | null = null;

async function fetchSuggestions(q: string) {
  if (!q.trim()) {
    suggestions.value = [];
    return;
  }
  try {
    // /api/admin/users was refactored to return `items` (not
    // `data`) and accept `pageSize` (not `limit`). The previous
    // call still used the old contract so the autocomplete
    // silently swallowed `undefined.map(...)` in the catch block
    // below and showed nothing. The shape changed without the
    // typed response on this call being updated.
    const res = await $fetch<{
      items: { id: string; username: string; invitesRemaining: number }[];
    }>('/api/admin/users', {
      query: { search: q, pageSize: 5 },
    });
    suggestions.value = (res.items ?? []).map((u) => ({
      id: u.id,
      username: u.username,
      invitesRemaining: u.invitesRemaining ?? 0,
    }));
  } catch {
    suggestions.value = [];
  }
}

function onSearchChange() {
  selectedUser.value = null;
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    fetchSuggestions(grantSearch.value);
    suggestionsOpen.value = true;
  }, 180);
}

function pickUser(u: UserMini) {
  selectedUser.value = u;
  grantSearch.value = u.username;
  suggestionsOpen.value = false;
}

function clearSelected() {
  selectedUser.value = null;
  grantSearch.value = '';
}

function closeSuggestionsLater() {
  setTimeout(() => {
    suggestionsOpen.value = false;
  }, 120);
}

async function grantInvites() {
  if (!selectedUser.value || !grantCount.value) return;
  isGranting.value = true;
  try {
    await $fetch('/api/admin/invites/grant', {
      method: 'POST',
      body: { userId: selectedUser.value.id, count: grantCount.value },
    });
    notifications.success(
      t(
        'admin.invites.toasts.granted',
        { count: grantCount.value, at: '@', username: selectedUser.value.username },
        grantCount.value,
      ),
    );
    clearSelected();
    grantCount.value = 2;
    await refresh();
  } catch (err: unknown) {
    notifications.error(
      (err as { data?: { message?: string } })?.data?.message ??
        t('admin.invites.errors.grantFailed'),
    );
  } finally {
    isGranting.value = false;
  }
}

// ── Ledger ──────────────────────────────────────────────────
const page = ref(1);
const filterStatus = ref<'all' | 'active' | 'used' | 'expired'>('all');
const filterText = ref('');

// Debounced copy of the search input. The server query is keyed off
// this debounced value so we don't fire a request on every keystroke;
// 250 ms gives the user enough room to keep typing without a flash
// of "no match" between strokes.
const debouncedSearch = ref('');
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
watch(filterText, (next) => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    debouncedSearch.value = next.trim();
    page.value = 1;
  }, 250);
});

// Reset to page 1 whenever the status filter changes — otherwise we
// can end up on a page that doesn't exist for the new filter.
watch(filterStatus, () => {
  page.value = 1;
});

const STATUS_FILTERS = computed(() => [
  { value: 'all' as const, label: t('admin.invites.filters.all') },
  { value: 'active' as const, label: t('admin.invites.filters.active') },
  { value: 'used' as const, label: t('admin.invites.filters.used') },
  { value: 'expired' as const, label: t('admin.invites.filters.expired') },
]);

const { data: invites, refresh } = await useFetch<InvitesResponse>(
  '/api/admin/invites',
  {
    query: computed(() => ({
      page: page.value,
      status: filterStatus.value,
      search: debouncedSearch.value || undefined,
    })),
  },
);

type Status = 'active' | 'used' | 'expired';

function statusOf(inv: Invitation): Status {
  if (inv.usedBy) return 'used';
  if (inv.expiresAt && new Date(inv.expiresAt).getTime() <= Date.now())
    return 'expired';
  return 'active';
}
function statusLabel(inv: Invitation): string {
  return {
    active: t('admin.invites.status.active'),
    used: t('admin.invites.status.used'),
    expired: t('admin.invites.status.expired'),
  }[statusOf(inv)];
}
function statusIcon(inv: Invitation): string {
  return {
    active: 'ph:hourglass-medium-bold',
    used: 'ph:check-fat-fill',
    expired: 'ph:clock-counter-clockwise-bold',
  }[statusOf(inv)];
}

// The server already filters by status + search, so the visible
// list is just whatever the current page returned. Kept as a
// computed (rather than reading `invites.value?.data` directly in
// the template) so future client-side post-filters can slot in here
// without restructuring the template.
const visibleInvites = computed(() => invites.value?.data ?? []);

/**
 * Tab badge counts come from the API's `counts` object — which
 * applies the search filter but ignores the status filter, so
 * switching between Active / Used / Expired always sees the right
 * number for each bucket.
 */
function segmentCount(status: 'active' | 'used' | 'expired'): number {
  return invites.value?.counts?.[status] ?? 0;
}

const stats = computed(() => {
  const c = invites.value?.counts;
  return {
    total: c?.total ?? 0,
    active: c?.active ?? 0,
    used: c?.used ?? 0,
    expired: c?.expired ?? 0,
  };
});

/**
 * Serial number for an entry. Uses (page-1)*pageSize + index + 1
 * so the numbering is stable across pages. Padded to 4 digits so
 * the mono column doesn't jitter as totals grow.
 */
function serialFor(inv: Invitation, idx: number): string {
  const limit = invites.value?.pagination.limit ?? 25;
  const offset = (page.value - 1) * limit;
  return String(offset + idx + 1).padStart(4, '0');
}

function formatDate(d: string) {
  return new Date(d).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── Strike flow ────────────────────────────────────────────
const confirmOpen = ref(false);
const pendingInvite = ref<Invitation | null>(null);
const pendingDelete = ref<string | null>(null);

function willRefund(inv: Invitation): boolean {
  return statusOf(inv) === 'active';
}
function askDelete(inv: Invitation) {
  pendingInvite.value = inv;
  confirmOpen.value = true;
}
async function confirmDelete() {
  if (!pendingInvite.value) return;
  pendingDelete.value = pendingInvite.value.id;
  try {
    const res = await $fetch<{
      success: true;
      refunded: boolean;
      wasUsed: boolean;
    }>(`/api/admin/invites/${pendingInvite.value.id}`, { method: 'DELETE' });
    confirmOpen.value = false;
    pendingInvite.value = null;
    await refresh();
    notifications.success(
      res.wasUsed
        ? t('admin.invites.toasts.struckRecipientUnaffected')
        : res.refunded
          ? t('admin.invites.toasts.struckRefunded')
          : t('admin.invites.toasts.struck'),
    );
  } catch (err: unknown) {
    notifications.error(
      (err as { data?: { message?: string } })?.data?.message ??
        t('admin.invites.errors.strikeFailed'),
    );
  } finally {
    pendingDelete.value = null;
  }
}
</script>

<style scoped>
/* ── Page shell ─────────────────────────────────────────────── */
.adm {
  display: flex;
  flex-direction: column;
  gap: 2.25rem;
  position: relative;
}
.adm::before {
  content: '';
  position: absolute;
  left: -0.75rem;
  top: 0;
  bottom: 0;
  width: 1px;
  background: linear-gradient(
    to bottom,
    rgba(212, 167, 52, 0) 0%,
    rgba(212, 167, 52, 0.35) 12%,
    rgba(212, 167, 52, 0.35) 88%,
    rgba(212, 167, 52, 0) 100%
  );
  pointer-events: none;
}

.adm-intro {
  margin: 0;
  font-size: 0.82rem;
  line-height: 1.6;
  color: rgb(var(--fg-muted));
  max-width: 64ch;
}
.adm-intro-link {
  color: #d4a734;
  text-decoration: underline;
  text-decoration-color: rgba(212, 167, 52, 0.5);
  text-underline-offset: 3px;
  transition: text-decoration-color 0.18s ease;
}
.adm-intro-link:hover {
  text-decoration-color: #d4a734;
}
.adm-intro strong {
  color: rgb(var(--fg-strong));
  font-weight: 700;
}

/* ── Snapshot strip ─────────────────────────────────────────── */
.snapshot {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  background: rgb(var(--bg-elevated));
  overflow: hidden;
  position: relative;
}
.snapshot::before {
  content: '';
  position: absolute;
  inset-inline: 1rem;
  top: 0;
  height: 1px;
  background: linear-gradient(
    to right,
    rgba(212, 167, 52, 0.55) 0%,
    rgba(212, 167, 52, 0.2) 60%,
    rgba(212, 167, 52, 0) 100%
  );
}
@media (max-width: 720px) {
  .snapshot { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
.snap {
  position: relative;
  padding: 1.1rem 1.2rem 1.2rem;
  border-right: 1px solid rgb(var(--line-default));
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.snap:last-child { border-right: 0; }
@media (max-width: 720px) {
  .snap { border-bottom: 1px solid rgb(var(--line-default)); }
  .snap:nth-child(2n) { border-right: 0; }
  .snap:nth-last-child(-n + 2) { border-bottom: 0; }
}
.snap-num {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: clamp(1.6rem, 3vw, 2.1rem);
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1;
  color: rgb(var(--fg-strong));
}
.snap--total .snap-num { color: #d4a734; }
.snap--active .snap-num { color: #d4a734; }
.snap--used .snap-num { color: rgb(var(--online)); }
.snap--expired .snap-num { color: rgb(var(--fg-muted)); }

.snap-label {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.snap-sub {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgb(var(--fg-faint));
}
.snap-icon {
  position: absolute;
  top: 1rem;
  right: 1rem;
  font-size: 1.1rem;
  color: rgb(var(--fg-faint));
}
.snap-dot {
  position: absolute;
  top: 1.35rem;
  right: 1.2rem;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.snap-dot--active {
  background: #d4a734;
  box-shadow: 0 0 0 4px rgba(212, 167, 52, 0.18);
}
.snap-dot--used {
  background: rgb(var(--online));
  box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.18);
}

/* ── Block scaffolding ──────────────────────────────────────── */
.block {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.block-head {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.85rem;
  padding-bottom: 0.85rem;
  border-bottom: 1px solid rgb(var(--line-default));
  position: relative;
}
.block-head::after {
  content: '';
  position: absolute;
  left: 0;
  bottom: -1px;
  width: 40px;
  height: 1px;
  background: #d4a734;
}
.block-num {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.2em;
  color: #d4a734;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgba(212, 167, 52, 0.35);
  padding: 0.3rem 0.55rem;
  border-radius: var(--radius-sm);
}
.block-id h2 {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
}
.block-id p {
  margin: 0.2rem 0 0;
  font-size: 0.78rem;
  color: rgb(var(--fg-muted));
  line-height: 1.5;
}
.block-meta {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  letter-spacing: 0.1em;
  color: rgb(var(--fg-muted));
  text-transform: uppercase;
}
.block-meta strong {
  color: rgb(var(--fg-strong));
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

/* ── Grant block ────────────────────────────────────────────── */
.grant {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) 96px auto;
  gap: 0.85rem;
  align-items: end;
  padding: 1.1rem 1.2rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  background: rgb(var(--bg-elevated));
  position: relative;
}
@media (max-width: 720px) {
  .grant { grid-template-columns: 1fr; }
}
.grant-label {
  display: block;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  margin-bottom: 0.35rem;
}
.grant-search { position: relative; }
.grant-input-wrap {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0 0.65rem;
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}
.grant-input-wrap:focus-within {
  border-color: rgba(212, 167, 52, 0.6);
  box-shadow: 0 0 0 3px rgba(212, 167, 52, 0.12);
}
.grant-input-icon { color: rgb(var(--fg-muted)); flex-shrink: 0; }
.grant-input {
  flex: 1;
  border: 0;
  background: transparent;
  padding: 0.55rem 0;
  color: rgb(var(--fg-strong));
  font-size: 0.86rem;
  outline: none;
  font-family: inherit;
  min-width: 0;
}
.grant-input::placeholder {
  color: rgb(var(--fg-faint));
  font-style: italic;
}
.grant-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.2rem 0.5rem;
  background: rgba(212, 167, 52, 0.12);
  border: 1px solid rgba(212, 167, 52, 0.4);
  color: #d4a734;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}
.grant-chip-close {
  display: inline-flex;
  align-items: center;
  border: 0;
  padding: 0;
  background: transparent;
  color: #d4a734;
  cursor: pointer;
  opacity: 0.75;
  transition: opacity 0.16s ease;
}
.grant-chip-close:hover { opacity: 1; }

.grant-suggestions {
  position: absolute;
  top: calc(100% + 5px);
  left: 0;
  right: 0;
  z-index: 30;
  list-style: none;
  margin: 0;
  padding: 0.25rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgba(212, 167, 52, 0.35);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-overlay);
  max-height: 240px;
  overflow-y: auto;
}
.grant-suggestion {
  display: grid;
  grid-template-columns: 18px 1fr auto;
  gap: 0.55rem;
  align-items: center;
  padding: 0.5rem 0.65rem;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.14s ease;
}
.grant-suggestion:hover { background: rgb(var(--bg-hover) / 0.5); }
.grant-suggestion-icon { color: rgb(var(--fg-muted)); font-size: 0.9rem; }
.grant-suggestion-name {
  font-size: 0.85rem;
  font-weight: 600;
  color: rgb(var(--fg-strong));
}
.grant-suggestion-quota {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  letter-spacing: 0.08em;
  color: rgb(var(--fg-muted));
  text-transform: uppercase;
}

.grant-suggest-enter-active,
.grant-suggest-leave-active {
  transition: opacity 0.18s ease, transform 0.22s ease;
}
.grant-suggest-enter-from,
.grant-suggest-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.grant-count-input {
  width: 100%;
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  padding: 0.55rem 0.65rem;
  color: rgb(var(--fg-strong));
  font-size: 0.95rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-weight: 600;
  text-align: center;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}
.grant-count-input:focus {
  outline: none;
  border-color: rgba(212, 167, 52, 0.6);
  box-shadow: 0 0 0 3px rgba(212, 167, 52, 0.12);
}

.grant-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  padding: 0.6rem 1.05rem;
  background: #d4a734;
  border: 1px solid #d4a734;
  color: #1a1a1a;
  border-radius: var(--radius-sm);
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.15s ease;
}
.grant-btn:hover:not(:disabled) {
  background: #e8b94e;
  border-color: #e8b94e;
}
.grant-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* ── Ledger filters ────────────────────────────────────────── */
.ledger-filters {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
  align-items: center;
}
.ledger-search {
  flex: 1;
  min-width: 240px;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0 0.7rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  transition: border-color 0.18s ease;
}
.ledger-search:focus-within {
  border-color: rgba(212, 167, 52, 0.5);
}
.ledger-search > svg { color: rgb(var(--fg-muted)); flex-shrink: 0; }
.ledger-search input {
  flex: 1;
  border: 0;
  background: transparent;
  padding: 0.55rem 0;
  color: rgb(var(--fg-strong));
  font-size: 0.85rem;
  outline: none;
  font-family: inherit;
  min-width: 0;
}
.ledger-search input::placeholder {
  color: rgb(var(--fg-faint));
  font-style: italic;
}
.ledger-search-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 0;
  color: rgb(var(--fg-muted));
  cursor: pointer;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-sm);
  transition: all 0.15s ease;
}
.ledger-search-clear:hover { color: rgb(var(--fg-strong)); background: rgb(var(--bg-hover) / 0.5); }

.ledger-segments {
  display: inline-flex;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  padding: 3px;
  gap: 2px;
}
.ledger-segment {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background: transparent;
  border: 0;
  padding: 0.4rem 0.75rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  border-radius: calc(var(--radius-sm) - 1px);
  cursor: pointer;
  transition: all 0.16s ease;
}
.ledger-segment:hover { color: rgb(var(--fg-strong)); }
.ledger-segment--active {
  background: rgb(var(--bg-base));
  color: #d4a734;
  box-shadow: inset 0 0 0 1px rgba(212, 167, 52, 0.4);
}
.ledger-segment-count {
  font-size: 10px;
  font-weight: 700;
  color: rgb(var(--fg-faint));
  padding: 0.1rem 0.35rem;
  background: rgb(var(--bg-base) / 0.4);
  border-radius: 999px;
  letter-spacing: 0.04em;
}
.ledger-segment--active .ledger-segment-count {
  color: #d4a734;
  background: rgba(212, 167, 52, 0.1);
}

/* ── Ledger entries ────────────────────────────────────────── */
.ledger {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  background: rgb(var(--bg-elevated));
  overflow: hidden;
}
.entry {
  display: grid;
  grid-template-columns: auto auto auto minmax(0, 1.4fr) auto auto;
  align-items: center;
  gap: 0.85rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid rgb(var(--line-default));
  transition: background 0.16s ease;
  animation: entry-in 0.32s cubic-bezier(0.2, 0.7, 0.2, 1) backwards;
  animation-delay: var(--stagger, 0ms);
}
.entry:last-child { border-bottom: 0; }
.entry:hover { background: rgb(var(--bg-hover) / 0.3); }
@keyframes entry-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

.entry-serial {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: rgb(var(--fg-faint));
  white-space: nowrap;
}

.entry-code-wrap {
  display: flex;
  align-items: center;
}
.entry-code {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  padding: 0.3rem 0.55rem;
  background: rgb(var(--bg-inset));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  color: rgb(var(--fg-strong));
  letter-spacing: 0.04em;
  white-space: nowrap;
}
.entry--active .entry-code {
  border-color: rgba(212, 167, 52, 0.4);
  background: rgba(212, 167, 52, 0.05);
}
.entry--used .entry-code {
  border-color: rgba(34, 197, 94, 0.35);
  background: rgba(34, 197, 94, 0.05);
}

.entry-status {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  padding: 0.22rem 0.55rem;
  border-radius: 999px;
  border: 1px solid currentColor;
  white-space: nowrap;
}
.entry-status--active {
  color: #d4a734;
  background: rgba(212, 167, 52, 0.08);
}
.entry-status--used {
  color: rgb(var(--online));
  background: rgba(34, 197, 94, 0.06);
}
.entry-status--expired {
  color: rgb(var(--fg-muted));
  background: rgb(var(--bg-base) / 0.4);
}

.entry-flow {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
}
.entry-flow-actor {
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
  min-width: 0;
}
.entry-flow-label {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 8.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgb(var(--fg-faint));
}
.entry-flow-user {
  font-size: 0.82rem;
  font-weight: 600;
  color: #d4a734;
  text-decoration: none;
  border-bottom: 1px dashed rgba(212, 167, 52, 0.4);
  transition: border-color 0.16s ease;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.entry-flow-user:hover { border-color: #d4a734; }
.entry-flow-soft {
  font-size: 0.82rem;
  color: rgb(var(--fg-faint));
}
.entry-flow-arrow {
  color: rgb(var(--fg-faint));
  font-size: 0.85rem;
  flex-shrink: 0;
}

.entry-dates {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  text-align: right;
}
.entry-date {
  display: inline-flex;
  align-items: baseline;
  gap: 0.4rem;
  justify-content: flex-end;
}
.entry-date-label {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 8.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgb(var(--fg-faint));
}
.entry-date-val {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  color: rgb(var(--fg-strong));
}

.entry-strike {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: transparent;
  border: 1px solid transparent;
  color: rgb(var(--fg-muted));
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s ease;
}
.entry-strike:hover:not(:disabled) {
  color: rgb(var(--danger));
  border-color: rgba(239, 68, 68, 0.4);
  background: rgba(239, 68, 68, 0.06);
}
.entry-strike:disabled { opacity: 0.5; cursor: not-allowed; }

@media (max-width: 980px) {
  .entry {
    grid-template-columns: auto auto auto 1fr;
    grid-template-rows: auto auto;
    row-gap: 0.4rem;
  }
  .entry-serial { grid-row: 1; }
  .entry-code-wrap { grid-row: 1; }
  .entry-status { grid-row: 1; }
  .entry-flow { grid-row: 2; grid-column: 1 / span 3; }
  .entry-dates { grid-row: 2; grid-column: 4; }
  .entry-strike { grid-row: 1; grid-column: 4; justify-self: end; }
}
@media (max-width: 640px) {
  .entry {
    grid-template-columns: 1fr auto;
    row-gap: 0.5rem;
  }
  .entry-serial { grid-row: 1; grid-column: 1; }
  .entry-status { grid-row: 1; grid-column: 2; }
  .entry-code-wrap { grid-row: 2; grid-column: 1 / -1; }
  .entry-flow {
    grid-row: 3;
    grid-column: 1 / -1;
    flex-wrap: wrap;
  }
  .entry-dates {
    grid-row: 4;
    grid-column: 1 / -1;
    flex-direction: row;
    flex-wrap: wrap;
    text-align: left;
    gap: 0.85rem;
  }
  .entry-strike {
    grid-row: 1;
    grid-column: 2;
    justify-self: end;
    margin-left: 0.5rem;
  }
}

/* ── Empty + pager ─────────────────────────────────────────── */
.ledger-empty {
  display: grid;
  place-items: center;
  gap: 0.55rem;
  padding: 3rem 1rem;
  border: 1px dashed rgb(var(--line-default));
  border-radius: var(--radius-md);
  text-align: center;
}
.ledger-empty-icon {
  font-size: 2rem;
  color: rgb(var(--fg-faint));
}
.ledger-empty-text {
  margin: 0;
  font-size: 0.85rem;
  color: rgb(var(--fg-muted));
  font-style: italic;
  max-width: 36ch;
}

.ledger-pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
}
.pager-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.4rem 0.75rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  color: rgb(var(--fg-strong));
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: all 0.15s ease;
}
.pager-btn:hover:not(:disabled) {
  border-color: rgba(212, 167, 52, 0.5);
  color: #d4a734;
}
.pager-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.pager-pos {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  color: rgb(var(--fg-muted));
  letter-spacing: 0.08em;
}

/* ── Confirm modal ─────────────────────────────────────────── */
.confirm-body { padding: 1.25rem 1.5rem; }
.confirm-text {
  margin: 0;
  font-size: 0.92rem;
  color: rgb(var(--fg-strong));
  line-height: 1.6;
}
.confirm-text strong { color: rgb(var(--fg-strong)); font-weight: 700; }
.confirm-code {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  background: rgb(var(--bg-inset));
  border: 1px solid rgb(var(--line-default));
  padding: 0.18rem 0.45rem;
  border-radius: var(--radius-sm);
  margin: 0 0.15rem;
}
.confirm-soft {
  margin: 0.85rem 0 0;
  font-size: 0.82rem;
  color: rgb(var(--fg-muted));
  line-height: 1.55;
}
.confirm-soft strong {
  color: rgb(var(--fg-strong));
  font-weight: 700;
}
.confirm-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.45rem;
  padding: 0.9rem 1.5rem;
  border-top: 1px solid rgb(var(--line-default));
}

/* ── Buttons ─────────────────────────────────────────────── */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.95rem;
  border-radius: var(--radius-sm);
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-base));
  color: rgb(var(--fg-strong));
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: inherit;
}
.btn:hover:not(:disabled) {
  border-color: rgba(212, 167, 52, 0.5);
  background: rgba(212, 167, 52, 0.05);
}
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn--ghost { background: transparent; }
.btn--danger {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.5);
  color: rgb(var(--danger));
}
.btn--danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.18);
  border-color: rgb(var(--danger));
}

.spin {
  animation: inv-spin 1s linear infinite;
}
@keyframes inv-spin {
  to { transform: rotate(360deg); }
}
</style>
