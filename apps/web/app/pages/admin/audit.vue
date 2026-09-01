<template>
  <div class="audit">
    <!-- ── Head ────────────────────────────────────────────── -->
    <header class="au-head">
      <div>
        <h2 class="au-title">
          {{ $t('admin.audit.title') }}
          <!-- Labelled, because a bare number beside a title reads as a total
               and this one is the FILTERED count. -->
          <span class="au-title-accent tabular-nums">
            {{ $t('admin.audit.matching', data?.total ?? 0) }}
          </span>
        </h2>
        <!-- One sentence. The other three explained the model — append-only,
             retention, who may read — to an operator who opened the register to
             look at rows, and they now sit in the footnote where that kind of
             thing belongs. -->
        <p class="au-lede">{{ $t('admin.audit.lede') }}</p>
      </div>
      <button
        type="button"
        class="tool-btn"
        :disabled="loading"
        :title="$t('admin.audit.refresh')"
        :aria-label="$t('admin.audit.refresh')"
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
    <!-- Focusable, and dimmed while a new filter is in flight: `useFetch` keeps
         the previous page in `data`, so the fifty rows from the last filter
         stayed on screen at full opacity and an operator had no way to tell
         whether what they were reading answered their query yet. -->
    <section
      class="au-table-wrap"
      :class="{ 'au-table-wrap--loading': loading }"
      tabindex="0"
      role="region"
      :aria-label="$t('admin.audit.tableLabel')"
      :aria-busy="loading"
    >
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
          <!-- Two states, two sentences. On a fresh install, with no filter
               set, the operator read "No entry matches these filters" about
               filters they had not touched — and reasonably concluded the page
               was broken. -->
          <tr v-if="!loading && !rows.length">
            <td colspan="6" class="au-empty">
              <template v-if="anyFilter">
                {{ $t('admin.audit.emptyFiltered') }}
                <button type="button" class="au-linkbtn" @click="clearFilters">
                  {{ $t('admin.audit.clear') }}
                </button>
              </template>
              <template v-else>{{ $t('admin.audit.emptyFresh') }}</template>
            </td>
          </tr>
          <template v-for="row in rows" :key="row.id">
            <tr :class="{ 'au-row--failed': !ok(row.statusCode) }">
              <td class="au-when">
                <time :datetime="row.createdAt">{{ stamp(row.createdAt) }}</time>
              </td>
              <!-- Inline, not stacked. Two cells were vertical piles, which put
                   every row at ~55px against the house table's ~36px: a page of
                   50 entries came to 2,750px of scrolling on a register whose
                   own style comment promises "a ledger, not a dashboard". And
                   both names are links now — an operator reading "alice banned
                   bob" could reach neither of them without copying a username
                   and changing page. -->
              <td class="au-actor">
                <NuxtLink
                  v-if="row.actorId"
                  :to="`/users/${row.actorId}`"
                  class="au-actor-name"
                >{{ row.actorName }}</NuxtLink>
                <span v-else class="au-actor-name">{{ row.actorName }}</span>
                <span class="au-role" :class="`au-role--${row.actorRole}`">
                  {{ row.actorRole }}
                </span>
              </td>
              <td>
                <code class="au-action">{{ row.action }}</code>
                <!-- The request, in the open. It was behind a chevron that
                     appeared on every row because `path` is always set, so an
                     operator learned to ignore the chevron — and therefore also
                     missed the rows carrying a real diff. -->
                <code class="au-request">{{ row.method }} {{ row.path }}</code>
              </td>
              <td class="au-target">
                <template v-if="row.targetLabel || row.targetId">
                  <span v-if="row.targetType" class="au-target-type">{{ row.targetType }}</span>
                  <NuxtLink
                    v-if="row.targetType === 'user' && row.targetId"
                    :to="`/users/${row.targetId}`"
                    class="au-target-label"
                  >{{ row.targetLabel || row.targetId }}</NuxtLink>
                  <span v-else class="au-target-label">{{ row.targetLabel || row.targetId }}</span>
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
                  :aria-controls="`au-detail-${row.id}`"
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
              <td :id="`au-detail-${row.id}`" colspan="6">
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
                    <dd>
                      <pre
                        class="au-json"
                        tabindex="0"
                        role="region"
                        :aria-label="$t('admin.audit.detail.changes')"
                      >{{ pretty(row.changes) }}</pre>
                    </dd>
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
/**
 * Whether opening this row shows anything the row does not already say.
 *
 * It used to include `!!row.path`, which is always set — so the chevron
 * appeared on every one of the fifty rows, and opening most of them revealed
 * two values: the request line and a hash. An operator learns to ignore a
 * control that pays nothing, and then misses the rows that carry a real diff.
 * The request line is now printed in the Action cell, so the chevron means
 * exactly one thing: there is a change to read.
 */
