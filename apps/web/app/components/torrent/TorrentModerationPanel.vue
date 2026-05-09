<template>
  <section
    v-if="visible"
    class="mod"
    :class="[`mod--${currentStatus}`, { 'mod--collapsed': !expanded }]"
    :data-status="currentStatus"
  >
    <!-- ─── Banner ──────────────────────────────────────── -->
    <!--
      The whole banner is the toggle. Clicking anywhere on the strip
      flips the panel between collapsed (default) and expanded. We
      use a button for keyboard / screen-reader semantics; `aria-
      expanded` and `aria-controls` link it to the body region below.
    -->
    <button
      type="button"
      class="mod-banner"
      :aria-expanded="expanded"
      :aria-controls="bodyId"
      @click="toggle"
    >
      <div class="mod-banner-glyph" aria-hidden="true">
        <Icon :name="bannerIcon" />
      </div>
      <div class="mod-banner-text">
        <p class="mod-banner-eyebrow">
          File · Moderation
          <span v-if="!loading" class="mod-banner-count">
            {{ messages.length }} {{ messages.length === 1 ? 'entry' : 'entries' }}
          </span>
          <span v-if="!expanded" class="mod-banner-collapsed-pip">
            click to open
          </span>
        </p>
        <h3 class="mod-banner-title">{{ bannerTitle }}</h3>
        <p class="mod-banner-sub">{{ bannerSub }}</p>
      </div>
      <div class="mod-banner-trail">
        <TorrentModerationBadge :status="currentStatus" />
        <Icon
          name="ph:caret-down-bold"
          class="mod-banner-caret"
          :class="{ 'mod-banner-caret--up': expanded }"
          aria-hidden="true"
        />
      </div>
    </button>

    <!-- ─── Body (collapsible) ──────────────────────────── -->
    <div :id="bodyId" v-show="expanded" class="mod-body">

    <!-- ─── Loading ─────────────────────────────────────── -->
    <div v-if="loading" class="mod-loading">
      <Icon name="ph:circle-notch" class="animate-spin" />
      <span>Loading conversation…</span>
    </div>

    <div v-else class="mod-stack">
      <!-- ─── Timeline ─────────────────────────────────── -->
      <div v-if="messages.length === 0" class="mod-empty">
        <Icon name="ph:scroll-bold" class="mod-empty-glyph" />
        <p class="mod-empty-text">No entries yet.</p>
        <p class="mod-empty-help">{{ emptyHint }}</p>
      </div>

      <ol v-else class="mod-thread" aria-live="polite">
        <li
          v-for="m in messages"
          :key="m.id"
          class="mod-row"
          :class="rowClass(m)"
        >
          <span class="mod-row-rail" aria-hidden="true" />
          <span class="mod-row-pin" aria-hidden="true">
            <Icon :name="rowIcon(m)" />
          </span>

          <div class="mod-row-card">
            <div class="mod-row-meta">
              <span class="mod-row-author">
                <template v-if="m.isSystem">System</template>
                <template v-else-if="m.author">@{{ m.author.username }}</template>
                <template v-else>(deleted)</template>
                <span v-if="!m.isSystem && m.author?.isAdmin" class="mod-row-pip mod-row-pip--admin">
                  Admin
                </span>
                <span v-else-if="!m.isSystem && m.author?.isModerator" class="mod-row-pip mod-row-pip--mod">
                  Mod
                </span>
              </span>
              <time class="mod-row-time" :datetime="m.createdAt">
                {{ formatDate(m.createdAt) }}
              </time>
              <span v-if="m.statusChange" class="mod-row-statuschange">
                set to <strong>{{ statusLabel(m.statusChange) }}</strong>
              </span>
            </div>
            <p class="mod-row-body">{{ m.body }}</p>
          </div>
        </li>
      </ol>

      <!-- ─── Composer ──────────────────────────────────── -->
      <div v-if="canAct" class="mod-composer">
        <div class="mod-composer-head">
          <Icon name="ph:paper-plane-tilt" />
          <span>{{ isStaff ? 'Take action or leave a note' : 'Reply to the moderation team' }}</span>
        </div>
        <textarea
          v-model="composerBody"
          rows="3"
          maxlength="4000"
          :placeholder="composerPlaceholder"
          class="mod-composer-input"
          :disabled="composerLoading"
        />
        <div class="mod-composer-actions">
          <button
            type="button"
            class="mod-action mod-action--reply"
            :disabled="!canPostReply"
            @click="postReply"
          >
            <Icon
              :name="composerAction === 'reply' && composerLoading
                ? 'ph:circle-notch'
                : 'ph:chat-circle-text-bold'"
              :class="{ 'animate-spin': composerAction === 'reply' && composerLoading }"
            />
            <span>Send reply</span>
          </button>

          <template v-if="isStaff">
            <button
              v-if="currentStatus !== 'accepted'"
              type="button"
              class="mod-action mod-action--accept"
              :disabled="composerLoading"
              @click="act('approve')"
            >
              <Icon
                :name="composerAction === 'approve' && composerLoading
                  ? 'ph:circle-notch'
                  : 'ph:check-circle-fill'"
                :class="{ 'animate-spin': composerAction === 'approve' && composerLoading }"
              />
              <span>Approve</span>
            </button>

            <button
              v-if="currentStatus !== 'changes_requested' && currentStatus !== 'rejected'"
              type="button"
              class="mod-action mod-action--changes"
              :disabled="composerLoading || !composerBody.trim()"
              @click="act('request-changes')"
              :title="!composerBody.trim() ? 'A note explaining what to change is required' : ''"
            >
              <Icon
                :name="composerAction === 'request-changes' && composerLoading
                  ? 'ph:circle-notch'
                  : 'ph:pencil-line-fill'"
                :class="{ 'animate-spin': composerAction === 'request-changes' && composerLoading }"
              />
              <span>Request changes</span>
            </button>

            <button
              v-if="currentStatus !== 'rejected'"
              type="button"
              class="mod-action mod-action--reject"
              :disabled="composerLoading || !composerBody.trim()"
              @click="act('reject')"
              :title="!composerBody.trim() ? 'A reason is required' : ''"
            >
              <Icon
                :name="composerAction === 'reject' && composerLoading
                  ? 'ph:circle-notch'
                  : 'ph:prohibit-fill'"
                :class="{ 'animate-spin': composerAction === 'reject' && composerLoading }"
              />
              <span>Reject</span>
            </button>

            <button
              v-if="currentStatus === 'rejected'"
              type="button"
              class="mod-action mod-action--reset"
              :disabled="composerLoading || !composerBody.trim()"
              @click="act('reset')"
              :title="!composerBody.trim() ? 'A note is required' : ''"
            >
              <Icon
                :name="composerAction === 'reset' && composerLoading
                  ? 'ph:circle-notch'
                  : 'ph:arrow-counter-clockwise-bold'"
                :class="{ 'animate-spin': composerAction === 'reset' && composerLoading }"
              />
              <span>Re-open to pending</span>
            </button>
          </template>
        </div>
        <p v-if="composerError" class="mod-composer-error">
          <Icon name="ph:warning-circle-fill" />
          {{ composerError }}
        </p>
      </div>

      <p v-else class="mod-readonly">
        <Icon name="ph:lock-simple" />
        This conversation is read-only from your viewpoint.
      </p>
    </div>
    </div><!-- /.mod-body -->
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import TorrentModerationBadge from '~/components/torrent/TorrentModerationBadge.vue';
import { useNotificationStore } from '~/stores/notifications';

