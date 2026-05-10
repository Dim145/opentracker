<template>
  <div class="topic-shell">
    <div v-if="pending" class="topic-skeleton">
      <div class="sk-head" />
      <div v-for="i in 3" :key="`sk-${i}`" class="sk-post" />
    </div>

    <template v-else-if="topic">
      <!-- ── Article header ──────────────────────────────────── -->
      <header class="article-head">
        <nav class="article-crumb">
          <NuxtLink to="/forum" class="article-crumb-link">{{ $t('forum.theForum') }}</NuxtLink>
          <Icon name="ph:caret-right-bold" class="article-crumb-sep" />
          <NuxtLink
            :to="`/forum/category/${topic.category.id}`"
            class="article-crumb-link"
          >
            {{ topic.category.name }}
          </NuxtLink>
          <Icon name="ph:caret-right-bold" class="article-crumb-sep" />
          <span class="article-crumb-leaf">{{ $t('forum.topic.crumbLeaf') }}</span>
        </nav>

        <p class="article-flags" v-if="topic.isPinned || topic.isLocked">
          <span v-if="topic.isPinned" class="flag flag--pin">
            <Icon name="ph:push-pin-fill" />
            {{ $t('forum.topic.pinned') }}
          </span>
          <span v-if="topic.isLocked" class="flag flag--lock">
            <Icon name="ph:lock-fill" />
            {{ $t('forum.topic.locked') }}
          </span>
        </p>

        <h1 class="article-title font-display">
          {{ topic.title }}
        </h1>

        <p class="article-byline">
          <span>{{ $t('forum.topic.byline.by') }}</span>
          <strong>{{ topic.author.username }}</strong>
          <span class="byline-sep">·</span>
          <span>{{ $t('forum.topic.byline.filed', { date: formatJoined(topic.createdAt) }) }}</span>
          <span class="byline-sep">·</span>
          <span>{{ $t('forum.topic.replies', { n: replyCount }) }}</span>
        </p>

        <div class="article-tools" v-if="canModerate">
          <button
            type="button"
            class="ed-btn ed-btn--ghost"
            @click="handleTogglePin"
          >
            <Icon :name="topic.isPinned ? 'ph:push-pin-slash' : 'ph:push-pin'" />
            {{ topic.isPinned ? $t('forum.actions.unpin') : $t('forum.actions.pin') }}
          </button>
          <button
            type="button"
            class="ed-btn ed-btn--ghost"
            @click="handleToggleLock"
          >
            <Icon :name="topic.isLocked ? 'ph:lock-open' : 'ph:lock'" />
            {{ topic.isLocked ? $t('forum.actions.unlock') : $t('forum.actions.lock') }}
          </button>
          <button
            type="button"
            class="ed-btn ed-btn--ghost ed-btn--danger"
            @click="handleDeleteTopic"
          >
            <Icon name="ph:trash" />
            {{ $t('common.delete') }}
          </button>
        </div>
      </header>

      <!-- ── Posts ──────────────────────────────────────────── -->
      <ol class="post-list">
        <li
          v-for="(post, idx) in topic.posts"
          :id="`post-${post.id}`"
          :key="post.id"
          class="post"
          :class="{ 'post--lede': idx === 0 }"
        >
          <!-- Post number marker — sits in the gutter, doubles as anchor -->
          <a
            :href="`#post-${post.id}`"
            class="post-anchor"
            :title="$t('forum.topic.permalinkTitle', { n: idx + 1 })"
            @click.prevent="copyPermalink(post.id, idx)"
          >
            <span class="post-anchor-num">{{ formatIssueNumber(idx + 1) }}</span>
            <Icon name="ph:link-bold" class="post-anchor-icon" />
          </a>

          <!-- Author rail -->
          <aside class="post-author">
            <div
              class="post-avatar"
              :style="avatarStyle(post.author.username)"
              :title="post.author.username"
            >
              {{ post.author.username.slice(0, 2).toUpperCase() }}
            </div>
            <div class="post-author-id">
              <NuxtLink
                :to="`/users/${post.author.id}`"
                class="post-author-name"
              >
                {{ post.author.username }}
              </NuxtLink>
              <p class="post-author-tags">
                <span v-if="post.author.isAdmin" class="role-pill role-pill--admin">
                  <Icon name="ph:crown-fill" /> {{ $t('me.permission.admin') }}
                </span>
                <span
                  v-else-if="post.author.isModerator"
                  class="role-pill role-pill--mod"
                >
                  <Icon name="ph:shield-chevron-fill" /> {{ $t('nav.mod') }}
                </span>
                <span v-else class="role-pill">{{ $t('me.permission.member') }}</span>
              </p>
            </div>
          </aside>

          <!-- Content -->
          <article class="post-body">
            <header class="post-meta">
              <time class="post-time" :title="absoluteDate(post.createdAt)">
                {{ formatAge(post.createdAt) }}
              </time>
              <span
                v-if="isEdited(post)"
                class="post-edited"
                :title="$t('forum.topic.editedTitle', { date: absoluteDate(post.updatedAt) })"
              >
                {{ $t('forum.topic.editedSuffix', { age: formatAge(post.updatedAt) }) }}
              </span>

              <div class="post-meta-tools">
                <button
                  v-if="!isEditing(post.id)"
                  type="button"
                  class="post-tool"
                  :title="$t('forum.actions.quote')"
                  @click="quoteReply(post)"
                >
                  <Icon name="ph:quotes-bold" />
                </button>
                <button
                  v-if="canEdit(post) && !isEditing(post.id)"
                  type="button"
                  class="post-tool"
                  :title="$t('common.edit')"
                  @click="startEdit(post)"
                >
                  <Icon name="ph:pencil-simple-bold" />
                </button>
                <button
                  v-if="canDelete(post) && !isEditing(post.id)"
                  type="button"
                  class="post-tool post-tool--danger"
                  :title="$t('common.delete')"
                  @click="handleDeletePost(post.id)"
                >
                  <Icon name="ph:trash-bold" />
                </button>
              </div>
            </header>

            <!-- Edit mode: textarea + actions -->
            <div v-if="isEditing(post.id)" class="post-edit">
              <textarea
                v-model="editDraftContent"
                class="post-edit-input"
                rows="6"
              />
              <div class="post-edit-tools">
                <button
                  type="button"
                  class="ed-btn ed-btn--ghost"
                  @click="cancelEdit"
                >
                  {{ $t('common.cancel') }}
                </button>
                <button
                  type="button"
                  class="ed-btn ed-btn--primary"
                  :disabled="
                    saving ||
                    !editDraftContent.trim() ||
                    editDraftContent === post.content
                  "
                  @click="commitEdit(post.id)"
                >
                  <Icon
                    v-if="saving"
                    name="ph:circle-notch"
                    class="animate-spin"
                  />
                  {{ saving ? $t('forum.topic.saving') : $t('common.saveChanges') }}
                </button>
              </div>
            </div>

            <!-- Read mode: rendered post body -->
            <PostBody v-else :content="post.content" />
          </article>
        </li>
      </ol>

      <!-- ── Reply composer ─────────────────────────────────── -->
      <section
        v-if="!topic.isLocked || canModerate"
        ref="composerRef"
        class="composer"
        id="composer"
      >
        <header class="composer-head">
          <span class="composer-eyebrow">{{ $t('forum.actions.reply') }}</span>
          <span class="composer-rule" />
          <span class="composer-hint">
            <kbd>⌘</kbd> + <kbd>↵</kbd> {{ $t('forum.topic.toPost') }}
          </span>
        </header>
        <textarea
          v-model="replyContent"
          ref="replyTextareaRef"
          class="composer-input"
          rows="6"
          :placeholder="$t('forum.topic.replyPlaceholder')"
          @keydown.meta.enter="handlePostReply"
          @keydown.ctrl.enter="handlePostReply"
        />
        <footer class="composer-foot">
          <p class="composer-counter">
            {{ replyContent.length }} / 50000
          </p>
          <button
            type="button"
            class="ed-btn ed-btn--primary"
            :disabled="!replyContent.trim() || posting"
            @click="handlePostReply"
          >
            <Icon
              v-if="posting"
              name="ph:circle-notch"
              class="animate-spin"
            />
            <Icon v-else name="ph:paper-plane-tilt-bold" />
            {{ posting ? $t('forum.topic.posting') : $t('forum.topic.postReply') }}
          </button>
        </footer>
      </section>
      <div v-else class="composer-locked">
        <Icon name="ph:lock-fill" />
        <p>
          {{ $t('forum.topic.lockedNotice') }}
        </p>
      </div>
    </template>

    <div v-else class="topic-not-found">
      <Icon name="ph:question-bold" class="empty-icon" />
      <p>{{ $t('forum.topic.notFound') }}</p>
      <NuxtLink to="/forum" class="ed-btn">{{ $t('forum.topic.backToForum') }}</NuxtLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import PostBody from '~/components/forum/PostBody.vue';
