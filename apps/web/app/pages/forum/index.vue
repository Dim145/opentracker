<template>
  <div class="forum-shell">
    <!-- ── Masthead ────────────────────────────────────────── -->
    <header class="masthead">
      <p class="masthead-eyebrow">
        <span>{{ $t('forum.index.masthead.volume', { n: 1 }) }}</span>
        <span class="masthead-eyebrow-sep">·</span>
        <span>{{ $t('forum.index.masthead.issue', { n: issueNumber }) }}</span>
        <span class="masthead-eyebrow-sep">·</span>
        <time>{{ todayLabel }}</time>
      </p>
      <h1 class="masthead-title font-display">{{ $t('forum.index.masthead.title') }}</h1>
      <p class="masthead-tag">
        {{ $t('forum.index.masthead.tagline') }}
      </p>

      <ul class="masthead-stats" :class="{ 'is-loading': statsPending }">
        <li>
          <span class="stat-key">{{ $t('forum.index.stats.categories') }}</span>
          <span class="stat-val">{{ stats?.totals.categories ?? '—' }}</span>
        </li>
        <li>
          <span class="stat-key">{{ $t('forum.index.stats.threads') }}</span>
          <span class="stat-val">{{ stats?.totals.topics ?? '—' }}</span>
        </li>
        <li>
          <span class="stat-key">{{ $t('forum.index.stats.posts') }}</span>
          <span class="stat-val">{{ stats?.totals.posts ?? '—' }}</span>
        </li>
        <li>
          <span class="stat-key">{{ $t('forum.index.stats.contributors') }}</span>
          <span class="stat-val">{{ stats?.totals.contributors ?? '—' }}</span>
        </li>
        <li v-if="lastActivity" class="stat-pulse">
          <span class="pulse-dot" />
          <span class="stat-key">{{ $t('forum.index.stats.lastFiled') }}</span>
          <span class="stat-val-mono">{{ formatAge(lastActivity) }}</span>
        </li>
      </ul>

      <div v-if="user?.isAdmin" class="masthead-tools">
        <button type="button" class="ed-btn ed-btn--primary" @click="openCreate">
          <Icon name="ph:plus-bold" />
          {{ $t('forum.index.actions.newSection') }}
        </button>
      </div>
    </header>

    <!-- ── Sections (categories) ───────────────────────────── -->
    <section>
      <header class="rule-head">
        <span class="rule-eyebrow">{{ $t('forum.index.sections.title') }}</span>
        <span class="rule-line" />
        <span class="rule-counter">{{ categories?.length ?? 0 }}</span>
      </header>

      <div v-if="catPending" class="sections-grid">
        <div v-for="i in 4" :key="`sk-${i}`" class="section-tile section-tile--skeleton" />
      </div>

      <div v-else-if="categories && categories.length > 0" class="sections-grid">
        <article
          v-for="(cat, idx) in categories"
          :key="cat.id"
          class="section-tile"
          :style="tileStyle(cat)"
        >
          <NuxtLink :to="`/forum/category/${cat.id}`" class="section-tile-cover">
            <span class="section-tile-id">{{ formatIssueNumber(idx + 1) }}</span>
            <div class="section-tile-icon">
              <Icon :name="resolveIcon(cat)" />
            </div>
            <h2 class="section-tile-title font-display">{{ cat.name }}</h2>
            <p class="section-tile-desc" v-if="cat.description">
              {{ cat.description }}
            </p>

            <dl class="section-tile-stats">
              <div>
                <dt>{{ $t('forum.index.stats.threads') }}</dt>
                <dd>{{ cat.topicCount }}</dd>
              </div>
              <div>
                <dt>{{ $t('forum.index.stats.posts') }}</dt>
                <dd>{{ cat.postCount }}</dd>
              </div>
              <div>
                <dt>{{ $t('forum.index.stats.last') }}</dt>
                <dd>{{ cat.lastPost ? formatAge(cat.lastPost.createdAt) : '—' }}</dd>
              </div>
            </dl>

            <div v-if="cat.lastPost" class="section-tile-last">
              <p class="last-quote">
                <Icon name="ph:quotes-bold" class="last-quote-mark" />
                {{ excerpt(cat.lastPost.content, 110) }}
              </p>
              <p class="last-byline">
                <span>{{ $t('forum.index.byline.by') }}</span>
                <strong>{{ cat.lastPost.authorUsername }}</strong>
                <span class="last-byline-sep">{{ $t('forum.index.byline.in') }}</span>
                <em class="last-thread">{{ cat.lastPost.topicTitle }}</em>
              </p>
            </div>
            <p v-else class="section-tile-empty">
              <em>{{ $t('forum.index.empty.tile') }}</em>
            </p>
          </NuxtLink>

          <div v-if="user?.isAdmin" class="section-tile-admin">
            <button
              type="button"
              class="row-action"
              :title="$t('forum.index.actions.editSection')"
              @click.prevent="openEdit(cat)"
            >
              <Icon name="ph:pencil-bold" />
            </button>
            <button
              type="button"
              class="row-action row-action--danger"
              :title="$t('forum.index.actions.deleteSection')"
              @click.prevent="confirmDelete(cat)"
            >
              <Icon name="ph:trash-bold" />
            </button>
          </div>
        </article>
      </div>

      <div v-else class="sections-empty">
        <Icon name="ph:newspaper-clipping" class="empty-icon" />
        <h3 class="empty-title font-display">{{ $t('forum.index.empty.title') }}</h3>
        <p class="empty-sub">
          {{ user?.isAdmin
            ? $t('forum.index.empty.subAdmin')
            : $t('forum.index.empty.subMember') }}
        </p>
        <button
          v-if="user?.isAdmin"
          type="button"
          class="ed-btn ed-btn--primary"
          @click="openCreate"
        >
          <Icon name="ph:plus-bold" />
          {{ $t('forum.index.actions.openFirstSection') }}
        </button>
      </div>
    </section>

    <!-- ── Latest threads (cross-category ribbon) ──────────── -->
    <section v-if="stats && stats.latest.length > 0" class="latest">
      <header class="rule-head">
        <span class="rule-eyebrow">{{ $t('forum.index.latest.title') }}</span>
        <span class="rule-line" />
        <span class="rule-counter">{{ $t('forum.index.latest.counter', { n: stats.latest.length }) }}</span>
      </header>

      <ol class="latest-list">
        <li
          v-for="(t, i) in stats.latest"
          :key="t.id"
          class="latest-item"
        >
          <NuxtLink :to="`/forum/topic/${t.id}`" class="latest-link">
            <span class="latest-num">{{ formatIssueNumber(i + 1) }}</span>
            <div class="latest-body">
              <span
                class="latest-section"
                :style="{ '--cat-color': t.category.color || 'rgb(var(--fg-muted))' }"
              >
                <Icon :name="t.category.icon || 'ph:bookmark-simple'" />
                {{ t.category.name }}
              </span>
              <h3 class="latest-title font-display">
                <Icon
                  v-if="t.isPinned"
                  name="ph:push-pin-fill"
                  class="latest-status latest-status--pin"
                  :title="$t('forum.topic.pinned')"
                />
                <Icon
                  v-else-if="t.isLocked"
                  name="ph:lock-fill"
                  class="latest-status latest-status--lock"
                  :title="$t('forum.topic.locked')"
                />
                {{ t.title }}
              </h3>
              <p class="latest-meta">
                <span>{{ $t('forum.index.byline.by') }}</span>
                <strong>{{ t.author.username }}</strong>
                <span class="latest-meta-sep">·</span>
                <span>{{ formatAge(t.updatedAt) }}</span>
                <span class="latest-meta-sep">·</span>
                <span>{{ $t('forum.topic.replies', { n: t.replyCount }) }}</span>
              </p>
            </div>
            <Icon name="ph:arrow-right-bold" class="latest-arrow" />
          </NuxtLink>
        </li>
      </ol>
    </section>

    <!-- ── Modals (create/edit/delete) ─────────────────────── -->
    <Modal v-model="showCreate" :title="$t('forum.index.modals.createTitle')" size="md">
      <CategoryForm v-model="createForm" />
      <template #footer>
        <button type="button" class="ed-btn" @click="showCreate = false">
          {{ $t('common.cancel') }}
        </button>
        <button
          type="button"
          class="ed-btn ed-btn--primary"
          :disabled="creating || !createForm.name.trim()"
          @click="handleCreate"
        >
          <Icon
            v-if="creating"
            name="ph:circle-notch"
            class="animate-spin"
          />
          {{ creating ? $t('forum.index.actions.opening') : $t('forum.index.actions.openSection') }}
        </button>
      </template>
    </Modal>

    <Modal v-model="showEdit" :title="$t('forum.index.modals.editTitle')" size="md">
      <CategoryForm v-model="editForm" />
      <template #footer>
        <button type="button" class="ed-btn" @click="showEdit = false">
          {{ $t('common.cancel') }}
        </button>
        <button
          type="button"
          class="ed-btn ed-btn--primary"
          :disabled="updating || !editForm.name.trim()"
          @click="handleUpdate"
        >
          <Icon
            v-if="updating"
            name="ph:circle-notch"
            class="animate-spin"
          />
          {{ updating ? $t('forum.index.actions.saving') : $t('common.saveChanges') }}
        </button>
      </template>
    </Modal>

    <Modal v-model="showDelete" :title="$t('forum.index.modals.deleteTitle')" size="sm">
      <p class="delete-blurb">
        {{ $t('forum.index.modals.deleteIntro') }}
        <strong>{{ categoryToDelete?.name }}</strong>{{ $t('forum.index.modals.deleteWarning') }}
      </p>
      <template #footer>
        <button type="button" class="ed-btn" @click="showDelete = false">
          {{ $t('common.cancel') }}
        </button>
        <button
          type="button"
          class="ed-btn ed-btn--danger"
          :disabled="deleting"
          @click="handleDelete"
        >
          <Icon
            v-if="deleting"
            name="ph:circle-notch"
            class="animate-spin"
          />
          {{ deleting ? $t('forum.index.actions.removing') : $t('forum.index.actions.deleteSection') }}
        </button>
      </template>
    </Modal>
  </div>