type Status = 'pending' | 'accepted' | 'changes_requested' | 'rejected';

interface ModMessage {
  id: string;
  body: string;
  isSystem: boolean;
  statusChange: Status | null;
  createdAt: string;
  author: {
    id: string;
    username: string;
    isAdmin: boolean;
    isModerator: boolean;
  } | null;
}

interface Props {
  hash: string;
  status: Status;
  uploaderId: string | null;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  (e: 'status-change', s: Status): void;
}>();

const notifications = useNotificationStore();
const { user } = useUserSession();

const messages = ref<ModMessage[]>([]);
const loading = ref(true);
const currentStatus = ref<Status>(props.status);
const composerBody = ref('');
const composerLoading = ref(false);
const composerAction = ref<'reply' | 'approve' | 'request-changes' | 'reject' | 'reset' | null>(null);
const composerError = ref<string | null>(null);

// Collapsed by default — the panel sits under the torrent header
// most of the time and we don't want a wall of text every page load.
// Clicking the banner flips this on; aria-expanded + aria-controls
// keep keyboard / screen-reader users in the loop.
const expanded = ref(false);
const bodyId = `mod-panel-body-${Math.random().toString(36).slice(2, 9)}`;
function toggle() {
  expanded.value = !expanded.value;
}

const isStaff = computed(() =>
  Boolean(user.value && (user.value.isAdmin || user.value.isModerator))
);
const isOwner = computed(
  () => !!user.value && user.value.id === props.uploaderId
);
const visible = computed(() => isStaff.value || isOwner.value);
const canAct = computed(() => visible.value);
const canPostReply = computed(
  () =>
    canAct.value &&
    composerBody.value.trim().length > 0 &&
    !composerLoading.value
);

