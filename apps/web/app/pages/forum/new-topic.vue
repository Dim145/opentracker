<template>
  <div class="compose-shell">
    <!-- Crumb -->
    <nav class="compose-crumb">
      <NuxtLink to="/forum" class="compose-crumb-link">{{ $t('forum.theForum') }}</NuxtLink>
      <Icon name="ph:caret-right-bold" class="compose-crumb-sep" />
      <NuxtLink
        v-if="selectedCategory"
        :to="`/forum/category/${selectedCategory.id}`"
        class="compose-crumb-link"
      >
        {{ selectedCategory.name }}
      </NuxtLink>
      <Icon
        v-if="selectedCategory"
        name="ph:caret-right-bold"
        class="compose-crumb-sep"
      />
      <span class="compose-crumb-leaf">{{ $t('forum.newTopic.crumbLeaf') }}</span>
    </nav>

    <!-- Hero -->
    <header class="compose-head">
      <p class="compose-eyebrow">
        {{ $t('forum.newTopic.filingFor') }}
        <span class="compose-eyebrow-cat">
          <Icon
            v-if="selectedCategory?.icon"
            :name="selectedCategory.icon"
            class="compose-eyebrow-icon"
            :style="{ color: selectedCategory.color || 'inherit' }"
          />
          {{ selectedCategory?.name || $t('forum.newTopic.pickSectionEyebrow') }}
        </span>
      </p>
      <h1 class="compose-title font-display">{{ $t('forum.newTopic.title') }}</h1>
      <p class="compose-blurb">
        {{ $t('forum.newTopic.blurb') }}
        <em>{{ $t('forum.newTopic.markdownHint') }}</em>
      </p>
    </header>

    <!-- Form + preview -->
    <div class="compose-grid">
      <form class="compose-form" @submit.prevent="handleSubmit">
        <div class="compose-row">
          <label class="compose-label">
            <span>{{ $t('forum.newTopic.fields.section') }}</span>
            <div class="cat-picker">
              <button
                v-for="cat in categories ?? []"
                :key="cat.id"
                type="button"
                class="cat-tile"
                :class="{ 'cat-tile--on': form.categoryId === cat.id }"
                :style="catTileStyle(cat)"
                @click="form.categoryId = cat.id"
              >
                <Icon :name="cat.icon || 'ph:newspaper-clipping-bold'" />
                <span>{{ cat.name }}</span>
              </button>
            </div>
          </label>
        </div>

        <div class="compose-row">
          <label class="compose-label">
            <span>{{ $t('forum.newTopic.fields.headline') }}</span>
            <input
              v-model="form.title"
              type="text"
              class="compose-title-input font-display"
              :placeholder="$t('forum.newTopic.fields.headlinePlaceholder')"
              maxlength="200"
              autocomplete="off"
            />
            <span class="compose-counter">{{ form.title.length }} / 200</span>
          </label>
        </div>

        <div class="compose-row">
          <label class="compose-label">
            <span>{{ $t('forum.newTopic.fields.body') }}</span>
            <textarea
              v-model="form.content"
              class="compose-input"
              :placeholder="$t('forum.newTopic.fields.bodyPlaceholder')"
              maxlength="50000"
              rows="14"
            />
            <span class="compose-counter">
              {{ form.content.length }} / 50000
            </span>
          </label>
        </div>

        <div class="compose-actions">
          <button type="button" class="ed-btn" @click="router.back()">
            {{ $t('common.discard') }}
          </button>
          <button
            type="submit"
            class="ed-btn ed-btn--primary"
            :disabled="!isValid || submitting"
          >
            <Icon
              v-if="submitting"
              name="ph:circle-notch"
              class="animate-spin"
            />
            <Icon v-else name="ph:feather-bold" />
            {{ submitting ? $t('forum.newTopic.filing') : $t('forum.newTopic.fileThread') }}
          </button>
        </div>
      </form>

      <!-- Live preview — mirrors the published article header + body. -->
      <aside class="compose-preview">
        <p class="preview-eyebrow">{{ $t('forum.newTopic.preview.eyebrow') }}</p>
        <div class="preview-card">
          <p
            class="preview-section"
            :style="{
              '--cat-color':
                selectedCategory?.color || 'rgb(var(--fg-muted))',
            }"
          >
            <Icon
              :name="selectedCategory?.icon || 'ph:bookmark-simple'"
              class="preview-section-icon"
            />
            {{ selectedCategory?.name || $t('forum.newTopic.preview.pickSection') }}
          </p>
          <h2 class="preview-title font-display">
            {{ form.title.trim() || $t('forum.newTopic.preview.headlinePlaceholder') }}
          </h2>
          <p class="preview-byline">
            <span>{{ $t('forum.topic.byline.by') }}</span>
            <strong>{{ user?.username || $t('forum.newTopic.preview.youFallback') }}</strong>
            <span class="preview-byline-sep">·</span>
            <span>{{ $t('me.relativeTime.justNow') }}</span>
          </p>
          <PostBody
            v-if="form.content.trim()"
            :content="form.content"
            class="preview-body"
          />
          <p v-else class="preview-empty">
            <em>{{ $t('forum.newTopic.preview.empty') }}</em>
          </p>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import PostBody from '~/components/forum/PostBody.vue';

