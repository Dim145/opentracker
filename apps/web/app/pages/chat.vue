<template>
  <div class="room-shell">
    <!--
      A titled header with an icon tile, the way the rest of the app
      titles a section — the room used to open on a bare <h1> and a log,
      with nothing saying what you were looking at.
    -->
    <header class="room-head">
      <span class="room-head-tile" aria-hidden="true">
        <Icon name="ph:chats-circle-bold" />
      </span>
      <span class="room-head-text">
        <h1 class="room-head-name">{{ $t('room.title') }}</h1>
        <span class="room-head-sub">{{ $t('room.subtitle') }}</span>
      </span>
      <span class="room-head-tags">
        <span v-if="!connected" class="room-tag">
          <Icon name="ph:cloud-slash" class="w-3 h-3" />
          {{ $t('room.offline') }}
        </span>
        <span v-if="slowModeSeconds > 0" class="room-tag">
          <Icon name="ph:hourglass-medium" class="w-3 h-3" />
          {{ $t('room.slowMode', { seconds: slowModeSeconds }) }}
        </span>
      </span>
    </header>

    <!-- Under the header and outside the scroller: a pin that scrolls
         away with the conversation is a message, not a pin. -->
    <div v-if="pinned" class="room-pin">
      <Icon name="ph:megaphone" class="room-pin-icon" />
      <span class="room-pin-body">
        <b>{{ pinned.author ?? $t('messaging.deletedMember') }}</b>
        {{ pinned.body }}
      </span>
      <button
        v-if="isStaff"
        type="button"
        class="room-pin-clear"
        :aria-label="$t('room.unpin')"
        :title="$t('room.unpin')"
        @click="unpin"
      >
        <Icon name="ph:x" />
      </button>
    </div>

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

      <!--
        Grouped by author.

        Six messages in a row from the same person repeat their name six
        times and push the conversation off the screen. `startsGroup`
        shows the name and the disc once, and the rest of the run is just
        the messages — which is what makes a busy room readable without
        making every line shorter.
      -->
      <article
        v-for="(msg, i) in messages"
        :id="`room-${msg.id}`"
        :key="msg.id"
        class="room-msg"
        :class="{ 'room-msg--grouped': !startsGroup(i) }"
      >
        <!-- The disc and the name both lead to the profile: on a
             tracker, "who is this" is the question a room raises most
             often, and answering it should not mean a search. An erased
             author carries no id, so there is nothing to link to and the
             disc stays inert rather than pointing at a dead page. -->
        <NuxtLink
          v-if="startsGroup(i) && msg.author?.id"
          :to="`/users/${msg.author.id}`"
          class="room-avatar room-avatar--link"
          :aria-label="authorOf(msg)"
        >
          {{ (msg.author?.username?.[0] ?? '?').toUpperCase() }}
        </NuxtLink>
        <span
          v-else-if="startsGroup(i)"
          class="room-avatar"
          aria-hidden="true"
        >{{ (msg.author?.username?.[0] ?? '?').toUpperCase() }}</span>
        <span v-else class="room-avatar-gap" aria-hidden="true" />

        <div class="room-msg-main">
          <p v-if="startsGroup(i)" class="room-msg-head">
            <NuxtLink
              v-if="msg.author?.id"
              :to="`/users/${msg.author.id}`"
              class="room-msg-author room-msg-author--link"
            >{{ authorOf(msg) }}</NuxtLink>
            <span v-else class="room-msg-author">{{ authorOf(msg) }}</span>
            <MessagingAuthorBadge :badge="msg.author?.badge" />
            <time class="room-msg-time" :datetime="msg.createdAt">
              {{ shortTime(msg.createdAt) }}
            </time>
          </p>

          <div class="room-bubble" :class="{ 'room-bubble--failed': msg.failed }">
            <!-- The quote inside the bubble, on its own accent rail: in
                 the room a reply that only carried "@name" said who but
                 never what, which is the half that matters. -->
            <button
              v-if="msg.replyTo"
              type="button"
              class="room-quote"
              :disabled="msg.replyTo.gone"
              @click="jumpTo(msg.replyTo.id)"
            >
              <span class="room-quote-author">
                {{ msg.replyTo.gone
                  ? $t('messaging.replyGone')
                  : (msg.replyTo.author ?? $t('messaging.deletedMember')) }}
              </span>
              <span v-if="!msg.replyTo.gone" class="room-quote-text">
                {{ msg.replyTo.preview }}
              </span>
            </button>

            <p v-if="msg.deleted" class="room-body room-removed">
              {{ $t('room.deleted') }}
            </p>
            <p v-else class="room-body">
              {{ msg.body }}
              <span v-if="msg.editedAt" class="room-edited">
                ({{ $t('messaging.edited') }})
              </span>
            </p>

            <MessagingTorrentCard
              v-for="hash in torrentHashesIn(msg.body)"
              :key="hash"
              :hash="hash"
            />

            <MessagingReactions
              :counts="msg.reactions ?? {}"
              :mine="msg.myReactions ?? []"
              @toggle="(k) => react(msg, k)"
            />

            <!--
              One group, anchored to the bubble, revealed on hover.

              They used to be three loose children of a wrapping flex row,
              each with its own `margin-left: auto` — so they spread
              themselves evenly across the full width, on a line of their
              own, permanently. Grouped and absolutely positioned they
              stay together, next to the message they act on.
            -->
            <div v-if="!msg.deleted" class="room-actions">
              <MessagingReactionPicker
                v-if="!String(msg.id).startsWith('pending-')"
                :mine="msg.myReactions ?? []"
                @toggle="(k) => react(msg, k)"
              />
              <button
                type="button"
                class="room-action"
                :aria-label="$t('messaging.reply')"
                :title="$t('messaging.reply')"
                @click="startReply(msg)"
              >
                <Icon name="ph:arrow-bend-up-left" />
              </button>
              <button
                v-if="isMine(msg)"
                type="button"
                class="room-action"
                :aria-label="$t('messaging.edit')"
                :title="$t('messaging.edit')"
                @click="beginEdit(msg)"
              >
                <Icon name="ph:pencil-simple" />
              </button>
              <button
                v-if="isStaff"
                type="button"
                class="room-action"
                :aria-label="$t('room.pin')"
                :title="$t('room.pin')"
                @click="pin(msg)"
              >
                <Icon name="ph:push-pin" />
              </button>
              <!-- Staff only, even for your own: the room is a shared
                   log. Fixing a typo is what the edit window is for. -->
              <button
                v-if="isStaff"
                type="button"
                class="room-action room-action--danger"
                :aria-label="$t('room.remove')"
                :title="$t('room.remove')"
                @click="remove(msg)"
              >
                <Icon name="ph:trash" />
              </button>
            </div>
          </div>

          <button v-if="msg.failed" type="button" class="room-retry" @click="retry(msg)">
            {{ $t('room.retry') }}
          </button>
        </div>
      </article>
    </div>

    <p v-if="mutedUntil" class="room-notice">
      {{ $t('room.muted', { until: new Date(mutedUntil).toLocaleString() }) }}
    </p>

    <p v-if="commandNote" class="room-notice room-command-note">
      {{ commandNote }}
      <button
        type="button"
        class="room-pin-clear"
        :aria-label="$t('common.cancel')"
        @click="commandNote = ''"
      >
        <Icon name="ph:x" />
      </button>
    </p>

    <div v-if="(replyTo || editing) && !mutedUntil" class="room-context">
      <Icon :name="editing ? 'ph:pencil-simple' : 'ph:arrow-bend-up-left'" />
      <span class="room-context-text">
        <template v-if="editing">{{ $t('messaging.editing') }}</template>
        <template v-else>
          {{ $t('messaging.replyingTo', { name: authorOf(replyTo!) }) }}
          — {{ (replyTo!.body ?? '').slice(0, 60) }}
        </template>
      </span>
      <button
        type="button"
        class="room-pin-clear"
        :aria-label="$t('common.cancel')"
        @click="clearContext"
      >
        <Icon name="ph:x" />
      </button>
    </div>

    <form v-if="!mutedUntil" class="room-composer" @submit.prevent="send">
      <input
        v-model="draft"
        class="room-input"
        :placeholder="$t('room.placeholder')"
        :aria-label="$t('room.placeholder')"
      />
      <button type="submit" class="room-send" :disabled="!draft.trim()">
        <Icon :name="editing ? 'ph:check' : 'ph:paper-plane-tilt'" class="w-4 h-4" />
        <span class="sr-only">
          {{ editing ? $t('messaging.saveEdit') : $t('messaging.send') }}
        </span>
      </button>
    </form>
  </div>
