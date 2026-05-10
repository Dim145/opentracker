<template>
  <div class="card">
    <div class="card-header">
      <div class="flex items-center gap-2">
        <Icon name="ph:envelope-simple-bold" class="text-text-muted" />
        <h3 class="text-xs font-bold uppercase tracking-wider text-text-primary">
          {{ $t('admin.invites.title') }}
        </h3>
      </div>
    </div>

    <div class="card-body">
      <i18n-t keypath="admin.invites.intro" tag="p" class="text-xs text-text-muted leading-relaxed mb-5">
        <template #link>
          <NuxtLink to="/invites" class="text-accent underline-offset-2 underline">{{ $t('admin.invites.introLink') }}</NuxtLink>
        </template>
        <template #action>
          <strong>{{ $t('admin.invites.introAction') }}</strong>
        </template>
      </i18n-t>

      <!-- ── Grant section ─────────────────────────────── -->
      <div class="grant-panel">
        <div class="grant-panel-row">
          <div class="grant-panel-search">
            <label class="grant-panel-label">{{ $t('admin.invites.grant.userLabel') }}</label>
            <div class="grant-panel-input-wrap">
              <Icon name="ph:magnifying-glass" class="grant-panel-input-icon" />
              <input
                v-model="grantSearch"
                type="text"
                :placeholder="$t('admin.invites.grant.userPlaceholder')"
                class="grant-panel-input"
                @input="onSearchChange"
                @blur="closeSuggestionsLater"
                @focus="onSearchChange"
              />
              <span v-if="selectedUser" class="grant-panel-input-chip">
                <Icon name="ph:user-check-fill" />
                {{ selectedUser.username }}
                <button type="button" class="grant-panel-input-chip-close" @click="clearSelected">
                  <Icon name="ph:x-bold" />
                </button>
              </span>
            </div>

            <ul
              v-if="suggestions.length > 0 && suggestionsOpen"
              class="grant-panel-suggestions"
            >
              <li
                v-for="u in suggestions"
                :key="u.id"
                class="grant-panel-suggestion"
                @mousedown.prevent="pickUser(u)"
              >
                <Icon name="ph:user" />
                <span class="grant-panel-suggestion-name">{{ u.username }}</span>
                <span class="grant-panel-suggestion-quota">
                  {{ $t('admin.invites.grant.suggestionLeft', { n: u.invitesRemaining }) }}
                </span>
              </li>
            </ul>
          </div>

          <div class="grant-panel-count">
            <label class="grant-panel-label">{{ $t('admin.invites.grant.addLabel') }}</label>
            <input
              v-model.number="grantCount"
              type="number"
              min="1"
              max="100"
              class="grant-panel-count-input"
            />
          </div>

          <button
            type="button"
            class="grant-panel-btn"
            :disabled="!selectedUser || !grantCount || isGranting"
            @click="grantInvites"
          >
            <Icon
              v-if="isGranting"
              name="ph:circle-notch"
              class="animate-spin"
            />
            <Icon v-else name="ph:plus-bold" />
            <span>{{ $t('admin.invites.grant.submit') }}</span>
          </button>
        </div>
      </div>

      <!-- ── KPIs ──────────────────────────────────────── -->
      <ul class="kpi-strip" :class="{ 'kpi-strip--loading': !invites }">
        <li class="kpi kpi--total">
          <span class="kpi-label">{{ $t('admin.invites.kpi.totalEmitted') }}</span>
          <span class="kpi-value">{{ stats.total }}</span>
        </li>
        <li class="kpi kpi--accent">
          <span class="kpi-label">
            <span class="kpi-dot kpi-dot--accent" />
            {{ $t('admin.invites.kpi.active') }}
          </span>
          <span class="kpi-value">{{ stats.active }}</span>
          <span class="kpi-sub">{{ $t('admin.invites.kpi.activeSub') }}</span>
        </li>
        <li class="kpi kpi--success">
          <span class="kpi-label">
            <span class="kpi-dot kpi-dot--success" />
            {{ $t('admin.invites.kpi.used') }}
          </span>
          <span class="kpi-value">{{ stats.used }}</span>
          <span class="kpi-sub">{{ $t('admin.invites.kpi.usedSub') }}</span>
        </li>
        <li class="kpi kpi--muted">
          <span class="kpi-label">{{ $t('admin.invites.kpi.expired') }}</span>
          <span class="kpi-value">{{ stats.expired }}</span>
        </li>
      </ul>

      <!-- ── Filters ───────────────────────────────────── -->
      <div class="invite-filters">
        <div class="invite-filter-search">
          <Icon name="ph:magnifying-glass" />
          <input
            v-model="filterText"
            type="text"
            :placeholder="$t('admin.invites.filters.searchPlaceholder')"
          />
        </div>
        <div class="invite-filter-segments" role="tablist">
          <button
            v-for="opt in STATUS_FILTERS"
            :key="opt.value"
            type="button"
            class="invite-filter-segment"
            :class="{ 'invite-filter-segment--active': filterStatus === opt.value }"
            @click="filterStatus = opt.value"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>

      <!-- ── Invites table ─────────────────────────────── -->
      <div v-if="visibleInvites.length > 0" class="invite-table-wrap">
        <table class="invite-table">
          <thead>
            <tr>
              <th>{{ $t('admin.invites.table.code') }}</th>
              <th>{{ $t('admin.invites.table.status') }}</th>
              <th>{{ $t('admin.invites.table.issuedBy') }}</th>
              <th>{{ $t('admin.invites.table.usedBy') }}</th>
              <th>{{ $t('admin.invites.table.created') }}</th>
              <th>{{ $t('admin.invites.table.expires') }}</th>
              <th class="invite-table-action-col" :aria-label="$t('common.actions')"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="inv in visibleInvites" :key="inv.id">
              <td>
                <code
                  class="invite-table-code invite-table-code--readonly"
                  :title="$t('admin.invites.table.codeTitle')"
                >
                  {{ inv.codePreview }}
                </code>
              </td>
              <td>
                <span class="invite-table-status" :class="`invite-table-status--${statusOf(inv)}`">
                  <Icon :name="statusIcon(inv)" />
                  {{ statusLabel(inv) }}
                </span>
              </td>
              <td>
                <NuxtLink
                  v-if="inv.creator"
                  :to="`/users/${inv.creator.id}`"
                  class="invite-table-user"
                >
                  @{{ inv.creator.username }}
                </NuxtLink>
                <span v-else class="invite-table-soft">—</span>
              </td>
              <td>
                <NuxtLink
                  v-if="inv.usedByUser"
                  :to="`/users/${inv.usedByUser.id}`"
                  class="invite-table-user"
                >
                  @{{ inv.usedByUser.username }}
                </NuxtLink>
                <span v-else class="invite-table-soft">—</span>
              </td>
              <td class="invite-table-mono">{{ formatDate(inv.createdAt) }}</td>
              <td class="invite-table-mono">
                {{ inv.expiresAt ? formatDate(inv.expiresAt) : $t('admin.invites.table.never') }}
              </td>
              <td class="invite-table-action-cell">
                <button
                  type="button"
                  class="invite-table-action"
                  :disabled="pendingDelete === inv.id"
                  :title="
                    statusOf(inv) === 'used'
                      ? $t('admin.invites.table.strikeUsedTitle')
                      : $t('admin.invites.table.strikeTitle')
                  "
                  @click="askDelete(inv)"
                >
                  <Icon
                    :name="pendingDelete === inv.id ? 'ph:circle-notch' : 'ph:trash'"
                    :class="{ 'animate-spin': pendingDelete === inv.id }"
                  />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p v-else class="text-xs text-text-muted text-center py-8">
        {{ $t('admin.invites.noMatch') }}
      </p>

      <!-- ── Confirm strike modal ─────────────────────── -->
      <Modal v-model="confirmOpen" size="sm" :title="$t('admin.invites.confirm.title')">
        <div class="invite-confirm-body">
          <i18n-t keypath="admin.invites.confirm.intro" tag="p" class="invite-confirm-text">
            <template #code>
              <code class="invite-confirm-code">{{ pendingInvite?.codePreview ?? '' }}</code>
            </template>
          </i18n-t>
          <p v-if="pendingInvite" class="invite-confirm-soft">
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
          <div class="invite-confirm-footer">
            <button
              type="button"
              class="btn btn-secondary !px-3 !py-1.5 text-xs"
              @click="confirmOpen = false"
            >
              {{ $t('admin.invites.confirm.keep') }}
            </button>
            <button
              type="button"
              class="btn btn-danger !px-3 !py-1.5 text-xs"
              :disabled="pendingDelete !== null"
              @click="confirmDelete"
            >
              <Icon
                :name="pendingDelete ? 'ph:circle-notch' : 'ph:trash'"
                :class="{ 'animate-spin': pendingDelete, 'mr-1': true }"
              />
              {{ $t('admin.invites.confirm.strike') }}
            </button>
          </div>
        </template>
      </Modal>

      <!-- ── Pagination ────────────────────────────────── -->
      <div
        v-if="invites?.pagination && invites.pagination.pages > 1"
        class="invite-pagination"
      >
        <button
          type="button"
          class="btn btn-secondary !px-3 !py-1 text-[10px]"
          :disabled="page <= 1"
          @click="page--"
        >
          <Icon name="ph:caret-left" /> {{ $t('admin.invites.pager.prev') }}
        </button>
        <span class="text-xs text-text-muted self-center">
          {{ page }} / {{ invites.pagination.pages }}
        </span>
        <button
          type="button"
          class="btn btn-secondary !px-3 !py-1 text-[10px]"
          :disabled="page >= invites.pagination.pages"
          @click="page++"
        >
          {{ $t('admin.invites.pager.next') }} <Icon name="ph:caret-right" />
        </button>
      </div>
    </div>
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
  // Masked partial of the code. The full value is **never** exposed
  // to admins (see /api/admin/invites for the rationale) so we don't
  // even type a `code` field here.
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
    const res = await $fetch<{
      data: { id: string; username: string; invitesRemaining: number }[];
    }>('/api/admin/users', {
      query: { search: q, limit: 5 },
    });
    suggestions.value = res.data.map((u) => ({
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
  // Slight delay so the @mousedown on a suggestion still fires first.
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
      t('admin.invites.toasts.granted', { count: grantCount.value, at: '@', username: selectedUser.value.username }, grantCount.value)
    );
    clearSelected();
    grantCount.value = 2;
    await refresh();
  } catch (err: unknown) {
    notifications.error(
      (err as { data?: { message?: string } })?.data?.message ??
        t('admin.invites.errors.grantFailed')
    );
  } finally {
    isGranting.value = false;
  }
}

