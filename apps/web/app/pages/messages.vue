<template>
  <div class="msg-shell">
    <!-- Below md the two panes become one: the list, then the thread with
         a way back. Two columns on a phone means two half-columns. -->
    <aside class="msg-list" :class="{ 'msg-hide-mobile': !!activeId }">
      <header class="msg-list-head">
        <h1 class="h-page">{{ $t('messaging.title') }}</h1>
        <button type="button" class="msg-new" @click="startOpen = true">
          <Icon name="ph:plus" class="w-4 h-4" />
          <span class="sr-only">{{ $t('messaging.newConversation') }}</span>
        </button>
      </header>

      <div v-if="requests.length" class="msg-section">
        <p class="eyebrow msg-section-title">{{ $t('messaging.requests') }}</p>
        <p class="msg-hint">{{ $t('messaging.requestsHint') }}</p>
        <button
          v-for="conv in requests"
          :key="conv.id"
          type="button"
          class="msg-row"
          :class="conv.id === activeId ? 'bg-bg-tertiary text-text-primary' : 'text-text-muted hover:bg-bg-secondary/50'"
          @click="open(conv)"
        >
          <span class="msg-row-name truncate">{{ nameOf(conv) }}</span>
          <span v-if="conv.unreadCount" class="msg-badge bg-accent">{{ conv.unreadCount }}</span>
        </button>
      </div>

      <div class="msg-section">
        <p class="eyebrow msg-section-title">{{ $t('messaging.inbox') }}</p>
        <p v-if="!inbox.length" class="msg-hint">{{ $t('messaging.empty') }}</p>
        <button
          v-for="conv in inbox"
          :key="conv.id"
          type="button"
          class="msg-row"
          :class="conv.id === activeId ? 'bg-bg-tertiary text-text-primary' : 'text-text-muted hover:bg-bg-secondary/50'"
          @click="open(conv)"
        >
          <span class="msg-row-name truncate">{{ nameOf(conv) }}</span>
          <Icon v-if="conv.encrypted" name="ph:lock-simple" class="msg-row-lock" />
          <span
            v-if="conv.unreadCount"
            class="msg-badge bg-accent"
            :aria-label="conv.unreadCount === 1 ? $t('messaging.unreadOne') : $t('messaging.unreadMany', { count: conv.unreadCount })"
          >{{ conv.unreadCount }}</span>
        </button>
      </div>
    </aside>

    <section class="msg-thread" :class="{ 'msg-hide-mobile': !activeId }">
      <template v-if="active">
        <header class="msg-thread-head">
          <button type="button" class="msg-back" @click="activeId = null">
            <Icon name="ph:arrow-left" class="w-4 h-4" />
            <span class="sr-only">{{ $t('common.back') }}</span>
          </button>
          <span class="msg-thread-name truncate">{{ nameOf(active) }}</span>
          <span
            v-if="!connected"
            class="msg-tag"
            :title="$t('messaging.offlineHint')"
          >
            <Icon name="ph:cloud-slash" class="w-3 h-3" />
            {{ $t('messaging.offline') }}
          </span>
          <span v-if="active.encrypted" class="msg-tag">
            <Icon name="ph:lock-simple" class="w-3 h-3" />
            {{ $t('messaging.encrypted') }}
          </span>
        </header>

        <!-- `role="log"` plus a polite live region: a screen reader
             announces an arriving message without stealing the caret from
             somebody mid-sentence in the composer. -->
        <div ref="scrollerRef" class="msg-scroller" role="log" aria-live="polite">
          <button
            v-if="nextBefore"
            type="button"
            class="msg-older"
            :disabled="loadingOlder"
            @click="loadOlder"
          >
            {{ $t('messaging.olderMessages') }}
          </button>

          <p v-if="!messages.length" class="msg-hint">{{ $t('messaging.emptyThread') }}</p>

          <article
            v-for="msg in messages"
            :key="msg.id"
            class="msg-bubble-row"
            :class="msg.mine ? 'msg-mine' : 'msg-theirs'"
          >
            <div
              class="msg-bubble"
              :class="[
                msg.mine
                  ? 'bg-bg-tertiary text-text-primary'
                  : 'bg-bg-secondary text-text-primary',
                msg.failed ? 'border-error' : 'border-border',
              ]"
            >
              <p v-if="!msg.mine" class="msg-author eyebrow">{{ authorOf(msg) }}</p>
              <p class="msg-body">{{ msg.body }}</p>
              <p class="msg-meta">
                <time :datetime="msg.createdAt">{{ shortTime(msg.createdAt) }}</time>
                <template v-if="msg.failed">
                  · <span class="text-error">{{ $t('messaging.sendFailed') }}</span>
                  <button type="button" class="msg-retry" @click="retry(msg)">
                    {{ $t('messaging.retry') }}
                  </button>
                </template>
              </p>
            </div>
          </article>
        </div>

        <p v-if="active.encrypted" class="msg-notice">
          {{ $t('messaging.encryptedNotice') }}
        </p>
        <form v-else class="msg-composer" @submit.prevent="send">
          <button
            v-if="active.state === 'pending'"
            type="button"
            class="msg-accept"
            @click="accept"
          >
            {{ $t('messaging.accept') }}
          </button>
          <textarea
            v-model="draft"
            rows="1"
            :placeholder="$t('messaging.placeholder')"
            :aria-label="$t('messaging.placeholder')"
            class="msg-input bg-bg-secondary border border-border text-text-primary placeholder:text-text-muted focus:border-accent"
            @keydown.enter.exact.prevent="send"
          />
          <button type="submit" class="msg-send" :disabled="!draft.trim()">
            <Icon name="ph:paper-plane-tilt" class="w-4 h-4" />
            <span class="sr-only">{{ $t('messaging.send') }}</span>
          </button>
        </form>
      </template>
      <p v-else class="msg-hint msg-placeholder">{{ $t('messaging.pick') }}</p>
    </section>

    <Modal v-model="startOpen" :title="$t('messaging.newConversation')">
      <form class="flex flex-col gap-3" @submit.prevent="startConversation">
        <label class="eyebrow" for="msg-recipient">{{ $t('messaging.recipient') }}</label>
        <input
          id="msg-recipient"
          v-model="startWith"
          class="input"
          autocomplete="off"
          spellcheck="false"
        />
        <p v-if="startError" class="text-sm text-error">{{ startError }}</p>
        <button type="submit" class="btn btn-primary self-end" :disabled="!startWith.trim()">
          {{ $t('messaging.start') }}
        </button>
      </form>
    </Modal>
  </div>
