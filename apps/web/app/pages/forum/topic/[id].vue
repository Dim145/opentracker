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
          <!-- Renommer et déplacer n'existaient POUR PERSONNE : le titre et
               la section étaient écrits une seule fois, par l'INSERT de
               création. Un sujet mal titré le restait, et un sujet posté dans
               la mauvaise section n'avait qu'une issue — la suppression, qui
               détruit les réponses déjà écrites. -->
          <button
            type="button"
            class="ed-btn ed-btn--ghost"
            @click="openRetitle"
          >
            <Icon name="ph:text-aa" />
            {{ $t('forum.actions.retitle') }}
          </button>
          <button
            type="button"
            class="ed-btn ed-btn--ghost"
            @click="openMove"
          >
            <Icon name="ph:arrows-left-right" />
            {{ $t('forum.actions.move') }}
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
              <!-- La main du personnel dans le texte d'autrui se voit, et se
                   nomme. Elle ne passe PAS par `isEdited()` : cette heuristique
                   ignore les cinq premières secondes, et une intervention
                   immédiate resterait muette. Une marque écrite en base EST
                   une édition, sans avoir à la déduire d'un horodatage. -->
              <span
                v-if="post.editedBy"
                class="post-edited post-edited--staff"
                :title="$t('forum.topic.editedByStaffTitle', {
                  name: post.editedBy.username,
                  date: absoluteDate(post.editedAt ?? post.updatedAt),
                })"
              >
                <Icon name="ph:pencil-simple" />
                {{ $t('forum.topic.editedByStaff', { name: post.editedBy.username }) }}
              </span>
              <span
                v-else-if="isEdited(post)"
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
                :aria-label="$t('forum.topic.editLabel')"
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
        <!-- Le texte réapparaît tout seul à l'ouverture : le dire, sinon
             c'est un texte qu'on ne se souvient pas d'avoir écrit. -->
        <p v-if="replyDraft.restored.value" class="draft-note">
          <Icon name="ph:floppy-disk-back-bold" />
          {{ $t('common.draftRestored') }}
          <button type="button" class="draft-note-clear" @click="replyContent = ''; replyDraft.clear()">
            {{ $t('common.draftDiscard') }}
          </button>
        </p>
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
    <!-- Une seule boîte pour les deux gestes : ils portent sur le même objet,
         et séparer deux modales pour deux champs aurait fait deux fois le
         même code. -->
    <Modal
      v-model="topicEdit.open"
      :title="topicEdit.mode === 'title' ? $t('forum.actions.retitle') : $t('forum.actions.move')"
      :icon="topicEdit.mode === 'title' ? 'ph:text-aa' : 'ph:arrows-left-right'"
      size="sm"
    >
      <div class="tedit">
        <template v-if="topicEdit.mode === 'title'">
          <label class="field-label" :for="topicEditId">{{ $t('forum.newTopic.fields.headline') }}</label>
          <input
            :id="topicEditId"
            v-model="topicEdit.title"
            class="input"
            maxlength="200"
            :placeholder="$t('forum.newTopic.fields.headlinePlaceholder')"
          />
        </template>
        <template v-else>
          <label class="field-label" :for="topicEditId">{{ $t('forum.actions.moveTo') }}</label>
          <select :id="topicEditId" v-model="topicEdit.categoryId" class="input">
            <option v-for="c in sections" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </template>
        <p v-if="topicEdit.error" class="tedit-error" role="alert">{{ topicEdit.error }}</p>
      </div>
      <template #footer>
        <button type="button" class="btn btn-secondary" :disabled="topicEdit.busy" @click="topicEdit.open = false">
          {{ $t('common.cancel') }}
        </button>
        <button type="button" class="btn btn-primary" :disabled="topicEdit.busy || !topicEditValid" @click="submitTopicEdit">
          <Icon v-if="topicEdit.busy" name="ph:circle-notch" class="animate-spin" />
          {{ $t('common.save') }}
        </button>
      </template>
    </Modal>
