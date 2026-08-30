<template>
  <!--
    A queue, not a table.

    The only question anybody brings here is "what has been waiting
    longest, and is anyone on it" — so waiting time is the typography and
    the assignee is the second thing on the line. Everything else is
    subordinate. Open tickets are ordered oldest-first, which is the
    reverse of every other list in this application and the whole point of
    a queue: newest-first is for a feed, oldest-first is for work.
  -->
  <div class="tq">
    <div class="tq-bar">
      <div class="tq-tabs" role="tablist" :aria-label="$t('mod.tickets.title')">
        <button
          type="button"
          role="tab"
          class="tq-tab"
          :class="{ 'tq-tab--on': !closed }"
          :aria-selected="!closed"
          @click="closed = false"
        >
          {{ $t('mod.tickets.queue') }}
          <span v-if="counts.open" class="tq-count">{{ counts.open }}</span>
        </button>
        <button
          type="button"
          role="tab"
          class="tq-tab"
          :class="{ 'tq-tab--on': closed }"
          :aria-selected="closed"
          @click="closed = true"
        >
          {{ $t('mod.tickets.archive') }}
        </button>
      </div>

      <p v-if="!closed && counts.untaken" class="tq-untaken">
        <Icon name="ph:warning-circle-bold" />
        {{ $t('mod.tickets.untaken', { n: counts.untaken }) }}
      </p>
    </div>

    <p v-if="pending && !tickets.length" class="tq-empty">{{ $t('common.loading') }}</p>
    <p v-else-if="!tickets.length" class="tq-empty">
      {{ closed ? $t('mod.tickets.emptyArchive') : $t('mod.tickets.emptyQueue') }}
    </p>

    <ol v-else class="tq-list">
      <li
        v-for="t in tickets"
        :key="t.id"
        class="tq-row"
        :class="{
          'tq-row--untaken': t.status === 'open' && !t.assignedToId,
          'tq-row--waiting': t.lastMessageBy === 'member' && !closed,
        }"
      >
        <!-- The wait, at display size. It is the answer to the only
             question the queue is opened to ask. -->
        <span class="tq-age" :title="new Date(t.lastMessageAt).toLocaleString()">
          {{ waited(t.lastMessageAt) }}
        </span>

        <div class="tq-main">
          <p class="tq-head">
            <span class="tq-num">#{{ t.number }}</span>
            <NuxtLink :to="`/mod/tickets?id=${t.id}`" class="tq-subject" @click.prevent="open(t.id)">
              {{ t.subject }}
            </NuxtLink>
            <span class="tq-cat">{{ $t(`tickets.categories.${t.category}`) }}</span>
          </p>
          <p class="tq-meta">
            <NuxtLink v-if="t.openedById" :to="`/users/${t.openedById}`" class="tq-who">
              {{ t.openedByName }}
            </NuxtLink>
            <span v-else class="tq-who tq-who--gone">{{ t.openedByName }}</span>
            <span class="tq-sep" aria-hidden="true">·</span>

            <!-- In the queue the question is who has it. In the archive it
                 is how it ended — showing the assignee there hid the
                 outcome behind a name, so a resolved ticket and a rejected
                 one read identically. -->
            <template v-if="t.status !== 'open'">
              <span class="tq-outcome" :class="`tq-outcome--${ticketState(t)}`">
                {{ outcomeLabel(t) }}
              </span>
              <template v-if="t.closedByName">
                <span class="tq-sep" aria-hidden="true">·</span>
                <span class="tq-assignee tq-assignee--none">{{ t.closedByName }}</span>
              </template>
            </template>
            <span v-else-if="t.assignedToName" class="tq-assignee">
              <Icon name="ph:user-check-bold" />
              {{ t.assignedToName }}
            </span>
            <span v-else class="tq-assignee tq-assignee--none">
              {{ $t('mod.tickets.nobody') }}
            </span>
          </p>
        </div>

        <button type="button" class="btn btn-sm" @click="open(t.id)">
          {{ $t('mod.tickets.openAction') }}
        </button>
      </li>
    </ol>

    <!-- The ticket itself, in a dialog: the queue is the page, and losing
         your place in it to read one entry is what makes a queue tiring. -->
    <Modal v-model="detailOpen" :title="detailTitle" size="lg">
      <MessagingTicketThread
        v-if="activeId"
        :ticket-id="activeId"
        staff
        @changed="onChanged"
      />
    </Modal>
  </div>