</template>

<script setup lang="ts">
import type { AuthorBadgeValue } from '~/components/messaging/AuthorBadge.vue';
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
interface RoomReplyRef {
  id: string;
  /** Retention or a removal took the quoted message. */
  gone?: boolean;
  author?: string | null;
  preview?: string | null;
}

interface RoomMessage {
  id: string;
  body: string | null;
  deleted: boolean;
  createdAt: string;
  editedAt?: string | null;
  author: {
    id: string;
    username: string;
    displayName: string | null;
    /** The single highest-priority public badge, or null. */
    badge?: AuthorBadgeValue | null;
  } | null;
  reactions?: Record<string, number>;
  myReactions?: string[];
  replyTo?: RoomReplyRef | null;
  failed?: boolean;
}


const { t } = useI18n();
const { user } = useUserSession();

/** Mine to edit. Computed rather than stored: the server never says so. */
const isMine = (msg: RoomMessage) =>
  !!msg.author?.id && msg.author.id === user.value?.id;

const messages = ref<RoomMessage[]>([]);
/** The message the composer is answering, if any. */
const replyTo = ref<RoomMessage | null>(null);
/** The message the composer is rewriting. Mutually exclusive with above. */
const editing = ref<RoomMessage | null>(null);
const pinned = ref<{ id: string; body: string | null; author: string | null } | null>(null);
/** Feedback for a slash command, which has no message to show for it. */
const commandNote = ref('');
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
  pinned: { id: string; body: string | null; author: string | null } | null;
}>('/api/messaging/room');