import { formatAge } from '~/utils/format';

interface Author {
  id: string;
  username: string;
  isAdmin: boolean;
  isModerator: boolean;
}

interface Post {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  author: Author;
}

interface Topic {
  id: string;
  title: string;
  isPinned: boolean;
  isLocked: boolean;
  createdAt: string;
  categoryId: string;
  category: { id: string; name: string };
  author: Author;
  posts: Post[];
}

const route = useRoute();
const { user } = useUserSession();
const notifications = useNotificationStore();
const confirm = useConfirm();
const { t } = useI18n();

const {
  data: topic,
  pending,
  refresh,
} = await useFetch<Topic>(() => `/api/forum/topics/${route.params.id}`);

useHead({
  title: () => topic.value?.title ?? t('forum.topic.headFallback'),
});

const replyContent = ref('');
const replyTextareaRef = ref<HTMLTextAreaElement | null>(null);
const composerRef = ref<HTMLElement | null>(null);
const posting = ref(false);

// Edit state — single in-flight edit at a time, identified by post id.
const editingPostId = ref<string | null>(null);
const editDraftContent = ref('');
const saving = ref(false);
function isEditing(postId: string) {
  return editingPostId.value === postId;
}
function startEdit(post: Post) {
  editingPostId.value = post.id;
  editDraftContent.value = post.content;
}
function cancelEdit() {
  editingPostId.value = null;
  editDraftContent.value = '';
}

