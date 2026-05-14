<template>
  <!--
    NotificationBell — header dropdown.

    The pop-up is shaped like a small inbox console: a gold rail
    threads the top edge, the unread count sits beside the title in
    a coloured badge, and the "mark all read" action lives as a
    proper button next to it so the user doesn't have to hunt for
    it. A two-chip filter strip switches between unread-only and
    full feed; each row reveals a one-click "mark this read" check
    on hover so the user can clear noise without ever opening the
    full /notifications page.
  -->
  <div class="nbell" ref="rootRef">
    <button
      type="button"
      class="nbell-btn"
      :class="{ 'nbell-btn--open': open }"
      :aria-label="$t('notifications.toggleLabel')"
      :aria-expanded="open"
      @click.stop="toggle"
    >
      <Icon
        :name="hasUnread ? 'ph:bell-fill' : 'ph:bell'"
        class="nbell-icon"
      />
      <span
        v-if="hasUnread"
        class="nbell-badge"
        :class="{ 'nbell-badge--many': displayCount.length > 1 }"
      >{{ displayCount }}</span>
    </button>

    <Transition name="nbell-pop">
      <div
        v-if="open"
        class="nbell-pop"
        role="dialog"
        :aria-label="$t('notifications.toggleLabel')"
      >
        <!-- ── Header strip ───────────────────────────────────── -->
        <header class="nbell-pop-head">
          <span class="nbell-eyebrow">
            <span class="nbell-eyebrow-rule" aria-hidden="true" />
            {{ $t('notifications.eyebrow') }}
          </span>
          <div class="nbell-pop-row">
            <h3 class="nbell-pop-title">{{ $t('notifications.title') }}</h3>
            <span
              v-if="hasUnread"
              class="nbell-pop-count tabular-nums"
              :title="$t('notifications.unreadTitle', { n: state.unreadCount })"
            >
              {{ state.unreadCount > 99 ? '99+' : state.unreadCount }}
            </span>
            <button
              v-if="hasUnread"
              type="button"
              class="nbell-pop-mark"
              :disabled="markingAll"
              @click="onMarkAllRead"
            >
              <Icon
                :name="markingAll ? 'ph:circle-notch' : 'ph:checks-bold'"
                :class="{ 'nbell-loading-spin': markingAll }"
              />
              <span>{{ $t('notifications.markAllRead') }}</span>
            </button>
          </div>
        </header>

        <!-- ── Filter strip ───────────────────────────────────── -->
        <nav v-if="state.initialised && state.items.length > 0" class="nbell-filters">
          <button
            type="button"
            class="nbell-filter"
            :class="{ 'nbell-filter--on': filter === 'unread' }"
            @click="filter = 'unread'"
          >
            <span class="nbell-filter-dot" :class="{ 'nbell-filter-dot--on': filter === 'unread' && hasUnread }" />
            {{ $t('notifications.filter.unread') }}
            <span class="nbell-filter-count tabular-nums">{{ state.unreadCount }}</span>
          </button>
          <button
            type="button"
            class="nbell-filter"
            :class="{ 'nbell-filter--on': filter === 'all' }"
            @click="filter = 'all'"
          >
            {{ $t('notifications.filter.all') }}
            <span class="nbell-filter-count tabular-nums">{{ state.items.length }}</span>
          </button>
        </nav>

        <!-- ── Loading / empty ────────────────────────────────── -->
        <div v-if="!state.initialised" class="nbell-pop-empty">
          <Icon name="ph:circle-notch" class="nbell-loading-spin" />
          <span>{{ $t('notifications.loading') }}</span>
        </div>

        <div v-else-if="state.items.length === 0" class="nbell-pop-empty">
          <div class="nbell-empty-stamp" aria-hidden="true">
            <Icon name="ph:envelope-open-bold" />
          </div>
          <span>{{ $t('notifications.empty') }}</span>
        </div>

        <div v-else-if="visibleItems.length === 0" class="nbell-pop-empty">
          <div class="nbell-empty-stamp nbell-empty-stamp--clear" aria-hidden="true">
            <Icon name="ph:check-fat-bold" />
          </div>
          <span>{{ $t('notifications.allCaughtUp') }}</span>
        </div>

        <!-- ── List ────────────────────────────────────────────── -->
        <ul v-else class="nbell-list">
          <li
            v-for="(row, i) in visibleItems"
            :key="row.id"
            class="nbell-row"
            :class="{ 'nbell-row--unread': !row.readAt }"
            :style="{ '--stagger': `${i * 25}ms` }"
            @click="onRowClick(row)"
          >
            <span
              class="nbell-row-rail"
              :class="`nbell-row-rail--${toneFor(row.type)}`"
              aria-hidden="true"
            />
            <Icon
              :name="iconFor(row.type)"
              class="nbell-row-icon"
              :class="`nbell-row-icon--${toneFor(row.type)}`"
            />
            <div class="nbell-row-body">
              <p class="nbell-row-title">{{ titleFor(row) }}</p>
              <p v-if="descFor(row)" class="nbell-row-desc">{{ descFor(row) }}</p>
              <p class="nbell-row-time tabular-nums">{{ formatAge(row.createdAt) }}</p>
            </div>
            <!-- Per-row "mark read" — only on unread rows. Always
                 visible on touch, hover-revealed on pointer for a
                 calmer default look. -->
            <button
              v-if="!row.readAt"
              type="button"
              class="nbell-row-clear"
              :aria-label="$t('notifications.markOne')"
              :title="$t('notifications.markOne')"
              @click.stop="onMarkOne(row.id)"
            >
              <Icon name="ph:check-bold" />
            </button>
          </li>
        </ul>

        <!-- ── Footer ─────────────────────────────────────────── -->
        <footer v-if="state.initialised" class="nbell-pop-foot">
          <NuxtLink to="/notifications" class="nbell-pop-all" @click="open = false">
            {{ $t('notifications.seeAll') }}
            <Icon name="ph:arrow-right-bold" />
          </NuxtLink>
        </footer>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { formatAge } from '~/utils/format';