</template>

<script setup lang="ts">
import PostBody from '~/components/forum/PostBody.vue';
import Modal from '~/components/Modal.vue';
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
  /** Qui, dans le personnel, a réécrit ce texte. NULL quand l'auteur s'est
   *  corrigé lui-même — ça ne regarde personne. `updatedAt` ne distingue pas
   *  les deux : il bouge aussi quand on se relit. */
  editedBy?: { id: string; username: string } | null;
  editedAt?: string | null;
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
// Un brouillon par sujet : deux réponses en cours dans deux onglets ne se
// marchent pas dessus.
const replyDraft = useDraft(`forum:reply:${route.params.id}`, replyContent);
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

/* ── Renommer, déplacer ────────────────────────────────────────────────────
 *
 * Une seule pièce d'état pour les deux : même objet, même route, et deux
 * modales pour deux champs auraient été deux fois le même code.
 */
const topicEditId = useId();
const topicEdit = reactive({
  open: false,
  mode: 'title' as 'title' | 'move',
  title: '',
  categoryId: '',
  busy: false,
  error: '',
});
const sections = ref<{ id: string; name: string }[]>([]);

const topicEditValid = computed(() =>
  topicEdit.mode === 'title'
    ? topicEdit.title.trim().length >= 3
    : !!topicEdit.categoryId && topicEdit.categoryId !== topic.value?.categoryId
);

function openRetitle() {
  topicEdit.mode = 'title';
  topicEdit.title = topic.value?.title ?? '';
  topicEdit.error = '';
  topicEdit.open = true;
}

async function openMove() {
  topicEdit.mode = 'move';
  topicEdit.categoryId = topic.value?.categoryId ?? '';
  topicEdit.error = '';
  topicEdit.open = true;
  // Les sections sont chargées à l'ouverture, pas au montage : personne ne
  // déplace un sujet à chaque visite, et la liste ne sert qu'ici.
  if (sections.value.length === 0) {
    try {
      const res = await $fetch<{ id: string; name: string }[] | { data: { id: string; name: string }[] }>(
        '/api/forum/categories'
      );
      sections.value = Array.isArray(res) ? res : (res.data ?? []);
    } catch {
      topicEdit.error = t('common.loadFailed');
    }
  }
}