</template>

<script setup lang="ts">
/**
 * Private messages — the P1 surface.
 *
 * No live delivery yet: the thread is what the server had when the page
 * asked. That is deliberate rather than unfinished, and it is why sending
 * is optimistic — the message appears immediately with a failure state
 * and a retry, so the absence of a socket is not felt as latency.
 *
 * The encrypted case is visible but inert here: a conversation can be
 * opened encrypted (the flag is immutable, so it has to be settable at
 * creation) while the key exchange itself lands in a later step. Showing
 * it locked is more honest than hiding conversations that exist.
 */
interface Conversation {
  id: string;
  encrypted: boolean;
  lastMessageAt: string;
  unreadCount: number;
  state?: 'active' | 'pending';
  with: { id: string; username: string; displayName: string | null } | null;
}

interface ThreadMessage {
  id: string;
  body: string | null;
  cipher: string | null;
  deleted: boolean;
  createdAt: string;
  author: { id: string; username: string; displayName: string | null } | null;
  mine?: boolean;
  failed?: boolean;
}

const { t } = useI18n();
const { user } = useUserSession();

const inbox = ref<Conversation[]>([]);
const requests = ref<Conversation[]>([]);
const activeId = ref<string | null>(null);
const messages = ref<ThreadMessage[]>([]);
const nextBefore = ref<string | null>(null);
const loadingOlder = ref(false);
const draft = ref('');
const scrollerRef = ref<HTMLElement | null>(null);