import { safeInAppPath } from '~/utils/safePath';
import { useNotifications, type NotificationRow } from '~/composables/useNotifications';

const { t } = useI18n();
const { state, markAllRead, markRead } = useNotifications();
const router = useRouter();

const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);
const filter = ref<'unread' | 'all'>('unread');
const markingAll = ref(false);

const hasUnread = computed(() => state.value.unreadCount > 0);
const displayCount = computed(() => {
  const n = state.value.unreadCount;
  if (n === 0) return '';
  if (n > 99) return '99+';
  return String(n);
});

const visibleItems = computed(() => {
  const items = state.value.items.slice(0, 12);
  if (filter.value === 'unread') {
    return items.filter((i) => !i.readAt);
  }
  return items;
});

function toggle() {
  open.value = !open.value;
  if (open.value) {
    // Land on the filter that matters most — unread when there
    // are any, the full feed otherwise so the popover isn't empty.
    filter.value = hasUnread.value ? 'unread' : 'all';
  }
}

async function onMarkAllRead() {
  if (markingAll.value) return;
  markingAll.value = true;
  try {
    await markAllRead();
  } finally {
    markingAll.value = false;
  }
}

async function onMarkOne(id: string) {
  await markRead(id);
}

function onRowClick(row: NotificationRow) {
  void markRead(row.id);
  open.value = false;
  if (row.link) {
    // Notification rows carry a server-supplied link string. Router
    // will treat bare strings as in-app paths, but `//evil.tld/...`
    // or `https://evil.tld/...` would still navigate off-origin.
    // `safeInAppPath` coerces anything not matching our origin to
    // '/' so a poisoned row can't be used to phish the user.
    void router.push(safeInAppPath(row.link));
  }
}

function onDocClick(ev: MouseEvent) {
  if (!open.value || !rootRef.value) return;
  if (!rootRef.value.contains(ev.target as Node)) {
    open.value = false;
  }
}
function onKey(ev: KeyboardEvent) {
  if (ev.key === 'Escape' && open.value) open.value = false;
}
onMounted(() => {
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick);
  document.removeEventListener('keydown', onKey);
});