// ── Listing ──────────────────────────────────────────────────
const page = ref(1);
const filterStatus = ref<'all' | 'active' | 'used' | 'expired'>('all');
const filterText = ref('');

const STATUS_FILTERS = computed(() => [
  { value: 'all' as const, label: t('admin.invites.filters.all') },
  { value: 'active' as const, label: t('admin.invites.filters.active') },
  { value: 'used' as const, label: t('admin.invites.filters.used') },
  { value: 'expired' as const, label: t('admin.invites.filters.expired') },
]);

const { data: invites, refresh } = await useFetch<InvitesResponse>(
  '/api/admin/invites',
  {
    query: computed(() => ({ page: page.value })),
  }
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
    active: 'ph:hourglass-medium',
    used: 'ph:check-fat',
    expired: 'ph:clock-counter-clockwise',
  }[statusOf(inv)];
}

const visibleInvites = computed(() => {
  const list = invites.value?.data ?? [];
  const text = filterText.value.trim().toLowerCase();
  return list.filter((inv) => {
    if (filterStatus.value !== 'all' && statusOf(inv) !== filterStatus.value)
      return false;
    if (!text) return true;
    // The full code is never sent here; admins filter on the
    // visible preview (which retains the first 8 + last 4 chars) and
    // on creator / recipient usernames.
    return (
      inv.codePreview.toLowerCase().includes(text) ||
      inv.creator?.username.toLowerCase().includes(text) ||
      inv.usedByUser?.username.toLowerCase().includes(text)
    );
  });
});

