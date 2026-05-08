<template>
  <div class="ip-blocklist">
    <!-- ── Eyebrow + headline ──────────────────────────────── -->
    <header class="bl-head">
      <div>
        <p class="bl-eyebrow">IP blocklist · Operator console</p>
        <h2 class="bl-title">
          Banned addresses
          <span class="bl-title-accent">{{ data?.stats.total ?? 0 }}</span>
        </h2>
      </div>
      <div class="bl-head-tools">
        <button
          type="button"
          class="tool-btn"
          :disabled="loading"
          :title="loading ? 'Refreshing…' : 'Refresh'"
          @click="refresh"
        >
          <Icon
            name="ph:arrows-clockwise-bold"
            :class="{ 'animate-spin': loading }"
          />
        </button>
      </div>
    </header>

    <!-- ── KPI strip ───────────────────────────────────────── -->
    <ul class="kpi-strip">
      <li v-for="kpi in kpis" :key="kpi.key" class="kpi" :class="`kpi--${kpi.tone}`">
        <span class="kpi-label">
          <Icon :name="kpi.icon" />
          {{ kpi.label }}
        </span>
        <span class="kpi-value">{{ kpi.value }}</span>
        <span v-if="kpi.sub" class="kpi-sub">{{ kpi.sub }}</span>
      </li>
    </ul>

    <!-- ── Add new ban ─────────────────────────────────────── -->
    <section class="add-card">
      <header class="section-head">
        <span class="section-number">＋</span>
        <h3 class="section-title">Add to blocklist</h3>
        <span class="section-rule" />
      </header>

      <form class="add-form" @submit.prevent="submitAdd">
        <label class="add-field add-field--ip">
          <span class="field-label">IP address</span>
          <input
            v-model="addIp"
            type="text"
            class="input add-input add-input--mono"
            placeholder="192.0.2.13 or 2001:db8::1"
            :disabled="adding"
            autocomplete="off"
            spellcheck="false"
          />
        </label>
        <label class="add-field add-field--reason">
          <span class="field-label">Reason</span>
          <input
            v-model="addReason"
            type="text"
            class="input add-input"
            placeholder="Brute-force registration / abusive announce / …"
            :disabled="adding"
            maxlength="500"
          />
        </label>
        <button
          type="submit"
          class="btn-primary"
          :disabled="!canSubmit || adding"
        >
          <Icon
            :name="adding ? 'ph:circle-notch' : 'ph:prohibit-bold'"
            :class="{ 'animate-spin': adding }"
          />
          {{ adding ? 'Adding…' : 'Add ban' }}
        </button>
      </form>
      <p v-if="addError" class="add-error">
        <Icon name="ph:warning-circle-fill" />
        {{ addError }}
      </p>
    </section>

    <!-- ── Search ──────────────────────────────────────────── -->
    <div class="filters">
      <div class="filter-search">
        <Icon name="ph:magnifying-glass-bold" class="filter-search-icon" />
        <input
          v-model="searchInput"
          type="search"
          placeholder="Search IPs or reasons…"
          class="filter-search-input"
        />
        <button
          v-if="searchInput"
          type="button"
          class="filter-search-clear"
          aria-label="Clear search"
          @click="searchInput = ''"
        >
          <Icon name="ph:x-bold" />
        </button>
      </div>
    </div>

    <!-- ── Table ───────────────────────────────────────────── -->
    <div class="table-wrap">
      <table class="bl-table" :aria-busy="loading">
        <thead>
          <tr>
            <th
              class="th th--sortable"
              :class="{ 'th--active': sort === 'ip' }"
              :aria-sort="ariaSort('ip')"
              @click="toggleSort('ip')"
            >
              <span>IP address</span>
              <Icon :name="sortIcon('ip')" class="th-sort-icon" />
            </th>
            <th class="th">Reason</th>
            <th class="th th--center">Source</th>
            <th
              class="th th--sortable th--right"
              :class="{ 'th--active': sort === 'createdAt' }"
              :aria-sort="ariaSort('createdAt')"
              @click="toggleSort('createdAt')"
            >
              <span>Banned</span>
              <Icon :name="sortIcon('createdAt')" class="th-sort-icon" />
            </th>
            <th class="th th--right">Actions</th>
          </tr>
        </thead>

        <tbody v-if="loading && !data">
          <tr v-for="i in pageSize" :key="`sk-${i}`" class="row row--skeleton">
            <td colspan="5">
              <div class="sk-bar" :style="{ width: `${30 + (i % 7) * 8}%` }" />
            </td>
          </tr>
        </tbody>

        <tbody v-else-if="data && data.items.length === 0">
          <tr>
            <td colspan="5" class="empty">
              <div class="empty-inner">
                <Icon name="ph:shield-check" class="empty-icon" />
                <p class="empty-headline">
                  {{
                    debouncedSearch
                      ? 'No banned IPs match that search'
                      : 'The blocklist is clean'
                  }}
                </p>
                <p class="empty-sub">
                  {{
                    debouncedSearch
                      ? 'Try a less specific term, or clear the search.'
                      : 'Bans appear here as you add them or as users get banned with a known IP.'
                  }}
                </p>
              </div>
            </td>
          </tr>
        </tbody>

        <tbody v-else>
          <tr
            v-for="item in data?.items ?? []"
            :key="item.ip"
            class="row"
            :class="{ 'row--auto': item.automatic }"
          >
            <td class="cell cell--ip">
              <code :title="item.ip">{{ item.ip }}</code>
              <span class="ip-version">{{ ipVersion(item.ip) }}</span>
            </td>
            <td class="cell cell--reason">
              <span v-if="item.reason" class="reason-text" :title="item.reason">
                {{ item.reason }}
              </span>
              <span v-else class="cell-dash">—</span>
            </td>
            <td class="cell cell--center">
              <span
                class="source-chip"
                :class="
                  item.automatic ? 'source-chip--auto' : 'source-chip--manual'
                "
              >
                <Icon
                  :name="
                    item.automatic
                      ? 'ph:robot-fill'
                      : 'ph:user-circle-gear-fill'
                  "
                />
                {{ item.automatic ? 'Auto' : 'Manual' }}
              </span>
            </td>
            <td class="cell cell--right cell--mono">
              <span :title="formatAbsolute(item.createdAt)">
                <!-- ClientOnly: formatRelative reads Date.now() each call,
                     which diverges between SSR and hydration. -->
                <ClientOnly>
                  {{ formatRelative(item.createdAt) }}
                  <template #fallback>{{ formatAbsolute(item.createdAt) }}</template>
                </ClientOnly>
              </span>
            </td>
            <td class="cell cell--right">
              <button
                type="button"
                class="row-action row-action--unban"
                title="Remove from blocklist"
                :disabled="actionPending[item.ip]"
                @click="onUnban(item)"
              >
                <Icon
                  :name="
                    actionPending[item.ip]
                      ? 'ph:circle-notch'
                      : 'ph:lock-key-open-bold'
                  "
                  :class="{ 'animate-spin': actionPending[item.ip] }"
                />
                <span>Unban</span>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- ── Pagination ──────────────────────────────────────── -->
    <footer v-if="data" class="pager">
      <span class="pager-summary">
        <span class="pager-summary-strong">
          {{ rangeStart }}–{{ rangeEnd }}
        </span>
        of
        <span class="pager-summary-strong">{{ data.total }}</span>
      </span>

      <div class="pager-controls">
        <label class="pager-size">
          <span>Rows</span>
          <select v-model.number="pageSize" class="pager-size-input">
            <option :value="10">10</option>
            <option :value="25">25</option>
            <option :value="50">50</option>
            <option :value="100">100</option>
          </select>
        </label>

        <div class="pager-buttons">
          <button
            class="pager-btn"
            :disabled="page === 1"
            title="First page"
            @click="goTo(1)"
          >
            <Icon name="ph:caret-double-left-bold" />
          </button>
          <button
            class="pager-btn"
            :disabled="page === 1"
            @click="goTo(page - 1)"
          >
            <Icon name="ph:caret-left-bold" />
            <span>Prev</span>
          </button>
          <span class="pager-where">
            Page <strong>{{ page }}</strong> of {{ totalPages }}
          </span>
          <button
            class="pager-btn"
            :disabled="page >= totalPages"
            @click="goTo(page + 1)"
          >
            <span>Next</span>
            <Icon name="ph:caret-right-bold" />
          </button>
          <button
            class="pager-btn"
            :disabled="page >= totalPages"
            title="Last page"
            @click="goTo(totalPages)"
          >
            <Icon name="ph:caret-double-right-bold" />
          </button>
        </div>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'admin' });

