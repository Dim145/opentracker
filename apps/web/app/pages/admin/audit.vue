<template>
  <div class="audit">
    <!-- ── Head ────────────────────────────────────────────── -->
    <header class="au-head">
      <div>
        <p class="au-eyebrow">{{ $t('admin.audit.eyebrow') }}</p>
        <h2 class="au-title">
          {{ $t('admin.audit.title') }}
          <span class="au-title-accent tabular-nums">{{ data?.total ?? 0 }}</span>
        </h2>
        <p class="au-lede">{{ $t('admin.audit.lede') }}</p>
      </div>
      <button
        type="button"
        class="tool-btn"
        :disabled="loading"
        :title="$t('admin.audit.refresh')"
        @click="refreshData()"
      >
        <Icon name="ph:arrows-clockwise-bold" :class="{ 'animate-spin': loading }" />
      </button>
    </header>

    <!-- ── Filters ─────────────────────────────────────────── -->
    <section class="au-filters" :aria-label="$t('admin.audit.filtersLabel')">
      <label class="au-field au-field--grow">
        <span class="field-label">{{ $t('admin.audit.search') }}</span>
        <input
          v-model="searchInput"
          type="search"
          class="input"
          autocomplete="off"
          spellcheck="false"
          :placeholder="$t('admin.audit.searchPlaceholder')"
        />
      </label>

      <label class="au-field">
        <span class="field-label">{{ $t('admin.audit.action') }}</span>
        <select v-model="action" class="input">
          <option value="">{{ $t('admin.audit.anyAction') }}</option>
          <option v-for="a in actions" :key="a.action" :value="a.action">
            {{ a.action }} ({{ a.count }})
          </option>
        </select>
      </label>

      <label class="au-field">
        <span class="field-label">{{ $t('admin.audit.from') }}</span>
        <input v-model="from" type="date" class="input" />
      </label>

      <label class="au-field">
        <span class="field-label">{{ $t('admin.audit.to') }}</span>
        <input v-model="to" type="date" class="input" />
      </label>

      <label class="au-toggle">
        <input v-model="failuresOnly" type="checkbox" />
        <span>{{ $t('admin.audit.failuresOnly') }}</span>
      </label>

      <button
        v-if="anyFilter"
        type="button"
        class="tool-btn tool-btn--text"
        @click="clearFilters"
      >
        {{ $t('admin.audit.clear') }}
      </button>
    </section>

    <!-- ── The register ────────────────────────────────────── -->
    <section class="au-table-wrap" :aria-label="$t('admin.audit.tableLabel')">
      <table class="au-table">
        <thead>
          <tr>
            <th scope="col">{{ $t('admin.audit.col.when') }}</th>
            <th scope="col">{{ $t('admin.audit.col.actor') }}</th>
            <th scope="col">{{ $t('admin.audit.col.action') }}</th>
            <th scope="col">{{ $t('admin.audit.col.target') }}</th>
            <th scope="col" class="au-num">{{ $t('admin.audit.col.status') }}</th>
            <th scope="col"><span class="sr-only">{{ $t('admin.audit.col.detail') }}</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!loading && !rows.length">
            <td colspan="6" class="au-empty">{{ $t('admin.audit.empty') }}</td>
          </tr>
          <template v-for="row in rows" :key="row.id">
            <tr :class="{ 'au-row--failed': !ok(row.statusCode) }">
              <td class="au-when">
                <time :datetime="row.createdAt">{{ stamp(row.createdAt) }}</time>
              </td>
              <td class="au-actor">
                <span class="au-actor-name">{{ row.actorName }}</span>
                <span class="au-role" :class="`au-role--${row.actorRole}`">
                  {{ row.actorRole }}
                </span>
              </td>
              <td><code class="au-action">{{ row.action }}</code></td>
              <td class="au-target">
                <template v-if="row.targetLabel || row.targetId">
                  <span v-if="row.targetType" class="au-target-type">{{ row.targetType }}</span>
                  <span class="au-target-label">{{ row.targetLabel || row.targetId }}</span>
                </template>
                <span v-else class="au-dash">—</span>
              </td>
              <td class="au-num">
                <span class="au-status" :class="ok(row.statusCode) ? 'au-status--ok' : 'au-status--bad'">
                  {{ row.statusCode }}
                </span>
              </td>
              <td class="au-num">
                <button
                  v-if="hasDetail(row)"
                  type="button"
                  class="tool-btn tool-btn--sm"
                  :aria-expanded="expanded === row.id"
                  :aria-label="$t('admin.audit.col.detail')"
                  @click="expanded = expanded === row.id ? null : row.id"
                >
                  <Icon
                    name="ph:caret-down-bold"
                    :class="{ 'au-caret--open': expanded === row.id }"
                  />
                </button>
              </td>
            </tr>
            <tr v-if="expanded === row.id" class="au-detail-row">
              <td colspan="6">
                <dl class="au-detail">
                  <div>
                    <dt>{{ $t('admin.audit.detail.request') }}</dt>
                    <dd><code>{{ row.method }} {{ row.path }}</code></dd>
                  </div>
                  <div v-if="row.actorIpHash">
                    <dt>{{ $t('admin.audit.detail.ipHash') }}</dt>
                    <dd>
                      <code>{{ row.actorIpHash }}</code>
                      <span class="au-note">{{ $t('admin.audit.detail.ipNote') }}</span>
                    </dd>
                  </div>
                  <div v-if="row.changes">
                    <dt>{{ $t('admin.audit.detail.changes') }}</dt>
                    <dd><pre class="au-json">{{ pretty(row.changes) }}</pre></dd>
                  </div>
                </dl>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </section>

    <!-- ── Pager ───────────────────────────────────────────── -->
    <nav v-if="totalPages > 1" class="au-pager" :aria-label="$t('admin.audit.pagerLabel')">
      <button type="button" class="tool-btn" :disabled="page <= 1" @click="page--">
        <Icon name="ph:caret-left-bold" />
      </button>
      <span class="au-pager-label tabular-nums">
        {{ $t('admin.audit.pageOf', { page, pages: totalPages }) }}
      </span>
      <button
        type="button"
        class="tool-btn"
        :disabled="page >= totalPages"
        @click="page++"
      >
        <Icon name="ph:caret-right-bold" />
      </button>
    </nav>

    <!-- ── Retention ───────────────────────────────────────── -->
    <section class="au-retention" :aria-label="$t('admin.audit.retention.label')">
      <div>
        <h3 class="au-retention-title">{{ $t('admin.audit.retention.title') }}</h3>
        <p class="au-retention-text">{{ $t('admin.audit.retention.text') }}</p>
      </div>
      <form class="au-retention-form" @submit.prevent="saveRetention">
        <label class="au-field">
          <span class="field-label">{{ $t('admin.audit.retention.days') }}</span>
          <input
            v-model.number="retentionDays"
            type="number"
            min="0"
            max="3650"
            class="input au-retention-input"
          />
        </label>
        <button type="submit" class="btn btn-secondary btn-sm" :disabled="savingRetention">
          <Icon
            :name="savingRetention ? 'ph:circle-notch' : 'ph:check-bold'"
            :class="{ 'animate-spin': savingRetention }"
          />
          {{ $t('admin.audit.retention.save') }}
        </button>
      </form>
      <p v-if="retentionDays === 0" class="au-retention-note">
        {{ $t('admin.audit.retention.forever') }}
      </p>
    </section>

    <p class="au-foot">{{ $t('admin.audit.foot') }}</p>
  </div>