const stats = computed(() => {
  const list = invites.value?.data ?? [];
  return {
    total: invites.value?.pagination.total ?? list.length,
    active: list.filter((i) => statusOf(i) === 'active').length,
    used: list.filter((i) => statusOf(i) === 'used').length,
    expired: list.filter((i) => statusOf(i) === 'expired').length,
  };
});

function formatDate(d: string) {
  return new Date(d).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// `copyCode` was deliberately removed: the full code is no longer
// sent to the admin UI (see /api/admin/invites for the rationale),
// so there is nothing to copy from this surface.

// ── Strike (delete) flow ────────────────────────────────────
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
          : t('admin.invites.toasts.struck')
    );
  } catch (err: unknown) {
    notifications.error(
      (err as { data?: { message?: string } })?.data?.message ??
        t('admin.invites.errors.strikeFailed')
    );
  } finally {
    pendingDelete.value = null;
  }
}
</script>

<style scoped>
/* ── Grant panel ─────────────────────────────────────────── */
.grant-panel {
  border: 1px solid var(--line-default);
  border-radius: 8px;
  padding: 1rem;
  background: var(--bg-tertiary);
  margin-bottom: 1.25rem;
}
.grant-panel-row {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) 80px auto;
  gap: 0.75rem;
  align-items: end;
}
@media (max-width: 720px) {
  .grant-panel-row { grid-template-columns: 1fr; }
}
.grant-panel-label {
  display: block;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  font-weight: 700;
  color: var(--text-muted);
  margin-bottom: 0.25rem;
}
.grant-panel-search { position: relative; }
.grant-panel-input-wrap {
  position: relative;
  display: flex;
  align-items: center;
  background: var(--bg-primary);
  border: 1px solid var(--line-default);
  border-radius: 6px;
  padding: 0 0.5rem 0 0.625rem;
  transition: border-color 120ms ease;
}
.grant-panel-input-wrap:focus-within {
  border-color: color-mix(in srgb, var(--fg-default) 25%, transparent);
}
.grant-panel-input-icon { color: var(--text-muted); flex-shrink: 0; }
.grant-panel-input {
  flex: 1;
  border: none;
  background: transparent;
  padding: 0.5rem;
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
}
.grant-panel-input-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.125rem 0.5rem;
  background: color-mix(in srgb, var(--success) 20%, transparent);
  color: var(--success);
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
}
.grant-panel-input-chip-close {
  display: inline-flex;
  align-items: center;
  background: transparent;
  border: none;
  color: var(--success);
  cursor: pointer;
  padding: 0;
}
.grant-panel-suggestions {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 30;
  background: var(--bg-secondary);
  border: 1px solid var(--line-default);
  border-radius: 6px;
  list-style: none;
  margin: 0;
  padding: 0.25rem;
  box-shadow: 0 16px 40px -16px rgba(0, 0, 0, 0.4);
  max-height: 220px;
  overflow-y: auto;
}
.grant-panel-suggestion {
  display: grid;
  grid-template-columns: 16px 1fr auto;
  gap: 0.5rem;
  align-items: center;
  padding: 0.5rem 0.625rem;
  border-radius: 4px;
  font-size: 12px;
  color: var(--text-primary);
  cursor: pointer;
}
.grant-panel-suggestion:hover { background: var(--bg-tertiary); }
.grant-panel-suggestion-name { font-weight: 600; }
.grant-panel-suggestion-quota {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  color: var(--text-muted);
}