</template>

<script setup lang="ts">
import Modal from '~/components/Modal.vue';
import CategoryForm from '~/components/forum/CategoryForm.vue';
import { formatAge } from '~/utils/format';

interface ForumCategory {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  order: number;
  topicCount: number;
  postCount: number;
  lastTopic: {
    id: string;
    title: string;
    updatedAt: string;
    isPinned: boolean;
    isLocked: boolean;
    authorUsername: string;
  } | null;
  lastPost: {
    topicId: string;
    topicTitle: string;
    content: string;
    createdAt: string;
    authorUsername: string;
  } | null;
}

interface ForumStats {
  totals: {
    categories: number;
    topics: number;
    posts: number;
    contributors: number;
  };
  latest: Array<{
    id: string;
    title: string;
    isPinned: boolean;
    isLocked: boolean;
    updatedAt: string;
    category: {
      id: string;
      name: string;
      color: string | null;
      icon: string | null;
    };
    author: { id: string; username: string };
    replyCount: number;
  }>;
}

interface CategoryDraft {
  id?: string;
  name: string;
  description: string;
  color: string | null;
  icon: string | null;
  order: number;
}

const { t, locale } = useI18n();
const { user } = useUserSession();
const notifications = useNotificationStore();
const confirm = useConfirm();

const {
  data: categories,
  pending: catPending,
  refresh: refreshCategories,
} = await useFetch<ForumCategory[]>('/api/forum/categories');

