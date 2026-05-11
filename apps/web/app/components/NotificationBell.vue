<template>
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
      <div v-if="open" class="nbell-pop" role="dialog" :aria-label="$t('notifications.toggleLabel')">
        <header class="nbell-pop-head">
          <h3 class="nbell-pop-title">{{ $t('notifications.title') }}</h3>
          <button
            v-if="hasUnread"
            type="button"
            class="nbell-pop-action"
            @click="onMarkAllRead"
          >
            <Icon name="ph:check-bold" />
            {{ $t('notifications.markAllRead') }}
          </button>
        </header>

        <div v-if="!state.initialised" class="nbell-pop-empty">
          <Icon name="ph:circle-notch" class="nbell-loading-spin" />
          <span>{{ $t('notifications.loading') }}</span>
        </div>

        <div v-else-if="state.items.length === 0" class="nbell-pop-empty">
          <Icon name="ph:scroll" />
          <span>{{ $t('notifications.empty') }}</span>
        </div>

        <ul v-else class="nbell-list">
          <li
            v-for="row in state.items.slice(0, 8)"
            :key="row.id"
            class="nbell-row"
            :class="{ 'nbell-row--unread': !row.readAt }"
            @click="onRowClick(row)"
          >
            <Icon
              :name="iconFor(row.type)"
              class="nbell-row-icon"
              :class="`nbell-row-icon--${toneFor(row.type)}`"
            />
            <div class="nbell-row-body">
              <p class="nbell-row-title">{{ titleFor(row) }}</p>
              <p v-if="descFor(row)" class="nbell-row-desc">{{ descFor(row) }}</p>
              <p class="nbell-row-time">{{ formatAge(row.createdAt) }}</p>
            </div>
            <span v-if="!row.readAt" class="nbell-row-dot" aria-hidden="true" />
          </li>
        </ul>

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
import { useNotifications, type NotificationRow } from '~/composables/useNotifications';

const { t } = useI18n();
const { state, markAllRead, markRead } = useNotifications();
const router = useRouter();

const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);

const hasUnread = computed(() => state.value.unreadCount > 0);
const displayCount = computed(() => {
  const n = state.value.unreadCount;
  if (n === 0) return '';
  if (n > 99) return '99+';
  return String(n);
});

function toggle() {
  open.value = !open.value;
}

async function onMarkAllRead() {
  await markAllRead();
}

function onRowClick(row: NotificationRow) {
  // Mark read first so the badge updates even if the navigation
  // re-renders the navbar. Closing the popover also feels snappier
  // when the badge has visibly decremented.
  void markRead(row.id);
  open.value = false;
  if (row.link) {
    void router.push(row.link);
  }
}

// Close on outside click + Escape.
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
//
// Each notification type maps to:
//   - an icon (Phosphor)
//   - a tone class (`gain` green, `spend` coin, `info` neutral,
//     `warn` orange, `danger` red, `social` blue)
//   - a localised title (mandatory) + optional description derived
//     from the payload via i18n interpolation
const TYPE_DEFAULTS: Record<
  string,
  { icon: string; tone: 'info' | 'warn' | 'danger' | 'gain' | 'spend' | 'social' }
> = {
  // Moderation
  upload_accepted: { icon: 'ph:check-circle-fill', tone: 'gain' },
  upload_rejected: { icon: 'ph:x-circle-fill', tone: 'danger' },
  upload_changes_requested: { icon: 'ph:pencil-simple-line-bold', tone: 'warn' },
  upload_reset: { icon: 'ph:arrow-counter-clockwise-bold', tone: 'info' },
  moderation_message_received: { icon: 'ph:chat-circle-text-bold', tone: 'info' },
  torrent_deleted_by_staff: { icon: 'ph:trash-bold', tone: 'danger' },
  // HnR
  hnr_violation_marked: { icon: 'ph:lightning-bold', tone: 'danger' },
  hnr_cleared: { icon: 'ph:check-circle-bold', tone: 'gain' },
  hnr_exempted: { icon: 'ph:shield-check-bold', tone: 'gain' },
  // Admin actions
  account_banned: { icon: 'ph:prohibit-bold', tone: 'danger' },
  account_unbanned: { icon: 'ph:lock-key-open-bold', tone: 'gain' },
  role_attached_manually: { icon: 'ph:user-circle-gear-bold', tone: 'info' },
  role_detached: { icon: 'ph:user-circle-minus-bold', tone: 'info' },
  staff_status_changed: { icon: 'ph:shield-bold', tone: 'info' },
  bonus_points_adjusted: { icon: 'ph:coin-bold', tone: 'spend' },
  // Security
  password_changed: { icon: 'ph:key-bold', tone: 'info' },
  totp_enabled: { icon: 'ph:device-mobile-bold', tone: 'gain' },
  totp_disabled: { icon: 'ph:device-mobile-slash-bold', tone: 'warn' },
  passkey_added: { icon: 'ph:fingerprint-bold', tone: 'gain' },
  passkey_removed: { icon: 'ph:fingerprint-simple-bold', tone: 'warn' },
  recovery_codes_regenerated: { icon: 'ph:lifebuoy-bold', tone: 'info' },
  recovery_code_used: { icon: 'ph:lifebuoy-bold', tone: 'warn' },
  login_new_ip: { icon: 'ph:globe-bold', tone: 'warn' },
  // Social
  comment_on_my_upload: { icon: 'ph:chat-circle-text-bold', tone: 'social' },
  forum_reply_on_my_topic: { icon: 'ph:chats-circle-bold', tone: 'social' },
  comment_deleted_by_staff: { icon: 'ph:trash-bold', tone: 'warn' },
  forum_post_deleted_by_staff: { icon: 'ph:trash-bold', tone: 'warn' },
  // Bonus
  bonus_event_started: { icon: 'ph:gift-bold', tone: 'gain' },
  first_seeder_reward: { icon: 'ph:crown-bold', tone: 'gain' },
  seeding_milestone_reached: { icon: 'ph:trophy-bold', tone: 'gain' },
  // Invitations
  invite_redeemed: { icon: 'ph:envelope-simple-open-bold', tone: 'gain' },
  invitee_banned: { icon: 'ph:user-minus-bold', tone: 'warn' },
  // Mod
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
  // i18n returns the key itself when a translation is missing —
  // fall back to a humanised version of the snake_case so an
  // unknown type still reads OK in the wild.
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
  color: rgb(var(--fg-strong));
  background: rgb(var(--fg-default) / 0.05);
}