.grant-panel-count-input {
  width: 100%;
  background: var(--bg-primary);
  border: 1px solid var(--line-default);
  border-radius: 6px;
  padding: 0.5rem 0.625rem;
  color: var(--text-primary);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.grant-panel-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.625rem 1.25rem;
  background: var(--text-primary);
  color: var(--bg-primary);
  border: none;
  border-radius: 6px;
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  transition:
    transform 120ms ease,
    opacity 120ms ease;
}
.grant-panel-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  opacity: 0.92;
}
.grant-panel-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* ── KPIs ────────────────────────────────────────────────── */
.kpi-strip {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.5rem;
  margin: 0 0 1.25rem;
  padding: 0;
  list-style: none;
}
@media (max-width: 720px) {
  .kpi-strip { grid-template-columns: repeat(2, 1fr); }
}
.kpi {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.875rem 1rem;
  border-radius: 8px;
  border: 1px solid var(--line-default);
  background: var(--bg-tertiary);
}
.kpi-label {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  font-weight: 700;
  color: var(--text-muted);
}
.kpi-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}
.kpi-sub { font-size: 10px; color: var(--text-muted); }
.kpi-dot { width: 6px; height: 6px; border-radius: 999px; }
.kpi-dot--accent  { background: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent); }
.kpi-dot--success { background: var(--success); box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 18%, transparent); }