watchEffect(() => {
  if (!data.value) return;
  messages.value = [...data.value.messages].reverse();
  nextBefore.value = data.value.nextBefore;
  slowModeSeconds.value = data.value.slowModeSeconds;
  mutedUntil.value = data.value.mutedUntil;
  pinned.value = data.value.pinned ?? null;
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
  if (editing.value) return submitEdit();
  const body = draft.value.trim();
  if (!body) return;

  // Commands are intercepted before anything is written. A `/mute` that
  // reached the room as text would announce the moderation instead of
  // performing it.
  if (body.startsWith('/')) {
    draft.value = '';
    if (await runCommand(body)) return;
  }

  draft.value = '';
  const answering = replyTo.value;
  replyTo.value = null;

  const pending: RoomMessage = {
    id: `pending-${Date.now()}`,
    body,
    deleted: false,
    createdAt: new Date().toISOString(),
    author: user.value
      ? { id: user.value.id, username: user.value.username, displayName: user.value.displayName }
      : null,
    replyTo: answering
      ? {
          id: answering.id,
          author: answering.author?.username ?? null,
          preview: (answering.body ?? '').slice(0, 140),
        }
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
      {
        method: 'POST',
        body: { body: pending.body, replyToId: pending.replyTo?.id },
      }
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

/** Toggle one reaction on one message. */
function react(msg: RoomMessage, key: string) {
  void toggleReaction(`/api/messaging/room/messages/${msg.id}/reactions`, msg, key);
}

/**
 * Pin, and show it here rather than waiting for the echo.
 *
 * This used to do nothing visible: the banner was only updated by the
 * `roomPin` frame coming back through the relay, so with no live stream
 * — a relay that is down, a connection still opening, a browser that
 * blocked it — the click succeeded and the interface never moved. The
 * relay is an optimisation everywhere else in this feature; it cannot be
 * the only path for something the clicker is watching for.
 */
async function pin(msg: RoomMessage) {
  const previous = pinned.value;
  pinned.value = {
    id: msg.id,
    body: msg.body,
    author: msg.author?.username ?? null,
  };
  try {
    await $fetch('/api/mod/room/pin', {
      method: 'POST',
      body: { messageId: msg.id },
    });
  } catch (err) {
    pinned.value = previous;
    // Said out loud. A refusal that only shows in the console is a
    // button that "does nothing" — which is exactly how a 409 on an
    // already-removed message read.
    commandNote.value =
      (err as { data?: { message?: string } })?.data?.message ??
      t('room.commands.failed');
  }
}

async function unpin() {
  const previous = pinned.value;
  pinned.value = null;
  try {
    await $fetch('/api/mod/room/pin', { method: 'DELETE' });
  } catch (err) {
    pinned.value = previous;
    commandNote.value =
      (err as { data?: { message?: string } })?.data?.message ??
      t('room.commands.failed');
  }
}

/**
 * Whether this message opens a new run.
 *
 * A run is the same author, without a gap. Five minutes is the gap that
 * matters: past it the two messages are separate thoughts and the
 * timestamp is worth repeating, under it they are one and repeating the
 * name six times just pushes the room off the screen.
 */
const GROUP_GAP_MS = 5 * 60_000;
function startsGroup(i: number): boolean {
  if (i === 0) return true;
  const previous = messages.value[i - 1];
  const current = messages.value[i];
  if (!previous || !current) return true;
  if (previous.author?.id !== current.author?.id) return true;
  return (
    new Date(current.createdAt).getTime() -
      new Date(previous.createdAt).getTime() >
    GROUP_GAP_MS
  );
}

function startReply(msg: RoomMessage) {
  editing.value = null;
  replyTo.value = msg;
  void nextTick(() => {
    document.querySelector<HTMLInputElement>('.room-input')?.focus();
  });
}

function beginEdit(msg: RoomMessage) {
  replyTo.value = null;
  editing.value = msg;
  draft.value = msg.body ?? '';
  void nextTick(() => {
    const el = document.querySelector<HTMLInputElement>('.room-input');
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  });
}

function clearContext() {
  if (editing.value) draft.value = '';
  editing.value = null;
  replyTo.value = null;
}

async function submitEdit() {
  const target = editing.value;
  const body = draft.value.trim();
  if (!target || !body) return;
  const previous = target.body;
  target.body = body;
  target.editedAt = new Date().toISOString();
  draft.value = '';
  editing.value = null;
  try {
    await $fetch(`/api/messaging/room/messages/${target.id}`, {
      method: 'PATCH',
      body: { body },
    });
  } catch (err) {
    target.body = previous;
    target.editedAt = null;
    commandNote.value =
      (err as { data?: { message?: string } })?.data?.message ??
      t('room.commands.failed');
  }
}

/** How much longer a mute has to run, rounded to something readable. */
function shortUntil(iso: string): string {
  const mins = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
  if (mins < 60) return t('room.commands.minutesLeft', { count: mins });
  return t('room.commands.hoursLeft', { count: Math.round(mins / 60) });
}

/**
 * Staff slash commands.
 *
 * The shoutbox convention, and it earns its place: moderating the room
 * from the room is the difference between acting on something in five
 * seconds and opening another page to do it. Every one maps to a route
 * that already enforces the permission, so this is a shortcut and never
 * an authority — a member who types `/mute` gets the same 403 they would
 * get from the API.
 *
 * Returns true when the input WAS a command, so the caller does not also
 * send it as a message.
 */
async function runCommand(raw: string): Promise<boolean> {
  if (!raw.startsWith('/')) return false;
  const [cmd, ...rest] = raw.slice(1).split(/\s+/);
  commandNote.value = '';

  try {
    switch (cmd) {
      case 'help':
        commandNote.value = t('room.commands.help');
        return true;

      case 'pin': {
        // Pins what you are replying to: naming a message by id in a
        // chat box is not something anyone will do.
        if (!replyTo.value) {
          commandNote.value = t('room.commands.pinNeedsReply');
          return true;
        }
        await pin(replyTo.value);
        replyTo.value = null;
        return true;
      }

      case 'unpin':
        await unpin();
        return true;

      case 'mute': {
        const [name, hours, ...reason] = rest;
        if (!name) {
          commandNote.value = t('room.commands.usageMute');
          return true;
        }
        await $fetch('/api/mod/room/mutes', {
          method: 'POST',
          body: {
            username: name,
            hours: Number(hours) > 0 ? Number(hours) : 1,
            reason: reason.join(' ') || undefined,
          },
        });
        commandNote.value = t('room.commands.muted', { name });
        return true;
      }

      /*
       * `/unmute` takes a name and there was nowhere to read one. A mute
       * expires on its own, but "wait it out" is not the same as being
       * able to lift it, and a moderator coming on shift after somebody
       * else has no way to know who is silenced.
       */
      case 'mutes': {
        const { mutes } = await $fetch<{
          mutes: { username: string; until: string; by: string | null }[];
        }>('/api/mod/room/mutes');
        commandNote.value = mutes.length
          ? t('room.commands.mutes', {
              list: mutes
                .map((m) =>
                  t('room.commands.muteEntry', {
                    name: m.username,
                    until: shortUntil(m.until),
                  })
                )
                .join(' · '),
            })
          : t('room.commands.mutesNone');
        return true;
      }

      case 'unmute': {
        const [name] = rest;
        if (!name) {
          commandNote.value = t('room.commands.usageUnmute');
          return true;
        }
        await $fetch(`/api/mod/room/mutes/${encodeURIComponent(name)}`, {
          method: 'DELETE',
        });
        commandNote.value = t('room.commands.unmuted', { name });
        return true;
      }

      case 'slow': {
        const seconds = Number(rest[0]);
        if (!Number.isFinite(seconds) || seconds < 0) {
          commandNote.value = t('room.commands.usageSlow');
          return true;
        }
        await $fetch('/api/admin/settings', {
          method: 'PUT',
          body: { messagingRoomSlowModeSeconds: Math.floor(seconds) },
        });
        slowModeSeconds.value = Math.floor(seconds);
        commandNote.value = t('room.commands.slow', { seconds: Math.floor(seconds) });
        return true;
      }

      default:
        // Unknown commands are NOT sent as messages. Somebody who
        // mistypes `/mtue` should see that nothing happened, not
        // broadcast their moderation intent to the room.
        commandNote.value = t('room.commands.unknown', { cmd });
        return true;
    }
  } catch (err) {
    const message = (err as { data?: { message?: string } })?.data?.message;
    commandNote.value = message ?? t('room.commands.failed');
    return true;
  }
}

/** Scroll a quoted message into view, and say which one it was. */
function jumpTo(id: string) {
  const el = document.getElementById(`room-${id}`);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.add('room-flash');
  setTimeout(() => el.classList.remove('room-flash'), 1200);
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
      return;
    }
    // A delta, not a new total: two readers reacting in the same second
    // must not each apply a snapshot taken before the other's.
    if (frame.type === 'roomReaction') {
      const row = messages.value.find((m) => m.id === frame.messageId);
      // The reactor already applied it optimistically; applying the echo
      // too would count it twice.
      if (row && frame.userId !== user.value?.id) {
        applyReactionDelta(row, frame.key, frame.delta);
      }
      return;
    }
    if (frame.type === 'roomPin') {
      // A null id is an unpin. Sent as one frame type rather than two so
      // a reader that missed the pin cannot end up stuck showing it.
      pinned.value = frame.messageId
        ? { id: frame.messageId, body: frame.body, author: null }
        : null;
      // The author is not in the frame — refetching is one request and
      // keeps the banner from showing a nameless quote.
      if (frame.messageId) void refresh();
      return;
    }
    if (frame.type === 'roomEdit') {
      const row = messages.value.find((m) => m.id === frame.messageId);
      if (row) {
        row.body = frame.body;
        row.editedAt = frame.editedAt;
      }
    }
  },
});