const {
  data: stats,
  pending: statsPending,
  refresh: refreshStats,
} = await useFetch<ForumStats>('/api/forum/stats');

useHead({ title: t('forum.index.pageTitle') });

// ── Edition number: stable per day, derived from the issue's "first
// publication". We anchor at the oldest known activity (or today) and
// number issues by ISO week so the masthead reads like a real periodical.
const issueNumber = computed(() => {
  const since = new Date(2026, 0, 1).getTime();
  const week = Math.floor((Date.now() - since) / (7 * 86400_000)) + 1;
  return String(Math.max(1, week)).padStart(2, '0');
});
const todayLabel = computed(() =>
  new Date().toLocaleDateString(locale.value === 'fr' ? 'fr-FR' : 'en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
);

const lastActivity = computed(() => {
  const cands: number[] = [];
  for (const c of categories.value ?? []) {
    if (c.lastPost) cands.push(new Date(c.lastPost.createdAt).getTime());
  }
  if (cands.length === 0) return null;
  return new Date(Math.max(...cands)).toISOString();
});

// ── Helpers ──────────────────────────────────────────────────
function formatIssueNumber(n: number): string {
  return String(n).padStart(2, '0');
}
function excerpt(text: string, max: number): string {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}
function resolveIcon(cat: ForumCategory): string {
  return cat.icon || 'ph:newspaper-clipping-bold';
}
function tileStyle(cat: ForumCategory) {
  const accent = cat.color || 'rgb(var(--fg-muted))';
  return {
    '--accent': accent,
  } as Record<string, string>;
}

// ── Mutations ────────────────────────────────────────────────
const showCreate = ref(false);
const creating = ref(false);
const createForm = ref<CategoryDraft>({
  name: '',
  description: '',
  color: '#9ca3af',
  icon: 'ph:newspaper-clipping-bold',
  order: 0,
});
function openCreate() {
  createForm.value = {
    name: '',
    description: '',
    color: '#9ca3af',
    icon: 'ph:newspaper-clipping-bold',
    order: (categories.value?.length ?? 0),
  };
  showCreate.value = true;
}
async function handleCreate() {
  if (!createForm.value.name.trim()) return;
  creating.value = true;
  try {
    await $fetch('/api/forum/categories', {
      method: 'POST',
      body: {
        name: createForm.value.name.trim(),
        description: createForm.value.description?.trim() || null,
        color: createForm.value.color,
        icon: createForm.value.icon,
        order: createForm.value.order,
      },
    });
    showCreate.value = false;
    notifications.success(t('forum.index.toasts.sectionCreated'));
    await Promise.all([refreshCategories(), refreshStats()]);
  } catch (e: any) {
    notifications.error(e?.data?.message || t('forum.index.errors.createFailed'));
  } finally {
    creating.value = false;
  }
}

const showEdit = ref(false);
const updating = ref(false);
const editForm = ref<CategoryDraft>({
  name: '',
  description: '',
  color: null,
  icon: null,
  order: 0,
});
function openEdit(cat: ForumCategory) {
  editForm.value = {
    id: cat.id,
    name: cat.name,
    description: cat.description ?? '',
    color: cat.color,
    icon: cat.icon,
    order: cat.order,
  };
  showEdit.value = true;
}
async function handleUpdate() {
  if (!editForm.value.id || !editForm.value.name.trim()) return;
  updating.value = true;
  try {
    await $fetch(
      `/api/forum/categories/${editForm.value.id}` as '/api/forum/categories/:id',
      {
        method: 'PUT',
        body: {
          name: editForm.value.name.trim(),
          description: editForm.value.description?.trim() || null,
          color: editForm.value.color,
          icon: editForm.value.icon,
          order: editForm.value.order,
        },
      } as any
    );
    showEdit.value = false;
    notifications.success(t('forum.index.toasts.sectionUpdated'));
    await refreshCategories();
  } catch (e: any) {
    notifications.error(e?.data?.message || t('forum.index.errors.updateFailed'));
  } finally {
    updating.value = false;
  }
}

const showDelete = ref(false);
const deleting = ref(false);
const categoryToDelete = ref<ForumCategory | null>(null);
function confirmDelete(cat: ForumCategory) {
  categoryToDelete.value = cat;
  showDelete.value = true;
}
async function handleDelete() {
  if (!categoryToDelete.value) return;
  deleting.value = true;
  try {
    await $fetch(
      `/api/forum/categories/${categoryToDelete.value.id}` as '/api/forum/categories/:id',
      { method: 'DELETE' } as any
    );
    showDelete.value = false;
    categoryToDelete.value = null;
    notifications.success(t('forum.index.toasts.sectionDeleted'));
    await Promise.all([refreshCategories(), refreshStats()]);
  } catch (e: any) {
    notifications.error(e?.data?.message || t('forum.index.errors.deleteFailed'));
  } finally {
    deleting.value = false;
  }
}
</script>

<style scoped>
/* =============================================================================
 * Forum — newsroom edition
 *
 * Direction: editorial broadsheet × terminal BBS. The page is built around
 * a serif masthead ("THE FORUM"), a horizontal stat ribbon, then a grid
 * of section tiles that read like a magazine table of contents. A
 * "latest" ribbon at the bottom mirrors a wire-feed.
 *
 * Tokens reused: `--bg-base/surface/elevated`, `--fg-strong/muted/subtle`,
 * `--line-default/strong`, `--accent`, `--header-h`. The serif comes from
 * the `.font-display` utility (Fraunces) defined in main.css.
 * ============================================================================= */

.forum-shell {
  --rule: rgb(var(--line-default));
  --rule-strong: rgb(var(--line-strong));
  --paper: rgb(var(--bg-base));
  --ink: rgb(var(--fg-strong));
  --ink-soft: rgb(var(--fg-default));
  --ink-fade: rgb(var(--fg-muted));
  --ink-faint: rgb(var(--fg-faint));

  display: flex;
  flex-direction: column;
  gap: 3.5rem;
  padding-bottom: 4rem;
}

/* ─── Masthead ──────────────────────────────────────────────────── */
.masthead {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding: 2rem 1.5rem 2.25rem;
  border-top: 4px solid var(--ink);
  border-bottom: 1px double var(--rule-strong);
  background:
    radial-gradient(1200px 200px at 50% 0%, rgb(var(--fg-default) / 0.03), transparent 60%),
    rgb(var(--bg-surface) / 0.4);
  overflow: hidden;
}
.masthead::before {
  /* Subtle hairline above the bottom rule, in the spirit of a folio
     dotted underline used in vintage print. */
  content: '';
  position: absolute;
  inset-inline: 1.5rem;
  bottom: 0;
  height: 1px;
  background-image: linear-gradient(to right, var(--rule) 50%, transparent 0);
  background-size: 6px 1px;
  background-repeat: repeat-x;
}
.masthead-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ink-fade);
}
.masthead-eyebrow-sep {
  color: var(--ink-faint);
}
.masthead-title {
  font-weight: 800;
  letter-spacing: -0.045em;
  line-height: 0.92;
  color: var(--ink);
  font-size: clamp(3rem, 9vw, 6.5rem);
  margin: 0;
  font-variation-settings: 'opsz' 144, 'SOFT' 30;
}
.masthead-tag {
  font-size: 1rem;
  color: var(--ink-soft);
  max-width: 48ch;
  line-height: 1.55;
}
.masthead-tag em {
  font-family: 'Fraunces', serif;
  font-style: italic;
  color: var(--ink-fade);
}

