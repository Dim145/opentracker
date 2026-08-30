<template>
  <!--
    MessagesBell — the unread count, in the header.

    No dropdown, unlike NotificationBell: the messages page already IS
    the list this would show, and a second inbox console to maintain
    buys nothing. One icon, one badge, one destination.

    The count comes from the server rather than being tallied client-
    side from the stream. A local tally drifts — a frame missed during a
    reconnect, a conversation read in another tab — and a badge that is
    quietly wrong is worse than one that costs a request.
  -->
  <NuxtLink
    v-if="canMessage"
    to="/messages"
    class="mbell-btn"
    :aria-label="label"
    :title="label"
  >
    <Icon
      :name="total > 0 ? 'ph:chat-circle-dots-fill' : 'ph:chat-circle'"
      class="mbell-icon"
    />
    <span
      v-if="total > 0"
      class="mbell-badge"
      :class="{ 'mbell-badge--many': display.length > 1 }"
    >{{ display }}</span>
  </NuxtLink>
</template>

<script setup lang="ts">
const { t } = useI18n();
const { user } = useUserSession();

// The scope has an `off` state, so the server decides whether the door
// exists at all. Same flag the nav links are gated on.
const canMessage = computed(
  () => !!(user.value as { canMessage?: boolean } | null)?.canMessage,
);

const messages = ref(0);
const requests = ref(0);
const total = computed(() => messages.value + requests.value);
const display = computed(() => (total.value > 99 ? '99+' : String(total.value)));

const label = computed(() =>
  total.value > 0
    ? t('messaging.unreadLabel', { count: total.value })
    : t('messaging.title'),
);

async function refresh() {
  if (!canMessage.value) return;
  try {
    const r = await $fetch<{ messages: number; requests: number }>(
      '/api/messaging/unread',
    );
    messages.value = r.messages ?? 0;
    requests.value = r.requests ?? 0;
  } catch {
    // A failed count is not worth an error to the user: the page behind
    // the icon still works and the next refresh corrects it.
  }
}

let pending: ReturnType<typeof setTimeout> | null = null;
function scheduleRefresh() {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    void refresh();
  }, 1000);
}

/*
 * Live, without a second connection.
 *
 * The obvious implementation opens the messaging stream here. That would
 * give every signed-in member TWO SSE connections instead of one — the
 * bell's and the page's — which doubles the number the relay's ceiling
 * was sized against, for a badge.
 *
 * The notification stream is already open for everyone, and a private
 * message now raises a notification on the first unread of a thread. So
 * the signal already arrives; this just listens to it. The count itself
 * still comes from the server, because the notification says "something
 * happened", not "the total is now four".
 */
const { state } = useNotifications();
watch(
  () => state.value.items[0]?.id,
  () => {
    const type = state.value.items[0]?.type;
    if (type === 'message_received' || type === 'message_request_received') {
      scheduleRefresh();
    }
  },
);

// Reading happens on a page this component does not own, and nothing
// pushes "you read something" back. Re-counting on navigation is what
// makes the badge fall.
const route = useRoute();
watch(() => route.fullPath, () => scheduleRefresh());

onMounted(() => void refresh());
onUnmounted(() => {
  if (pending) clearTimeout(pending);
});
</script>

<style scoped>
/* Deliberately the same geometry as .nbell-btn: the two sit side by side
   in the header and any difference reads as a mistake. */
.mbell-btn {
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
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: color var(--dur-2) ease, background var(--dur-2) ease;
}
.mbell-btn:hover {
  color: rgb(var(--fg-strong));
  background: rgb(var(--fg-default) / 0.05);
}
.mbell-icon { font-size: 1.05rem; }
.mbell-badge {
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
  border-radius: var(--radius-pill);
  font-family: var(--font-mono);
  font-size: 0.5625rem;
  font-weight: 800;
  letter-spacing: calc(0.02em * var(--tracking-scale));
  border: 2px solid rgb(var(--bg-base));
  box-shadow: 0 0 0 1px rgba(244, 63, 94, 0.45);
}
.mbell-badge--many { border-radius: var(--radius-pill); }
</style>
