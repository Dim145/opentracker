<template>
  <div class="room-shell">
    <header class="room-head">
      <h1 class="h-page">{{ $t('room.title') }}</h1>
      <span v-if="!connected" class="room-tag">
        <Icon name="ph:cloud-slash" class="w-3 h-3" />
        {{ $t('room.offline') }}
      </span>
      <span v-if="slowModeSeconds > 0" class="room-tag">
        <Icon name="ph:hourglass-medium" class="w-3 h-3" />
        {{ $t('room.slowMode', { seconds: slowModeSeconds }) }}
      </span>
    </header>

    <div ref="scrollerRef" class="room-scroller" role="log" aria-live="polite">
      <button
        v-if="nextBefore"
        type="button"
        class="room-older"
        :disabled="loadingOlder"
        @click="loadOlder"
      >
        {{ $t('room.older') }}
      </button>

      <p v-if="!messages.length" class="room-hint">{{ $t('room.empty') }}</p>

      <article v-for="msg in messages" :key="msg.id" class="room-line">
        <time class="room-time" :datetime="msg.createdAt">{{ shortTime(msg.createdAt) }}</time>
        <span class="room-author">{{ authorOf(msg) }}</span>
        <span v-if="msg.deleted" class="room-body room-removed">{{ $t('room.deleted') }}</span>
        <span v-else class="room-body" :class="{ 'text-error': msg.failed }">{{ msg.body }}</span>
        <button
          v-if="isStaff && !msg.deleted"
          type="button"
          class="room-remove"
          :aria-label="$t('room.remove')"
          @click="remove(msg)"
        >
          <Icon name="ph:trash" class="w-3 h-3" />
        </button>
        <button v-if="msg.failed" type="button" class="room-retry" @click="retry(msg)">
          {{ $t('room.retry') }}
        </button>
      </article>
    </div>

    <p v-if="mutedUntil" class="room-notice">
      {{ $t('room.muted', { until: new Date(mutedUntil).toLocaleString() }) }}
    </p>
    <form v-else class="room-composer" @submit.prevent="send">
      <input
        v-model="draft"
        :placeholder="$t('room.placeholder')"
        :aria-label="$t('room.placeholder')"
        class="room-input bg-bg-secondary border border-border text-text-primary placeholder:text-text-muted focus:border-accent"
        maxlength="1000"
        autocomplete="off"
      />
      <button type="submit" class="room-send" :disabled="!draft.trim()">
        <Icon name="ph:paper-plane-tilt" class="w-4 h-4" />
        <span class="sr-only">{{ $t('room.send') }}</span>
      </button>
    </form>
  </div>
</template>

<script setup lang="ts">
/**
 * The room.
 *
 * A page rather than a dock, and that is a load decision as much as a
 * design one: a dock present on every screen makes every connected member
 * a reader of the room. At ten thousand online that is thirty thousand
 * writes a second in normal traffic instead of four and a half — a factor
 * of six or seven, for a convenience. If the dock arrives it will have to
 * be collapsed by default and unsubscribed while collapsed.
 *
 * Dense lines rather than bubbles: a shoutbox is scanned, not read, and
 * the timestamp and the name are what people scan by.
 */
interface RoomMessage {
  id: string;
  body: string | null;
  deleted: boolean;
  createdAt: string;
  author: { id: string; username: string; displayName: string | null } | null;
  failed?: boolean;
}

const { t } = useI18n();
const { user } = useUserSession();

const messages = ref<RoomMessage[]>([]);
const nextBefore = ref<string | null>(null);
const loadingOlder = ref(false);
const slowModeSeconds = ref(0);
const mutedUntil = ref<string | null>(null);
const draft = ref('');
const scrollerRef = ref<HTMLElement | null>(null);

const isStaff = computed(() => !!user.value?.isAdmin || !!user.value?.isModerator);

function authorOf(msg: RoomMessage) {
  if (!msg.author) return t('messaging.deletedMember');
  return msg.author.displayName || msg.author.username;
}

function shortTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

// `useFetch`, not `$fetch`: a bare fetch at the top of a page runs during
// SSR with no cookie and answers 401.
const { data, refresh } = await useFetch<{
  messages: RoomMessage[];
  nextBefore: string | null;
  slowModeSeconds: number;
  mutedUntil: string | null;
}>('/api/messaging/room');

watchEffect(() => {
  if (!data.value) return;
  messages.value = [...data.value.messages].reverse();
  nextBefore.value = data.value.nextBefore;
  slowModeSeconds.value = data.value.slowModeSeconds;
  mutedUntil.value = data.value.mutedUntil;
});

function scrollToEnd() {
  const el = scrollerRef.value;
  if (el) el.scrollTop = el.scrollHeight;
}

onMounted(() => nextTick(scrollToEnd));