const bannerIcon = computed(() => {
  switch (currentStatus.value) {
    case 'pending': return 'ph:hourglass-high-fill';
    case 'changes_requested': return 'ph:pencil-line-fill';
    case 'rejected': return 'ph:prohibit-fill';
    case 'accepted': return 'ph:check-circle-fill';
  }
  return 'ph:gavel';
});

const bannerTitle = computed(() => {
  switch (currentStatus.value) {
    case 'pending':
      return isStaff.value ? 'Awaiting your call' : 'Awaiting moderation';
    case 'changes_requested':
      return isOwner.value
        ? 'Changes requested — edit and resubmit'
        : 'Changes requested';
    case 'rejected':
      return 'This file has been rejected';
    case 'accepted':
      return 'Open conversation';
  }
  return 'Moderation';
});

const bannerSub = computed(() => {
  switch (currentStatus.value) {
    case 'pending':
      return isStaff.value
        ? 'Use the actions below to approve, request changes, or reject this row.'
        : 'A moderator will review your upload shortly.';
    case 'changes_requested':
      return isOwner.value
        ? 'Read the moderator’s note, edit the torrent, then save to resubmit.'
        : 'Awaiting the uploader’s edits.';
    case 'rejected':
      return 'Hidden from public listings. Only a moderator can re-open it.';
    case 'accepted':
      return 'Visible everywhere. Notes posted here stay between you and the moderation team.';
  }
  return '';
});

const emptyHint = computed(() => {
  if (currentStatus.value === 'pending')
    return isStaff.value
      ? 'Open the composer below to action this row.'
      : 'You will be notified once a moderator chimes in.';
  if (currentStatus.value === 'changes_requested')
    return isOwner.value
      ? 'Save an edit to push the torrent back into review.'
      : 'Awaiting the uploader’s edits.';
  if (currentStatus.value === 'rejected')
    return 'Only a moderator can post here now.';
  return 'Nothing to discuss yet.';
});

const composerPlaceholder = computed(() => {
  if (currentStatus.value === 'rejected' && isStaff.value)
    return 'Explain why you are re-opening this rejected file…';
  if (isStaff.value) return 'Add a note or write the rationale for an action…';
  return 'Reply to the moderation team…';
});

watch(
  () => props.status,
  (s) => {
    currentStatus.value = s;
  }
);