</template>

<script setup lang="ts">
interface QueueRow {
  id: string;
  number: number;
  subject: string;
  category: string;
  status: string;
  closureReason: string | null;
  openedById: string | null;
  openedByName: string;
  assignedToId: string | null;
  assignedToName: string | null;
  closedByName: string | null;
  createdAt: string;
  lastMessageAt: string;
  lastMessageBy: string;
}

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const closed = ref(false);
const activeId = ref<string | null>(
  typeof route.query.id === 'string' ? route.query.id : null
);
const detailOpen = computed({
  get: () => !!activeId.value,
  set: (v: boolean) => {
    if (!v) activeId.value = null;
  },
});

const { data, pending, refresh } = await useFetch<{
  tickets: QueueRow[];
  counts: { open: number; untaken: number; closed: number };
}>('/api/mod/tickets', {
  query: computed(() => ({ closed: closed.value ? 'true' : 'false' })),
});

const tickets = computed(() => data.value?.tickets ?? []);
const counts = computed(
  () => data.value?.counts ?? { open: 0, untaken: 0, closed: 0 }
);

/**
 * Kept, not looked up.
 *
 * Deriving the title from the list meant it vanished the moment the
 * ticket left that list — closing one from inside the dialog swapped its
 * own heading for the generic page title, because the row had just
 * dropped out of the open queue underneath it. The dialog is showing one
 * ticket; it should hold on to which one.
 */
const openRow = ref<{ number: number; subject: string } | null>(null);

const detailTitle = computed(() =>
  openRow.value
    ? `#${openRow.value.number} · ${openRow.value.subject}`
    : t('mod.tickets.title')
);

function open(id: string) {
  const row = tickets.value.find((x) => x.id === id);
  if (row) openRow.value = { number: row.number, subject: row.subject };
  activeId.value = id;
  void router.replace({ query: { ...route.query, id } });
}

/**
 * The outcome, in the queue's voice.
 *
 * "Clôturé par toi" is the member's word for a withdrawal and is simply
 * false on this page — it was their ticket, not the reader's. The row
 * already prints who did it, so here the outcome only has to say what.
 */
function outcomeLabel(row: QueueRow): string {
  const s = ticketState(row);
  return s === 'withdrawn'
    ? t('mod.tickets.withdrawn')
    : t(`tickets.status.${s}`);
}

/** Coarse on purpose: "3 d" is the signal, "3 d 4 h 12 m" is noise. */
function waited(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return t('mod.tickets.ageMinutes', { n: mins });
  if (mins < 60 * 48) return t('mod.tickets.ageHours', { n: Math.round(mins / 60) });
  return t('mod.tickets.ageDays', { n: Math.round(mins / 1440) });
}

async function onChanged() {
  await refresh();
}

watch(activeId, (v) => {
  if (!v) {
    openRow.value = null;
    if (route.query.id) {
      void router.replace({ query: { ...route.query, id: undefined } });
    }
  }
});

// A `?id=` deep link opens the dialog before the queue has loaded, so the
// heading is filled in when the row shows up rather than at click time.
watch(tickets, (rows) => {
  if (!activeId.value || openRow.value) return;
  const row = rows.find((x) => x.id === activeId.value);
  if (row) openRow.value = { number: row.number, subject: row.subject };
});
</script>

<style scoped>
.tq-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1.25rem;
}