async function loadOlder() {
  if (!nextBefore.value || loadingOlder.value) return;
  loadingOlder.value = true;
  try {
    const page = await $fetch<{ messages: RoomMessage[]; nextBefore: string | null }>(
      '/api/messaging/room',
      { query: { before: nextBefore.value } }
    );
    messages.value = [...[...page.messages].reverse(), ...messages.value];
    nextBefore.value = page.nextBefore;
  } finally {
    loadingOlder.value = false;
  }
}

async function send() {
  const body = draft.value.trim();
  if (!body) return;
  draft.value = '';

  const pending: RoomMessage = {
    id: `pending-${Date.now()}`,
    body,
    deleted: false,
    createdAt: new Date().toISOString(),
    author: user.value
      ? { id: user.value.id, username: user.value.username, displayName: user.value.displayName }
      : null,
  };
  messages.value = [...messages.value, pending];
  await nextTick(scrollToEnd);
  await deliver(pending);
}

async function deliver(pending: RoomMessage) {
  try {
    const res = await $fetch<{ id: string; createdAt: string }>(
      '/api/messaging/room/messages',
      { method: 'POST', body: { body: pending.body } }
    );
    const row = messages.value.find((m) => m.id === pending.id);
    if (row) {
      row.id = res.id;
      row.createdAt = res.createdAt;
      row.failed = false;
    }
  } catch (err) {
    const row = messages.value.find((m) => m.id === pending.id);
    if (row) row.failed = true;
    // Slow mode and a mute are refusals with something to say, so they
    // update the chrome rather than only marking the row failed.
    const data = (err as { data?: { data?: { retryAfter?: number; mutedUntil?: string } } })?.data
      ?.data;
    if (data?.mutedUntil) mutedUntil.value = data.mutedUntil;
  }
}

function retry(msg: RoomMessage) {
  msg.failed = false;
  void deliver(msg);
}

async function remove(msg: RoomMessage) {
  await $fetch(`/api/messaging/room/messages/${msg.id}`, { method: 'DELETE' });
  // The relay tells every other reader; this is just the local echo.
  msg.deleted = true;
  msg.body = null;
}

const { connected } = useMessagingStream({
  onFrame: (frame) => {
    if (frame.type === 'room' && frame.message) {
      if (messages.value.some((m) => m.id === frame.message.id)) return;
      messages.value = [...messages.value, frame.message as RoomMessage];
      void nextTick(scrollToEnd);
      return;
    }
    if (frame.type === 'room-delete') {
      const row = messages.value.find((m) => m.id === frame.messageId);
      if (row) {
        row.deleted = true;
        row.body = null;
      }
    }
  },
});

onMounted(() => refresh());
</script>

<style scoped>
.room-shell {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-height: 60vh;
}

.room-head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.room-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.6875rem;
  color: rgb(var(--fg-subtle));
}

.room-scroller {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  flex: 1;
  overflow-y: auto;
  max-height: 65vh;
  padding: 0.75rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
}

.room-older {
  align-self: center;
  padding: 0.375rem 0.75rem;
  font-size: 0.75rem;
  color: rgb(var(--fg-muted));
  cursor: pointer;
}

.room-hint,
.room-notice {
  padding: 1rem 0.25rem;
  font-size: 0.8125rem;
  color: rgb(var(--fg-muted));
}

/* One line per message. A shoutbox is scanned rather than read, and the
   timestamp and the name are the columns people scan by — bubbles would
   put the eye somewhere different on every row. */
.room-line {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  padding: 0.25rem 0.25rem;
  font-size: 0.875rem;
  line-height: 1.45;
}

.room-time {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  color: rgb(var(--fg-subtle));
  font-variant-numeric: tabular-nums;
}

.room-author {
  flex-shrink: 0;
  font-weight: 600;
  color: rgb(var(--fg-strong));
}

.room-body {
  min-width: 0;
  overflow-wrap: anywhere;
}

.room-removed {
  font-style: italic;
  color: rgb(var(--fg-subtle));
}

.room-remove,
.room-retry {
  flex-shrink: 0;
  margin-left: auto;
  color: rgb(var(--fg-subtle));
  cursor: pointer;
}

.room-retry {
  font-size: 0.75rem;
  text-decoration: underline;
}

.room-composer {
  display: flex;
  gap: 0.5rem;
}

.room-input {
  flex: 1;
  min-width: 0;
  /* 44px on a phone. */
  padding: 0.6875rem 0.75rem;
  border-radius: var(--radius-sm);
  font-size: 0.875rem;
}

.room-send {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

@media (min-width: 768px) {
  .room-input {
    padding-top: 0.4375rem;
    padding-bottom: 0.4375rem;
  }

  .room-send {
    width: 2.25rem;
    height: 2.25rem;
  }
}
</style>