onMounted(async () => {
  if (!visible.value) {
    loading.value = false;
    return;
  }
  await load();
});

async function load() {
  loading.value = true;
  try {
    const res = await $fetch<{ status: Status; messages: ModMessage[] }>(
      `/api/torrents/${props.hash}/moderation/messages`
    );
    messages.value = res.messages;
    currentStatus.value = res.status;
  } catch (err) {
    console.warn('[moderation] load failed:', err);
  } finally {
    loading.value = false;
  }
}

async function postReply() {
  if (!canPostReply.value) return;
  composerLoading.value = true;
  composerAction.value = 'reply';
  composerError.value = null;
  try {
    await $fetch(`/api/torrents/${props.hash}/moderation/messages`, {
      method: 'POST',
      body: { body: composerBody.value.trim() },
    });
    composerBody.value = '';
    await load();
    notifications.success('Reply sent.');
  } catch (err: unknown) {
    composerError.value =
      (err as { data?: { message?: string } })?.data?.message ??
      'Failed to send reply.';
  } finally {
    composerLoading.value = false;
    composerAction.value = null;
  }
}

async function act(
  action: 'approve' | 'request-changes' | 'reject' | 'reset'
) {
  if (!isStaff.value || composerLoading.value) return;
  const trimmed = composerBody.value.trim();
  if (action !== 'approve' && trimmed.length === 0) {
    composerError.value = 'A note is required for this action.';
    return;
  }
  composerLoading.value = true;
  composerAction.value = action;
  composerError.value = null;
  try {
    const path =
      action === 'reset'
        ? `/api/mod/torrents/${props.hash}/reset`
        : action === 'request-changes'
          ? `/api/mod/torrents/${props.hash}/request-changes`
          : `/api/mod/torrents/${props.hash}/${action}`;
    const res = await $fetch<{ torrent: { moderationStatus: Status } }>(path, {
      method: 'POST',
      body: trimmed.length > 0 ? { message: trimmed } : {},
    });
    composerBody.value = '';
    currentStatus.value = res.torrent.moderationStatus;
    emit('status-change', res.torrent.moderationStatus);
    await load();
    notifications.success(actionConfirmation(action, res.torrent.moderationStatus));
  } catch (err: unknown) {
    composerError.value =
      (err as { data?: { message?: string } })?.data?.message ??
      'Action failed.';
  } finally {
    composerLoading.value = false;
    composerAction.value = null;
  }
}

function actionConfirmation(action: string, next: Status): string {
  if (action === 'approve') return 'Torrent approved.';
  if (action === 'request-changes') return 'Changes requested.';
  if (action === 'reject') return 'Torrent rejected.';
  if (action === 'reset') return `Torrent moved to ${statusLabel(next)}.`;
  return 'Done.';
}

function rowClass(m: ModMessage): string[] {
  const variant = m.statusChange ?? 'reply';
  const cls = [`mod-row--${variant}`];
  if (m.isSystem) cls.push('mod-row--system');
  if (!m.isSystem && (m.author?.isAdmin || m.author?.isModerator)) cls.push('mod-row--mod');
  if (!m.isSystem && !(m.author?.isAdmin || m.author?.isModerator)) cls.push('mod-row--user');
  return cls;
}

function rowIcon(m: ModMessage): string {
  if (m.isSystem) return 'ph:gear-fill';
  if (m.statusChange === 'accepted') return 'ph:check-bold';
  if (m.statusChange === 'rejected') return 'ph:prohibit-fill';
  if (m.statusChange === 'changes_requested') return 'ph:pencil-line-fill';
  if (m.statusChange === 'pending') return 'ph:hourglass-medium-fill';
  if (m.author?.isAdmin || m.author?.isModerator) return 'ph:shield-chevron-fill';
  return 'ph:user-fill';
}

