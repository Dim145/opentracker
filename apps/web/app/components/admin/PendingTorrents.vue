<template>
  <div class="card">
    <div class="card-header">
      <div class="queue-head">
        <div class="queue-head-left">
          <Icon name="ph:gavel" class="queue-head-icon" />
          <h3 class="queue-head-title">{{ $t('admin.pendingTorrents.title') }}</h3>
        </div>
        <div class="queue-segments" role="tablist">
          <button
            v-for="opt in STATUS_FILTERS"
            :key="opt.value"
            type="button"
            class="queue-segment"
            :class="[
              `queue-segment--${opt.value}`,
              { 'queue-segment--active': filter === opt.value },
            ]"
            @click="filter = opt.value"
          >
            <span v-if="opt.dot" class="queue-segment-dot" :class="`queue-segment-dot--${opt.value}`" />
            <span class="queue-segment-label">{{ opt.label }}</span>
            <span class="queue-segment-count">{{ counts[opt.value] }}</span>
          </button>
        </div>
      </div>
    </div>

    <div class="card-body">
      <p class="queue-intro">
        <i18n-t keypath="admin.pendingTorrents.intro.lead" tag="span">
          <template #accepted>
            <strong>{{ $t('admin.pendingTorrents.intro.accepted') }}</strong>
          </template>
        </i18n-t>
        <span class="queue-intro-pip queue-intro-pip--pending">{{ $t('admin.pendingTorrents.intro.pendingPip') }}</span>
        {{ $t('admin.pendingTorrents.intro.pendingSuffix') }}
        <span class="queue-intro-pip queue-intro-pip--changes">{{ $t('admin.pendingTorrents.intro.changesPip') }}</span>
        {{ $t('admin.pendingTorrents.intro.changesSuffix') }}
        <span class="queue-intro-pip queue-intro-pip--rejected">{{ $t('admin.pendingTorrents.intro.rejectedPip') }}</span>
        {{ $t('admin.pendingTorrents.intro.trail') }}
      </p>

      <div v-if="loading" class="queue-loading">
        <Icon name="ph:circle-notch" class="animate-spin" />
        {{ $t('admin.pendingTorrents.loading') }}
      </div>

      <div v-else-if="visibleTorrents.length === 0" class="queue-empty">
        <Icon name="ph:check-circle-fill" class="queue-empty-glyph" />
        <p class="queue-empty-text">{{ $t('admin.pendingTorrents.empty.headline') }}</p>
        <p class="queue-empty-help">
          {{ $t('admin.pendingTorrents.empty.help') }}
        </p>
      </div>

      <ul v-else class="queue-list">
        <li
          v-for="row in visibleTorrents"
          :key="row.id"
          class="queue-row"
          :class="`queue-row--${row.moderationStatus}`"
        >
          <NuxtLink
            :to="`/torrents/${row.infoHash}`"
            class="queue-row-name"
            :title="row.name"
          >
            {{ row.name }}
          </NuxtLink>

          <TorrentModerationBadge :status="row.moderationStatus" />

          <dl class="queue-row-meta">
            <div>
              <dt>{{ $t('admin.pendingTorrents.meta.uploadedBy') }}</dt>
              <dd>
                <NuxtLink
                  v-if="row.uploader"
                  :to="`/users/${row.uploader.id}`"
                  class="queue-link"
                >
                  @{{ row.uploader.username }}
                </NuxtLink>
                <span v-else>—</span>
              </dd>
            </div>
            <div v-if="row.category">
              <dt>{{ $t('admin.pendingTorrents.meta.category') }}</dt>
              <dd>{{ row.category.name }}</dd>
            </div>
            <div>
              <dt>{{ $t('admin.pendingTorrents.meta.cast') }}</dt>
              <dd>{{ formatDate(row.createdAt) }}</dd>
            </div>
            <div v-if="row.moderatedBy && row.moderatedAt">
              <dt>{{ $t('admin.pendingTorrents.meta.lastAction') }}</dt>
              <dd>
                <NuxtLink
                  :to="`/users/${row.moderatedBy.id}`"
                  class="queue-link"
                >
                  @{{ row.moderatedBy.username }}
                </NuxtLink>
                <span class="queue-meta-soft">·  {{ formatDate(row.moderatedAt) }}</span>
              </dd>
            </div>
          </dl>

          <NuxtLink
            :to="`/torrents/${row.infoHash}`"
            class="queue-row-cta"
            :title="$t('admin.pendingTorrents.openTitle')"
          >
            <Icon name="ph:arrow-right-bold" />
          </NuxtLink>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue';
import TorrentModerationBadge from '~/components/torrent/TorrentModerationBadge.vue';