// ── Per-type display mapping ─────────────────────────────────────
const TYPE_DEFAULTS: Record<
  string,
  { icon: string; tone: 'info' | 'warn' | 'danger' | 'gain' | 'spend' | 'social' }
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
  return translated === key ? humanise(row.type) : translated;
}

function descFor(row: NotificationRow): string {
  const key = `notifications.types.${row.type}.desc`;
  const payload = (row.payload ?? {}) as Record<string, string | number>;
  const translated = t(key, payload);
  return translated === key ? '' : translated;
}

function humanise(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
</script>

<style scoped>
.nbell {
  position: relative;
}

/* ── Bell trigger ───────────────────────────────────────── */
.nbell-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  background: transparent;
  border: 0;
  color: rgb(var(--fg-muted));
  border-radius: 4px;
  cursor: pointer;
  transition: color 0.14s ease, background 0.14s ease;
}
.nbell-btn:hover {
  color: rgb(var(--fg-strong));
  background: rgb(var(--fg-default) / 0.05);
}
.nbell-btn--open {
  color: #d4a734;
  background: rgba(212, 167, 52, 0.08);
}
.nbell-icon { font-size: 1.05rem; }
.nbell-badge {
  position: absolute;
  top: 0.1rem;
  right: 0.1rem;
  min-width: 0.95rem;
  height: 0.95rem;
  padding: 0 0.25rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #f43f5e;
  color: #fff;
  border-radius: 9999px;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.02em;
  border: 2px solid rgb(var(--bg-base));
  box-shadow: 0 0 0 1px rgba(244, 63, 94, 0.45);
}

/* ── Popover ────────────────────────────────────────────── */
.nbell-pop {
  position: absolute;
  top: calc(100% + 0.5rem);
  right: 0;
  width: min(24rem, calc(100vw - 1.5rem));
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-strong));
  border-radius: var(--radius-md);
  box-shadow: 0 18px 48px rgb(0 0 0 / 0.5);
  overflow: hidden;
  z-index: 40;
  display: flex;
  flex-direction: column;
}
.nbell-pop::before {
  /* Gold filament along the top — visual link to the admin
     console family. */
  content: '';
  position: absolute;
  top: 0;
  inset-inline: 0.85rem;
  height: 1px;
  background: linear-gradient(
    to right,
    rgba(212, 167, 52, 0) 0%,
    rgba(212, 167, 52, 0.7) 50%,
    rgba(212, 167, 52, 0) 100%
  );
}