const canModerate = computed(
  () => Boolean(user.value?.isAdmin || user.value?.isModerator)
);
const replyCount = computed(() => Math.max(0, (topic.value?.posts.length ?? 1) - 1));

function canEdit(post: Post) {
  return Boolean(
    user.value && (user.value.id === post.author.id || canModerate.value)
  );
}
function canDelete(post: Post) {
  return Boolean(
    user.value && (user.value.id === post.author.id || canModerate.value)
  );
}
function isEdited(post: Post) {
  // Treat anything updated more than 5 s after creation as a real edit;
  // the API often round-trips a couple of ms between insert and select.
  return new Date(post.updatedAt).getTime() - new Date(post.createdAt).getTime() > 5000;
}

function formatIssueNumber(n: number): string {
  return String(n).padStart(2, '0');
}
function formatJoined(date: string): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}
function absoluteDate(date: string): string {
  return new Date(date).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Deterministic avatar accent — the same username always maps to the
// same hue. Saturated low so it sits on the dark surface without
// fighting the editorial palette.
function hashHue(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}
function avatarStyle(name: string) {
  const hue = hashHue(name);
  return {
    background: `linear-gradient(140deg, hsl(${hue}, 35%, 22%), hsl(${(hue + 28) % 360}, 35%, 32%))`,
    color: 'rgb(var(--fg-strong))',
    borderColor: `hsl(${hue}, 30%, 40%)`,
  } as Record<string, string>;
}

// Permalink — copy `https://host/forum/topic/<id>#post-<post>` to the
// clipboard so the user can drop it in chat / a thread. We swallow the
// click on the anchor to avoid the page jumping when the URL is mostly
// the same.
async function copyPermalink(postId: string, idx: number) {
  if (!import.meta.client) return;
  const url = `${window.location.origin}${window.location.pathname}#post-${postId}`;
  try {
    await navigator.clipboard.writeText(url);
    notifications.success(t('forum.topic.toasts.permalinkCopied', { n: formatIssueNumber(idx + 1) }));
  } catch {
    notifications.error(t('forum.topic.errors.permalinkCopy'));
  }
}

function quoteReply(post: Post) {
  const lines = post.content
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n');
  const insertion = `> ${t('forum.topic.quotedAttribution', { at: '@', username: post.author.username })}\n${lines}\n\n`;
  // If the user already typed something, append; otherwise replace.
  replyContent.value = replyContent.value
    ? `${replyContent.value.replace(/\s*$/, '\n\n')}${insertion}`
    : insertion;
  nextTick(() => {
    replyTextareaRef.value?.focus();
    composerRef.value?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  });
}

async function handlePostReply() {
  if (!topic.value || !replyContent.value.trim()) return;
  posting.value = true;
  try {
    await $fetch('/api/forum/posts', {
      method: 'POST',
      body: {
        topicId: topic.value.id,
        content: replyContent.value,
      },
    });
    replyContent.value = '';
    await refresh();
    nextTick(() => {
      // Scroll to the new last post — that's the one we just added.
      const posts = topic.value?.posts;
      if (posts?.length) {
        const last = posts[posts.length - 1];
        document.getElementById(`post-${last.id}`)?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      }
    });
  } catch (e: any) {
    notifications.error(e?.data?.message || t('forum.topic.errors.postReply'));
  } finally {
    posting.value = false;
  }
}

async function commitEdit(postId: string) {
  if (!editDraftContent.value.trim()) return;
  saving.value = true;
  try {
    await $fetch(`/api/forum/posts/${postId}` as '/api/forum/posts/:id', {
      method: 'PATCH',
      body: { content: editDraftContent.value },
    } as any);
    editingPostId.value = null;
    editDraftContent.value = '';
    notifications.success(t('forum.topic.toasts.postUpdated'));
    await refresh();
  } catch (e: any) {
    notifications.error(e?.data?.message || t('forum.topic.errors.saveEdit'));
  } finally {
    saving.value = false;
  }
}

async function handleTogglePin() {
  if (!topic.value) return;
  try {
    await $fetch(`/api/forum/topics/${topic.value.id}/pin`, {
      method: 'PUT',
      body: { isPinned: !topic.value.isPinned },
    });
    await refresh();
  } catch (e: any) {
    notifications.error(e?.data?.message || t('forum.topic.errors.updateTopic'));
  }
}
async function handleToggleLock() {
  if (!topic.value) return;
  try {
    await $fetch(`/api/forum/topics/${topic.value.id}/lock`, {
      method: 'PUT',
      body: { isLocked: !topic.value.isLocked },
    });
    await refresh();
  } catch (e: any) {
    notifications.error(e?.data?.message || t('forum.topic.errors.updateTopic'));
  }
}
async function handleDeleteTopic() {
  if (!topic.value) return;
  const ok = await confirm({
    title: t('forum.topic.deleteTopicConfirm.title'),
    message: t('forum.topic.deleteTopicConfirm.message', { title: topic.value.title }),
    confirmText: t('forum.topic.deleteTopicConfirm.action'),
    destructive: true,
  });
  if (!ok) return;
  try {
    await $fetch(`/api/forum/topics/${topic.value.id}`, { method: 'DELETE' });
    notifications.success(t('forum.topic.toasts.topicDeleted'));
    await navigateTo(`/forum/category/${topic.value.categoryId}`);
  } catch (e: any) {
    notifications.error(e?.data?.message || t('forum.topic.errors.deleteTopic'));
  }
}
async function handleDeletePost(postId: string) {
  const ok = await confirm({
    title: t('forum.topic.deletePostConfirm.title'),
    message: t('forum.topic.deletePostConfirm.message'),
    confirmText: t('forum.topic.deletePostConfirm.action'),
    destructive: true,
  });
  if (!ok) return;
  try {
    const res = await $fetch<{ message: string }>(
      `/api/forum/posts/${postId}`,
      { method: 'DELETE' }
    );
    if (res.message.includes('Topic deleted')) {
      notifications.success(t('forum.topic.toasts.postDeletedTopicRemoved'));
      await navigateTo(`/forum/category/${topic.value?.categoryId}`);
    } else {
      notifications.success(t('forum.topic.toasts.postDeleted'));
      await refresh();
    }
  } catch (e: any) {
    notifications.error(e?.data?.message || t('forum.topic.errors.deletePost'));
  }
}

// Auto-scroll to the hash on load — supports `#post-<id>` permalinks
// landing the reader directly on the relevant reply.
onMounted(() => {
  if (typeof window === 'undefined') return;
  const hash = window.location.hash;
  if (!hash || !hash.startsWith('#post-')) return;
  setTimeout(() => {
    document
      .querySelector(hash)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 60);
});
</script>

<style scoped>
.topic-shell {
  --rule: rgb(var(--line-default));
  --rule-strong: rgb(var(--line-strong));
  --ink: rgb(var(--fg-strong));
  --ink-soft: rgb(var(--fg-default));
  --ink-fade: rgb(var(--fg-muted));
  --ink-faint: rgb(var(--fg-faint));

  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  padding-bottom: 4rem;
  max-width: 64rem;
  margin: 0 auto;
}

/* ─── Article header ─────────────────────────────────────── */
.article-head {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 1.5rem 0 1.25rem;
  border-bottom: 1px double var(--rule-strong);
}
.article-crumb {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ink-fade);
  flex-wrap: wrap;
}
.article-crumb-link {
  color: var(--ink-fade);
  text-decoration: none;
  transition: color 0.12s;
}
.article-crumb-link:hover {
  color: var(--ink);
}
.article-crumb-sep {
  font-size: 0.7rem;
  color: var(--ink-faint);
}
.article-crumb-leaf {
  color: var(--ink);
}

.article-flags {
  display: flex;
  gap: 0.4rem;
  margin: 0;
  flex-wrap: wrap;
}

.article-title {
  margin: 0;
  font-size: clamp(2.25rem, 5.5vw, 4rem);
  line-height: 1;
  letter-spacing: -0.04em;
  font-weight: 800;
  color: var(--ink);
  font-variation-settings: 'opsz' 144, 'SOFT' 30;
  word-break: break-word;
}

.article-byline {
  margin: 0;
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.4rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-fade);
}
.article-byline strong {
  color: var(--ink);
  font-weight: 700;
}
.byline-sep {
  color: var(--ink-faint);
}

