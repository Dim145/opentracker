<template>
  <div class="cat-shell">
    <div v-if="pending" class="cat-skeleton">
      <div class="sk-banner" />
      <div class="sk-row" v-for="i in 4" :key="`sk-${i}`" />
    </div>

    <template v-else-if="category">
      <!-- ── Banner ───────────────────────────────────────────── -->
      <header class="cat-banner" :style="bannerStyle">
        <div class="cat-banner-stripe" />

        <nav class="cat-crumb">
          <NuxtLink to="/forum" class="cat-crumb-link">{{ $t('forum.theForum') }}</NuxtLink>
          <Icon name="ph:caret-right-bold" class="cat-crumb-sep" />
          <span class="cat-crumb-leaf">{{ $t('forum.category.crumbLeaf') }}</span>
        </nav>

        <div class="cat-banner-head">
          <span class="cat-banner-icon">
            <Icon :name="category.icon || 'ph:newspaper-clipping-bold'" />
          </span>
          <div class="cat-banner-text">
            <p class="cat-banner-eyebrow">
              {{ $t('forum.category.sectionLabel', { n: formatIssueNumber(1) }) }}
              <span class="dot" />
              {{ $t('forum.category.threads', { n: visibleTopics.length }) }}
            </p>
            <h1 class="cat-banner-title font-display">{{ category.name }}</h1>
            <p v-if="category.description" class="cat-banner-tag">
              {{ category.description }}
            </p>
          </div>
          <div class="cat-banner-cta">
            <NuxtLink
              :to="`/forum/new-topic?categoryId=${category.id}`"
              class="ed-btn ed-btn--primary"
            >
              <Icon name="ph:feather-bold" />
              {{ $t('forum.category.openThread') }}
            </NuxtLink>
          </div>
        </div>
      </header>

      <!-- ── Toolbar (sort + filter) ──────────────────────────── -->
      <div class="cat-toolbar">
        <div class="cat-toolbar-stats">
          <span>
            <strong>{{ category.topics.length }}</strong>
            {{ $t('forum.category.threadWord', { n: category.topics.length }) }}
          </span>
          <span class="cat-toolbar-sep" />
          <span>
            <strong>{{ totalReplies }}</strong>
            {{ $t('forum.category.replyWord', { n: totalReplies }) }}
          </span>
        </div>
        <div class="cat-toolbar-controls">
          <div class="seg" role="tablist" :aria-label="$t('forum.category.sortBy')">
            <button
              v-for="opt in sortOptions"
              :key="opt.value"
              type="button"
              role="tab"
              :aria-selected="sort === opt.value"
              class="seg-btn"
              :class="{ 'seg-btn--on': sort === opt.value }"
              @click="sort = opt.value"
            >
              <Icon :name="opt.icon" />
              {{ opt.label }}
            </button>
          </div>
        </div>
      </div>

      <!-- ── Topics list ──────────────────────────────────────── -->
      <ol v-if="visibleTopics.length > 0" class="topic-list">
        <li
          v-for="(topic, idx) in visibleTopics"
          :key="topic.id"
          class="topic-card"
          :class="{
            'topic-card--pinned': topic.isPinned,
            'topic-card--locked': topic.isLocked && !topic.isPinned,
          }"
        >
          <NuxtLink :to="`/forum/topic/${topic.id}`" class="topic-card-link">
            <div class="topic-card-num">
              <span>{{ formatIssueNumber(idx + 1) }}</span>
              <span class="topic-card-num-label">№</span>
            </div>

            <div class="topic-card-body">
              <p class="topic-card-flags">
                <span v-if="topic.isPinned" class="flag flag--pin">
                  <Icon name="ph:push-pin-fill" />
                  {{ $t('forum.topic.pinned') }}
                </span>
                <span v-if="topic.isLocked" class="flag flag--lock">
                  <Icon name="ph:lock-fill" />
                  {{ $t('forum.topic.locked') }}
                </span>
                <span class="flag flag--time">
                  <Icon name="ph:clock-bold" />
                  {{ formatAge(topic.updatedAt) }}
                </span>
              </p>

              <h2 class="topic-card-title font-display">{{ topic.title }}</h2>

              <p v-if="topic.firstPostExcerpt" class="topic-card-excerpt">
                {{ topic.firstPostExcerpt }}
              </p>

              <p class="topic-card-byline">
                <span>{{ $t('forum.topic.byline.by') }}</span>
                <strong>{{ topic.author.username }}</strong>
                <span class="topic-card-byline-sep">·</span>
                <span>{{ formatJoinedDate(topic.createdAt) }}</span>
              </p>
            </div>

            <div class="topic-card-side">
              <dl class="topic-card-stats">
                <div>
                  <dt>{{ $t('forum.category.repliesLabel') }}</dt>
                  <dd>{{ topic.replyCount }}</dd>
                </div>
              </dl>
              <div v-if="topic.lastPost" class="topic-card-last">
                <p class="topic-card-last-eyebrow">{{ $t('forum.category.lastReply') }}</p>
                <p class="topic-card-last-line">
                  <strong>{{ topic.lastPost.authorUsername }}</strong>
                  <span class="topic-card-byline-sep">·</span>
                  <span>{{ formatAge(topic.lastPost.createdAt) }}</span>
                </p>
              </div>
              <div v-else class="topic-card-last topic-card-last--empty">
                <em>{{ $t('forum.category.noRepliesYet') }}</em>
              </div>
            </div>
          </NuxtLink>

          <button
            v-if="canDelete"
            type="button"
            class="topic-card-delete"
            :title="$t('forum.category.deleteTopicTitle')"
            @click.stop.prevent="handleDeleteTopic(topic)"
          >
            <Icon name="ph:trash-bold" />
          </button>
        </li>
      </ol>

      <div v-else class="topic-list-empty">
        <Icon name="ph:wind" class="empty-icon" />
        <h3 class="empty-title font-display">{{ $t('forum.category.empty.title') }}</h3>
        <p class="empty-sub">
          {{ $t('forum.category.empty.sub') }}
        </p>
        <NuxtLink
          :to="`/forum/new-topic?categoryId=${category.id}`"
          class="ed-btn ed-btn--primary"
        >
          <Icon name="ph:feather-bold" />
          {{ $t('forum.category.openThread') }}
        </NuxtLink>
      </div>
    </template>

    <div v-else class="cat-not-found">
      <Icon name="ph:question-bold" class="empty-icon" />
      <p>{{ $t('forum.category.notFound') }}</p>
      <NuxtLink to="/forum" class="ed-btn">{{ $t('forum.topic.backToForum') }}</NuxtLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { formatAge } from '~/utils/format';