</template>

<script setup lang="ts">
/**
 * The staff register.
 *
 * Admin-only at three layers, and they are not redundant: the page middleware,
 * the nav entry, and `requireAdminSession` on the API. Moderators fill this
 * table and cannot read it — see the route for why.
 *
 * A read-only surface, deliberately. There is no delete button and no "mark
 * reviewed": rows leave only through the retention sweep, and a register the
 * registered can amend is not a register.
 */
definePageMeta({ middleware: 'admin' });

interface AuditRow {
  id: string;
  actorId: string | null;
  actorName: string;
  actorRole: string;
  action: string;
  method: string;
  path: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  changes: Record<string, unknown> | null;
  statusCode: number;
  actorIpHash: string | null;
  createdAt: string;
}

interface AuditPayload {
  items: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
}

const { t } = useI18n();

const searchInput = ref('');
const debouncedSearch = ref('');
const action = ref('');
const from = ref('');
const to = ref('');
const failuresOnly = ref(false);
const page = ref(1);
const pageSize = ref(50);
const expanded = ref<string | null>(null);

// Same 250 ms debounce as the other admin listings — one query per pause, not
// per keystroke.
let searchTimer: ReturnType<typeof setTimeout> | null = null;
watch(searchInput, (val) => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    debouncedSearch.value = val.trim();
    page.value = 1;
  }, 250);
});