/* ── Header strip ───────────────────────────────────────── */
.nbell-pop-head {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.7rem 0.9rem 0.75rem;
  background: rgb(var(--bg-base));
  border-bottom: 1px solid rgb(var(--line-default));
}
.nbell-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: #d4a734;
}
.nbell-eyebrow-rule {
  display: inline-block;
  width: 18px;
  height: 1px;
  background: #d4a734;
}
.nbell-pop-row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}
.nbell-pop-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 800;
  letter-spacing: -0.005em;
  color: rgb(var(--fg-strong));
}
.nbell-pop-count {
  display: inline-grid;
  place-items: center;
  min-width: 1.4rem;
  height: 1.1rem;
  padding: 0 0.35rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 800;
  background: rgba(244, 63, 94, 0.12);
  border: 1px solid rgba(244, 63, 94, 0.45);
  color: #f43f5e;
  border-radius: 999px;
  letter-spacing: 0.02em;
}
.nbell-pop-mark {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin-left: auto;
  padding: 0.35rem 0.65rem;
  background: rgba(212, 167, 52, 0.1);
  border: 1px solid rgba(212, 167, 52, 0.45);
  border-radius: var(--radius-sm);
  font-family: inherit;
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #d4a734;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}
.nbell-pop-mark:hover:not(:disabled) {
  background: rgba(212, 167, 52, 0.18);
  border-color: rgba(212, 167, 52, 0.7);
}
.nbell-pop-mark:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.nbell-pop-mark svg { font-size: 0.85rem; }

/* ── Filter chips ──────────────────────────────────────── */
.nbell-filters {
  display: flex;
  gap: 0.35rem;
  padding: 0.55rem 0.9rem;
  background: rgb(var(--bg-base));
  border-bottom: 1px solid rgb(var(--line-default));
}
.nbell-filter {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.32rem 0.65rem;
  background: transparent;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  cursor: pointer;
  transition: all 0.15s ease;
}
.nbell-filter:hover {
  color: rgb(var(--fg-strong));
  border-color: rgb(var(--line-strong));
}
.nbell-filter--on {
  color: #d4a734;
  background: rgba(212, 167, 52, 0.08);
  border-color: rgba(212, 167, 52, 0.5);
}
.nbell-filter-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgb(var(--line-strong));
  transition: background 0.16s ease;
}
.nbell-filter-dot--on {
  background: #f43f5e;
  box-shadow: 0 0 6px rgba(244, 63, 94, 0.7);
  animation: nbell-blip 1.6s ease-in-out infinite;
}
@keyframes nbell-blip {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}
.nbell-filter-count {
  display: inline-grid;
  place-items: center;
  min-width: 18px;
  height: 16px;
  padding: 0 0.3rem;
  border-radius: 999px;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  font-size: 9px;
  font-weight: 800;
  color: inherit;
}
.nbell-filter--on .nbell-filter-count {
  background: rgb(var(--bg-base));
  border-color: rgba(212, 167, 52, 0.45);
}

/* ── Empty / loading ───────────────────────────────────── */
.nbell-pop-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.65rem;
  padding: 2rem 1.5rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  text-align: center;
}
.nbell-empty-stamp {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: rgba(212, 167, 52, 0.08);
  border: 1px solid rgba(212, 167, 52, 0.4);
  color: #d4a734;
  font-size: 1.2rem;
}
.nbell-empty-stamp--clear {
  background: rgba(108, 209, 97, 0.08);
  border-color: rgba(108, 209, 97, 0.45);
  color: #6cd161;
  transform: rotate(-6deg);
}
.nbell-loading-spin {
  animation: nbell-spin 0.9s linear infinite;
}
@keyframes nbell-spin {
  to { transform: rotate(360deg); }
}

/* ── List ──────────────────────────────────────────────── */
.nbell-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 26rem;
  overflow-y: auto;
}
.nbell-list::-webkit-scrollbar { width: 6px; }
.nbell-list::-webkit-scrollbar-thumb {
  background: rgba(212, 167, 52, 0.25);
  border-radius: 6px;
}

.nbell-row {
  position: relative;
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr) auto;
  gap: 0.6rem;
  align-items: flex-start;
  padding: 0.65rem 0.85rem 0.65rem 0.9rem;
  cursor: pointer;
  border-bottom: 1px solid rgb(var(--line-default) / 0.45);
  transition: background 0.14s ease;
  animation: nbell-in 0.32s cubic-bezier(0.2, 0.7, 0.2, 1) backwards;
  animation-delay: var(--stagger, 0ms);
}
@keyframes nbell-in {
  from { opacity: 0; transform: translateY(3px); }
  to { opacity: 1; transform: translateY(0); }
}
.nbell-row:last-child { border-bottom: 0; }
.nbell-row:hover {
  background: rgb(var(--bg-base));
}
.nbell-row--unread {
  background: rgba(212, 167, 52, 0.04);
}
.nbell-row--unread:hover {
  background: rgba(212, 167, 52, 0.08);
}

/* Tiny status rail at the leftmost edge — coloured by the
   notification's tone. Only fully visible for unread rows; read
   rows get a thin grey rail so the column stays aligned. */