const { t } = useI18n();

type Status = 'pending' | 'accepted' | 'changes_requested' | 'rejected';
type FilterValue = 'all' | 'pending' | 'changes_requested' | 'rejected';

interface QueueRow {
  id: string;
  infoHash: string;
  name: string;
  createdAt: string;
  moderationStatus: Status;
  moderatedAt: string | null;
  uploader: { id: string; username: string } | null;
  category: { id: string; name: string } | null;
  moderatedBy: { id: string; username: string } | null;
}

const STATUS_FILTERS = computed<{ value: FilterValue; label: string; dot: boolean }[]>(() => [
  { value: 'all', label: t('admin.pendingTorrents.filters.all'), dot: false },
  { value: 'pending', label: t('admin.pendingTorrents.filters.pending'), dot: true },
  { value: 'changes_requested', label: t('admin.pendingTorrents.filters.changes'), dot: true },
  { value: 'rejected', label: t('admin.pendingTorrents.filters.rejected'), dot: true },
]);

// Default to "pending" — the queue lands first on the active work.
// Moderators can flip to "all" or the closed states from the
// segmented control above.
const filter = ref<FilterValue>('pending');
const torrents = ref<QueueRow[]>([]);
const loading = ref(true);

async function load() {
  loading.value = true;
  try {
    const res = await $fetch<QueueRow[]>('/api/mod/torrents/pending');
    torrents.value = Array.isArray(res) ? res : [];
  } catch (err) {
    console.error('[admin/queue] load failed:', err);
    torrents.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(load);

const visibleTorrents = computed(() => {
  if (filter.value === 'all') return torrents.value;
  return torrents.value.filter((t) => t.moderationStatus === filter.value);
});

const counts = computed(() => {
  const result: Record<FilterValue, number> = {
    all: torrents.value.length,
    pending: 0,
    changes_requested: 0,
    rejected: 0,
  };
  for (const t of torrents.value) {
    if (t.moderationStatus in result) {
      result[t.moderationStatus as FilterValue]++;
    }
  }
  return result;
});

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
</script>

<style scoped>
/*
 * Moderation queue — a "triage" surface. Each filter segment is
 * coloured by its status hue (amber / sky / red) so the moderator
 * can pick a lane at a glance, and the rows themselves carry the
 * same hue on a thick left rail + a tinted background.
 */

.queue-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.875rem;
  width: 100%;
}
.queue-head-left {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
}
.queue-head-icon {
  font-size: 1.15rem;
  color: rgb(var(--fg-strong));
}
.queue-head-title {
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
  margin: 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}

/* ── Segmented filter ─────────────────────────────────── */
.queue-segments {
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: 8px;
}
.queue-segment {
  --s: 161 161 161;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  background: transparent;
  border: 1px solid transparent;
  padding: 0.4rem 0.7rem;
  border-radius: 6px;
  cursor: pointer;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  transition:
    background 140ms ease,
    color 140ms ease,
    border-color 140ms ease;
}
.queue-segment--pending           { --s: 234 179 8; }
.queue-segment--changes_requested { --s: 56 189 248; }
.queue-segment--rejected          { --s: 239 68 68; }
.queue-segment--all               { --s: 250 250 250; }

.queue-segment:hover {
  color: rgb(var(--fg-strong));
  background: rgb(var(--s) / 0.08);
}
.queue-segment--active {
  background: rgb(var(--s) / 0.18);
  border-color: rgb(var(--s) / 0.45);
  color: rgb(var(--s));
}
.queue-segment-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: rgb(var(--s));
  box-shadow: 0 0 0 3px rgb(var(--s) / 0.2);
}
.queue-segment-count {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  background: rgb(var(--s) / 0.18);
  color: rgb(var(--s));
  padding: 0.05rem 0.4rem;
  border-radius: 999px;
  border: 1px solid rgb(var(--s) / 0.35);
  font-weight: 700;
  min-width: 20px;
  text-align: center;
}
.queue-segment:not(.queue-segment--active) .queue-segment-count {
  background: rgb(var(--bg-base));
  color: rgb(var(--fg-muted));
  border-color: rgb(var(--line-default));
}