.article-tools {
  display: flex;
  gap: 0.35rem;
  flex-wrap: wrap;
}

.flag {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.18rem 0.55rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  border: 1px solid var(--rule);
  border-radius: 9999px;
  color: var(--ink-fade);
}
.flag--pin {
  color: var(--ink);
  border-color: rgb(var(--fg-strong) / 0.35);
  background: rgb(var(--fg-default) / 0.05);
}
.flag--lock {
  color: var(--ink-fade);
  background: rgb(var(--bg-elevated));
}

/* ─── Posts ────────────────────────────────────────────── */
.post-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.post {
  display: grid;
  grid-template-columns: 4rem 11rem 1fr;
  gap: 1.25rem;
  padding: 1.5rem 0;
  border-bottom: 1px solid var(--rule);
  position: relative;
}
.post:last-child {
  border-bottom: 0;
}
.post--lede {
  grid-template-columns: 4rem 1fr;
}
.post--lede .post-author {
  display: none;
}
.post--lede .post-body {
  font-size: 1.05rem;
}
.post--lede:not(:last-child) {
  border-bottom: 4px double var(--rule-strong);
  padding-bottom: 2rem;
  margin-bottom: 0.5rem;
}

.post-anchor {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.35rem;
  text-decoration: none;
  color: var(--ink-faint);
  position: relative;
}
.post-anchor-num {
  font-family: 'Fraunces', serif;
  font-size: 1.4rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--ink);
  font-variation-settings: 'opsz' 96;
  line-height: 1;
}
.post--lede .post-anchor-num {
  font-size: 2rem;
  color: var(--ink);
}
.post-anchor-icon {
  font-size: 0.85rem;
  opacity: 0;
  transition: opacity 0.12s;
}
.post:hover .post-anchor-icon,
.post:focus-within .post-anchor-icon {
  opacity: 1;
}