/* ── Filters ─────────────────────────────────────────────── */
.invite-filters {
  display: flex;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
  flex-wrap: wrap;
}
.invite-filter-search {
  flex: 1;
  min-width: 220px;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0 0.625rem;
  background: var(--bg-primary);
  border: 1px solid var(--line-default);
  border-radius: 6px;
}
.invite-filter-search :deep(svg),
.invite-filter-search .iconify { color: var(--text-muted); flex-shrink: 0; }
.invite-filter-search input {
  flex: 1;
  border: none;
  background: transparent;
  padding: 0.5rem 0;
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
}
.invite-filter-segments {
  display: inline-flex;
  background: var(--bg-tertiary);
  border: 1px solid var(--line-default);
  border-radius: 6px;
  padding: 2px;
}
.invite-filter-segment {
  background: transparent;
  border: none;
  padding: 0.375rem 0.75rem;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  border-radius: 4px;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.invite-filter-segment:hover { color: var(--text-primary); }
.invite-filter-segment--active {
  background: var(--bg-primary);
  color: var(--text-primary);
  box-shadow: inset 0 0 0 1px var(--line-default);
}

/* ── Table ───────────────────────────────────────────────── */
.invite-table-wrap {
  border: 1px solid var(--line-default);
  border-radius: 8px;
  overflow: hidden;
}
.invite-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.invite-table thead th {
  text-align: left;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-size: 9px;
  font-weight: 700;
  padding: 0.625rem 0.875rem;
  color: var(--text-muted);
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--line-default);
  white-space: nowrap;
}
.invite-table tbody td {
  padding: 0.75rem 0.875rem;
  border-bottom: 1px solid var(--line-default);
  vertical-align: middle;
}
.invite-table tbody tr:last-child td { border-bottom: none; }
.invite-table tbody tr:hover { background: color-mix(in srgb, var(--bg-secondary) 50%, transparent); }
.invite-table-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  background: var(--bg-tertiary);
  border: 1px solid var(--line-default);
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  color: var(--text-secondary);
  cursor: default;
}
.invite-table-status {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-weight: 700;
  padding: 0.2rem 0.5rem;
  border-radius: 999px;
  border: 1px solid transparent;
  white-space: nowrap;
}
.invite-table-status--active {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 30%, transparent);
}
.invite-table-status--used {
  background: color-mix(in srgb, var(--success) 14%, transparent);
  color: var(--success);
  border-color: color-mix(in srgb, var(--success) 30%, transparent);
}
.invite-table-status--expired {
  background: var(--bg-tertiary);
  color: var(--text-muted);
  border-color: var(--line-default);
}
.invite-table-user {
  color: var(--accent);
  font-weight: 600;
  text-decoration: none;
  border-bottom: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
}
.invite-table-user:hover { border-color: var(--accent); }
.invite-table-soft { color: var(--text-muted); }
.invite-table-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.invite-pagination {
  display: flex;
  justify-content: center;
  gap: 0.5rem;
  margin-top: 0.875rem;
}

/* ── Action column ───────────────────────────────────────── */
.invite-table-action-col { width: 44px; }
.invite-table-action-cell {
  text-align: right;
  white-space: nowrap;
}
.invite-table-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition:
    color 140ms ease,
    background 140ms ease,
    border-color 140ms ease;
}
.invite-table-action:hover:not(:disabled) {
  color: var(--error);
  background: color-mix(in srgb, var(--error) 8%, transparent);
  border-color: color-mix(in srgb, var(--error) 35%, transparent);
}
.invite-table-action:disabled { opacity: 0.5; cursor: not-allowed; }

/* ── Confirm modal ───────────────────────────────────────── */
.invite-confirm-body { padding: 1.25rem; }
.invite-confirm-text {
  font-size: 0.95rem;
  color: var(--text-primary);
  line-height: 1.55;
  margin: 0;
}
.invite-confirm-text strong { color: var(--text-primary); font-weight: 600; }
.invite-confirm-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  background: var(--bg-tertiary);
  border: 1px solid var(--line-default);
  padding: 0.15rem 0.4rem;
  border-radius: 4px;
  margin: 0 0.125rem;
}
.invite-confirm-soft {
  font-size: 0.85rem;
  color: var(--text-muted);
  margin: 0.625rem 0 0;
  line-height: 1.55;
}
.invite-confirm-soft strong {
  color: var(--text-primary);
  font-weight: 600;
}
.invite-confirm-footer {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
  padding: 0.875rem 1rem;
  border-top: 1px solid var(--line-default);
}
</style>