.masthead-stats {
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(140px, 100%), 1fr));
  gap: 0;
  margin: 0.75rem 0 0;
  padding: 0;
  border-top: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
}
.masthead-stats li {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.85rem 1rem;
  border-right: 1px solid var(--rule);
}
.masthead-stats li:last-child {
  border-right: 0;
}
.masthead-stats.is-loading .stat-val,
.masthead-stats.is-loading .stat-val-mono {
  opacity: 0.4;
}
.stat-key {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ink-faint);
}
.stat-val {
  font-family: 'Fraunces', serif;
  font-weight: 700;
  font-size: 1.65rem;
  letter-spacing: -0.025em;
  color: var(--ink);
  font-variation-settings: 'opsz' 96;
}
.stat-val-mono {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--ink);
}
.stat-pulse {
  position: relative;
  flex-direction: row;
  align-items: center;
  gap: 0.55rem;
}
.pulse-dot {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 9999px;
  background: rgb(var(--online));
  box-shadow: 0 0 0 0 rgb(var(--online) / 0.6);
  animation: pulse 2.4s infinite ease-out;
}
@keyframes pulse {
  0%   { box-shadow: 0 0 0 0 rgb(var(--online) / 0.55); }
  60%  { box-shadow: 0 0 0 0.65rem rgb(var(--online) / 0); }
  100% { box-shadow: 0 0 0 0 rgb(var(--online) / 0); }
}
.stat-pulse .stat-key {
  flex: none;
}
.stat-pulse .stat-val-mono {
  margin-left: auto;
}