function statusLabel(s: Status | null): string {
  if (!s) return '—';
  return {
    pending: 'pending',
    accepted: 'accepted',
    changes_requested: 'changes requested',
    rejected: 'rejected',
  }[s];
}

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
 * Moderation panel — visual treatment.
 * The design borrows from a "case file" metaphor: a banner
 * coloured by the current status, a timeline of acts (status
 * changes + chat), and a composer at the bottom.
 *
 * Colours come straight from the existing semantic palette by
 * wrapping CSS variables in `rgb(...)`. Earlier drafts referenced
 * Tailwind tokens (--success / --error / --text-primary) which
 * don't exist as CSS variables, so the panel rendered without any
 * accent colour at all.
 */

.mod {
  /* Status palette — overridden by .mod--<status> below. */
  --c: 161 161 161;             /* fg-muted fallback */
  --c-soft: rgb(var(--c) / 0.10);
  --c-mid:  rgb(var(--c) / 0.22);
  --c-line: rgb(var(--c) / 0.45);
  --c-text: rgb(var(--c));

  border: 1px solid rgb(var(--line-default));
  border-radius: 12px;
  background: rgb(var(--bg-surface));
  overflow: hidden;
  position: relative;
}
.mod--pending { --c: 234 179 8; }            /* warning amber */
.mod--changes_requested { --c: 56 189 248; } /* info sky blue */
.mod--rejected { --c: 239 68 68; }           /* danger red */
.mod--accepted { --c: 34 197 94; }           /* online green */

/* Coloured side bar — gives the entire panel an unmistakable hue. */
.mod::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 4px;
  background: var(--c-text);
}

/* ── Banner ───────────────────────────────────────────── */
.mod-banner {
  display: grid;
  grid-template-columns: 48px 1fr auto;
  gap: 1rem;
  align-items: center;
  padding: 1.1rem 1.25rem 1rem 1.5rem;
  background:
    linear-gradient(135deg, var(--c-mid) 0%, transparent 70%),
    rgb(var(--bg-elevated));
  border-bottom: 1px solid var(--c-line);
  /* The banner is the toggle button; reset native button cosmetics */
  width: 100%;
  border-left: none;
  border-right: none;
  border-top: none;
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: inherit;
  transition: background 160ms ease;
}
.mod-banner:hover {
  background:
    linear-gradient(135deg, rgb(var(--c) / 0.32) 0%, transparent 70%),
    rgb(var(--bg-hover));
}
.mod-banner:focus-visible {
  outline: 2px solid rgb(var(--c) / 0.6);
  outline-offset: -2px;
}
/* When collapsed, the banner is the only thing visible — drop the
   bottom border so it merges with the rounded panel edge. */
.mod--collapsed .mod-banner {
  border-bottom: 0;
}

@media (max-width: 540px) {
  .mod-banner {
    grid-template-columns: 40px 1fr;
    grid-template-areas: "glyph trail" "text text";
    row-gap: 0.5rem;
  }
  .mod-banner-glyph { grid-area: glyph; }
  .mod-banner-text  { grid-area: text;  }
  .mod-banner-trail { grid-area: trail; justify-self: end; }
}

.mod-banner-trail {
  display: inline-flex;
  align-items: center;
  gap: 0.625rem;
}
.mod-banner-caret {
  font-size: 14px;
  color: rgb(var(--fg-subtle));
  transition: transform 220ms cubic-bezier(0.4, 0, 0.2, 1), color 160ms ease;
}
.mod-banner:hover .mod-banner-caret { color: var(--c-text); }
.mod-banner-caret--up { transform: rotate(-180deg); }