interface BannedIp {
  ip: string;
  reason: string | null;
  createdAt: string;
  automatic: boolean;
}

interface RegistryPayload {
  items: BannedIp[];
  total: number;
  page: number;
  pageSize: number;
  stats: {
    total: number;
    today: number;
    week: number;
    manual: number;
    automatic: number;
  };
}

const notifications = useNotificationStore();
const confirm = useConfirm();

// ── Form state ────────────────────────────────────────────────
const searchInput = ref('');
const debouncedSearch = ref('');
const sort = ref<'createdAt' | 'ip'>('createdAt');
const dir = ref<'asc' | 'desc'>('desc');
const page = ref(1);
const pageSize = ref(25);

const addIp = ref('');
const addReason = ref('');
const adding = ref(false);
const addError = ref<string | null>(null);

const actionPending = reactive<Record<string, boolean>>({});

// Debounced search → query ref
let searchTimer: ReturnType<typeof setTimeout> | null = null;
watch(searchInput, (val) => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    debouncedSearch.value = val.trim();
    page.value = 1;
  }, 250);
});

// ── Data ──────────────────────────────────────────────────────
const apiQuery = computed(() => {
  const q: Record<string, string | number> = {
    page: page.value,
    pageSize: pageSize.value,
    sort: sort.value,
    dir: dir.value,
  };
  if (debouncedSearch.value) q.search = debouncedSearch.value;
  return q;
});

