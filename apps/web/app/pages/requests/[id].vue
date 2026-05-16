<template>
  <div class="dossier">
    <div class="dossier-aura" aria-hidden="true">
      <span class="aura-blob aura-blob--a" />
      <span class="aura-grain" />
    </div>

    <NuxtLink to="/requests" class="dossier-back">
      <Icon name="ph:arrow-left-bold" />
      <span>{{ $t('requests.actions.backToBoard') }}</span>
    </NuxtLink>

    <div v-if="pending && !data" class="dossier-loader">
      <Icon name="ph:circle-notch" class="loader-spin" />
    </div>

    <template v-else-if="data">
      <!-- ── Hero card ──────────────────────────────────────────
           Two-column layout: identity on the left (meta + title +
           byline), reward block on the right, vertically centred
           against the whole hero. The reward sits inside the same
           card rather than as an inline status pill so it reads
           as the standing offer — the thing this dossier is
           ultimately about. -->
      <section class="hero" :class="`hero--${data.status}`">
        <div class="hero-body">
          <div class="hero-meta">
            <span class="hero-status">
              <span class="hero-status-dot" />
              {{ $t(`requests.status.${data.status}`) }}
            </span>
            <span class="hero-sep" aria-hidden="true">·</span>
            <span class="hero-cat">
              <Icon
                v-if="data.category"
                :name="getCategoryIcon(data.category)"
              />
              <span>{{
                data.category?.name ?? $t('requests.unknownCategory')
              }}</span>
            </span>
            <span class="hero-sep" aria-hidden="true">·</span>
            <time class="hero-when tabular-nums" :datetime="data.createdAt">
              {{ formatAge(data.createdAt) }}
            </time>
          </div>

          <h1 class="hero-title">{{ data.title }}</h1>

          <div class="hero-byline">
            <span>{{ $t('requests.by') }}</span>
            <NuxtLink
              v-if="data.requester"
              :to="`/users/${data.requester.id}`"
              class="hero-byline-link"
            >
              @{{ data.requester.username }}
            </NuxtLink>
          </div>
        </div>

        <aside v-if="data.rewardPoints > 0" class="hero-reward">
          <span class="hero-reward-label">
            {{ $t('requests.reward') }}
          </span>
          <span class="hero-reward-value tabular-nums">
            <span class="hero-reward-mark">⊕</span>
            {{ formatPoints(data.rewardPoints) }}
          </span>
          <span class="hero-reward-unit">{{ $t('requests.points') }}</span>
        </aside>
      </section>

      <!-- ── Two-column grid: description + actions ──────────── -->
      <div class="grid">
        <section class="grid-main">
          <header class="grid-section-head">
            <span class="grid-section-mark" aria-hidden="true">§</span>
            <h2>{{ $t('requests.description') }}</h2>
            <span class="grid-section-line" aria-hidden="true" />
          </header>
          <div class="description">
            {{ data.description }}
          </div>

          <!-- If filled: surface the matched torrent inline. -->
          <div
            v-if="data.torrent && (data.status === 'filled' || data.status === 'validated')"
            class="filled-card"
          >
            <header class="filled-card-head">
              <Icon name="ph:link-bold" />
              <span>
                {{
                  data.status === 'validated'
                    ? $t('requests.filledByValidated')
                    : $t('requests.filledBy')
                }}
              </span>
              <NuxtLink
                v-if="data.filler"
                :to="`/users/${data.filler.id}`"
                class="filled-card-user"
              >
                @{{ data.filler.username }}
              </NuxtLink>
            </header>
            <NuxtLink
              :to="`/torrents/${data.torrent.infoHash}`"
              class="filled-card-link"
            >
              <Icon name="ph:file-zip-bold" />
              <span>{{ data.torrent.name }}</span>
              <Icon name="ph:arrow-up-right-bold" class="filled-card-arrow" />
            </NuxtLink>
          </div>

          <!-- ── Comments thread ──────────────────────────── -->
          <section class="thread">
            <header class="grid-section-head grid-section-head--thread">
              <span class="grid-section-mark" aria-hidden="true">§</span>
              <h2>{{ $t('requests.thread.title') }}</h2>
              <span class="grid-section-count tabular-nums">{{
                data.comments.length
              }}</span>
              <span class="grid-section-line" aria-hidden="true" />
            </header>

            <ul v-if="data.comments.length > 0" class="thread-list">
              <li
                v-for="(c, i) in data.comments"
                :key="c.id"
                class="thread-item"
                :class="{ 'is-deleted': c.deletedAt }"
              >
                <header class="thread-head">
                  <span class="thread-num tabular-nums">
                    #{{ String(i + 1).padStart(3, '0') }}
                  </span>
                  <NuxtLink
                    v-if="c.author"
                    :to="`/users/${c.author.id}`"
                    class="thread-author"
                  >
                    @{{ c.author.username }}
                  </NuxtLink>
                  <span v-else class="thread-author thread-author--gone">
                    [{{ $t('requests.thread.deletedUser') }}]
                  </span>
                  <time
                    class="thread-time tabular-nums"
                    :datetime="c.createdAt"
                  >
                    {{ formatAge(c.createdAt) }}
                  </time>
                  <span
                    v-if="c.editedAt"
                    class="thread-edited"
                    :title="formatDate(c.editedAt)"
                  >
                    {{ $t('requests.thread.edited') }}
                  </span>
                  <span class="thread-actions">
                    <button
                      v-if="canEditComment(c)"
                      type="button"
                      class="thread-action"
                      @click="startEdit(c)"
                    >
                      <Icon name="ph:pencil-simple-bold" />
                    </button>
                    <button
                      v-if="canDeleteComment(c)"
                      type="button"
                      class="thread-action thread-action--danger"
                      @click="deleteComment(c)"
                    >
                      <Icon name="ph:trash-bold" />
                    </button>
                  </span>
                </header>
                <div v-if="editing.id === c.id" class="thread-edit">
                  <textarea
                    v-model="editing.body"
                    class="thread-edit-input"
                    rows="3"
                    maxlength="4000"
                  />
                  <div class="thread-edit-actions">
                    <button
                      type="button"
                      class="thread-edit-btn thread-edit-btn--ghost"
                      @click="editing.id = null"
                    >
                      {{ $t('common.cancel') }}
                    </button>
                    <button
                      type="button"
                      class="thread-edit-btn thread-edit-btn--primary"
                      @click="submitEdit"
                    >
                      {{ $t('common.save') }}
                    </button>
                  </div>
                </div>
                <p v-else-if="c.deletedAt" class="thread-body thread-body--deleted">
                  {{ $t('requests.thread.deletedBody') }}
                </p>
                <p v-else class="thread-body">{{ c.body }}</p>
              </li>
            </ul>
            <p v-else class="thread-empty">
              {{ $t('requests.thread.empty') }}
            </p>

            <!-- Compose box. Hidden once the request is resolved
                 — closed cases stay readable but no longer accept
                 new comments (existing thread is frozen). -->
            <form
              v-if="data.viewer.canComment"
              class="thread-compose"
              @submit.prevent="postComment"
            >
              <textarea
                v-model="newComment"
                class="thread-compose-input"
                rows="3"
                maxlength="4000"
                :placeholder="$t('requests.thread.placeholder')"
              />
              <div class="thread-compose-row">
                <span class="thread-compose-counter tabular-nums">
                  {{ newComment.length }}/4000
                </span>
                <button
                  type="submit"
                  class="thread-compose-btn"
                  :disabled="newComment.trim().length === 0 || posting"
                >
                  <Icon
                    :name="posting ? 'ph:circle-notch' : 'ph:paper-plane-tilt-bold'"
                    :class="{ 'loader-spin': posting }"
                  />
                  <span>{{ $t('requests.thread.send') }}</span>
                </button>
              </div>
            </form>
            <p v-else class="thread-locked">
              <Icon name="ph:lock-key-bold" />
              <span>{{ $t('requests.thread.locked') }}</span>
            </p>
          </section>
        </section>

        <!-- ── Actions sidebar ──────────────────────────── -->
        <aside class="grid-side">
          <div class="side-card">
            <header class="side-card-head">
              <Icon name="ph:gear-six-bold" />
              <span>{{ $t('requests.actions.title') }}</span>
            </header>

            <!-- Requester actions -->
            <template v-if="data.viewer.isRequester">
              <template v-if="data.status === 'requested'">
                <button
                  type="button"
                  class="side-btn side-btn--danger"
                  :disabled="busy"
                  @click="cancel"
                >
                  <Icon name="ph:x-circle-bold" />
                  <span>{{ $t('requests.actions.cancel') }}</span>
                </button>
              </template>
              <template v-else-if="data.status === 'filled'">
                <button
                  type="button"
                  class="side-btn side-btn--accept"
                  :disabled="busy"
                  @click="validateFill"
                >
                  <Icon name="ph:check-circle-bold" />
                  <span>{{ $t('requests.actions.validate') }}</span>
                </button>
                <button
                  type="button"
                  class="side-btn side-btn--danger"
                  :disabled="busy"
                  @click="rejectFill"
                >
                  <Icon name="ph:x-circle-bold" />
                  <span>{{ $t('requests.actions.reject') }}</span>
                </button>
              </template>
            </template>

            <!-- Filler action: only on open + not requester -->
            <template v-else-if="data.status === 'requested'">
              <div class="side-fill">
                <label class="side-fill-label">
                  {{ $t('requests.actions.fillHashLabel') }}
                </label>
                <input
                  v-model="fillHash"
                  type="text"
                  class="side-fill-input"
                  pattern="[a-fA-F0-9]{40}"
                  :placeholder="$t('requests.actions.fillHashPlaceholder')"
                />
                <p class="side-fill-quota tabular-nums">
                  {{
                    $t('requests.actions.attemptsLeft', {
                      n: data.viewer.attemptsLeft,
                      max: data.viewer.maxAttempts,
                    })
                  }}
                </p>
                <button
                  type="button"
                  class="side-btn side-btn--accept"
                  :disabled="
                    busy ||
                    fillHash.length !== 40 ||
                    data.viewer.attemptsLeft <= 0
                  "
                  @click="fill"
                >
                  <Icon name="ph:upload-simple-bold" />
                  <span>{{ $t('requests.actions.fill') }}</span>
                </button>
              </div>
            </template>

            <p v-if="!hasAction" class="side-empty">
              {{ $t('requests.actions.nothingToDo') }}
            </p>
          </div>

          <!-- Status timeline.
               The events are derived from a merge of the
               canonical request stamps (created / cancelled /
               validated) and every fill attempt (proposed +
               rejected). A rejected proposal stays in the
               timeline as a discrete pair of rows rather than
               vanishing when the request reopens. -->
          <div class="side-card">
            <header class="side-card-head">
              <Icon name="ph:clock-counter-clockwise-bold" />
              <span>{{ $t('requests.timeline') }}</span>
            </header>
            <ol class="timeline">
              <li
                v-for="event in timeline"
                :key="event.key"
                class="timeline-item is-done"
                :class="`timeline-item--${event.tone}`"
              >
                <span class="timeline-dot" />
                <span class="timeline-label">
                  {{ event.label }}
                  <NuxtLink
                    v-if="event.userId"
                    :to="`/users/${event.userId}`"
                    class="timeline-user"
                  >
                    @{{ event.username }}
                  </NuxtLink>
                </span>
                <time class="timeline-time tabular-nums">{{
                  formatStamp(event.at)
                }}</time>
              </li>
            </ol>
          </div>
        </aside>
      </div>
    </template>

    <div v-else class="dossier-empty">
      <Icon name="ph:question-bold" class="dossier-empty-icon" />
      <p>{{ $t('requests.notFound') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { formatAge, formatDate } from '~/utils/format';
import { getCategoryIcon } from '~/utils/categoryIcon';

definePageMeta({ title: 'Request' });

const route = useRoute();
const router = useRouter();
const { user } = useUserSession();
const { t, locale } = useI18n();
const notifications = useNotificationStore();
const confirm = useConfirm();

interface CommentItem {
  id: string;
  body: string | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  author: { id: string; username: string } | null;
}

interface FillAttempt {
  id: string;
  status: 'proposed' | 'rejected' | 'validated';
  createdAt: string;
  rejectedAt: string | null;
  user: { id: string; username: string } | null;
}

interface RequestDetail {
  id: string;
  title: string;
  description: string;
  rewardPoints: number;
  status: 'requested' | 'filled' | 'validated' | 'cancelled';
  createdAt: string;
  updatedAt: string;
  filledAt: string | null;
  validatedAt: string | null;
  cancelledAt: string | null;
  requester: { id: string; username: string } | null;
  category: {
    id: string;
    name: string;
    slug: string;
    type: string | null;
    icon: string | null;
  } | null;
  filler: { id: string; username: string } | null;
  torrent: { id: string; infoHash: string; name: string } | null;
  comments: CommentItem[];
  fillAttempts: FillAttempt[];
  viewer: {
    isRequester: boolean;
    isFiller: boolean;
    isStaff: boolean;
    attempts: number;
    maxAttempts: number;
    attemptsLeft: number;
    canComment: boolean;
  };
}

const id = computed(() => route.params.id as string);
const { data, pending, refresh } = await useFetch<RequestDetail>(
  () => `/api/requests/${id.value}`,
);
useHead({
  title: () =>
    data.value?.title
      ? t('requests.headTitleWithName', { name: data.value.title })
      : t('requests.headTitleDetail'),
});

const busy = ref(false);
const fillHash = ref('');
const newComment = ref('');
const posting = ref(false);
const editing = reactive<{ id: string | null; body: string }>({
  id: null,
  body: '',
});

const hasAction = computed(() => {
  if (!data.value) return false;
  if (data.value.viewer.isRequester) {
    return data.value.status === 'requested' || data.value.status === 'filled';
  }
  return data.value.status === 'requested';
});

interface TimelineEvent {
  key: string;
  at: string;
  label: string;
  tone: 'created' | 'proposed' | 'rejected' | 'validated' | 'cancelled';
  userId: string | null;
  username: string | null;
}

/** Merge the canonical request events (created / cancelled /
 *  validated) with every fill attempt (proposed + optional
 *  rejected) into a single chronological feed. The whole point
 *  of this view is that rejected proposals don't disappear —
 *  they accumulate as evidence of how the request evolved. */
const timeline = computed<TimelineEvent[]>(() => {
  if (!data.value) return [];
  const events: TimelineEvent[] = [];

  events.push({
    key: 'created',
    at: data.value.createdAt,
    label: t('requests.timelineRow.created'),
    tone: 'created',
    userId: null,
    username: null,
  });

  for (const attempt of data.value.fillAttempts) {
    events.push({
      key: `proposed-${attempt.id}`,
      at: attempt.createdAt,
      label: t('requests.timelineRow.proposed'),
      tone: 'proposed',
      userId: attempt.user?.id ?? null,
      username: attempt.user?.username ?? null,
    });
    if (attempt.status === 'rejected' && attempt.rejectedAt) {
      events.push({
        key: `rejected-${attempt.id}`,
        at: attempt.rejectedAt,
        label: t('requests.timelineRow.rejected'),
        tone: 'rejected',
        userId: attempt.user?.id ?? null,
        username: attempt.user?.username ?? null,
      });
    }
  }

  if (data.value.cancelledAt) {
    events.push({
      key: 'cancelled',
      at: data.value.cancelledAt,
      label: t('requests.timelineRow.cancelled'),
      tone: 'cancelled',
      userId: null,
      username: null,
    });
  }
  if (data.value.validatedAt) {
    events.push({
      key: 'validated',
      at: data.value.validatedAt,
      label: t('requests.timelineRow.validated'),
      tone: 'validated',
      userId: null,
      username: null,
    });
  }

  return events.sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  );
});

function formatPoints(n: number): string {
  return n.toLocaleString('fr-FR').replace(/\s/g, ' ');
}
function formatStamp(iso: string): string {
  const d = new Date(iso);
  return d
    .toLocaleString(locale.value, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
    .toUpperCase();
}

const EDIT_WINDOW_MS = 15 * 60 * 1000;
function canEditComment(c: CommentItem): boolean {
  if (!user.value || !c.author) return false;
  if (c.deletedAt) return false;
  if (c.author.id !== (user.value as any).id) return false;
  return Date.now() - new Date(c.createdAt).getTime() <= EDIT_WINDOW_MS;
}
function canDeleteComment(c: CommentItem): boolean {
  if (!user.value || c.deletedAt) return false;
  const isStaff = !!(
    (user.value as any).isAdmin || (user.value as any).isModerator
  );
  if (isStaff) return true;
  return canEditComment(c);
}

function startEdit(c: CommentItem) {
  editing.id = c.id;
  editing.body = c.body || '';
}

async function submitEdit() {
  if (!editing.id) return;
  try {
    await $fetch(`/api/requests/${id.value}/comments/${editing.id}`, {
      method: 'PATCH',
      body: { body: editing.body.trim() },
    });
    editing.id = null;
    await refresh();
  } catch (err: any) {
    notifications.error(
      err?.data?.message || t('requests.toasts.commentEditFailed'),
    );
  }
}

async function deleteComment(c: CommentItem) {
  const ok = await confirm({
    title: t('requests.thread.deleteConfirmTitle'),
    message: t('requests.thread.deleteConfirmMessage'),
    confirmText: t('common.delete'),
    destructive: true,
  });
  if (!ok) return;
  try {
    await $fetch(`/api/requests/${id.value}/comments/${c.id}`, {
      method: 'DELETE',
    });
    await refresh();
  } catch (err: any) {
    notifications.error(
      err?.data?.message || t('requests.toasts.commentDeleteFailed'),
    );
  }
}

async function postComment() {
  if (newComment.value.trim().length === 0 || posting.value) return;
  posting.value = true;
  try {
    await $fetch(`/api/requests/${id.value}/comments`, {
      method: 'POST',
      body: { body: newComment.value.trim() },
    });
    newComment.value = '';
    await refresh();
  } catch (err: any) {
    notifications.error(
      err?.data?.message || t('requests.toasts.commentFailed'),
    );
  } finally {
    posting.value = false;
  }
}

async function cancel() {
  const ok = await confirm({
    title: t('requests.actions.cancelConfirmTitle'),
    message: t('requests.actions.cancelConfirmMessage'),
    confirmText: t('requests.actions.cancel'),
    destructive: true,
  });
  if (!ok) return;
  busy.value = true;
  try {
    await $fetch(`/api/requests/${id.value}`, { method: 'DELETE' });
    notifications.success(t('requests.toasts.cancelled'));
    await router.push('/requests');
  } catch (err: any) {
    notifications.error(err?.data?.message || t('requests.toasts.failed'));
  } finally {
    busy.value = false;
  }
}

async function validateFill() {
  busy.value = true;
  try {
    await $fetch(`/api/requests/${id.value}/validate`, { method: 'POST' });
    notifications.success(t('requests.toasts.validated'));
    await refresh();
  } catch (err: any) {
    notifications.error(err?.data?.message || t('requests.toasts.failed'));
  } finally {
    busy.value = false;
  }
}

async function rejectFill() {
  busy.value = true;
  try {
    await $fetch(`/api/requests/${id.value}/reject`, { method: 'POST' });
    notifications.success(t('requests.toasts.rejected'));
    await refresh();
  } catch (err: any) {
    notifications.error(err?.data?.message || t('requests.toasts.failed'));
  } finally {
    busy.value = false;
  }
}

async function fill() {
  if (fillHash.value.length !== 40) return;
  busy.value = true;
  try {
    await $fetch(`/api/requests/${id.value}/fill`, {
      method: 'POST',
      body: { infoHash: fillHash.value.toLowerCase() },
    });
    fillHash.value = '';
    notifications.success(t('requests.toasts.filled'));
    await refresh();
  } catch (err: any) {
    notifications.error(err?.data?.message || t('requests.toasts.failed'));
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.dossier {
  position: relative;
  isolation: isolate;
  max-width: 1180px;
  margin: 0 auto;
  padding: 2rem 1.5rem 5rem;
  --brass: 212 167 52;
  --brass-deep: 158 113 31;
  --phosphor: 110 231 183;
  --status-filled: 251 191 36;
  --status-validated: 96 165 250;
  --status-cancelled: 156 163 175;
  --danger: 244 63 94;
}
.tabular-nums { font-variant-numeric: tabular-nums; }

.dossier-aura {
  position: absolute;
  top: -2rem;
  left: 50%;
  width: 100vw;
  margin-left: -50vw;
  height: 60vh;
  max-height: 480px;
  z-index: -1;
  overflow: hidden;
  pointer-events: none;
}
.aura-blob {
  position: absolute;
  width: 520px;
  height: 520px;
  top: -180px;
  left: -100px;
  filter: blur(90px);
  opacity: 0.32;
  border-radius: 50%;
  background: radial-gradient(circle, rgb(var(--brass) / 0.55), transparent 65%);
}
.aura-grain {
  position: absolute;
  inset: 0;
  background-image: radial-gradient(rgba(255,255,255,0.03) 1px, transparent 1px);
  background-size: 3px 3px;
  opacity: 0.5;
  mix-blend-mode: overlay;
}

.dossier-back {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  text-decoration: none;
  transition: color 0.15s, transform 0.2s;
}
.dossier-back:hover {
  color: rgb(var(--brass));
  transform: translateX(-2px);
}

.dossier-loader {
  display: flex;
  justify-content: center;
  padding: 5rem 0;
}
.loader-spin { font-size: 1.5rem; animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.dossier-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 5rem 1.5rem;
  text-align: center;
  color: rgb(var(--fg-muted));
}
.dossier-empty-icon { font-size: 3rem; color: rgb(var(--fg-faint)); }

/* ── Hero card ─────────────────────────────────────────────── */
.hero {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 1.4rem 2rem;
  padding: 1.6rem 2rem;
  background:
    radial-gradient(ellipse 90% 80% at 0% 0%, rgb(var(--brass) / 0.15), transparent 60%),
    radial-gradient(ellipse 70% 80% at 100% 100%, rgb(var(--brass-deep) / 0.18), transparent 60%),
    rgb(var(--bg-surface));
  border: 1px solid rgb(var(--brass) / 0.45);
  border-radius: 0.65rem;
  margin-bottom: 2rem;
  box-shadow:
    0 22px 60px -22px rgba(0,0,0,0.7),
    inset 0 1px 0 rgba(255,255,255,0.05);
  animation: hero-rise 0.55s cubic-bezier(0.22, 1, 0.36, 1) both;
}
@keyframes hero-rise {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
.hero--validated { border-color: rgb(var(--status-validated) / 0.45); }
.hero--cancelled { border-color: rgb(var(--status-cancelled) / 0.4); opacity: 0.85; }
.hero--filled    { border-color: rgb(var(--status-filled) / 0.45); }

.hero-meta {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  flex-wrap: wrap;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.hero-status {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.6rem;
  border: 1px solid rgb(var(--phosphor) / 0.4);
  border-radius: 999px;
  font-weight: 800;
  color: rgb(var(--phosphor));
}
.hero-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: currentColor;
}
.hero--requested .hero-status-dot {
  box-shadow: 0 0 8px currentColor;
  animation: status-pulse 2s ease-in-out infinite;
}
@keyframes status-pulse {
  0%, 100% { opacity: 0.65; transform: scale(1); }
  50%      { opacity: 1;    transform: scale(1.15); }
}
.hero--filled .hero-status    { color: rgb(var(--status-filled));    border-color: rgb(var(--status-filled) / 0.4); }
.hero--validated .hero-status { color: rgb(var(--status-validated)); border-color: rgb(var(--status-validated) / 0.4); }
.hero--cancelled .hero-status { color: rgb(var(--status-cancelled)); border-color: rgb(var(--status-cancelled) / 0.4); }
.hero-cat {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  color: rgb(var(--fg-default));
}
.hero-sep { opacity: 0.4; }

.hero-title {
  margin: 0;
  font-family: 'Fraunces', 'Charter', Georgia, serif;
  font-weight: 600;
  font-size: clamp(1.6rem, 4vw, 2.4rem);
  line-height: 1.1;
  letter-spacing: -0.015em;
  color: rgb(var(--fg-strong));
  overflow-wrap: anywhere;
}
.hero-byline {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.55rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  letter-spacing: 0.12em;
  color: rgb(var(--fg-muted));
}
.hero-byline-link {
  color: rgb(var(--brass));
  text-decoration: none;
  font-weight: 700;
}
.hero-byline-link:hover { text-decoration: underline; }

/* Hero body — the left column. Holds the meta row, title, and
   byline in a vertical stack. The right column is the reward
   block (when there's one) and is vertically centred against
   this whole column. */
.hero-body {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  min-width: 0;
}

/* Brass reward block — anchored on the right of the hero, the
   "standing offer". Restrained palette: vertical "REWARD"
   eyebrow on top, big mono value, "POINTS" caption below. Sits
   inside the same card border so it reads as part of the
   dossier rather than a separate widget. */
.hero-reward {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
  padding: 0.85rem 1.4rem;
  background:
    linear-gradient(180deg, rgb(var(--brass) / 0.18), rgb(var(--brass-deep) / 0.08)),
    rgb(var(--bg-base));
  border: 1px solid rgb(var(--brass) / 0.55);
  border-radius: 0.5rem;
  color: rgb(var(--brass));
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.08),
    0 6px 18px -12px rgb(var(--brass) / 0.55);
  align-self: center;
}
.hero-reward-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  opacity: 0.75;
}
.hero-reward-value {
  display: inline-flex;
  align-items: baseline;
  gap: 0.25rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 1.6rem;
  font-weight: 900;
  letter-spacing: -0.01em;
  line-height: 1.1;
  text-shadow: 0 0 10px rgb(var(--brass) / 0.4);
}
.hero-reward-mark {
  font-size: 1.05rem;
  font-weight: 900;
  opacity: 0.7;
}
.hero-reward-unit {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 8.5px;
  font-weight: 800;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  opacity: 0.65;
}

/* Stack below ~720 px — the reward goes under the body so a
   long title doesn't push it into a sliver. */
@media (max-width: 720px) {
  .hero { grid-template-columns: 1fr; }
  .hero-reward {
    align-self: stretch;
    flex-direction: row;
    justify-content: space-between;
    padding: 0.65rem 1rem;
  }
  .hero-reward-value { font-size: 1.4rem; }
}

/* ── Grid: main + sidebar ──────────────────────────────────── */
.grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 1.6rem;
}
@media (max-width: 900px) {
  .grid { grid-template-columns: 1fr; }
}
.grid-main {
  display: flex;
  flex-direction: column;
  gap: 1.4rem;
}

.grid-section-head {
  display: flex;
  align-items: baseline;
  gap: 0.55rem;
  margin-bottom: 0.7rem;
}
.grid-section-mark {
  font-family: 'Fraunces', 'Charter', Georgia, serif;
  font-style: italic;
  font-size: 18px;
  font-weight: 600;
  color: rgb(var(--brass));
  filter: drop-shadow(0 0 8px rgb(var(--brass) / 0.4));
}
.grid-section-head h2 {
  margin: 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--brass));
}
.grid-section-count {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  padding: 0.1rem 0.45rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 999px;
  color: rgb(var(--fg-muted));
}
.grid-section-line {
  flex: 1;
  height: 1px;
  background: linear-gradient(to right, rgb(var(--brass) / 0.4), transparent);
}