.nbell-row-rail {
  width: 2px;
  align-self: stretch;
  margin-right: 0.15rem;
  background: rgb(var(--line-default));
  border-radius: 1px;
}
.nbell-row--unread .nbell-row-rail--gain { background: #6cd161; box-shadow: 0 0 5px rgba(108, 209, 97, 0.5); }
.nbell-row--unread .nbell-row-rail--spend { background: #d4a734; box-shadow: 0 0 5px rgba(212, 167, 52, 0.5); }
.nbell-row--unread .nbell-row-rail--warn { background: #fb923c; box-shadow: 0 0 5px rgba(251, 146, 60, 0.5); }
.nbell-row--unread .nbell-row-rail--danger { background: #f43f5e; box-shadow: 0 0 5px rgba(244, 63, 94, 0.5); }
.nbell-row--unread .nbell-row-rail--social { background: #60a5fa; box-shadow: 0 0 5px rgba(96, 165, 250, 0.5); }
.nbell-row--unread .nbell-row-rail--info { background: rgb(var(--fg-strong)); }

.nbell-row-icon {
  font-size: 1rem;
  flex-shrink: 0;
  padding: 0.3rem;
  border-radius: var(--radius-sm);
  align-self: flex-start;
}
.nbell-row-icon--gain {
  color: #6cd161;
  background: rgba(108, 209, 97, 0.1);
}
.nbell-row-icon--spend {
  color: #d4a734;
  background: rgba(212, 167, 52, 0.1);
}
.nbell-row-icon--info {
  color: rgb(var(--fg-strong));
  background: rgb(var(--fg-default) / 0.08);
}
.nbell-row-icon--warn {
  color: #fb923c;
  background: rgba(251, 146, 60, 0.1);
}
.nbell-row-icon--danger {
  color: #f43f5e;
  background: rgba(244, 63, 94, 0.1);
}
.nbell-row-icon--social {
  color: #60a5fa;
  background: rgba(96, 165, 250, 0.1);
}

.nbell-row-body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.nbell-row-title {
  margin: 0;
  font-size: 0.83rem;
  font-weight: 600;
  color: rgb(var(--fg-strong));
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.nbell-row--unread .nbell-row-title {
  font-weight: 700;
}
.nbell-row-desc {
  margin: 0;
  font-size: 0.72rem;
  color: rgb(var(--fg-muted));
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.nbell-row-time {
  margin: 0.2rem 0 0;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  letter-spacing: 0.06em;
  color: rgb(var(--fg-faint));
}

/* Per-row "mark this read". Sits at a low opacity by default so
   the row stays visually calm, but never invisible — the previous
   `opacity:0` version left the button in the tab order while
   completely hidden, which disoriented keyboard users tabbing
   through the popover. Touch targets bumped to 36px to clear the
   WCAG 2.5.5 minimum. */
.nbell-row-clear {
  align-self: center;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
  background: rgba(212, 167, 52, 0.08);
  border: 1px solid rgba(212, 167, 52, 0.35);
  border-radius: var(--radius-sm);
  color: #d4a734;
  cursor: pointer;
  opacity: 0.45;
  transition: opacity 0.18s ease, background 0.15s ease,
    border-color 0.15s ease;
}
.nbell-row-clear svg { font-size: 0.85rem; }
.nbell-row:hover .nbell-row-clear,
.nbell-row-clear:focus-visible {
  opacity: 1;
}
.nbell-row-clear:hover {
  background: rgba(212, 167, 52, 0.18);
  border-color: rgba(212, 167, 52, 0.6);
  opacity: 1;
}

/* ── Footer ────────────────────────────────────────────── */
.nbell-pop-foot {
  border-top: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-base));
}
.nbell-pop-all {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  padding: 0.7rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  text-decoration: none;
  transition: all 0.16s ease;
}
.nbell-pop-all:hover {
  color: #d4a734;
  background: rgba(212, 167, 52, 0.06);
}
.nbell-pop-all svg {
  transition: transform 0.16s ease;
}
.nbell-pop-all:hover svg {
  transform: translateX(2px);
}

/* ── Pop transition ────────────────────────────────────── */
.nbell-pop-enter-active,
.nbell-pop-leave-active {
  transition: opacity 0.18s ease, transform 0.22s cubic-bezier(0.2, 0.7, 0.2, 1);
}
.nbell-pop-enter-from,
.nbell-pop-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.97);
}
</style>