.tq-tabs {
  display: flex;
  gap: 0.25rem;
  padding: 0.25rem;
  border-radius: var(--radius-md);
  background: rgb(var(--fg-default) / 0.05);
}
.tq-tab {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 2rem;
  padding: 0 0.85rem;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: rgb(var(--fg-muted));
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: background var(--dur-2) ease, color var(--dur-2) ease;
}
.tq-tab--on {
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-strong));
}
.tq-count {
  min-width: 1.1rem;
  padding: 0 0.25rem;
  border-radius: var(--radius-pill);
  background: rgb(var(--accent-warm));
  color: rgb(var(--bg-base));
  font-family: var(--font-mono);
  font-size: 0.6rem;
  font-weight: 800;
  text-align: center;
}

.tq-untaken {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0;
  color: rgb(var(--accent-warm));
  font-size: 0.75rem;
}

.tq-empty {
  padding: 2.5rem 0;
  color: rgb(var(--fg-muted));
  font-size: 0.875rem;
}

.tq-list {
  margin: 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid rgb(var(--line-default));
}

.tq-row {
  display: grid;
  grid-template-columns: 4.5rem 1fr auto;
  align-items: center;
  gap: 1rem;
  padding: 0.85rem 0.5rem;
  border-bottom: 1px solid rgb(var(--line-default));
  border-left: 2px solid transparent;
}
/* Untaken is the state the queue exists to surface. */
.tq-row--untaken { border-left-color: rgb(var(--accent-warm)); }
.tq-row--waiting { background: rgb(var(--fg-default) / 0.02); }

.tq-age {
  font-family: var(--font-mono);
  font-size: 1.05rem;
  font-variant-numeric: tabular-nums;
  color: rgb(var(--fg-default));
  text-align: right;
}
.tq-row--untaken .tq-age { color: rgb(var(--accent-warm)); }

.tq-main { min-width: 0; }
.tq-head {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin: 0 0 0.15rem;
  min-width: 0;
}
.tq-num {
  color: rgb(var(--fg-subtle));
  font-family: var(--font-mono);
  font-size: 0.7rem;
}
.tq-subject {
  color: rgb(var(--fg-default));
  font-size: 0.9rem;
  font-weight: 600;
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tq-subject:hover { text-decoration: underline; }
.tq-cat {
  flex: none;
  padding: 0.05rem 0.4rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-pill);
  color: rgb(var(--fg-subtle));
  font-size: 0.62rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.tq-meta {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  color: rgb(var(--fg-muted));
  font-size: 0.75rem;
}
.tq-who { color: inherit; text-decoration: none; }
.tq-who:hover { text-decoration: underline; }
.tq-who--gone { text-decoration: line-through; text-decoration-thickness: 1px; }
.tq-sep { color: rgb(var(--fg-subtle)); }
.tq-assignee { display: inline-flex; align-items: center; gap: 0.25rem; }
.tq-assignee--none { color: rgb(var(--fg-subtle)); font-style: italic; }

/* The outcome, in the archive. Enough colour to scan a column of them and
   see at a glance what was turned down, and no more. */
.tq-outcome {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.07em;
}
.tq-outcome--resolved { color: rgb(var(--online)); }
.tq-outcome--rejected { color: rgb(var(--fg-muted)); }
.tq-outcome--stale { color: rgb(var(--fg-subtle)); }
.tq-outcome--withdrawn { color: rgb(var(--fg-muted)); }

@media (max-width: 48rem) {
  .tq-row {
    grid-template-columns: 3.5rem 1fr;
    gap: 0.5rem 0.75rem;
  }
  .tq-row > .btn { grid-column: 2; justify-self: start; }

  /* Let the subject wrap rather than clip. On a phone the ellipsis was
     eating the half of the sentence that says what the ticket is about
     — "Doublon signalé à tort sur mon uplo…" is not a queue entry, it is
     a riddle. Two lines cost nothing here; the row is already tall. */
  .tq-head { flex-wrap: wrap; }
  .tq-subject {
    overflow: visible;
    text-overflow: clip;
    white-space: normal;
  }
}
</style>