interface ForumTopic {
  id: string;
  title: string;
  isPinned: boolean;
  isLocked: boolean;
  createdAt: string;
  updatedAt: string;
  author: { id: string; username: string };
  replyCount: number;
  firstPostExcerpt: string | null;
  lastPost: {
    authorUsername: string;
    createdAt: string;
  } | null;
}

interface Category {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  order: number;
  createdAt: string;
  topics: ForumTopic[];
}

const route = useRoute();
const { t, locale } = useI18n();
const { user } = useUserSession();
const notifications = useNotificationStore();
const confirm = useConfirm();

const {
  data: category,
  pending,
  refresh,
} = await useFetch<Category>(
  () => `/api/forum/categories/${route.params.id}`
);

useHead({
  title: () => category.value?.name ?? t('forum.category.headFallback'),
});

const sortOptions = computed(() => [
  { value: 'recent' as const, label: t('forum.category.sort.recent'), icon: 'ph:clock-bold' },
  { value: 'oldest' as const, label: t('forum.category.sort.oldest'), icon: 'ph:hourglass-bold' },
  { value: 'replies' as const, label: t('forum.category.sort.replies'), icon: 'ph:chats-circle-bold' },
]);
type SortValue = 'recent' | 'oldest' | 'replies';
const sort = ref<SortValue>('recent');

// Pinned threads always float on top regardless of the sort axis — that's
// what `is_pinned` is for. Within each band (pinned / unpinned) we apply
// the user-selected ordering. Sorting is done in the FE since the topic
// list is bounded (the API returns the whole category).
const visibleTopics = computed(() => {
  if (!category.value) return [] as ForumTopic[];
  const arr = [...category.value.topics];
  arr.sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    if (sort.value === 'recent') {
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    }
    if (sort.value === 'oldest') {
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    }
    return b.replyCount - a.replyCount;
  });
  return arr;
});

const totalReplies = computed(() =>
  category.value?.topics.reduce((acc, t) => acc + t.replyCount, 0) ?? 0
);