/* Author rail (sidebar) */
.post-author {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  padding-right: 1rem;
  border-right: 1px solid var(--rule);
  align-self: start;
}
.post-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 3.25rem;
  height: 3.25rem;
  border-radius: 4px;
  border: 1px solid var(--rule);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-weight: 700;
  font-size: 1rem;
  letter-spacing: 0.04em;
}
.post-author-id {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}
.post-author-name {
  font-family: 'Fraunces', serif;
  font-weight: 700;
  font-size: 1rem;
  letter-spacing: -0.005em;
  color: var(--ink);
  text-decoration: none;
  font-variation-settings: 'opsz' 14;
}
.post-author-name:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}
.post-author-tags {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}
.role-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  padding: 0.1rem 0.4rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  border: 1px solid var(--rule);
  border-radius: 2px;
  color: var(--ink-fade);
}
.role-pill--admin {
  color: #f5c518;
  border-color: rgba(245, 197, 24, 0.4);
  background: rgba(245, 197, 24, 0.08);
}
.role-pill--mod {
  color: #6cd161;
  border-color: rgba(108, 209, 97, 0.4);
  background: rgba(108, 209, 97, 0.08);
}

/* Post body */
.post-body {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  min-width: 0;
}
.post-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  letter-spacing: 0.12em;
  color: var(--ink-fade);
  text-transform: uppercase;
}
.post-time {
  color: var(--ink-fade);
}
.post-edited {
  color: var(--ink-faint);
  font-style: italic;
  text-transform: none;
  letter-spacing: 0.04em;
}
.post-meta-tools {
  margin-left: auto;
  display: inline-flex;
  gap: 0.25rem;
}
.post-tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 4px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--ink-fade);
  cursor: pointer;
  transition: all 0.12s;
}
.post-tool:hover {
  border-color: var(--rule);
  background: rgb(var(--bg-elevated));
  color: var(--ink);
}
.post-tool--danger:hover {
  border-color: rgb(var(--danger) / 0.4);
  background: rgb(var(--danger) / 0.08);
  color: rgb(var(--danger));
}