.description {
  padding: 1.1rem 1.2rem;
  background:
    linear-gradient(180deg, rgba(255,255,255,0.02), transparent 50%),
    rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-strong));
  border-radius: 0.45rem;
  font-size: 14px;
  line-height: 1.65;
  color: rgb(var(--fg-default));
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.filled-card {
  padding: 1rem 1.1rem;
  background: rgb(var(--status-filled) / 0.08);
  border: 1px dashed rgb(var(--status-filled) / 0.45);
  border-radius: 0.45rem;
}
.filled-card-head {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.6rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgb(var(--status-filled));
}
.filled-card-user {
  color: rgb(var(--brass));
  text-decoration: none;
}
.filled-card-link {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 0.85rem;
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-strong));
  border-radius: 0.35rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
  font-weight: 700;
  color: rgb(var(--fg-strong));
  text-decoration: none;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: border-color 0.18s, color 0.18s;
}
.filled-card-link:hover {
  color: rgb(var(--brass));
  border-color: rgb(var(--brass) / 0.5);
}
.filled-card-arrow { font-size: 0.95rem; margin-left: auto; }

/* ── Thread ────────────────────────────────────────────────── */
.thread { margin-top: 0.5rem; }
.thread-list {
  list-style: none;
  margin: 0 0 1rem;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.thread-item {
  padding: 0.85rem 1rem;
  background:
    linear-gradient(180deg, rgba(255,255,255,0.02), transparent 50%),
    rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.4rem;
}
.thread-item.is-deleted { opacity: 0.5; }
.thread-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.12em;
  color: rgb(var(--fg-muted));
}
.thread-num {
  color: rgb(var(--brass));
  font-weight: 800;
}
.thread-author {
  font-weight: 700;
  color: rgb(var(--fg-strong));
  text-decoration: none;
}
.thread-author:hover { color: rgb(var(--brass)); }
.thread-author--gone { color: rgb(var(--fg-faint)); font-style: italic; }
.thread-time { margin-left: auto; }
.thread-edited {
  font-style: italic;
  font-size: 9px;
  letter-spacing: 0.18em;
  color: rgb(var(--fg-faint));
}
.thread-actions { display: inline-flex; gap: 0.2rem; }
.thread-action {
  background: transparent;
  border: 0;
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 0.25rem;
  color: rgb(var(--fg-muted));
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.thread-action:hover {
  background: rgb(var(--bg-base));
  color: rgb(var(--fg-strong));
}
.thread-action--danger:hover { color: rgb(var(--danger)); }
.thread-body {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.55;
  color: rgb(var(--fg-default));
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.thread-body--deleted {
  font-style: italic;
  color: rgb(var(--fg-faint));
}

.thread-edit {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.thread-edit-input {
  width: 100%;
  padding: 0.55rem 0.75rem;
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.3rem;
  color: rgb(var(--fg-default));
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12.5px;
  line-height: 1.5;
  resize: vertical;
}
.thread-edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.4rem;
}
.thread-edit-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.7rem;
  border-radius: 0.25rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  border: 1px solid rgb(var(--line-default));
  background: transparent;
  color: rgb(var(--fg-muted));
  cursor: pointer;
}
.thread-edit-btn--primary {
  color: rgb(var(--brass));
  border-color: rgb(var(--brass) / 0.5);
  background: rgb(var(--brass) / 0.1);
}

.thread-empty {
  margin: 0 0 1rem;
  padding: 1.3rem 0;
  text-align: center;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-faint));
  border: 1px dashed rgb(var(--line-default));
  border-radius: 0.4rem;
}