const canDelete = computed(
  () => Boolean(user.value?.isAdmin || user.value?.isModerator)
);

const bannerStyle = computed(() => ({
  '--accent': category.value?.color || 'rgb(var(--fg-muted))',
}));

function formatIssueNumber(n: number): string {
  return String(n).padStart(2, '0');
}
function formatJoinedDate(date: string): string {
  return new Date(date).toLocaleDateString(locale.value === 'fr' ? 'fr-FR' : 'en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

async function handleDeleteTopic(topic: ForumTopic) {
  const ok = await confirm({
    title: t('forum.topic.deleteTopicConfirm.title'),
    message: t('forum.topic.deleteTopicConfirm.message', { title: topic.title }),
    confirmText: t('forum.topic.deleteTopicConfirm.action'),
    destructive: true,
  });
  if (!ok) return;
  try {
    await $fetch(`/api/forum/topics/${topic.id}`, { method: 'DELETE' });
    notifications.success(t('forum.topic.toasts.topicDeleted'));
    await refresh();
  } catch (e: any) {
    notifications.error(e?.data?.message || t('forum.topic.errors.deleteTopic'));
  }
}
</script>

<style scoped>
.cat-shell {
  display: flex;
  flex-direction: column;
  gap: 2rem;
  padding-bottom: 4rem;
}

/* ─── Banner ─────────────────────────────────────────────── */
.cat-banner {
  --rule: rgb(var(--line-default));
  --rule-strong: rgb(var(--line-strong));
  --ink: rgb(var(--fg-strong));
  --ink-soft: rgb(var(--fg-default));
  --ink-fade: rgb(var(--fg-muted));
  --ink-faint: rgb(var(--fg-faint));

  position: relative;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.85rem 1.5rem 2rem 2.25rem;
  border: 1px solid var(--rule);
  border-radius: 4px;
  background:
    radial-gradient(800px 200px at 0% 0%, color-mix(in srgb, var(--accent) 12%, transparent), transparent 60%),
    rgb(var(--bg-surface));
  overflow: hidden;
}
.cat-banner-stripe {
  position: absolute;
  inset: 0 auto 0 0;
  width: 6px;
  background: var(--accent);
}

.cat-crumb {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ink-fade);
}
.cat-crumb-link {
  color: var(--ink-fade);
  text-decoration: none;
  transition: color 0.12s;
}
.cat-crumb-link:hover {
  color: var(--ink);
}
.cat-crumb-sep {
  color: var(--ink-faint);
  font-size: 0.7rem;
}
.cat-crumb-leaf {
  color: var(--ink);
}

.cat-banner-head {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 1.25rem;
  align-items: start;
}
.cat-banner-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 3.5rem;
  height: 3.5rem;
  border-radius: 4px;
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
  color: var(--accent);
  font-size: 1.7rem;
  flex-shrink: 0;
}
.cat-banner-text {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  min-width: 0;
}
.cat-banner-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--accent);
  margin: 0;
}
.cat-banner-eyebrow .dot {
  display: inline-block;
  width: 4px;
  height: 4px;
  border-radius: 9999px;
  background: var(--ink-faint);
}
.cat-banner-title {
  margin: 0;
  font-size: clamp(2.25rem, 5vw, 3.5rem);
  line-height: 1;
  letter-spacing: -0.035em;
  color: var(--ink);
  font-weight: 800;
  font-variation-settings: 'opsz' 96, 'SOFT' 30;
  word-break: break-word;
}
.cat-banner-tag {
  margin: 0;
  font-family: 'Fraunces', serif;
  font-style: italic;
  font-size: 1rem;
  line-height: 1.45;
  color: var(--ink-soft);
  font-variation-settings: 'opsz' 14;
  max-width: 60ch;
}
.cat-banner-cta {
  display: flex;
  align-items: flex-start;
}

@media (max-width: 720px) {
  .cat-banner-head {
    grid-template-columns: auto 1fr;
  }
  .cat-banner-cta {
    grid-column: 1 / -1;
  }
}