const hasDetail = (row: AuditRow) => !!row.changes || !!row.actorIpHash;

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
  letter-spacing: calc(0.14em * var(--tracking-scale));
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
  border-radius: var(--radius-md);
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
/* 36px, like `.irc-switch` in the same batch of work, which commented exactly
   why: the whole row is the target, not a 13px checkbox. */
.au-toggle {
  min-height: 2.25rem;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  padding-bottom: 0.5rem;
}

/* ── Table ───────────────────────────────────────────────────── */
/* Its own scroll container: the action and path columns are long, and the
   page body must never scroll sideways. */
.au-table-wrap:focus-visible,
.au-json:focus-visible {
  outline: 2px solid rgb(var(--focus-ring));
  outline-offset: 2px;
}
.au-table-wrap--loading {
  opacity: 0.5;
  pointer-events: none;
}
.au-table-wrap {
  overflow-x: auto;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
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
  /* Scaled with the theme, like every other micro-label on the site. */
  letter-spacing: calc(0.08em * var(--tracking-scale));
  text-transform: uppercase;
  color: rgb(var(--fg-subtle));
  border-bottom: 1px solid rgb(var(--line-default));
  white-space: nowrap;
  /* Pinned. Fifty rows means the header leaves the viewport on the first
     scroll, and after that six columns of dense text have no names — the
     cheapest scanning win on the page. */
  position: sticky;
  top: 0;
  z-index: 1;
  background: rgb(var(--bg-surface));
}
.au-table td {
  padding: 0.45rem 0.75rem;
  border-bottom: 1px solid rgb(var(--line-default));
  vertical-align: middle;
}
.au-detail-row td { vertical-align: top; }
.au-table tbody tr:last-child td {
  border-bottom: 0;
}
/* The same 3 % wash the house `.data-table` uses. Following one row from its
   timestamp to its status code across six columns and 46rem of minimum width
   was being done by eye; this is not decoration, it is the scanning tool. */
.au-table tbody tr:hover td {
  background-color: rgb(var(--fg-default) / 0.03);
}
.au-table tbody tr.au-detail-row:hover td { background-color: transparent; }
/* The first column carries the reading key of a register, so it stays put when
   the table is scrolled sideways on a phone. */
.au-when {
  position: sticky;
  left: 0;
  background: rgb(var(--bg-surface));
}
.au-linkbtn {
  background: none;
  border: 0;
  padding: 0;
  font: inherit;
  color: rgb(var(--info));
  cursor: pointer;
  text-decoration: underline;
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
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35rem;
}
.au-actor-name {
  font-weight: 600;
}
a.au-actor-name:hover { color: rgb(var(--accent-warm)); }
/* Inline with the action key, not stacked under it.
   Surfacing the request line was right — behind a chevron that appeared on
   every row, it taught operators to ignore the chevron — but putting it on its
   own line just moved the row's second line from the actor cell to the action
   cell and left the height at 53px against the house table's 36px. Inline it
   wraps only on a narrow column. */
.au-request {
  margin-left: 0.4rem;
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  color: rgb(var(--fg-subtle));
  overflow-wrap: anywhere;
}
.au-role {
  font-size: 0.65rem;
  letter-spacing: calc(0.06em * var(--tracking-scale));
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
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35rem;
  max-width: 18rem;
}
.au-target-type {
  font-size: 0.65rem;
  letter-spacing: calc(0.06em * var(--tracking-scale));
  text-transform: uppercase;
  color: rgb(var(--fg-subtle));
}
.au-target-label {
  word-break: break-word;
}
a.au-target-label:hover { color: rgb(var(--accent-warm)); }
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
.au-caret {
  transition: transform var(--dur-2) ease;
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
  letter-spacing: calc(0.08em * var(--tracking-scale));
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
  border-radius: var(--radius-sm);
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
  border-radius: var(--radius-md);
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