onMounted(() => refresh());
</script>

<style scoped>
/*
 * The room, laid out as a conversation rather than as a log.
 *
 * The previous version was one wrapping flex row per message. It read
 * fine until anything else had to live on that row: the three action
 * buttons each carried `margin-left: auto`, so they spread themselves
 * evenly across the full width on a permanent line of their own, and the
 * reaction strip wrapped mid-sentence. Grouping by author and giving the
 * message a bubble puts each of those things somewhere it belongs.
 */
.room-shell {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-height: 60vh;
  max-height: calc(100dvh - 8rem);
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  background: rgb(var(--bg-surface));
  overflow: hidden;
}

/* ── Header ───────────────────────────────────────────────────────── */
.room-head {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.75rem 0.875rem;
  border-bottom: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-elevated));
}
.room-head-tile {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  flex: none;
  border-radius: var(--radius-md);
  background: rgb(var(--accent-warm) / 0.16);
  color: rgb(var(--accent-warm));
  font-size: 1.1rem;
}
.room-head-text { display: flex; flex-direction: column; min-width: 0; }
.room-head-name {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
  color: rgb(var(--fg-strong));
}
.room-head-sub { font-size: 0.72rem; color: rgb(var(--fg-muted)); }
.room-head-tags {
  margin-left: auto;
  display: flex;
  gap: 0.35rem;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.room-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.15rem 0.45rem;
  border-radius: var(--radius-pill);
  background: rgb(var(--fg-default) / 0.08);
  color: rgb(var(--fg-muted));
  font-size: 0.65rem;
}