/* ─── Toolbar ────────────────────────────────────────────── */
.cat-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem 0;
  border-top: 1px solid rgb(var(--line-default));
  border-bottom: 1px solid rgb(var(--line-default));
  flex-wrap: wrap;
}
.cat-toolbar-stats {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.cat-toolbar-stats strong {
  color: rgb(var(--fg-strong));
  font-weight: 700;
}
.cat-toolbar-sep {
  width: 4px;
  height: 4px;
  border-radius: 9999px;
  background: rgb(var(--fg-faint));
}
.cat-toolbar-controls {
  margin-left: auto;
}

.seg {
  display: inline-flex;
  border: 1px solid rgb(var(--line-default));
  border-radius: 4px;
  overflow: hidden;
  background: rgb(var(--bg-surface));
}
.seg-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.7rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  background: transparent;
  border: 0;
  border-right: 1px solid rgb(var(--line-default));
  cursor: pointer;
  transition: all 0.12s;
}
.seg-btn:last-child {
  border-right: 0;
}
.seg-btn:hover {
  color: rgb(var(--fg-strong));
  background: rgb(var(--fg-default) / 0.04);
}
.seg-btn--on {
  background: rgb(var(--fg-default));
  color: rgb(var(--accent-fg));
}
.seg-btn--on:hover {
  background: rgb(var(--fg-default));
}

/* ─── Topic cards ─────────────────────────────────────────── */
.topic-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}
.topic-card {
  position: relative;
  background: rgb(var(--bg-surface));
  border: 1px solid rgb(var(--line-default));
  border-radius: 4px;
  transition: border-color 0.16s, transform 0.16s;
}
.topic-card:hover {
  border-color: rgb(var(--line-strong));
  transform: translateY(-1px);
}
.topic-card--pinned {
  border-left: 3px solid rgb(var(--fg-strong));
}
.topic-card--locked {
  border-left: 3px solid rgb(var(--fg-muted));
  background: rgb(var(--bg-surface) / 0.6);
}

.topic-card-link {
  display: grid;
  grid-template-columns: 4.5rem 1fr 12rem;
  gap: 1rem;
  padding: 1.1rem 1.25rem;
  text-decoration: none;
  color: inherit;
}
.topic-card-num {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  font-family: 'Fraunces', serif;
  border-right: 1px dashed rgb(var(--line-default));
  padding-right: 0.85rem;
}
.topic-card-num span {
  font-size: 1.85rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: rgb(var(--fg-strong));
  font-variation-settings: 'opsz' 96;
  line-height: 1;
}
.topic-card-num-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9.5px !important;
  letter-spacing: 0.2em;
  color: rgb(var(--fg-faint)) !important;
  text-transform: uppercase;
  margin-top: 0.2rem;
}

.topic-card-body {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
}
.topic-card-flags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin: 0;
}
.flag {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.18rem 0.5rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  border: 1px solid rgb(var(--line-default));
  border-radius: 9999px;
  color: rgb(var(--fg-muted));
}
.flag--pin {
  color: rgb(var(--fg-strong));
  border-color: rgb(var(--fg-strong) / 0.4);
  background: rgb(var(--fg-default) / 0.05);
}
.flag--lock {
  color: rgb(var(--fg-muted));
  background: rgb(var(--bg-elevated));
}
.flag--time {
  border-color: transparent;
  background: rgb(var(--bg-elevated));
}

.topic-card-title {
  margin: 0;
  font-size: 1.5rem;
  line-height: 1.15;
  letter-spacing: -0.02em;
  font-weight: 700;
  color: rgb(var(--fg-strong));
  font-variation-settings: 'opsz' 96;
  word-break: break-word;
}
.topic-card:hover .topic-card-title {
  text-decoration: underline;
  text-underline-offset: 5px;
  text-decoration-thickness: 1px;
  text-decoration-color: rgb(var(--fg-default) / 0.3);
}
.topic-card-excerpt {
  margin: 0;
  font-family: 'Fraunces', serif;
  font-style: italic;
  font-size: 0.95rem;
  line-height: 1.55;
  color: rgb(var(--fg-default));
  font-variation-settings: 'opsz' 14;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.topic-card-byline {
  margin: 0;
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.35rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.topic-card-byline strong {
  color: rgb(var(--fg-strong));
  font-weight: 700;
}
.topic-card-byline-sep {
  color: rgb(var(--fg-faint));
}

.topic-card-side {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding-left: 1rem;
  border-left: 1px solid rgb(var(--line-default));
}
.topic-card-stats {
  margin: 0;
  display: flex;
  flex-direction: column;
}
.topic-card-stats > div {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.topic-card-stats dt {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9.5px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-faint));
}
.topic-card-stats dd {
  margin: 0;
  font-family: 'Fraunces', serif;
  font-size: 1.55rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: rgb(var(--fg-strong));
  font-variation-settings: 'opsz' 96;
  line-height: 1;
}
.topic-card-last {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}
.topic-card-last-eyebrow {
  margin: 0;
  font-size: 9.5px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-faint));
}
.topic-card-last-line {
  margin: 0;
  font-size: 11px;
  letter-spacing: 0.04em;
  color: rgb(var(--fg-default));
}
.topic-card-last-line strong {
  color: rgb(var(--fg-strong));
}
.topic-card-last--empty {
  color: rgb(var(--fg-faint));
  font-family: 'Fraunces', serif;
  font-style: italic;
  font-size: 0.92rem;
}