/* ── Intro paragraph ──────────────────────────────────── */
.queue-intro {
  font-size: 12.5px;
  color: rgb(var(--fg-muted));
  line-height: 1.65;
  margin: 0 0 1.25rem;
}
.queue-intro strong {
  color: rgb(34 197 94);
  font-weight: 700;
}
.queue-intro-pip {
  display: inline-flex;
  align-items: center;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 0.05rem 0.45rem;
  border-radius: 4px;
  border: 1px solid;
}
.queue-intro-pip--pending {
  color: rgb(234 179 8);
  background: rgb(234 179 8 / 0.12);
  border-color: rgb(234 179 8 / 0.4);
}
.queue-intro-pip--changes {
  color: rgb(56 189 248);
  background: rgb(56 189 248 / 0.12);
  border-color: rgb(56 189 248 / 0.4);
}
.queue-intro-pip--rejected {
  color: rgb(239 68 68);
  background: rgb(239 68 68 / 0.12);
  border-color: rgb(239 68 68 / 0.4);
}

/* ── States ───────────────────────────────────────────── */
.queue-loading,
.queue-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 3rem 1rem;
  color: rgb(var(--fg-muted));
  font-size: 13px;
}
.queue-empty-glyph { font-size: 2rem; color: rgb(34 197 94); }
.queue-empty-text {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  font-weight: 700;
  color: rgb(var(--fg-strong));
  margin: 0;
}
.queue-empty-help { font-size: 12px; color: rgb(var(--fg-muted)); margin: 0; }

/* ── Rows ─────────────────────────────────────────────── */
.queue-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.5rem;
}
.queue-row {
  --r: 161 161 161;
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  gap: 0.5rem 0.875rem;
  padding: 0.95rem 1.1rem 0.95rem 1.25rem;
  border: 1px solid rgb(var(--line-default));
  background:
    linear-gradient(90deg, rgb(var(--r) / 0.06) 0%, transparent 30%),
    rgb(var(--bg-elevated));
  border-left: 4px solid rgb(var(--r));
  border-radius: 8px;
  position: relative;
  transition: background 160ms ease, border-color 160ms ease, transform 160ms ease;
}
.queue-row:hover {
  border-color: rgb(var(--r) / 0.5);
  background:
    linear-gradient(90deg, rgb(var(--r) / 0.12) 0%, transparent 50%),
    rgb(var(--bg-hover));
  transform: translateX(2px);
}
.queue-row--pending           { --r: 234 179 8; }
.queue-row--changes_requested { --r: 56 189 248; }
.queue-row--rejected          { --r: 239 68 68; }

.queue-row-name {
  grid-row: 1;
  grid-column: 1;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 13.5px;
  font-weight: 700;
  color: rgb(var(--fg-strong));
  text-decoration: none;
  word-break: break-all;
  line-height: 1.35;
}
.queue-row-name:hover {
  color: rgb(var(--r));
}

/* The badge sits at the top-right of the row, aligned to the title. */
.queue-row > :deep(.mod-badge) {
  grid-row: 1;
  grid-column: 2;
  align-self: start;
}

.queue-row-meta {
  grid-row: 2;
  grid-column: 1 / 3;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 1.25rem;
  margin: 0;
  font-size: 11px;
}
.queue-row-meta > div {
  display: inline-flex;
  align-items: baseline;
  gap: 0.4rem;
}
.queue-row-meta dt {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-subtle));
  font-weight: 700;
}
.queue-row-meta dd {
  margin: 0;
  color: rgb(var(--fg-default));
  font-size: 11.5px;
}
.queue-meta-soft { color: rgb(var(--fg-subtle)); }
.queue-link {
  color: rgb(var(--r));
  text-decoration: none;
  border-bottom: 1px solid rgb(var(--r) / 0.4);
  font-weight: 600;
}
.queue-link:hover { border-color: rgb(var(--r)); }

.queue-row-cta {
  grid-row: 1;
  grid-column: 2;
  display: none; /* badge takes that slot; CTA is hidden — name link covers the action */
}
@media (min-width: 720px) {
  .queue-row {
    grid-template-columns: 1fr auto 32px;
    grid-template-rows: auto auto;
    gap: 0.5rem 0.75rem;
  }
  .queue-row > :deep(.mod-badge) {
    grid-row: 1;
    grid-column: 2;
  }
  .queue-row-cta {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    grid-row: 1 / 3;
    grid-column: 3;
    width: 32px;
    height: 32px;
    align-self: center;
    border-radius: 6px;
    background: rgb(var(--bg-base));
    color: rgb(var(--r));
    border: 1px solid rgb(var(--r) / 0.3);
    text-decoration: none;
    transition:
      background 140ms ease,
      transform 140ms ease,
      color 140ms ease,
      border-color 140ms ease;
  }
  .queue-row-cta:hover {
    background: rgb(var(--r) / 0.16);
    border-color: rgb(var(--r));
    color: rgb(var(--r));
    transform: translateX(2px);
  }
  .queue-row-meta {
    grid-column: 1 / 3;
  }
}
</style>