// Any filter change puts you back on page 1: staying on page 7 of a narrower
// result set shows an empty table and reads as "nothing found".
watch([action, from, to, failuresOnly], () => {
  page.value = 1;
});

const apiQuery = computed(() => {
  const q: Record<string, string | number> = {
    page: page.value,
    pageSize: pageSize.value,
  };
  if (debouncedSearch.value) q.q = debouncedSearch.value;
  if (action.value) q.action = action.value;
  if (from.value) q.from = from.value;
  // The date input gives a day; the filter is inclusive, so the end of it.
  if (to.value) q.to = `${to.value}T23:59:59.999Z`;
  if (failuresOnly.value) q.failuresOnly = 'true';
  return q;
});

const {
  data,
  pending: loading,
  refresh: refreshData,
} = await useFetch<AuditPayload>('/api/admin/audit', {
  query: apiQuery,
  watch: [apiQuery],
  default: () => null as unknown as AuditPayload,
});

// Read from the table, not from a hard-coded list — an un-enriched route's
// action key is derived from its path, so only the data knows what exists.
const { data: actionsData } = await useFetch<{
  items: Array<{ action: string; count: number }>;
}>('/api/admin/audit/actions', { default: () => ({ items: [] }) });

const actions = computed(() => actionsData.value?.items ?? []);
const rows = computed(() => data.value?.items ?? []);
const totalPages = computed(() =>
  Math.max(1, Math.ceil((data.value?.total ?? 0) / pageSize.value))
);
const anyFilter = computed(
  () =>
    !!debouncedSearch.value ||
    !!action.value ||
    !!from.value ||
    !!to.value ||
    failuresOnly.value
);

function clearFilters() {
  searchInput.value = '';
  debouncedSearch.value = '';
  action.value = '';
  from.value = '';
  to.value = '';
  failuresOnly.value = false;
  page.value = 1;
}

// ── Retention ─────────────────────────────────────────────────
// The control lives here rather than on the settings page: this is where an
// admin asks the question, and a setting whose only way in is a SQL prompt is
// a setting only its author can change.
const notifications = useNotificationStore();
const { data: settings } = await useFetch<{ auditRetentionDays: number }>(
  '/api/admin/settings',
  { default: () => ({ auditRetentionDays: 365 }) }
);
const retentionDays = ref(settings.value?.auditRetentionDays ?? 365);
watch(
  () => settings.value?.auditRetentionDays,
  (v) => {
    if (typeof v === 'number') retentionDays.value = v;
  }
);
const savingRetention = ref(false);

async function saveRetention() {
  savingRetention.value = true;
  try {
    await $fetch('/api/admin/settings', {
      method: 'PUT',
      body: { auditRetentionDays: retentionDays.value },
    });
    notifications.success(t('admin.audit.retention.saved'));
  } catch (err: unknown) {
    const e = err as { data?: { message?: string }; message?: string };
    notifications.error(e?.data?.message || e?.message || t('admin.audit.retention.failed'));
  } finally {
    savingRetention.value = false;
  }
}

const ok = (status: number) => status >= 200 && status < 300;
const hasDetail = (row: AuditRow) => !!row.changes || !!row.actorIpHash || !!row.path;

/**
 * Pinned to `en-GB` for the same reason the account page pins its locale: a
 * server-rendered timestamp formatted with the OS locale and a client one
 * formatted with the browser's produce different strings and a hydration
 * mismatch. A register is also the one place where an unambiguous, sortable
 * stamp beats a friendly one.
 */
function stamp(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'UTC',
  });
}

function pretty(changes: Record<string, unknown>): string {
  return JSON.stringify(changes, null, 2);
}

useHead({ title: () => t('admin.audit.title') });
</script>

<style scoped>
/*
 * A ledger, not a dashboard. Hairline rules, tabular figures, one accent —
 * the page is read while something has gone wrong, and every flourish is a
 * thing between the reader and the row they are looking for.
 *
 * Colour lives on utility classes and on the few semantic classes below;
 * this sheet owns geometry.
 */
.audit {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.au-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}
.au-eyebrow {
  margin: 0 0 0.25rem;
  font-size: 0.7rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgb(var(--fg-subtle));
}
.au-title {
  margin: 0;
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  font-size: 1.35rem;
}
.au-title-accent {
  font-size: 0.95rem;
  color: rgb(var(--accent));
}
.au-lede {
  margin: 0.4rem 0 0;
  max-width: 46rem;
  font-size: 0.82rem;
  line-height: 1.6;
  color: rgb(var(--fg-subtle));
}