/* ── Pinned announcement ──────────────────────────────────────────── */
.room-pin {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.5rem 0.875rem;
  border-bottom: 1px solid rgb(var(--accent-warm) / 0.28);
  background: rgb(var(--accent-warm) / 0.09);
  font-size: 0.78rem;
  line-height: 1.4;
}
.room-pin-icon { flex: none; margin-top: 0.15rem; color: rgb(var(--accent-warm)); }
.room-pin-body { flex: 1; min-width: 0; }
.room-pin-body b { font-weight: 700; color: rgb(var(--fg-strong)); }
.room-pin-clear {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: rgb(var(--fg-muted));
  cursor: pointer;
}
.room-pin-clear:hover { color: rgb(var(--fg-strong)); background: rgb(var(--fg-default) / 0.1); }

/* ── Log ──────────────────────────────────────────────────────────── */
.room-scroller {
  flex: 1;
  overflow-y: auto;
  padding: 0.75rem 0.875rem;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.room-older {
  align-self: center;
  margin-bottom: 0.5rem;
  padding: 0.25rem 0.75rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-pill);
  background: transparent;
  color: rgb(var(--fg-muted));
  font-size: 0.7rem;
  cursor: pointer;
}
.room-hint {
  padding: 1rem 0;
  color: rgb(var(--fg-muted));
  font-size: 0.8rem;
  text-align: center;
}