async function submitTopicEdit() {
  if (!topic.value || !topicEditValid.value) return;
  topicEdit.busy = true;
  topicEdit.error = '';
  try {
    const body =
      topicEdit.mode === 'title'
        ? { title: topicEdit.title.trim() }
        : { categoryId: topicEdit.categoryId };
    await $fetch(`/api/forum/topics/${topic.value.id}`, { method: 'PATCH', body });
    topicEdit.open = false;
    await refresh();
  } catch (e: unknown) {
    topicEdit.error =
      (e as { data?: { message?: string } })?.data?.message ?? t('common.actionFailed');
  } finally {
    topicEdit.busy = false;
  }
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
    // Publié : le brouillon n'a plus de raison d'exister.
    replyDraft.clear();
    await refresh();
    nextTick(() => {
      // Scroll to the new last post — that's the one we just added.
      // `.at(-1)` is in baseline-widely-available so it's safe to ship
      // to the browser bundle; no fallback needed.
      const last = topic.value?.posts?.at(-1);
      if (last) {
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
  /* Le trait d'un CONTRÔLE, pas d'un séparateur : WCAG 1.4.11 le
     veut à 3:1, et `--rule` mesure 1,21:1. */
  --rule-field: rgb(var(--line-field));
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
  font-family: var(--font-mono);
  font-size: 0.6563rem;
  font-weight: 700;
  letter-spacing: calc(0.18em * var(--tracking-scale));
  text-transform: uppercase;
  color: var(--ink-fade);
  flex-wrap: wrap;
}
.article-crumb-link {
  /* WCAG 2.5.8 : 24 px de cible au minimum. Mesuré à 16 px avant. */
  padding-block: 0.25rem;
  color: var(--ink-fade);
  text-decoration: none;
  transition: color var(--dur-1);
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
  letter-spacing: calc(-0.04em * var(--tracking-scale));
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
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  letter-spacing: calc(0.08em * var(--tracking-scale));
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
  font-family: var(--font-mono);
  font-size: 0.5938rem;
  font-weight: 700;
  letter-spacing: calc(0.14em * var(--tracking-scale));
  text-transform: uppercase;
  border: 1px solid var(--rule);
  border-radius: var(--radius-pill);
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
  font-family: var(--font-display);
  font-size: 1.4rem;
  font-weight: 700;
  letter-spacing: calc(-0.02em * var(--tracking-scale));
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
  transition: opacity var(--dur-1);
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
  border-radius: var(--radius-sm);
  border: 1px solid var(--rule);
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 1rem;
  letter-spacing: calc(0.04em * var(--tracking-scale));
}
.post-author-id {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}
.post-author-name {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 1rem;
  letter-spacing: calc(-0.005em * var(--tracking-scale));
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
  font-family: var(--font-mono);
  font-size: 0.5625rem;
  font-weight: 700;
  letter-spacing: calc(0.16em * var(--tracking-scale));
  text-transform: uppercase;
  border: 1px solid var(--rule);
  border-radius: var(--radius-xs);
  color: var(--ink-fade);
}
.role-pill--admin {
  color: rgb(var(--accent-warm-text));  /* jeton sémantique : cette teinte était figée sur le thème sombre */
  border-color: rgba(245, 197, 24, 0.4);
  background: rgba(245, 197, 24, 0.08);
}
.role-pill--mod {
  color: rgb(var(--online));  /* jeton sémantique : cette teinte était figée sur le thème sombre */
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
  font-family: var(--font-mono);
  font-size: 0.6563rem;
  letter-spacing: calc(0.12em * var(--tracking-scale));
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
  letter-spacing: calc(0.04em * var(--tracking-scale));
}
/* Pas en italique, contrairement à la marque d'auto-correction : ce n'est pas
   un aparté, c'est une attribution. */
.post-edited--staff {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  color: rgb(var(--warning));
  font-style: normal;
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
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  background: transparent;
  color: var(--ink-fade);
  cursor: pointer;
  transition: all var(--dur-1);
}
.post-tool:hover {
  border-color: rgb(var(--fg-default) / 0.45);
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
  font-family: var(--font-sans);
  font-size: 0.95rem;
  line-height: 1.55;
  padding: 0.85rem 1rem;
  border: 1px solid var(--rule-strong);
  border-radius: var(--radius-sm);
  background: rgb(var(--bg-elevated));
  color: var(--ink);
  resize: vertical;
}
.post-edit-input:focus {
  outline: none;
  border-color: var(--ink);
}
/* L'anneau rendu au clavier. `outline: none` ci-dessus est pour la souris, où
   un changement de bordure suffit ; en `<style scoped>` la règle compile avec un
   attribut de données, donc elle battait le `:focus-visible` global de `main.css`
   quel que soit l'ordre — et ce champ n'avait plus aucun indicateur de focus.
   `main.css` corrige exactement ça pour `.input`, avec la même explication. */
.post-edit-input:focus-visible {
  outline: 2px solid rgb(var(--focus-ring));
  outline-offset: 2px;
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
  border-radius: var(--radius-sm);
}
.composer-head {
  display: flex;
  align-items: center;
  gap: 0.85rem;
}
.composer-eyebrow {
  font-family: var(--font-mono);
  font-size: 0.6563rem;
  font-weight: 700;
  letter-spacing: calc(0.22em * var(--tracking-scale));
  text-transform: uppercase;
  color: var(--ink);
}
.composer-rule {
  flex: 1;
  height: 1px;
  background: var(--rule);
}
.composer-hint {
  font-family: var(--font-mono);
  font-size: 0.625rem;
  letter-spacing: calc(0.1em * var(--tracking-scale));
  color: var(--ink-fade);
  text-transform: uppercase;
}
.composer-hint kbd {
  display: inline-block;
  padding: 0 0.3rem;
  border: 1px solid var(--rule);
  border-bottom-width: 2px;
  border-radius: var(--radius-xs);
  background: rgb(var(--bg-elevated));
  color: var(--ink);
  font-size: 0.625rem;
  font-family: inherit;
}
.composer-input {
  width: 100%;
  font-family: var(--font-sans);
  font-size: 0.95rem;
  line-height: 1.55;
  padding: 0.85rem 1rem;
  border: 1px solid var(--rule);
  border-radius: var(--radius-sm);
  background: rgb(var(--bg-base));
  color: var(--ink);
  resize: vertical;
}
.composer-input:focus {
  outline: none;
  border-color: var(--ink);
}
/* L'anneau rendu au clavier. `outline: none` ci-dessus est pour la souris, où
   un changement de bordure suffit ; en `<style scoped>` la règle compile avec un
   attribut de données, donc elle battait le `:focus-visible` global de `main.css`
   quel que soit l'ordre — et ce champ n'avait plus aucun indicateur de focus.
   `main.css` corrige exactement ça pour `.input`, avec la même explication. */
.composer-input:focus-visible {
  outline: 2px solid rgb(var(--focus-ring));
  outline-offset: 2px;
}

.composer-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.composer-counter {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.6563rem;
  letter-spacing: calc(0.08em * var(--tracking-scale));
  color: var(--ink-faint);
}

.composer-locked {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding: 1rem 1.25rem;
  margin-top: 1rem;
  border: 1px dashed var(--rule);
  border-radius: var(--radius-sm);
  color: var(--ink-fade);
  font-family: var(--font-display);
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
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: calc(0.16em * var(--tracking-scale));
  text-transform: uppercase;
  border: 1px solid var(--rule-field);
  background: rgb(var(--bg-elevated));
  color: var(--ink-soft);
  cursor: pointer;
  border-radius: var(--radius-xs);
  transition: all var(--dur-2);
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
  color: rgb(var(--danger-fg));  /* jeton sémantique : cette teinte était figée sur le thème sombre */
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
  border-radius: var(--radius-sm);
  background: linear-gradient(
    90deg,
    rgb(var(--bg-surface)) 0%,
    rgb(var(--bg-elevated)) 50%,
    rgb(var(--bg-surface)) 100%
  );
  background-size: 200% 100%;
  animation: shimmer calc(1.6s * var(--motion-scale)) infinite;
}
.sk-post {
  height: 7rem;
  border: 1px solid var(--rule);
  border-radius: var(--radius-sm);
  background: linear-gradient(
    90deg,
    rgb(var(--bg-surface)) 0%,
    rgb(var(--bg-elevated)) 50%,
    rgb(var(--bg-surface)) 100%
  );
  background-size: 200% 100%;
  animation: shimmer calc(1.6s * var(--motion-scale)) infinite;
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
.draft-note {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin-bottom: 0.4rem;
  font-size: 0.7rem;
  color: rgb(var(--fg-subtle));
}
.draft-note-clear {
  color: rgb(var(--fg-muted));
  text-decoration: underline;
  cursor: pointer;
}
.draft-note-clear:hover { color: rgb(var(--fg-default)); }
.tedit {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.tedit-error {
  margin: 0.2rem 0 0;
  padding: 0.45rem 0.6rem;
  border: 1px solid rgb(var(--danger) / 0.55);
  border-radius: var(--radius-sm);
  background: rgb(var(--danger) / 0.12);
  color: rgb(var(--fg-default));
  font-size: 0.75rem;
}

</style>