const {
  data,
  pending: loading,
  refresh: refreshData,
} = await useFetch<RegistryPayload>('/api/admin/banned-ips', {
  query: apiQuery,
  watch: [apiQuery],
  default: () => null as unknown as RegistryPayload,
});

function refresh() {
  refreshData();
}

// ── KPI strip ─────────────────────────────────────────────────
const kpis = computed(() => {
  const s = data.value?.stats ?? {
    total: 0,
    today: 0,
    week: 0,
    manual: 0,
    automatic: 0,
  };
  return [
    {
      key: 'total',
      label: 'Total banned',
      value: s.total,
      icon: 'ph:prohibit-bold',
      tone: 'fg' as const,
    },
    {
      key: 'today',
      label: 'Last 24h',
      value: s.today,
      icon: 'ph:clock-countdown-bold',
      tone: 'amber' as const,
    },
    {
      key: 'week',
      label: 'Last 7 days',
      value: s.week,
      icon: 'ph:calendar-blank-bold',
      sub: 'rolling window',
      tone: 'aqua' as const,
    },
    {
      key: 'manual',
      label: 'Manual bans',
      value: s.manual,
      icon: 'ph:user-circle-gear-fill',
      sub: 'set by an admin',
      tone: 'gold' as const,
    },
    {
      key: 'auto',
      label: 'Auto bans',
      value: s.automatic,
      icon: 'ph:robot-fill',
      sub: 'cascaded from user bans',
      tone: 'red' as const,
    },
  ];
});

// ── Sort ───────────────────────────────────────────────────────
function toggleSort(key: 'createdAt' | 'ip') {
  if (sort.value === key) {
    dir.value = dir.value === 'asc' ? 'desc' : 'asc';
  } else {
    sort.value = key;
    dir.value = key === 'ip' ? 'asc' : 'desc';
  }
  page.value = 1;
}

function ariaSort(key: 'createdAt' | 'ip'): 'ascending' | 'descending' | 'none' {
  if (sort.value !== key) return 'none';
  return dir.value === 'asc' ? 'ascending' : 'descending';
}
function sortIcon(key: 'createdAt' | 'ip') {
  if (sort.value !== key) return 'ph:arrows-down-up';
  return dir.value === 'asc' ? 'ph:arrow-up-bold' : 'ph:arrow-down-bold';
}

// ── Pagination ─────────────────────────────────────────────────
const totalPages = computed(() =>
  data.value && data.value.total > 0
    ? Math.max(1, Math.ceil(data.value.total / pageSize.value))
    : 1
);
const rangeStart = computed(() =>
  data.value && data.value.total > 0 ? (page.value - 1) * pageSize.value + 1 : 0
);
const rangeEnd = computed(() =>
  data.value ? Math.min(page.value * pageSize.value, data.value.total) : 0
);
function goTo(p: number) {
  if (p < 1 || p > totalPages.value) return;
  page.value = p;
}
watch(pageSize, () => {
  page.value = 1;
});