/* ── One message ──────────────────────────────────────────────────── */
.room-msg {
  display: flex;
  gap: 0.5rem;
  /* Room for the toolbar to sit above the bubble without touching the
     message before it. */
  padding-top: 0.5rem;
}
/* Inside a run: no name, no disc, no gap. This is what keeps a busy room
   readable without shortening a single line. */
.room-msg--grouped { padding-top: 0.05rem; }

.room-avatar,
.room-avatar-gap {
  width: 1.9rem;
  flex: none;
}
.room-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 1.9rem;
  border-radius: var(--radius-pill);
  background: rgb(var(--fg-default) / 0.1);
  color: rgb(var(--fg-default));
  font-size: 0.72rem;
  font-weight: 700;
}

.room-msg-main { min-width: 0; flex: 1; }
.room-msg-head {
  display: flex;
  /* Center, not baseline: the badge is a bordered pill and baseline
     alignment hangs it below the name it belongs to. */
  align-items: center;
  gap: 0.4rem;
  margin: 0 0 0.15rem;
}
.room-msg-author {
  font-size: 0.8rem;
  font-weight: 700;
  color: rgb(var(--fg-strong));
  text-decoration: none;
}
/* Underlined on hover rather than always: a room where every name is
   underlined reads as a page of links, not as a conversation. */
.room-msg-author--link:hover { text-decoration: underline; }
.room-avatar--link {
  text-decoration: none;
  transition: background var(--dur-2) ease;
}
.room-avatar--link:hover { background: rgb(var(--fg-default) / 0.18); }
.room-msg-time {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 0.65rem;
  color: rgb(var(--fg-subtle));
}

.room-bubble {
  position: relative;
  display: inline-block;
  max-width: min(90%, 44rem);
  padding: 0.4rem 0.6rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  background: rgb(var(--bg-elevated));
  font-size: 0.85rem;
  line-height: 1.45;
}
.room-bubble--failed { border-color: rgb(var(--danger)); }
.room-body { margin: 0; overflow-wrap: anywhere; }
.room-removed { color: rgb(var(--fg-subtle)); font-style: italic; }
.room-edited { color: rgb(var(--fg-subtle)); font-size: 0.68rem; font-style: italic; }