const startOpen = ref(false);
const startWith = ref('');
const startError = ref('');

const active = computed(
  () =>
    inbox.value.find((c) => c.id === activeId.value) ??
    requests.value.find((c) => c.id === activeId.value) ??
    null
);

function nameOf(conv: Conversation) {
  // A deleted account leaves no name behind: `authorId` went null on
  // deletion, and rendering the absence is the erasure story rather than a
  // remembered username.
  if (!conv.with) return t('messaging.deletedMember');
  return conv.with.displayName || conv.with.username;
}

function authorOf(msg: ThreadMessage) {
  if (!msg.author) return t('messaging.deletedMember');
  // A streamed frame carries the author's id but not their name — the
  // relay copies bytes and does not join. For anyone but me that is the
  // conversation's other side, which the list already names.
  return (
    msg.author.displayName ||
    msg.author.username ||
    (active.value ? nameOf(active.value) : t('messaging.deletedMember'))
  );
}

function shortTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * The first load goes through `useFetch`, not `$fetch`.
 *
 * A bare `$fetch` at the top of a page runs on the server during SSR,
 * where it carries no cookie — so it answered 401 and the whole page
 * rendered as an error. `useFetch` forwards the request's own headers,
 * which is why every other authenticated page here uses it. Later reloads
 * happen in the browser, where the cookie rides along on its own.
 */
const { data: listData, refresh: refreshList } = await useFetch<{
  inbox: Conversation[];
  requests: Conversation[];
}>('/api/messaging/conversations');

watchEffect(() => {
  inbox.value = (listData.value?.inbox ?? []).map((c) => ({
    ...c,
    state: 'active' as const,
  }));
  requests.value = (listData.value?.requests ?? []).map((c) => ({
    ...c,
    state: 'pending' as const,
  }));
});

async function loadList() {
  await refreshList();
}

// ── Live delivery ────────────────────────────────────────────────────
//
// Everything above works without this. That is not an accident: the relay
// is a separate process, and a page that only functioned while a socket
// was open would have no answer for the socket being shut.

const { connected, needsReload, start } = useMessagingStream((incoming) => {
  for (const msg of incoming) {
    if (msg.conversationId === activeId.value) {
      // A message I just sent comes back through my own channel too — I am
      // a participant. The optimistic row already carries the server's id
      // by then, so matching on it is what stops the echo showing twice.
      if (messages.value.some((m) => m.id === msg.id)) continue;
      messages.value = [
        ...messages.value,
        {
          id: msg.id,
          body: msg.body,
          cipher: msg.cipher,
          deleted: false,
          createdAt: msg.createdAt,
          author: msg.authorId
            ? { id: msg.authorId, username: '', displayName: null }
            : null,
          mine: msg.authorId === user.value?.id,
        },
      ];
      void nextTick(scrollToEnd);
      continue;
    }
    // For any other conversation, the counter is the notification. Nudging
    // it locally avoids a round trip per arriving message — the list is
    // reconciled on the next real load anyway.
    const row =
      inbox.value.find((c) => c.id === msg.conversationId) ??
      requests.value.find((c) => c.id === msg.conversationId);
    if (row) row.unreadCount += 1;
    else void loadList(); // a conversation we did not know about yet
  }
});

// Past the catch-up cap the view is cheaper to rebuild than to patch.
watch(needsReload, async (needed) => {
  if (!needed) return;
  await loadList();
  if (activeId.value) await loadThread();
});

onMounted(start);

async function open(conv: Conversation) {
  activeId.value = conv.id;
  messages.value = [];
  nextBefore.value = null;
  await loadThread();
  // Marking read is a single call per open, never one per message seen:
  // at ten thousand people online that difference is the whole write
  // budget of the feature.
  await $fetch(`/api/messaging/conversations/${conv.id}/read`, { method: 'POST' });
  conv.unreadCount = 0;
}