.thread-compose {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.85rem 1rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--brass) / 0.3);
  border-radius: 0.45rem;
}
.thread-compose-input {
  width: 100%;
  padding: 0.5rem 0.7rem;
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.3rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 13px;
  line-height: 1.5;
  resize: vertical;
  min-height: 64px;
  color: rgb(var(--fg-default));
}
.thread-compose-input:focus {
  outline: 0;
  border-color: rgb(var(--brass) / 0.55);
  box-shadow: 0 0 0 3px rgb(var(--brass) / 0.12);
}
.thread-compose-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.thread-compose-counter {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9.5px;
  color: rgb(var(--fg-faint));
}
.thread-compose-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.9rem;
  background:
    linear-gradient(180deg, rgb(var(--brass) / 0.25), rgb(var(--brass) / 0.08)),
    rgb(var(--bg-base));
  border: 1px solid rgb(var(--brass) / 0.55);
  border-radius: 0.3rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--brass));
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.22s;
}
.thread-compose-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 20px -10px rgb(var(--brass) / 0.5);
}
.thread-compose-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* Discussion lock — shown when the request is validated or
   cancelled. Replaces the compose box with a clear "case closed"
   notice so it's unambiguous why posting is disabled. */
.thread-locked {
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: rgb(var(--bg-elevated));
  border: 1px dashed rgb(var(--line-strong));
  border-radius: 0.4rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-faint));
}
.thread-locked > svg { font-size: 1rem; color: rgb(var(--fg-muted)); }