.post-edit {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}
.post-edit-input {
  width: 100%;
  font-family: 'Inter', sans-serif;
  font-size: 0.95rem;
  line-height: 1.55;
  padding: 0.85rem 1rem;
  border: 1px solid var(--rule-strong);
  border-radius: 4px;
  background: rgb(var(--bg-elevated));
  color: var(--ink);
  resize: vertical;
}
.post-edit-input:focus {
  outline: none;
  border-color: var(--ink);
}
.post-edit-tools {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

/* ─── Composer ───────────────────────────────────────────── */
.composer {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  margin-top: 1.5rem;
  padding: 1.25rem 1.25rem 1.4rem;
  background: rgb(var(--bg-surface));
  border: 1px solid var(--rule);
  border-top: 4px solid var(--ink);
  border-radius: 4px;
}
.composer-head {
  display: flex;
  align-items: center;
  gap: 0.85rem;
}
.composer-eyebrow {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--ink);
}
.composer-rule {
  flex: 1;
  height: 1px;
  background: var(--rule);
}
.composer-hint {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.1em;
  color: var(--ink-fade);
  text-transform: uppercase;
}
.composer-hint kbd {
  display: inline-block;
  padding: 0 0.3rem;
  border: 1px solid var(--rule);
  border-bottom-width: 2px;
  border-radius: 3px;
  background: rgb(var(--bg-elevated));
  color: var(--ink);
  font-size: 10px;
  font-family: inherit;
}
.composer-input {
  width: 100%;
  font-family: 'Inter', sans-serif;
  font-size: 0.95rem;
  line-height: 1.55;
  padding: 0.85rem 1rem;
  border: 1px solid var(--rule);
  border-radius: 4px;
  background: rgb(var(--bg-base));
  color: var(--ink);
  resize: vertical;
}
.composer-input:focus {
  outline: none;
  border-color: var(--ink);
}
.composer-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.composer-counter {
  margin: 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  letter-spacing: 0.08em;
  color: var(--ink-faint);
}