async function loadThread(before?: string) {
  const data = await $fetch<{ messages: ThreadMessage[]; nextBefore: string | null }>(
    `/api/messaging/conversations/${activeId.value}/messages`,
    { query: before ? { before } : undefined }
  );
  // The API answers newest-first for the cursor to work; the thread reads
  // oldest-first.
  const page = [...data.messages].reverse().map((m) => ({
    ...m,
    mine: m.author?.id === user.value?.id,
  }));
  messages.value = before ? [...page, ...messages.value] : page;
  nextBefore.value = data.nextBefore;
  if (!before) await nextTick(scrollToEnd);
}

async function loadOlder() {
  if (!nextBefore.value || loadingOlder.value) return;
  loadingOlder.value = true;
  try {
    await loadThread(nextBefore.value);
  } finally {
    loadingOlder.value = false;
  }
}

function scrollToEnd() {
  const el = scrollerRef.value;
  if (el) el.scrollTop = el.scrollHeight;
}

async function send() {
  const body = draft.value.trim();
  if (!body || !activeId.value || active.value?.encrypted) return;
  draft.value = '';

  // Optimistic: the row appears now and carries its own failure state, so
  // a slow round trip reads as sent rather than as the page hanging.
  const pending: ThreadMessage = {
    id: `pending-${Date.now()}`,
    body,
    cipher: null,
    deleted: false,
    createdAt: new Date().toISOString(),
    author: user.value
      ? { id: user.value.id, username: user.value.username, displayName: user.value.displayName }
      : null,
    mine: true,
  };
  messages.value = [...messages.value, pending];
  await nextTick(scrollToEnd);
  await deliver(pending);
}

async function deliver(pending: ThreadMessage) {
  try {
    const res = await $fetch<{ id: string; createdAt: string }>(
      `/api/messaging/conversations/${activeId.value}/messages`,
      { method: 'POST', body: { body: pending.body } }
    );
    const row = messages.value.find((m) => m.id === pending.id);
    if (row) {
      row.id = res.id;
      row.createdAt = res.createdAt;
      row.failed = false;
    }
    if (active.value?.state === 'pending') await loadList();
  } catch {
    const row = messages.value.find((m) => m.id === pending.id);
    if (row) row.failed = true;
  }
}

function retry(msg: ThreadMessage) {
  msg.failed = false;
  void deliver(msg);
}

async function accept() {
  if (!activeId.value) return;
  await $fetch(`/api/messaging/conversations/${activeId.value}/accept`, {
    method: 'POST',
  });
  await loadList();
}

async function startConversation() {
  startError.value = '';
  try {
    const res = await $fetch<{ id: string }>('/api/messaging/conversations', {
      method: 'POST',
      body: { username: startWith.value.trim() },
    });
    startOpen.value = false;
    startWith.value = '';
    await loadList();
    const conv =
      inbox.value.find((c) => c.id === res.id) ??
      requests.value.find((c) => c.id === res.id);
    if (conv) await open(conv);
  } catch (err) {
    startError.value =
      (err as { data?: { message?: string } })?.data?.message ?? String(err);
  }
}

</script>

<style scoped>
/* Mobile-first, and it has to stay that way: a media query adds no
   specificity, so between two rules of equal weight the last one wins.
   Below md the two panes are one column and `.msg-hide-mobile` picks
   which of them is on screen; above md both are always shown, so the
   class has nothing left to hide. */
.msg-shell {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-height: 60vh;
}

.msg-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
}