/* ── Sidebar ──────────────────────────────────────────────── */
.grid-side {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.side-card {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 1rem 1.1rem 1.1rem;
  background:
    linear-gradient(180deg, rgba(255,255,255,0.025), transparent 50%),
    rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-strong));
  border-radius: 0.5rem;
}
.side-card-head {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--brass));
  padding-bottom: 0.6rem;
  border-bottom: 1px dashed rgb(var(--line-default));
}

.side-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 0.85rem;
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.35rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-default));
  text-decoration: none;
  cursor: pointer;
  transition: background 0.18s, border-color 0.18s, color 0.18s, transform 0.2s;
}
.side-btn:hover:not(:disabled) {
  transform: translateY(-1px);
}
.side-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.side-btn--accept {
  background:
    linear-gradient(180deg, rgb(var(--phosphor) / 0.2), rgb(var(--phosphor) / 0.05)),
    rgb(var(--bg-base));
  border-color: rgb(var(--phosphor) / 0.55);
  color: rgb(var(--phosphor));
}
.side-btn--danger {
  color: rgb(var(--danger));
  border-color: rgb(var(--danger) / 0.4);
  background: rgb(var(--danger) / 0.08);
}
.side-btn--danger:hover:not(:disabled) {
  background: rgb(var(--danger) / 0.15);
}