.mod-banner-collapsed-pip {
  display: inline-flex;
  align-items: center;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--fg-subtle));
  font-weight: 600;
  font-style: normal;
}
.mod-banner-collapsed-pip::before {
  content: '·';
  margin: 0 0.4rem;
  color: rgb(var(--fg-faint));
}
.mod-banner-glyph {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1.4rem;
  background: rgb(var(--c) / 0.14);
  color: var(--c-text);
  border: 1.5px solid var(--c-line);
}
.mod-banner-eyebrow {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-subtle));
  margin: 0 0 0.2rem;
  font-weight: 600;
}
.mod-banner-count {
  font-size: 9px;
  letter-spacing: 0.18em;
  color: var(--c-text);
  background: rgb(var(--c) / 0.14);
  border: 1px solid var(--c-line);
  padding: 0.05rem 0.4rem;
  border-radius: 999px;
  font-weight: 700;
}
.mod-banner-title {
  font-size: 1.15rem;
  font-weight: 700;
  color: rgb(var(--fg-strong));
  margin: 0 0 0.2rem;
  line-height: 1.2;
  letter-spacing: -0.005em;
}
.mod-banner-sub {
  font-size: 12.5px;
  color: rgb(var(--fg-muted));
  line-height: 1.5;
  margin: 0;
  max-width: 60ch;
}

/* ── States ───────────────────────────────────────────── */
.mod-loading {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 12px;
  color: rgb(var(--fg-muted));
  padding: 1.5rem 1.5rem;
}

.mod-stack {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding: 1.25rem 1.5rem 1.25rem;
}

.mod-empty {
  text-align: center;
  padding: 1.75rem 1rem 0.5rem;
  border: 1px dashed rgb(var(--line-default));
  border-radius: 10px;
  background: rgb(var(--bg-inset) / 0.6);
}
.mod-empty-glyph { font-size: 2rem; color: var(--c-text); opacity: 0.6; margin-bottom: 0.5rem; }
.mod-empty-text {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  font-weight: 700;
  color: rgb(var(--fg-strong));
  margin: 0;
}
.mod-empty-help {
  font-size: 12px;
  color: rgb(var(--fg-muted));
  margin: 0.25rem 0 0;
}

/* ── Timeline ─────────────────────────────────────────── */
.mod-thread {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.mod-row {
  --r: 161 161 161;
  display: grid;
  grid-template-columns: 32px 1fr;
  gap: 0.75rem;
  padding: 0.5rem 0;
  position: relative;
}
.mod-row + .mod-row { border-top: 0; }

/* Vertical rail on the left, "pin" icon at top, body card on the
   right. The rail extends to the bottom of the row. */
.mod-row-rail {
  grid-column: 1;
  grid-row: 1 / -1;
  width: 2px;
  background: rgb(var(--r) / 0.3);
  border-radius: 999px;
  margin-left: 15px;
  align-self: stretch;
}
.mod-row-pin {
  grid-column: 1;
  grid-row: 1;
  width: 32px;
  height: 32px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgb(var(--bg-surface));
  border: 1.5px solid rgb(var(--r));
  color: rgb(var(--r));
  font-size: 14px;
  margin-top: 2px;
  z-index: 1;
}

/* Variant tints — mirror the panel-level palette so a "rejected"
   action in a thread reads the same colour as its banner. */
.mod-row--accepted          { --r: 34 197 94; }
.mod-row--rejected          { --r: 239 68 68; }
.mod-row--changes_requested { --r: 56 189 248; }
.mod-row--pending           { --r: 234 179 8; }
.mod-row--reply.mod-row--user { --r: 161 161 161; }
.mod-row--reply.mod-row--mod  { --r: 250 250 250; }
.mod-row--system { --r: 112 112 112; }
.mod-row--system .mod-row-pin { border-style: dashed; }

.mod-row-card {
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-left: 3px solid rgb(var(--r));
  border-radius: 8px;
  padding: 0.625rem 0.875rem;
}
.mod-row--system .mod-row-card {
  background: rgb(var(--bg-inset));
  border-style: dashed;
}

.mod-row-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 0.3rem;
}
.mod-row-author {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-weight: 700;
  color: rgb(var(--fg-strong));
  font-size: 12.5px;
}
.mod-row-pip {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  font-weight: 700;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  border: 1px solid transparent;
}
.mod-row-pip--admin {
  background: rgb(234 179 8 / 0.18);
  color: rgb(234 179 8);
  border-color: rgb(234 179 8 / 0.45);
}
.mod-row-pip--mod {
  background: rgb(56 189 248 / 0.18);
  color: rgb(56 189 248);
  border-color: rgb(56 189 248 / 0.45);
}
.mod-row-time {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  color: rgb(var(--fg-subtle));
}
.mod-row-statuschange {
  font-size: 10.5px;
  color: rgb(var(--fg-muted));
  font-style: italic;
}
.mod-row-statuschange strong {
  color: rgb(var(--r));
  font-style: normal;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-size: 10px;
  padding: 0.05rem 0.35rem;
  background: rgb(var(--r) / 0.14);
  border-radius: 999px;
  border: 1px solid rgb(var(--r) / 0.4);
  margin-left: 0.2rem;
}
.mod-row-body {
  font-size: 13.5px;
  line-height: 1.55;
  color: rgb(var(--fg-default));
  white-space: pre-wrap;
  margin: 0;
}

