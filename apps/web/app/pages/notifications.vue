<template>
  <div class="np">
    <header class="np-head">
      <div>
        <p class="np-eyebrow">{{ $t('notifications.pageEyebrow') }}</p>
        <h1 class="np-title">{{ $t('notifications.pageTitle') }}</h1>
      </div>
      <div class="np-head-actions">
        <button
          type="button"
          class="np-filter"
          :class="{ 'np-filter--on': unreadOnly }"
          @click="toggleUnreadOnly"
        >
          <Icon :name="unreadOnly ? 'ph:funnel-fill' : 'ph:funnel'" />
          {{ unreadOnly ? $t('notifications.showAll') : $t('notifications.showUnreadOnly') }}
          <span v-if="state.unreadCount > 0" class="np-filter-count">
            {{ state.unreadCount > 99 ? '99+' : state.unreadCount }}
          </span>
        </button>
        <button
          v-if="state.unreadCount > 0"
          type="button"
          class="np-mark-all"
          @click="onMarkAllRead"
        >
          <Icon name="ph:check-bold" />
          {{ $t('notifications.markAllRead') }}
        </button>
      </div>
    </header>

    <div v-if="!state.initialised && rows.length === 0" class="np-loading">
      <Icon name="ph:circle-notch" class="np-spin" />
      <span>{{ $t('notifications.loading') }}</span>
    </div>

    <div v-else-if="rows.length === 0" class="np-empty">
      <Icon name="ph:scroll" class="np-empty-icon" />
      <h2>
        {{ unreadOnly ? $t('notifications.emptyUnread') : $t('notifications.empty') }}
      </h2>
      <p>{{ $t('notifications.emptyHint') }}</p>
    </div>

    <ol v-else class="np-list">
      <li
        v-for="row in rows"
        :key="row.id"
        class="np-row"
        :class="{ 'np-row--unread': !row.readAt }"
        @click="onRowClick(row)"
      >
        <Icon
          :name="iconFor(row.type)"
          class="np-row-icon"
          :class="`np-row-icon--${toneFor(row.type)}`"
        />
        <div class="np-row-body">
          <p class="np-row-title">{{ titleFor(row) }}</p>
          <p v-if="descFor(row)" class="np-row-desc">{{ descFor(row) }}</p>
          <p class="np-row-meta">
            <span>{{ formatFullDate(row.createdAt) }}</span>
            <span v-if="row.readAt" class="np-row-meta-sep">·</span>
            <span v-if="row.readAt" class="np-row-meta-read">
              {{ $t('notifications.markedReadAt', { time: formatAge(row.readAt) }) }}
            </span>
          </p>
        </div>
        <span v-if="!row.readAt" class="np-row-dot" aria-hidden="true" />
      </li>
    </ol>

    <button
      v-if="hasMore"
      type="button"
      class="np-load-more"
      :disabled="loadingMore"
      @click="onLoadMore"
    >
      <Icon
        :name="loadingMore ? 'ph:circle-notch' : 'ph:caret-double-down-bold'"
        :class="loadingMore ? 'np-spin' : ''"
      />
      <span>{{ $t('notifications.loadMore') }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { formatAge } from '~/utils/format';
import { useNotifications, type NotificationRow } from '~/composables/useNotifications';

const { t } = useI18n();
const { state, markAllRead, markRead, fetchInitial, loadMore } =
  useNotifications();
const router = useRouter();

useHead({ title: () => t('notifications.pageTitle') });

// Local "older rows" extending the composable's in-memory list.
// The composable caps its window at MAX_IN_MEMORY (50); deeper
// history lives only here, fetched on demand.
const olderRows = ref<NotificationRow[]>([]);
const hasMore = ref(false);
const cursor = ref<string | null>(null);
const loadingMore = ref(false);
const unreadOnly = ref(false);

// Combined list = composable (live) + older. Filter applied on top.
const rows = computed<NotificationRow[]>(() => {
  const all = [...state.value.items, ...olderRows.value];
  // De-dup by id in case a row crossed the boundary mid-fetch.
  const seen = new Set<string>();
  const out: NotificationRow[] = [];
  for (const r of all) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    if (unreadOnly.value && r.readAt) continue;
    out.push(r);
  }
  return out;
});

onMounted(async () => {
  await fetchInitial();
  // Determine the oldest row's createdAt as cursor for the next page.
  const last = state.value.items[state.value.items.length - 1];
  if (last) {
    cursor.value = last.createdAt;
    hasMore.value = state.value.items.length >= 50;
  } else {
    hasMore.value = false;
  }
});

async function onLoadMore() {
  if (!cursor.value || loadingMore.value) return;
  loadingMore.value = true;
  try {
    const res = await loadMore(cursor.value);
    olderRows.value.push(...res.items);
    hasMore.value = res.hasMore;
    cursor.value = res.nextCursor;
  } finally {
    loadingMore.value = false;
  }
}