/* ── Quote ────────────────────────────────────────────────────────── */
.room-quote {
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
  width: 100%;
  margin-bottom: 0.3rem;
  padding: 0.25rem 0.45rem;
  border: 0;
  border-left: 2px solid rgb(var(--accent-warm));
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  background: rgb(var(--fg-default) / 0.06);
  color: rgb(var(--fg-muted));
  font-size: 0.72rem;
  line-height: 1.35;
  text-align: left;
  cursor: pointer;
}
.room-quote:disabled { cursor: default; font-style: italic; }
.room-quote-author { font-weight: 700; color: rgb(var(--accent-warm)); }
.room-quote-text {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ── Actions ──────────────────────────────────────────────────────── */
.room-actions {
  position: absolute;
  /* Anchored to the bubble's top EDGE, not offset by a guessed number of
     rems. A fixed negative `top` has to guess the toolbar's own height,
     and guessing short leaves it sitting on the first line of the
     message — unreadable and unclickable at once. `bottom: 100%` puts it
     entirely above whatever height it turns out to be; the small
     negative margin pulls it back to overlap the border only. */
  bottom: 100%;
  margin-bottom: -0.5rem;
  right: 0.25rem;
  display: flex;
  gap: 0.1rem;
  padding: 0.12rem;
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-strong));
  border-radius: var(--radius-pill);
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.3);
  opacity: 0;
  transition: opacity var(--dur-2) ease;
  z-index: 2;
}
.room-msg:hover .room-actions,
.room-actions:focus-within { opacity: 1; }
/* No hover, no discovery — on touch they are simply there. */
@media (hover: none) {
  .room-actions { opacity: 1; }
}
.room-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.6rem;
  height: 1.6rem;
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: rgb(var(--fg-muted));
  font-size: 0.8rem;
  cursor: pointer;
  transition: color var(--dur-2) ease, background var(--dur-2) ease;
}
.room-action:hover { color: rgb(var(--fg-strong)); background: rgb(var(--fg-default) / 0.1); }
/* Destructive actions carry the danger colour, and sit last. */
.room-action--danger:hover { color: rgb(var(--danger)); background: rgb(var(--danger) / 0.12); }

.room-retry {
  margin-top: 0.2rem;
  border: 0;
  background: transparent;
  color: rgb(var(--danger));
  font-size: 0.7rem;
  text-decoration: underline;
  cursor: pointer;
}

/* ── Notices and composer ─────────────────────────────────────────── */
.room-notice {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 0.875rem;
  border-top: 1px solid rgb(var(--line-default));
  color: rgb(var(--fg-muted));
  font-size: 0.75rem;
}
.room-command-note { color: rgb(var(--fg-default)); }

.room-context {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0.5rem 0.875rem 0;
  padding: 0.35rem 0.5rem;
  border-left: 2px solid rgb(var(--accent-warm));
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  background: rgb(var(--fg-default) / 0.06);
  color: rgb(var(--fg-muted));
  font-size: 0.72rem;
}
.room-context-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.room-composer {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 0.875rem;
  border-top: 1px solid rgb(var(--line-default));
}
.room-input {
  flex: 1;
  min-width: 0;
  /* 44px: this is the control the whole page exists for. */
  height: 2.75rem;
  padding: 0 0.875rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-pill);
  background: rgb(var(--bg-inset));
  color: rgb(var(--fg-default));
  font-size: 0.875rem;
}
.room-input::placeholder { color: rgb(var(--fg-subtle)); }
.room-input:focus {
  outline: none;
  border-color: rgb(var(--accent-warm) / 0.6);
}
.room-send {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  flex: none;
  border: 0;
  border-radius: var(--radius-pill);
  background: rgb(var(--accent-warm));
  color: rgb(var(--bg-base));
  cursor: pointer;
  transition: opacity var(--dur-2) ease;
}
.room-send:disabled { opacity: 0.4; cursor: default; }

.room-flash { animation: room-flash 1.2s ease-out; }
@keyframes room-flash {
  0%, 40% { background: rgb(var(--accent-warm) / 0.16); }
  100% { background: transparent; }
}

@media (prefers-reduced-motion: reduce) {
  .room-action,
  .room-actions,
  .room-send { transition: none; }
  .room-flash { animation: none; }
}
</style>