.masthead-tools {
  display: flex;
  justify-content: flex-end;
}

/* ─── Editorial buttons ─────────────────────────────────────── */
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
  border: 1px solid var(--rule-strong);
  background: rgb(var(--bg-elevated));
  color: var(--ink-soft);
  cursor: pointer;
  border-radius: 2px;
  transition: all 0.15s;
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
  background: rgb(var(--danger));
  color: #fff;
  border-color: rgb(var(--danger));
}
.ed-btn--danger:hover:not(:disabled) {
  background: rgb(var(--danger) / 0.85);
  border-color: rgb(var(--danger) / 0.85);
}

/* ─── Rule head (used between sections) ───────────────────── */
.rule-head {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  margin-bottom: 1.25rem;
}
.rule-eyebrow {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--ink-soft);
}
.rule-line {
  flex: 1;
  height: 1px;
  background: var(--rule);
}
.rule-counter {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  letter-spacing: 0.16em;
  color: var(--ink-faint);
  text-transform: uppercase;
}

/* ─── Section tiles ─────────────────────────────────────────── */
.sections-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr));
  gap: 1rem;
}
.section-tile {
  position: relative;
  background: rgb(var(--bg-surface));
  border: 1px solid var(--rule);
  border-left: 3px solid color-mix(in srgb, var(--accent) 80%, transparent);
  border-radius: 4px;
  transition: border-color 0.18s, transform 0.18s;
}
.section-tile:hover {
  border-color: var(--rule-strong);
  border-left-color: var(--accent);
  transform: translateY(-1px);
}
.section-tile--skeleton {
  min-height: 12rem;
  border-left-color: var(--rule);
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
.section-tile-cover {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1.4rem 1.5rem 1.5rem;
  text-decoration: none;
  color: inherit;
}
.section-tile-id {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.22em;
  color: var(--accent);
  text-transform: uppercase;
}
.section-tile-icon {
  width: 2.6rem;
  height: 2.6rem;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1.4rem;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
}
.section-tile-title {
  margin: 0;
  font-size: 1.65rem;
  line-height: 1.05;
  letter-spacing: -0.025em;
  color: var(--ink);
  font-weight: 700;
  font-variation-settings: 'opsz' 96, 'SOFT' 50;
}
.section-tile-desc {
  font-size: 0.9rem;
  line-height: 1.45;
  color: var(--ink-soft);
  margin: 0;
}
.section-tile-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  border-top: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
  margin: 0.5rem 0 0;
  padding: 0;
}
.section-tile-stats > div {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.55rem 0.75rem;
  border-right: 1px solid var(--rule);
}
.section-tile-stats > div:last-child {
  border-right: 0;
}
.section-tile-stats dt {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ink-faint);
}
.section-tile-stats dd {
  margin: 0;
  font-family: 'Fraunces', serif;
  font-weight: 700;
  font-size: 1.05rem;
  color: var(--ink);
  font-variation-settings: 'opsz' 48;
}
.section-tile-last {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.last-quote {
  position: relative;
  margin: 0;
  padding-left: 1.4rem;
  font-family: 'Fraunces', serif;
  font-style: italic;
  font-size: 0.92rem;
  line-height: 1.5;
  color: var(--ink-soft);
  font-variation-settings: 'opsz' 14;
}
.last-quote-mark {
  position: absolute;
  left: 0;
  top: 0.05rem;
  color: var(--accent);
  font-size: 0.95rem;
}
.last-byline {
  margin: 0;
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.3rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  letter-spacing: 0.06em;
  color: var(--ink-fade);
  text-transform: uppercase;
}
.last-byline strong {
  color: var(--ink);
  font-weight: 700;
}
.last-byline-sep {
  color: var(--ink-faint);
}
.last-thread {
  font-style: italic;
  color: var(--ink-soft);
  letter-spacing: 0;
  text-transform: none;
}
.section-tile-empty {
  margin: 0;
  font-family: 'Fraunces', serif;
  color: var(--ink-faint);
  font-size: 0.95rem;
}
.section-tile-admin {
  position: absolute;
  top: 0.75rem;
  right: 0.75rem;
  display: flex;
  gap: 0.3rem;
  opacity: 0;
  transition: opacity 0.15s;
}
.section-tile:hover .section-tile-admin,
.section-tile:focus-within .section-tile-admin {
  opacity: 1;
}
.row-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 4px;
  border: 1px solid var(--rule);
  background: rgb(var(--bg-elevated));
  color: var(--ink-fade);
  cursor: pointer;
  transition: all 0.12s;
}
.row-action:hover {
  border-color: var(--rule-strong);
  color: var(--ink);
}
.row-action--danger:hover {
  border-color: rgb(var(--danger) / 0.5);
  color: rgb(var(--danger));
  background: rgb(var(--danger) / 0.08);
}
@media (max-width: 640px) {
  .section-tile-admin {
    opacity: 1;
  }
}