.composer-locked {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding: 1rem 1.25rem;
  margin-top: 1rem;
  border: 1px dashed var(--rule);
  border-radius: 4px;
  color: var(--ink-fade);
  font-family: 'Fraunces', serif;
  font-style: italic;
  font-size: 0.95rem;
  font-variation-settings: 'opsz' 14;
}
.composer-locked p {
  margin: 0;
}
.composer-locked > svg {
  font-size: 1.25rem;
  flex-shrink: 0;
}

/* ─── Editorial buttons ──────────────────────────────────── */
.ed-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.5rem 0.85rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  border: 1px solid var(--rule-strong);
  background: rgb(var(--bg-elevated));
  color: var(--ink-soft);
  cursor: pointer;
  border-radius: 2px;
  transition: all 0.15s;
  text-decoration: none;
}
.ed-btn:hover:not(:disabled) {
  background: var(--ink);
  color: rgb(var(--accent-fg));
  border-color: var(--ink);
}
.ed-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ed-btn--ghost {
  background: transparent;
  border-color: var(--rule);
}
.ed-btn--primary {
  background: var(--ink);
  color: rgb(var(--accent-fg));
  border-color: var(--ink);
}
.ed-btn--primary:hover:not(:disabled) {
  background: rgb(var(--fg-default));
  border-color: rgb(var(--fg-default));
}
.ed-btn--danger {
  color: rgb(var(--danger));
  border-color: rgb(var(--danger) / 0.4);
}
.ed-btn--danger:hover:not(:disabled) {
  background: rgb(var(--danger));
  color: #fff;
  border-color: rgb(var(--danger));
}

/* ─── Skeleton ───────────────────────────────────────────── */
.topic-skeleton {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-top: 1rem;
}
.sk-head {
  height: 8rem;
  border: 1px solid var(--rule);
  border-radius: 4px;
  background: linear-gradient(
    90deg,
    rgb(var(--bg-surface)) 0%,
    rgb(var(--bg-elevated)) 50%,
    rgb(var(--bg-surface)) 100%
  );
  background-size: 200% 100%;
  animation: shimmer 1.6s infinite;
}
.sk-post {
  height: 7rem;
  border: 1px solid var(--rule);
  border-radius: 4px;
  background: linear-gradient(
    90deg,
    rgb(var(--bg-surface)) 0%,
    rgb(var(--bg-elevated)) 50%,
    rgb(var(--bg-surface)) 100%
  );
  background-size: 200% 100%;
  animation: shimmer 1.6s infinite;
}
@keyframes shimmer {
  0%   { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}

.empty-icon {
  font-size: 2.5rem;
  color: var(--ink-faint);
}
.topic-not-found {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.85rem;
  padding: 3rem 1.5rem;
  color: var(--ink-fade);
}

/* ─── Mobile reflow ───────────────────────────────────────── */
@media (max-width: 720px) {
  .post {
    grid-template-columns: 3rem 1fr;
    gap: 0.85rem;
    padding: 1.25rem 0;
  }
  .post-author {
    grid-column: 2 / -1;
    flex-direction: row;
    align-items: center;
    border-right: 0;
    border-bottom: 1px solid var(--rule);
    padding-right: 0;
    padding-bottom: 0.75rem;
    gap: 0.75rem;
  }
  .post--lede {
    grid-template-columns: 3rem 1fr;
  }
  .post-avatar {
    width: 2.5rem;
    height: 2.5rem;
    font-size: 0.85rem;
  }
  .post-meta-tools {
    flex-wrap: wrap;
  }
  .post-anchor-num {
    font-size: 1.15rem;
  }
  .post--lede .post-anchor-num {
    font-size: 1.4rem;
  }
}
</style>