.msg-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.msg-new,
.msg-back,
.msg-send {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* 44px on a phone: the floor Apple states and Material rounds up. */
  width: 2.75rem;
  height: 2.75rem;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.msg-section {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.msg-section-title {
  padding: 0 0.25rem 0.25rem;
}

.msg-hint {
  padding: 0.5rem 0.25rem;
  font-size: 0.8125rem;
  color: rgb(var(--fg-muted));
}

.msg-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.6875rem 0.625rem;
  border-radius: var(--radius-sm);
  text-align: left;
  cursor: pointer;
}

.msg-row-name {
  flex: 1;
  min-width: 0;
  font-size: 0.875rem;
}

.msg-row-lock {
  width: 0.875rem;
  height: 0.875rem;
  flex-shrink: 0;
  opacity: 0.6;
}

.msg-badge {
  flex-shrink: 0;
  min-width: 1.25rem;
  padding: 0 0.375rem;
  border-radius: 9999px;
  font-size: 0.6875rem;
  line-height: 1.25rem;
  text-align: center;
  color: rgb(var(--accent-fg));
}

.msg-thread {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  overflow: hidden;
}

/* Declared AFTER `.msg-list` and `.msg-thread`, which both set `display`.
   A scoped selector carries `[data-v-…]`, so all three weigh the same and
   source order is what decides — put this first and it silently loses,
   which is how both panes ended up on screen at once on a phone. */
.msg-hide-mobile {
  display: none;
}

.msg-thread-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.5rem;
  border-bottom: 1px solid rgb(var(--line-default));
}

.msg-thread-name {
  flex: 1;
  min-width: 0;
  font-weight: 600;
}

.msg-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  flex-shrink: 0;
  font-size: 0.6875rem;
  color: rgb(var(--fg-subtle));
}

.msg-scroller {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  flex: 1;
  overflow-y: auto;
  max-height: 60vh;
  padding: 0.75rem;
}

.msg-older {
  align-self: center;
  padding: 0.375rem 0.75rem;
  font-size: 0.75rem;
  color: rgb(var(--fg-muted));
  cursor: pointer;
}

/* Sender differentiation carries on alignment as well as colour, never on
   colour alone — the same rule the rest of this app follows for state. */
.msg-bubble-row {
  display: flex;
}

.msg-mine {
  justify-content: flex-end;
}

.msg-theirs {
  justify-content: flex-start;
}

.msg-bubble {
  max-width: min(85%, 34rem);
  padding: 0.5rem 0.6875rem;
  border-width: 1px;
  border-style: solid;
  border-radius: var(--radius-md);
}

.msg-author {
  margin-bottom: 0.125rem;
}

.msg-body {
  font-size: 0.875rem;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.msg-meta {
  margin-top: 0.25rem;
  font-size: 0.6875rem;
  color: rgb(var(--fg-subtle));
}

.msg-retry {
  margin-left: 0.375rem;
  text-decoration: underline;
  cursor: pointer;
}

.msg-notice,
.msg-placeholder {
  padding: 1rem;
  font-size: 0.8125rem;
  color: rgb(var(--fg-muted));
}

.msg-composer {
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
  padding: 0.5rem;
  border-top: 1px solid rgb(var(--line-default));
}

.msg-accept {
  padding: 0.6875rem 0.75rem;
  border-radius: var(--radius-sm);
  font-size: 0.8125rem;
  cursor: pointer;
}

.msg-input {
  flex: 1;
  min-width: 0;
  resize: none;
  padding: 0.6875rem 0.75rem;
  border-radius: var(--radius-sm);
  font-size: 0.875rem;
  line-height: 1.4;
}

@media (min-width: 768px) {
  .msg-shell {
    flex-direction: row;
    gap: 1.5rem;
  }

  .msg-list {
    width: 18rem;
    flex-shrink: 0;
  }

  /* Both panes are on screen from here up, so the mobile toggle has to
     stop hiding either of them. */
  .msg-hide-mobile {
    display: flex;
  }

  .msg-row,
  .msg-input,
  .msg-accept {
    padding-top: 0.4375rem;
    padding-bottom: 0.4375rem;
  }

  .msg-new,
  .msg-back,
  .msg-send {
    width: 2.25rem;
    height: 2.25rem;
  }

  .msg-back {
    display: none;
  }
}
</style>