/* ─── Sections empty state ─────────────────────────────────── */
.sections-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  text-align: center;
  padding: 3rem 1.5rem;
  border: 1px dashed var(--rule);
  border-radius: 4px;
}
.empty-icon {
  font-size: 2.5rem;
  color: var(--ink-faint);
}
.empty-title {
  margin: 0;
  font-size: 1.6rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--ink);
  font-variation-settings: 'opsz' 96;
}
.empty-sub {
  margin: 0;
  font-size: 0.95rem;
  color: var(--ink-fade);
  max-width: 36ch;
}

/* ─── Latest ribbon ─────────────────────────────────────────── */
.latest-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--rule);
}
.latest-item {
  border-bottom: 1px solid var(--rule);
}
.latest-link {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 1rem;
  padding: 0.85rem 0.5rem;
  text-decoration: none;
  color: inherit;
  transition: background 0.12s;
}
.latest-link:hover {
  background: rgb(var(--fg-default) / 0.03);
}
.latest-num {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  letter-spacing: 0.16em;
  color: var(--ink-faint);
}
.latest-body {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}
.latest-section {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--cat-color);
  width: max-content;
}
.latest-title {
  margin: 0;
  font-size: 1.12rem;
  line-height: 1.25;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--ink);
  font-variation-settings: 'opsz' 48;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.latest-status {
  font-size: 0.9rem;
}
.latest-status--pin { color: var(--ink); }
.latest-status--lock { color: var(--ink-fade); }
.latest-meta {
  margin: 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  letter-spacing: 0.06em;
  color: var(--ink-fade);
  text-transform: uppercase;
  display: flex;
  align-items: center;
  gap: 0.3rem;
  flex-wrap: wrap;
}
.latest-meta strong {
  color: var(--ink);
  font-weight: 700;
}
.latest-meta-sep {
  color: var(--ink-faint);
}
.latest-arrow {
  font-size: 1rem;
  color: var(--ink-faint);
  transition: transform 0.18s, color 0.18s;
}
.latest-link:hover .latest-arrow {
  color: var(--ink);
  transform: translateX(2px);
}

/* ─── Modal helpers ─────────────────────────────────────────── */
.delete-blurb {
  margin: 0;
  font-family: 'Fraunces', serif;
  font-size: 1rem;
  line-height: 1.55;
  color: var(--ink-soft);
}
.delete-blurb strong {
  font-weight: 700;
  color: var(--ink);
}

@media (max-width: 640px) {
  .masthead {
    padding: 1.5rem 1rem 1.75rem;
  }
  .masthead-stats li {
    border-right: 0;
    border-bottom: 1px solid var(--rule);
  }
  .masthead-stats li:last-child {
    border-bottom: 0;
  }
  .latest-link {
    grid-template-columns: auto 1fr;
  }
  .latest-arrow {
    display: none;
  }
}
</style>