// ── Helpers ────────────────────────────────────────────────────
function formatRelative(iso: string) {
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
function formatAbsolute(iso: string) {
  // Pin the locale so SSR (Node default, often en-US) and the client
  // (browser default) render the same string in the table cell.
  return new Date(iso).toLocaleString('en-US');
}
function ipVersion(ip: string) {
  return ip.includes(':') ? 'IPv6' : 'IPv4';
}

// ── Mutations ──────────────────────────────────────────────────
const canSubmit = computed(() => addIp.value.trim().length > 0);

async function submitAdd() {
  if (!canSubmit.value || adding.value) return;
  adding.value = true;
  addError.value = null;
  try {
    await $fetch('/api/admin/banned-ips', {
      method: 'POST',
      body: {
        ip: addIp.value.trim(),
        reason: addReason.value.trim() || null,
      },
    });
    addIp.value = '';
    addReason.value = '';
    notifications.success('IP added to blocklist');
    await refreshData();
  } catch (err: any) {
    addError.value =
      err?.data?.data?.issues?.[0]?.message ||
      err?.data?.message ||
      err?.message ||
      'Failed to add IP';
  } finally {
    adding.value = false;
  }
}

async function onUnban(item: BannedIp) {
  const ok = await confirm({
    title: 'Remove from blocklist',
    message: item.automatic
      ? `${item.ip} was banned alongside a user account. Removing it here lets the IP register / log in again, but the user remains banned. Proceed?`
      : `Allow ${item.ip} to register and authenticate again?`,
    confirmText: 'Unban',
    destructive: false,
  });
  if (!ok) return;

  actionPending[item.ip] = true;
  try {
    await $fetch(
      `/api/admin/banned-ips/${encodeURIComponent(item.ip)}`,
      { method: 'DELETE' }
    );
    notifications.success(`${item.ip} unbanned`);
    if (data.value) {
      data.value = {
        ...data.value,
        items: data.value.items.filter((i) => i.ip !== item.ip),
        total: Math.max(0, data.value.total - 1),
        stats: {
          ...data.value.stats,
          total: Math.max(0, data.value.stats.total - 1),
          manual: item.automatic
            ? data.value.stats.manual
            : Math.max(0, data.value.stats.manual - 1),
          automatic: item.automatic
            ? Math.max(0, data.value.stats.automatic - 1)
            : data.value.stats.automatic,
        },
      };
    }
  } catch (err: any) {
    notifications.error(err?.data?.message || 'Failed to unban IP');
  } finally {
    actionPending[item.ip] = false;
  }
}
</script>

<style scoped>
.ip-blocklist {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  max-width: 1480px;
  margin: 0 auto;
  padding: 0 0.25rem 4rem;
}

/* ─── Header ────────────────────────────────────────────────── */
.bl-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}
.bl-eyebrow {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  margin: 0 0 0.4rem;
}
.bl-title {
  font-size: clamp(1.65rem, 3.4vw, 2.5rem);
  font-weight: 900;
  letter-spacing: -0.025em;
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
  margin: 0;
  line-height: 1;
  display: inline-flex;
  align-items: baseline;
  gap: 0.6rem;
  font-variant-numeric: tabular-nums;
}
.bl-title-accent {
  font-weight: 400;
  color: rgb(var(--danger));
  font-style: italic;
  letter-spacing: 0;
  font-size: 0.6em;
}
.bl-head-tools {
  display: flex;
  gap: 0.5rem;
}
.tool-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 9999px;
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-muted));
  transition: all 0.15s;
}
.tool-btn:hover:not(:disabled) {
  color: rgb(var(--fg-strong));
  border-color: rgb(var(--fg-default) / 0.3);
}
.tool-btn:disabled {
  opacity: 0.6;
}