.nbell-icon {
  font-size: 1.05rem;
}

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
  background: rgb(var(--accent));
  color: rgb(var(--accent-fg));
  border-radius: 9999px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.02em;
  border: 2px solid rgb(var(--bg-base));
}

/* ─── Popover ───────────────────────────────────────────────── */
.nbell-pop {
  position: absolute;
  top: calc(100% + 0.5rem);
  right: 0;
  width: min(22rem, calc(100vw - 1.5rem));
  background: rgb(var(--bg-surface));
  border: 1px solid rgb(var(--line-strong));
  border-radius: 0.5rem;
  box-shadow: 0 10px 40px rgb(0 0 0 / 0.4);
  overflow: hidden;
  z-index: 40;
}

.nbell-pop-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid rgb(var(--line-default));
}
.nbell-pop-title {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 700;
  color: rgb(var(--fg-strong));
}
.nbell-pop-action {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.25rem 0.5rem;
  background: transparent;
  border: 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  cursor: pointer;
  transition: color 0.14s ease;
}
.nbell-pop-action:hover {
  color: rgb(var(--fg-strong));
}

.nbell-pop-empty {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 1.75rem 1.25rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgb(var(--fg-faint));
  justify-content: center;
}
.nbell-loading-spin {
  animation: nbell-spin 0.9s linear infinite;
}
@keyframes nbell-spin {
  to { transform: rotate(360deg); }
}

/* ─── List rows ────────────────────────────────────────────── */
.nbell-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 26rem;
  overflow-y: auto;
}

.nbell-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 0.75rem;
  align-items: flex-start;
  padding: 0.7rem 1rem;
  cursor: pointer;
  border-bottom: 1px solid rgb(var(--line-default) / 0.5);
  transition: background 0.12s ease;
}
.nbell-row:hover {
  background: rgb(var(--bg-elevated) / 0.6);
}
.nbell-row:last-child {
  border-bottom: 0;
}
.nbell-row--unread {
  background: rgb(var(--accent) / 0.05);
}
.nbell-row--unread:hover {
  background: rgb(var(--accent) / 0.1);
}

.nbell-row-icon {
  font-size: 1.1rem;
  flex-shrink: 0;
  padding: 0.25rem;
  border-radius: 0.3rem;
}
.nbell-row-icon--gain {
  color: rgb(var(--online));
  background: rgb(var(--online) / 0.1);
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
  color: rgb(var(--warning));
  background: rgb(var(--warning) / 0.1);
}
.nbell-row-icon--danger {
  color: rgb(var(--danger));
  background: rgb(var(--danger) / 0.1);
}
.nbell-row-icon--social {
  color: rgb(var(--info));
  background: rgb(var(--info) / 0.1);
}

.nbell-row-body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.nbell-row-title {
  margin: 0;
  font-size: 0.82rem;
  font-weight: 600;
  color: rgb(var(--fg-strong));
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
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
  margin: 0.15rem 0 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  color: rgb(var(--fg-faint));
}
.nbell-row-dot {
  width: 0.4rem;
  height: 0.4rem;
  margin-top: 0.45rem;
  border-radius: 50%;
  background: rgb(var(--accent));
  flex-shrink: 0;
}

/* ─── Footer ────────────────────────────────────────────────── */
.nbell-pop-foot {
  border-top: 1px solid rgb(var(--line-default));
}
.nbell-pop-all {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  padding: 0.7rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  text-decoration: none;
  transition: color 0.14s ease, background 0.14s ease;
}
.nbell-pop-all:hover {
  color: rgb(var(--fg-strong));
  background: rgb(var(--fg-default) / 0.05);
}

/* ─── Popover transition ────────────────────────────────────── */
.nbell-pop-enter-active,
.nbell-pop-leave-active {
  transition: opacity 0.16s ease, transform 0.16s cubic-bezier(0.4, 0, 0.2, 1);
}
.nbell-pop-enter-from,
.nbell-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}
</style>