interface Category {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
}

const router = useRouter();
const route = useRoute();
const { user } = useUserSession();
const notifications = useNotificationStore();
const { t } = useI18n();

const { data: categories } = await useFetch<Category[]>(
  '/api/forum/categories'
);

useHead({ title: t('forum.newTopic.headTitle') });

const form = ref({
  categoryId: (route.query.categoryId as string) || '',
  title: '',
  content: '',
});

const submitting = ref(false);

const selectedCategory = computed(() =>
  (categories.value ?? []).find((c) => c.id === form.value.categoryId) ?? null
);

const isValid = computed(
  () =>
    Boolean(form.value.categoryId) &&
    form.value.title.trim().length > 0 &&
    form.value.content.trim().length > 0
);

function catTileStyle(cat: Category) {
  const accent = cat.color || 'rgb(var(--fg-muted))';
  return { '--accent': accent } as Record<string, string>;
}

async function handleSubmit() {
  if (!isValid.value) return;
  submitting.value = true;
  try {
    const topic = await $fetch<{ id: string } | null>('/api/forum/topics', {
      method: 'POST',
      body: {
        categoryId: form.value.categoryId,
        title: form.value.title.trim(),
        content: form.value.content,
      },
    });
    if (topic?.id) {
      router.push(`/forum/topic/${topic.id}`);
    }
  } catch (e: any) {
    notifications.error(e?.data?.message || t('forum.newTopic.errors.fileThread'));
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
.compose-shell {
  --rule: rgb(var(--line-default));
  --rule-strong: rgb(var(--line-strong));
  --ink: rgb(var(--fg-strong));
  --ink-soft: rgb(var(--fg-default));
  --ink-fade: rgb(var(--fg-muted));
  --ink-faint: rgb(var(--fg-faint));

  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding-bottom: 4rem;
  max-width: 78rem;
  margin: 0 auto;
}

.compose-crumb {
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
.compose-crumb-link {
  color: var(--ink-fade);
  text-decoration: none;
  transition: color 0.12s;
}
.compose-crumb-link:hover {
  color: var(--ink);
}
.compose-crumb-sep {
  font-size: 0.7rem;
  color: var(--ink-faint);
}
.compose-crumb-leaf {
  color: var(--ink);
}

.compose-head {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 1.25rem 0 1.5rem;
  border-bottom: 1px double var(--rule-strong);
}
.compose-eyebrow {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--ink-fade);
  margin: 0;
}
.compose-eyebrow-cat {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--ink);
}
.compose-eyebrow-icon {
  font-size: 0.95rem;
}
.compose-title {
  margin: 0;
  font-size: clamp(2.25rem, 5.5vw, 3.5rem);
  line-height: 1;
  letter-spacing: -0.035em;
  font-weight: 800;
  color: var(--ink);
  font-variation-settings: 'opsz' 144, 'SOFT' 30;
}
.compose-blurb {
  margin: 0;
  font-family: 'Fraunces', serif;
  font-size: 0.98rem;
  line-height: 1.55;
  color: var(--ink-soft);
  max-width: 60ch;
  font-variation-settings: 'opsz' 14;
}
.compose-blurb em {
  color: var(--ink-fade);
  font-style: italic;
}

.compose-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  gap: 1.5rem;
  margin-top: 0.5rem;
}