.side-fill {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.side-fill-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.side-fill-input {
  width: 100%;
  padding: 0.55rem 0.75rem;
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.3rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  letter-spacing: 0.04em;
  color: rgb(var(--fg-default));
}
.side-fill-input:focus {
  outline: 0;
  border-color: rgb(var(--brass) / 0.55);
  box-shadow: 0 0 0 3px rgb(var(--brass) / 0.12);
}
.side-fill-quota {
  margin: 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: rgb(var(--fg-muted));
}
.side-empty {
  margin: 0;
  padding: 0.85rem 0.6rem;
  text-align: center;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-faint));
}

.timeline {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.timeline-item {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.14em;
  color: rgb(var(--fg-muted));
}
.timeline-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: rgb(var(--brass));
  box-shadow: 0 0 8px rgb(var(--brass) / 0.4);
}
/* Tone the dot per event kind — at a glance the timeline reads
   the shape of the story (gold opens, amber proposals, red
   rejects, blue/grey closings). */
.timeline-item--proposed .timeline-dot {
  background: rgb(var(--status-filled));
  box-shadow: 0 0 8px rgb(var(--status-filled) / 0.5);
}
.timeline-item--rejected .timeline-dot {
  background: rgb(var(--danger));
  box-shadow: 0 0 8px rgb(var(--danger) / 0.5);
}
.timeline-item--validated .timeline-dot {
  background: rgb(var(--status-validated));
  box-shadow: 0 0 8px rgb(var(--status-validated) / 0.5);
}
.timeline-item--cancelled .timeline-dot {
  background: rgb(var(--status-cancelled));
  box-shadow: none;
  opacity: 0.7;
}
.timeline-label {
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: rgb(var(--fg-default));
  display: inline-flex;
  align-items: baseline;
  gap: 0.4rem;
  flex-wrap: wrap;
}
.timeline-user {
  font-size: 9.5px;
  color: rgb(var(--brass));
  text-decoration: none;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: none;
}
.timeline-user:hover { text-decoration: underline; }
.timeline-time {
  color: rgb(var(--fg-faint));
  font-size: 9.5px;
}

@media (prefers-reduced-motion: reduce) {
  .hero { animation: none !important; }
  .hero--requested .hero-status-dot { animation: none !important; }
}
</style>