.topic-card-delete {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 4px;
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-muted));
  cursor: pointer;
  opacity: 0;
  transition: all 0.12s;
}
.topic-card:hover .topic-card-delete,
.topic-card:focus-within .topic-card-delete {
  opacity: 1;
}
.topic-card-delete:hover {
  border-color: rgb(var(--danger) / 0.5);
  background: rgb(var(--danger) / 0.08);
  color: rgb(var(--danger));
}
@media (max-width: 640px) {
  .topic-card-delete {
    opacity: 1;
  }
}

/* ─── Empty state ─────────────────────────────────────────── */
.topic-list-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.85rem;
  padding: 3rem 1.5rem;
  border: 1px dashed rgb(var(--line-default));
  border-radius: 4px;
}
.empty-icon {
  font-size: 2.5rem;
  color: rgb(var(--fg-faint));
}
.empty-title {
  margin: 0;
  font-size: 1.6rem;
  letter-spacing: -0.02em;
  color: rgb(var(--fg-strong));
  font-weight: 700;
  font-variation-settings: 'opsz' 96;
}
.empty-sub {
  margin: 0;
  font-size: 0.95rem;
  color: rgb(var(--fg-muted));
  max-width: 36ch;
}

.cat-not-found {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 3rem 1.5rem;
  text-align: center;
  color: rgb(var(--fg-muted));
}

.cat-skeleton {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.cat-skeleton .sk-banner {
  height: 9rem;
  background: rgb(var(--bg-surface));
  border: 1px solid rgb(var(--line-default));
  border-radius: 4px;
  animation: shimmer 1.6s infinite;
  background: linear-gradient(
    90deg,
    rgb(var(--bg-surface)) 0%,
    rgb(var(--bg-elevated)) 50%,
    rgb(var(--bg-surface)) 100%
  );
  background-size: 200% 100%;
}
.cat-skeleton .sk-row {
  height: 5.5rem;
  background: rgb(var(--bg-surface));
  border: 1px solid rgb(var(--line-default));
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

/* ─── Editorial buttons (re-used from /forum) ────────────── */
.ed-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 1rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  border: 1px solid rgb(var(--line-strong));
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-default));
  cursor: pointer;
  border-radius: 2px;
  text-decoration: none;
  transition: all 0.15s;
}
.ed-btn:hover {
  background: rgb(var(--fg-strong));
  color: rgb(var(--accent-fg));
  border-color: rgb(var(--fg-strong));
}
.ed-btn--primary {
  background: rgb(var(--fg-strong));
  color: rgb(var(--accent-fg));
  border-color: rgb(var(--fg-strong));
}

/* ─── Mobile reflow ───────────────────────────────────────── */
@media (max-width: 768px) {
  .topic-card-link {
    grid-template-columns: auto 1fr;
    gap: 0.85rem;
    padding: 1rem 1rem 1.1rem;
  }
  .topic-card-num {
    border-right: 0;
    padding-right: 0;
    align-items: flex-start;
    flex-direction: row;
    gap: 0.4rem;
  }
  .topic-card-num span {
    font-size: 1.25rem;
  }
  .topic-card-side {
    grid-column: 1 / -1;
    flex-direction: row;
    border-left: 0;
    border-top: 1px solid rgb(var(--line-default));
    padding-left: 0;
    padding-top: 0.65rem;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .topic-card-stats > div {
    flex-direction: row;
    align-items: baseline;
    gap: 0.4rem;
  }
  .topic-card-stats dd {
    font-size: 1rem;
  }
  .topic-card-title {
    font-size: 1.2rem;
  }
}
</style>