@media (max-width: 960px) {
  .compose-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

/* ─── Form column ────────────────────────────────────────── */
.compose-form {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding: 1.25rem 1.4rem 1.5rem;
  background: rgb(var(--bg-surface));
  border: 1px solid var(--rule);
  border-top: 3px solid var(--ink);
  border-radius: 4px;
}
.compose-row {
  display: flex;
  flex-direction: column;
}
.compose-label {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--ink-faint);
}

.cat-picker {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.cat-tile {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 0.85rem;
  border: 1px solid var(--rule);
  border-radius: 4px;
  background: rgb(var(--bg-elevated));
  color: var(--ink-fade);
  cursor: pointer;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  transition: all 0.12s;
}
.cat-tile:hover {
  border-color: var(--rule-strong);
  color: var(--ink);
}
.cat-tile--on {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  border-color: var(--accent);
  color: var(--ink);
}
.cat-tile--on > svg {
  color: var(--accent);
}

.compose-title-input {
  width: 100%;
  font-family: 'Fraunces', serif;
  font-weight: 700;
  font-size: 1.4rem;
  letter-spacing: -0.02em;
  color: var(--ink);
  background: rgb(var(--bg-base));
  border: 1px solid var(--rule);
  border-radius: 4px;
  padding: 0.75rem 0.95rem;
  font-variation-settings: 'opsz' 48;
}
.compose-title-input:focus {
  outline: none;
  border-color: var(--ink);
}

.compose-input {
  width: 100%;
  font-family: 'Inter', sans-serif;
  font-size: 0.95rem;
  line-height: 1.55;
  letter-spacing: 0;
  text-transform: none;
  font-weight: 400;
  background: rgb(var(--bg-base));
  border: 1px solid var(--rule);
  border-radius: 4px;
  padding: 0.85rem 1rem;
  color: var(--ink);
  resize: vertical;
}
.compose-input:focus {
  outline: none;
  border-color: var(--ink);
}
.compose-counter {
  align-self: flex-end;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--ink-faint);
  text-transform: uppercase;
}

.compose-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--rule);
}

/* ─── Preview column ─────────────────────────────────────── */
.compose-preview {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  position: sticky;
  top: calc(var(--header-h) + 1rem);
  align-self: start;
}
.preview-eyebrow {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--ink-fade);
  margin: 0;
}
.preview-card {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1.4rem 1.5rem;
  background:
    radial-gradient(800px 200px at 0 0, rgb(var(--fg-default) / 0.04), transparent 60%),
    rgb(var(--bg-surface));
  border: 1px solid var(--rule);
  border-radius: 4px;
  border-top: 4px solid var(--ink);
}
.preview-section {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--cat-color);
  width: max-content;
}
.preview-section-icon {
  font-size: 0.95rem;
}
.preview-title {
  margin: 0;
  font-size: clamp(1.55rem, 3.5vw, 2.2rem);
  line-height: 1.05;
  letter-spacing: -0.025em;
  font-weight: 700;
  color: var(--ink);
  font-variation-settings: 'opsz' 96, 'SOFT' 30;
  word-break: break-word;
}
.preview-byline {
  margin: 0;
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.35rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-fade);
}
.preview-byline strong {
  color: var(--ink);
  font-weight: 700;
}
.preview-byline-sep {
  color: var(--ink-faint);
}
.preview-body {
  border-top: 1px solid var(--rule);
  padding-top: 0.75rem;
}
.preview-empty {
  margin: 0;
  font-family: 'Fraunces', serif;
  font-style: italic;
  color: var(--ink-faint);
  font-size: 0.95rem;
  font-variation-settings: 'opsz' 14;
}

/* ─── Editorial buttons ──────────────────────────────────── */
.ed-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.5rem 0.9rem;
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
</style>
