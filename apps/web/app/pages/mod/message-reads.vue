<template>
  <!--
    The read log, laid out as a ledger rather than as a table of records.
    Each line is one act: a name, what it opened, and whether anything was
    legible. There is nothing to sort and nothing to filter, because the
    only question anyone brings here is "who has been looking".

    No message bodies. Reading the log is not a second way to read the
    mail — it says a thing was opened, by whom, and stops.
  -->
  <div class="mrl">
    <p class="mrl-note">
      <Icon name="ph:info" class="mrl-note-icon" />
      <span>{{ $t('mod.messageReads.note') }}</span>
    </p>

    <p v-if="pending && !entries.length" class="mrl-empty">
      {{ $t('common.loading') }}
    </p>

    <p v-else-if="!entries.length" class="mrl-empty">
      {{ $t('mod.messageReads.empty') }}
    </p>

    <ol v-else class="mrl-list">
      <li v-for="e in entries" :key="e.id" class="mrl-row">
        <time class="mrl-when" :datetime="e.createdAt">
          {{ stamp(e.createdAt) }}
        </time>

        <span class="mrl-who">
          <NuxtLink v-if="e.readerId" :to="`/users/${e.readerId}`" class="mrl-link">
            {{ e.readerName }}
          </NuxtLink>
          <!-- The name outlives the account on purpose: a log that becomes
               a column of nulls when a moderator erases themselves is not
               a log. -->
          <span v-else class="mrl-gone" :title="$t('mod.messageReads.readerGone')">
            {{ e.readerName }}
          </span>
        </span>

        <span
          class="mrl-outcome"
          :class="e.disclosed ? 'mrl-outcome--read' : 'mrl-outcome--sealed'"
        >
          <Icon :name="e.disclosed ? 'ph:eye-bold' : 'ph:lock-key'" />
          {{ e.disclosed
            ? $t('mod.messageReads.disclosed')
            : $t('mod.messageReads.sealed') }}
        </span>

        <code class="mrl-ref">#{{ e.messageId.slice(0, 8) }}</code>
      </li>
    </ol>

    <div v-if="pagination && pagination.totalPages > 1" class="mrl-pager">
      <button
        type="button"
        class="btn btn-sm"
        :disabled="page <= 1"
        @click="page -= 1"
      >
        {{ $t('common.previous') }}
      </button>
      <span class="mrl-page tabular-nums">
        {{ page }} / {{ pagination.totalPages }}
      </span>
      <button
        type="button"
        class="btn btn-sm"
        :disabled="page >= pagination.totalPages"
        @click="page += 1"
      >
        {{ $t('common.next') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
interface ReadEntry {
  id: string;
  readerId: string | null;
  readerName: string;
  messageId: string;
  conversationId: string;
  reportId: string | null;
  disclosed: boolean;
  createdAt: string;
}

const { locale } = useI18n();
const page = ref(1);

const { data, pending } = await useFetch<{
  entries: ReadEntry[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}>('/api/mod/messages/read-log', {
  query: computed(() => ({ page: page.value })),
});

const entries = computed(() => data.value?.entries ?? []);
const pagination = computed(() => data.value?.pagination ?? null);

/** Full stamp, not "3 days ago": this is a record, and a record has a date. */
function stamp(iso: string): string {
  return new Date(iso).toLocaleString(locale.value, {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}
</script>

<style scoped>
.mrl-note {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  margin: 0 0 1.5rem;
  color: rgb(var(--fg-muted));
  font-size: 0.8rem;
  line-height: 1.6;
}
.mrl-note-icon { flex: none; margin-top: 0.15rem; }

.mrl-empty {
  padding: 2rem 0;
  color: rgb(var(--fg-muted));
  font-size: 0.875rem;
}

.mrl-list {
  margin: 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid rgb(var(--line-default));
}

/* One line per act. The stamp leads because the question is chronological. */
.mrl-row {
  display: grid;
  grid-template-columns: 10rem 1fr auto auto;
  align-items: center;
  gap: 1rem;
  padding: 0.7rem 0;
  border-bottom: 1px solid rgb(var(--line-default));
  font-size: 0.85rem;
}

.mrl-when {
  color: rgb(var(--fg-subtle));
  font-family: var(--font-mono);
  font-size: 0.72rem;
  font-variant-numeric: tabular-nums;
}

.mrl-who { min-width: 0; font-weight: 600; }
.mrl-link { color: inherit; text-decoration: none; }
.mrl-link:hover { text-decoration: underline; }
.mrl-gone {
  color: rgb(var(--fg-muted));
  text-decoration: line-through;
  text-decoration-thickness: 1px;
}

.mrl-outcome {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.mrl-outcome--read { color: rgb(var(--warning)); }
.mrl-outcome--sealed { color: rgb(var(--fg-subtle)); }

.mrl-ref {
  color: rgb(var(--fg-subtle));
  font-family: var(--font-mono);
  font-size: 0.7rem;
}

.mrl-pager {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 1.5rem;
}
.mrl-page {
  color: rgb(var(--fg-muted));
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

@media (max-width: 48rem) {
  .mrl-row {
    grid-template-columns: 1fr auto;
    gap: 0.3rem 0.75rem;
  }
  .mrl-when { grid-column: 1 / -1; }
}
</style>