async function onMarkAllRead() {
  await markAllRead();
  // Mark the older-rows mirror too so the UI is consistent.
  for (const r of olderRows.value) {
    if (!r.readAt) r.readAt = new Date().toISOString();
  }
}

function onRowClick(row: NotificationRow) {
  void markRead(row.id);
  if (row.link) {
    void router.push(row.link);
  }
}

function toggleUnreadOnly() {
  unreadOnly.value = !unreadOnly.value;
}

function formatFullDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Same mapping as the bell — copied here so the page works
// even if the bell isn't mounted (e.g. a deep-link from email).
const TYPE_DEFAULTS: Record<
  string,
  { icon: string; tone: string }
> = {
  upload_accepted: { icon: 'ph:check-circle-fill', tone: 'gain' },
  upload_rejected: { icon: 'ph:x-circle-fill', tone: 'danger' },
  upload_changes_requested: { icon: 'ph:pencil-simple-line-bold', tone: 'warn' },
  upload_reset: { icon: 'ph:arrow-counter-clockwise-bold', tone: 'info' },
  moderation_message_received: { icon: 'ph:chat-circle-text-bold', tone: 'info' },
  torrent_deleted_by_staff: { icon: 'ph:trash-bold', tone: 'danger' },
  hnr_violation_marked: { icon: 'ph:lightning-bold', tone: 'danger' },
  hnr_cleared: { icon: 'ph:check-circle-bold', tone: 'gain' },
  hnr_exempted: { icon: 'ph:shield-check-bold', tone: 'gain' },
  account_banned: { icon: 'ph:prohibit-bold', tone: 'danger' },
  account_unbanned: { icon: 'ph:lock-key-open-bold', tone: 'gain' },
  role_attached_manually: { icon: 'ph:user-circle-gear-bold', tone: 'info' },
  role_detached: { icon: 'ph:user-circle-minus-bold', tone: 'info' },
  staff_status_changed: { icon: 'ph:shield-bold', tone: 'info' },
  bonus_points_adjusted: { icon: 'ph:coin-bold', tone: 'spend' },
  password_changed: { icon: 'ph:key-bold', tone: 'info' },
  totp_enabled: { icon: 'ph:device-mobile-bold', tone: 'gain' },
  totp_disabled: { icon: 'ph:device-mobile-slash-bold', tone: 'warn' },
  passkey_added: { icon: 'ph:fingerprint-bold', tone: 'gain' },
  passkey_removed: { icon: 'ph:fingerprint-simple-bold', tone: 'warn' },
  recovery_codes_regenerated: { icon: 'ph:lifebuoy-bold', tone: 'info' },
  recovery_code_used: { icon: 'ph:lifebuoy-bold', tone: 'warn' },
  login_new_ip: { icon: 'ph:globe-bold', tone: 'warn' },
  comment_on_my_upload: { icon: 'ph:chat-circle-text-bold', tone: 'social' },
  forum_reply_on_my_topic: { icon: 'ph:chats-circle-bold', tone: 'social' },
  comment_deleted_by_staff: { icon: 'ph:trash-bold', tone: 'warn' },
  forum_post_deleted_by_staff: { icon: 'ph:trash-bold', tone: 'warn' },
  bonus_event_started: { icon: 'ph:gift-bold', tone: 'gain' },
  first_seeder_reward: { icon: 'ph:crown-bold', tone: 'gain' },
  seeding_milestone_reached: { icon: 'ph:trophy-bold', tone: 'gain' },
  invite_redeemed: { icon: 'ph:envelope-simple-open-bold', tone: 'gain' },
  invitee_banned: { icon: 'ph:user-minus-bold', tone: 'warn' },
  new_pending_upload: { icon: 'ph:cassette-tape-bold', tone: 'info' },
  new_report_filed: { icon: 'ph:flag-bold', tone: 'warn' },
  report_actioned: { icon: 'ph:gavel-bold', tone: 'info' },
  trusted_device_added: { icon: 'ph:laptop-bold', tone: 'info' },
};

function iconFor(type: string): string {
  return TYPE_DEFAULTS[type]?.icon ?? 'ph:bell-bold';
}
function toneFor(type: string): string {
  return TYPE_DEFAULTS[type]?.tone ?? 'info';
}
function titleFor(row: NotificationRow): string {
  const key = `notifications.types.${row.type}.title`;
  const payload = (row.payload ?? {}) as Record<string, string | number>;
  const translated = t(key, payload);
  return translated === key ? row.type.replace(/_/g, ' ') : translated;
}
function descFor(row: NotificationRow): string {
  const key = `notifications.types.${row.type}.desc`;
  const payload = (row.payload ?? {}) as Record<string, string | number>;
  const translated = t(key, payload);
  return translated === key ? '' : translated;
}
</script>