/* ─── KPI strip ─────────────────────────────────────────────── */
.kpi-strip {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.75rem;
}
@media (max-width: 1024px) {
  .kpi-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 540px) {
  .kpi-strip {
    grid-template-columns: 1fr;
  }
}
.kpi {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 1rem 1.1rem;
  background: rgb(var(--bg-secondary));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.5rem;
}
.kpi-label {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.kpi-value {
  font-size: 1.85rem;
  font-weight: 900;
  letter-spacing: -0.02em;
  color: rgb(var(--fg-strong));
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.kpi-sub {
  font-size: 10.5px;
  color: rgb(var(--fg-muted));
  letter-spacing: 0.04em;
}
.kpi--amber .kpi-value { color: #f5c518; }
.kpi--aqua .kpi-value { color: #34d4d8; }
.kpi--gold .kpi-value { color: #f5c518; }
.kpi--red .kpi-value { color: rgb(var(--danger)); }

/* ─── Add card ──────────────────────────────────────────────── */
.add-card {
  position: relative;
  padding: 1.25rem 1.4rem;
  background: rgb(var(--bg-secondary));
  border: 1px solid rgb(var(--line-default));
  border-left: 3px solid rgb(var(--danger));
  border-radius: 0.5rem;
  /* Diagonal-stripe danger atmospheric tint behind the form to
     reinforce that this section adds an item to a blocklist. */
  background-image: repeating-linear-gradient(
    -45deg,
    transparent,
    transparent 14px,
    rgba(229, 62, 62, 0.025) 14px,
    rgba(229, 62, 62, 0.025) 16px
  );
}
.section-head {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  margin-bottom: 1rem;
}
.section-number {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 13px;
  font-weight: 700;
  color: rgb(var(--danger));
  background: rgba(229, 62, 62, 0.1);
  border: 1px solid rgba(229, 62, 62, 0.4);
  border-radius: 0.25rem;
  padding: 0.05rem 0.5rem;
  line-height: 1;
}
.section-title {
  font-size: 0.78rem;
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
.add-form {
  display: grid;
  grid-template-columns: 18rem 1fr auto;
  gap: 0.75rem;
  align-items: end;
}
@media (max-width: 720px) {
  .add-form {
    grid-template-columns: 1fr;
  }
}
.add-field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 0;
}
.field-label {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.add-input {
  width: 100%;
  padding: 0.65rem 0.85rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.4rem;
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-strong));
  font-size: 0.85rem;
}
.add-input:focus {
  outline: none;
  border-color: rgb(var(--fg-default) / 0.3);
}
.add-input--mono {
  font-family: ui-monospace, SFMono-Regular, monospace;
  letter-spacing: 0.04em;
}
.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.7rem 1.1rem;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  background: rgb(var(--danger));
  color: #fff;
  border: 1px solid rgb(var(--danger));
  transition: filter 0.15s;
  white-space: nowrap;
}
.btn-primary:hover:not(:disabled) {
  filter: brightness(1.08);
}
.btn-primary:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.add-error {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0.85rem 0 0;
  font-size: 11.5px;
  color: rgb(var(--danger));
}

/* ─── Filters ───────────────────────────────────────────────── */
.filters {
  padding: 0.85rem 1rem;
  background: rgb(var(--bg-secondary));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.5rem;
}
.filter-search {
  position: relative;
}
.filter-search-icon {
  position: absolute;
  left: 0.95rem;
  top: 50%;
  transform: translateY(-50%);
  font-size: 1.05rem;
  color: rgb(var(--fg-muted));
  pointer-events: none;
}
.filter-search-input {
  width: 100%;
  padding: 0.65rem 0.95rem 0.65rem 2.6rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.4rem;
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-strong));
  font-size: 0.85rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
}
.filter-search-input:focus {
  outline: none;
  border-color: rgb(var(--fg-default) / 0.3);
}
.filter-search-clear {
  position: absolute;
  right: 0.6rem;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 9999px;
  color: rgb(var(--fg-muted));
}
.filter-search-clear:hover {
  color: rgb(var(--fg-strong));
  background: rgb(var(--bg-elevated));
}

/* ─── Table ─────────────────────────────────────────────────── */
.table-wrap {
  position: relative;
  overflow-x: auto;
  background: rgb(var(--bg-secondary));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.5rem;
}
.bl-table {
  width: 100%;
  border-collapse: collapse;
}
.th {
  position: sticky;
  top: 0;
  z-index: 1;
  text-align: left;
  vertical-align: bottom;
  padding: 0.85rem 1rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  background: rgb(var(--bg-secondary));
  border-bottom: 1px solid rgb(var(--line-default));
  white-space: nowrap;
}
.th--right { text-align: right; }
.th--center { text-align: center; }
.th--sortable {
  cursor: pointer;
  user-select: none;
}
.th--sortable .th-sort-icon {
  margin-left: 0.35rem;
  font-size: 0.85em;
  opacity: 0.4;
  transition: opacity 0.15s;
  vertical-align: -2px;
}
.th--sortable:hover {
  color: rgb(var(--fg-strong));
}
.th--sortable:hover .th-sort-icon {
  opacity: 1;
}
.th--active {
  color: rgb(var(--fg-strong));
}
.th--active .th-sort-icon {
  opacity: 1;
}

.row {
  border-bottom: 1px solid rgb(var(--line-default) / 0.6);
  transition: background 0.12s;
}
.row:last-child { border-bottom: 0; }
.row:hover { background: rgb(var(--bg-elevated) / 0.5); }
.row--auto { background: rgba(229, 62, 62, 0.02); }
.row--auto:hover { background: rgba(229, 62, 62, 0.06); }
.row--skeleton:hover { background: transparent; }

.cell {
  padding: 0.7rem 1rem;
  font-size: 0.85rem;
  vertical-align: middle;
  color: rgb(var(--fg-default));
}
.cell--right { text-align: right; }
.cell--center { text-align: center; }
.cell--mono {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-variant-numeric: tabular-nums;
  font-size: 0.78rem;
}
.cell--ip {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.cell--ip code {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.85rem;
  font-weight: 700;
  color: rgb(var(--fg-strong));
  letter-spacing: 0.02em;
}
.ip-version {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: rgb(var(--fg-muted));
  padding: 0.1rem 0.4rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.25rem;
}
.cell--reason {
  max-width: 28rem;
}
.reason-text {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 0.82rem;
  color: rgb(var(--fg-default));
  line-height: 1.4;
}
.cell-dash {
  color: rgb(var(--fg-muted));
  opacity: 0.5;
}
.source-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.18rem 0.55rem;
  border-radius: 9999px;
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-elevated));
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.source-chip--manual {
  border-color: rgba(245, 197, 24, 0.4);
  background: rgba(245, 197, 24, 0.08);
  color: #f5c518;
}
.source-chip--auto {
  border-color: rgba(229, 62, 62, 0.4);
  background: rgba(229, 62, 62, 0.08);
  color: #ff6b6b;
}