/* ── Composer ─────────────────────────────────────────── */
.mod-composer {
  background: rgb(var(--bg-inset));
  border: 1px solid rgb(var(--line-default));
  border-radius: 10px;
  padding: 1rem 1rem 0.875rem;
  position: relative;
}
.mod-composer-head {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  font-weight: 700;
  margin-bottom: 0.625rem;
}
.mod-composer-head :deep(svg),
.mod-composer-head .iconify { color: var(--c-text); }

.mod-composer-input {
  width: 100%;
  background: rgb(var(--bg-base));
  border: 1.5px solid rgb(var(--line-default));
  border-radius: 8px;
  padding: 0.7rem 0.85rem;
  color: rgb(var(--fg-default));
  font-size: 13.5px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  resize: vertical;
  transition: border-color 140ms ease;
  line-height: 1.5;
}
.mod-composer-input:focus {
  outline: none;
  border-color: var(--c-line);
  box-shadow: 0 0 0 3px rgb(var(--c) / 0.12);
}
.mod-composer-input:disabled { opacity: 0.6; cursor: not-allowed; }

.mod-composer-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.7rem;
  justify-content: flex-end;
}
.mod-action {
  --a: 161 161 161;
  --a-bg: rgb(var(--a) / 0.12);
  --a-bg-hover: rgb(var(--a) / 0.22);
  --a-text: rgb(var(--a));
  --a-line: rgb(var(--a) / 0.4);

  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.55rem 0.95rem;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  cursor: pointer;
  transition:
    background 140ms ease,
    border-color 140ms ease,
    color 140ms ease,
    transform 140ms ease,
    box-shadow 140ms ease;
  border: 1.5px solid var(--a-line);
  background: var(--a-bg);
  color: var(--a-text);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}
.mod-action:hover:not(:disabled) {
  background: var(--a-bg-hover);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px -6px rgb(var(--a) / 0.4);
}
.mod-action:disabled { opacity: 0.45; cursor: not-allowed; }

.mod-action--reply   { --a: 250 250 250; }
.mod-action--accept  { --a: 34 197 94; }
.mod-action--changes { --a: 56 189 248; }
.mod-action--reject  { --a: 239 68 68; }
.mod-action--reset   { --a: 234 179 8; }

.mod-composer-error {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0.625rem 0 0;
  padding: 0.5rem 0.7rem;
  border-radius: 6px;
  background: rgb(239 68 68 / 0.1);
  border: 1px solid rgb(239 68 68 / 0.35);
  color: rgb(239 68 68);
  font-size: 12px;
}

.mod-readonly {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 11.5px;
  color: rgb(var(--fg-subtle));
  font-style: italic;
  margin: 0;
}
</style>