<style scoped>
.np {
  max-width: 56rem;
  margin: 0 auto;
}

.np-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1.5rem;
  flex-wrap: wrap;
  margin-bottom: 2rem;
}
.np-eyebrow {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  margin: 0 0 0.4rem;
}
.np-title {
  font-size: clamp(1.8rem, 4vw, 2.5rem);
  font-weight: 900;
  letter-spacing: -0.02em;
  text-transform: uppercase;
  margin: 0;
  line-height: 1;
}

.np-head-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.np-filter,
.np-mark-all {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.8rem;
  border-radius: 9999px;
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-surface));
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  cursor: pointer;
  transition: all 0.14s ease;
}
.np-filter:hover,
.np-mark-all:hover {
  color: rgb(var(--fg-strong));
  border-color: rgb(var(--line-strong));
}
.np-filter--on {
  background: rgb(var(--accent));
  color: rgb(var(--accent-fg));
  border-color: rgb(var(--accent));
}
.np-filter--on:hover {
  color: rgb(var(--accent-fg));
  background: rgb(var(--accent-hover));
}
.np-filter-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1rem;
  padding: 0 0.3rem;
  height: 1rem;
  background: rgb(var(--bg-base) / 0.4);
  border-radius: 9999px;
  font-size: 9px;
  letter-spacing: 0;
}

.np-loading,
.np-empty {
  text-align: center;
  padding: 4rem 1.5rem;
  border: 1px dashed rgb(var(--line-default));
  border-radius: 0.5rem;
}
.np-spin {
  animation: np-spin-anim 0.9s linear infinite;
  display: inline-block;
}
@keyframes np-spin-anim {
  to { transform: rotate(360deg); }
}
.np-loading {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.np-empty-icon {
  font-size: 2.5rem;
  color: rgb(var(--fg-faint));
  margin-bottom: 0.85rem;
}
.np-empty h2 {
  margin: 0 0 0.4rem;
  font-size: 0.9rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
}
.np-empty p {
  margin: 0;
  font-size: 0.8rem;
  color: rgb(var(--fg-muted));
  max-width: 36ch;
  margin-inline: auto;
}

/* ─── Rows ────────────────────────────────────────────────── */
.np-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.5rem;
  overflow: hidden;
}
.np-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 1rem;
  align-items: flex-start;
  padding: 1rem 1.25rem;
  background: rgb(var(--bg-surface));
  border-bottom: 1px solid rgb(var(--line-default));
  cursor: pointer;
  transition: background 0.12s ease;
}
.np-row:last-child {
  border-bottom: 0;
}
.np-row:hover {
  background: rgb(var(--bg-elevated) / 0.75);
}
.np-row--unread {
  background: rgb(var(--accent) / 0.04);
}
.np-row--unread:hover {
  background: rgb(var(--accent) / 0.08);
}

.np-row-icon {
  font-size: 1.4rem;
  flex-shrink: 0;
  padding: 0.5rem;
  border-radius: 0.4rem;
}
.np-row-icon--gain {
  color: rgb(var(--online));
  background: rgb(var(--online) / 0.1);
}
.np-row-icon--spend {
  color: #d4a734;
  background: rgba(212, 167, 52, 0.1);
}
.np-row-icon--info {
  color: rgb(var(--fg-strong));
  background: rgb(var(--fg-default) / 0.08);
}
.np-row-icon--warn {
  color: rgb(var(--warning));
  background: rgb(var(--warning) / 0.1);
}
.np-row-icon--danger {
  color: rgb(var(--danger));
  background: rgb(var(--danger) / 0.1);
}
.np-row-icon--social {
  color: rgb(var(--info));
  background: rgb(var(--info) / 0.1);
}

.np-row-body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.np-row-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
  color: rgb(var(--fg-strong));
  line-height: 1.3;
}
.np-row-desc {
  margin: 0;
  font-size: 0.82rem;
  color: rgb(var(--fg-muted));
  line-height: 1.5;
}
.np-row-meta {
  margin: 0.25rem 0 0;
  display: flex;
  gap: 0.5rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  color: rgb(var(--fg-faint));
}
.np-row-meta-sep {
  color: rgb(var(--fg-faint) / 0.6);
}
.np-row-meta-read {
  color: rgb(var(--fg-muted));
}

.np-row-dot {
  width: 0.5rem;
  height: 0.5rem;
  margin-top: 0.85rem;
  border-radius: 50%;
  background: rgb(var(--accent));
  flex-shrink: 0;
}

/* ─── Load more ───────────────────────────────────────────── */
.np-load-more {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin: 1.5rem auto 0;
  padding: 0.6rem 1.1rem;
  background: transparent;
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.4rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  cursor: pointer;
  transition: all 0.16s ease;
}
.np-load-more:hover:not(:disabled) {
  color: rgb(var(--fg-strong));
  border-color: rgb(var(--line-strong));
}
.np-load-more:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