/* ── Filters ─────────────────────────────────────────────────── */
.au-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.75rem;
  padding: 0.9rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.5rem;
  background: rgb(var(--bg-surface));
}
.au-field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 9rem;
}
.au-field--grow {
  flex: 1 1 14rem;
}
.au-toggle {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  padding-bottom: 0.5rem;
}

/* ── Table ───────────────────────────────────────────────────── */
/* Its own scroll container: the action and path columns are long, and the
   page body must never scroll sideways. */
.au-table-wrap {
  overflow-x: auto;
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.5rem;
}
.au-table {
  width: 100%;
  min-width: 46rem;
  border-collapse: collapse;
  font-size: 0.82rem;
}
.au-table th {
  text-align: left;
  padding: 0.6rem 0.75rem;
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgb(var(--fg-subtle));
  border-bottom: 1px solid rgb(var(--line-default));
  white-space: nowrap;
}
.au-table td {
  padding: 0.55rem 0.75rem;
  border-bottom: 1px solid rgb(var(--line-default));
  vertical-align: top;
}
.au-table tbody tr:last-child td {
  border-bottom: 0;
}
.au-num {
  text-align: right;
  white-space: nowrap;
}
.au-when {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  color: rgb(var(--fg-subtle));
}
.au-actor {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.au-actor-name {
  font-weight: 600;
}
.au-role {
  font-size: 0.65rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgb(var(--fg-subtle));
}
.au-role--owner,
.au-role--admin {
  color: rgb(var(--accent));
}
.au-action {
  font-size: 0.78rem;
  word-break: break-word;
}
.au-target {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  max-width: 18rem;
}
.au-target-type {
  font-size: 0.65rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgb(var(--fg-subtle));
}
.au-target-label {
  word-break: break-word;
}
.au-dash,
.au-empty {
  color: rgb(var(--fg-subtle));
}
.au-empty {
  padding: 2rem 0.75rem;
  text-align: center;
}
.au-status {
  font-variant-numeric: tabular-nums;
}
.au-status--bad {
  color: rgb(var(--danger));
}
/* A left rule rather than a tinted row: a failed request is worth spotting
   while scanning, not worth repainting the line. */
.au-row--failed td:first-child {
  box-shadow: inset 2px 0 0 rgb(var(--danger));
}
.au-caret--open {
  transform: rotate(180deg);
}

/* ── Detail ──────────────────────────────────────────────────── */
.au-detail-row td {
  background: rgb(var(--bg-surface));
}
.au-detail {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  margin: 0;
}
.au-detail dt {
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgb(var(--fg-subtle));
  margin-bottom: 0.2rem;
}
.au-detail dd {
  margin: 0;
}
.au-note {
  margin-left: 0.5rem;
  font-size: 0.72rem;
  color: rgb(var(--fg-subtle));
}
.au-json {
  margin: 0;
  padding: 0.6rem 0.75rem;
  overflow-x: auto;
  font-size: 0.76rem;
  line-height: 1.5;
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.35rem;
  background: rgb(var(--bg-inset));
}

/* ── Pager + foot ────────────────────────────────────────────── */
.au-pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
}
.au-pager-label {
  font-size: 0.8rem;
  color: rgb(var(--fg-subtle));
}
/* ── Retention ───────────────────────────────────────────────── */
.au-retention {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.9rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.5rem;
  background: rgb(var(--bg-surface));
}
.au-retention-title {
  margin: 0 0 0.25rem;
  font-size: 0.9rem;
}
.au-retention-text,
.au-retention-note {
  margin: 0;
  max-width: 38rem;
  font-size: 0.78rem;
  line-height: 1.6;
  color: rgb(var(--fg-subtle));
}
.au-retention-form {
  display: flex;
  align-items: flex-end;
  gap: 0.6rem;
}
.au-retention-input {
  width: 7rem;
}

.au-foot {
  margin: 0;
  padding-top: 0.75rem;
  border-top: 1px solid rgb(var(--line-default));
  font-size: 0.75rem;
  line-height: 1.6;
  color: rgb(var(--fg-subtle));
}

@media (max-width: 40rem) {
  .au-head {
    flex-direction: column;
  }
  .au-field,
  .au-field--grow {
    flex: 1 1 100%;
    min-width: 0;
  }
}
</style>