.row-action {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.85rem;
  border-radius: 9999px;
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-default));
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  transition: all 0.15s;
}
.row-action:hover:not(:disabled) {
  border-color: rgba(108, 209, 97, 0.45);
  color: #6cd161;
  background: rgba(108, 209, 97, 0.06);
}
.row-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Loading skeleton + empty */
.sk-bar {
  height: 0.65rem;
  background: linear-gradient(
    90deg,
    rgb(var(--bg-elevated)),
    rgb(var(--line-default)),
    rgb(var(--bg-elevated))
  );
  background-size: 200% 100%;
  animation: shimmer 1.6s infinite;
  border-radius: 9999px;
  margin: 0.25rem 0;
}
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.empty {
  padding: 3rem 1rem;
  text-align: center;
}
.empty-inner {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  color: rgb(var(--fg-muted));
}
.empty-icon {
  font-size: 2.25rem;
  opacity: 0.5;
}
.empty-headline {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 700;
  color: rgb(var(--fg-default));
  letter-spacing: 0.02em;
}
.empty-sub {
  margin: 0;
  font-size: 0.8rem;
  max-width: 32rem;
}

/* ─── Pager ─────────────────────────────────────────────────── */
.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 1rem;
}
.pager-summary {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11.5px;
  letter-spacing: 0.04em;
  color: rgb(var(--fg-muted));
}
.pager-summary-strong {
  color: rgb(var(--fg-strong));
  font-weight: 700;
}
.pager-controls {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}
.pager-size {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.pager-size-input {
  padding: 0.35rem 0.5rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.3rem;
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-default));
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  font-weight: 700;
}
.pager-buttons {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
.pager-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.4rem 0.7rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.3rem;
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-default));
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  transition: all 0.15s;
}
.pager-btn:hover:not(:disabled) {
  border-color: rgb(var(--fg-default) / 0.3);
  color: rgb(var(--fg-strong));
}
.pager-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.pager-where {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  color: rgb(var(--fg-muted));
  padding: 0 0.65rem;
  letter-spacing: 0.06em;
}
.pager-where strong {
  color: rgb(var(--fg-strong));
  font-weight: 700;
}
</style>
