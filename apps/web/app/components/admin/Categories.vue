<template>
  <!--
    /admin/categories — atlas.

    The page is laid out like an encyclopaedia's index page: each
    category is an "entry" with a call-number panel on the left
    (the Newznab id), a typeset name, and a strip of attributes
    (slug, type, adult flag). Roots and their children are held
    together by a left rail that threads the subcategories under
    their parent, so the hierarchy reads at a glance without
    needing a heavy table.

    The header keeps a live stats strip (roots / subs / types /
    adult count) so the operator sees the shape of the taxonomy
    without scrolling, plus a search field that filters in real
    time and auto-expands any parent whose subcategory matches.
  -->
  <div class="adm">
    <!-- ── Header ───────────────────────────────────────────── -->
    <header class="atlas-head">
      <div class="atlas-head-id">
        <span class="atlas-eyebrow">
          <span class="atlas-eyebrow-rule" aria-hidden="true" />
          {{ $t('admin.categories.eyebrow') }}
        </span>
        <h1 class="atlas-title">{{ $t('admin.categories.title') }}</h1>
        <p class="atlas-intro">{{ $t('admin.categories.intro') }}</p>
      </div>
      <button
        v-if="categories?.length"
        type="button"
        class="atlas-cta"
        @click="openCreate(null)"
      >
        <Icon name="ph:plus-bold" />
        <span>{{ $t('admin.categories.newCategory') }}</span>
      </button>
    </header>

    <!-- ── Stats strip ─────────────────────────────────────── -->
    <section v-if="categories?.length" class="atlas-stats">
      <div class="stat">
        <span class="stat-num tabular-nums">{{ stats.roots }}</span>
        <span class="stat-label">{{ $t('admin.categories.stats.roots') }}</span>
      </div>
      <div class="stat-divider" aria-hidden="true" />
      <div class="stat">
        <span class="stat-num tabular-nums">{{ stats.subs }}</span>
        <span class="stat-label">{{ $t('admin.categories.stats.subs') }}</span>
      </div>
      <div class="stat-divider" aria-hidden="true" />
      <div class="stat stat--movie">
        <Icon name="ph:film-strip-bold" class="stat-icon" />
        <span class="stat-num tabular-nums">{{ stats.movies }}</span>
        <span class="stat-label">{{ $t('admin.categories.stats.movies') }}</span>
      </div>
      <div class="stat stat--tv">
        <Icon name="ph:television-bold" class="stat-icon" />
        <span class="stat-num tabular-nums">{{ stats.tv }}</span>
        <span class="stat-label">{{ $t('admin.categories.stats.tv') }}</span>
      </div>
      <div class="stat stat--game">
        <Icon name="ph:game-controller-bold" class="stat-icon" />
        <span class="stat-num tabular-nums">{{ stats.games }}</span>
        <span class="stat-label">{{ $t('admin.categories.stats.games') }}</span>
      </div>
      <div v-if="stats.adult > 0" class="stat stat--adult">
        <Icon name="ph:eye-slash-bold" class="stat-icon" />
        <span class="stat-num tabular-nums">{{ stats.adult }}</span>
        <span class="stat-label">{{ $t('admin.categories.stats.adult') }}</span>
      </div>
    </section>

    <!-- ── Search field ────────────────────────────────────── -->
    <section v-if="categories?.length" class="atlas-toolbar">
      <label class="search">
        <Icon name="ph:magnifying-glass-bold" class="search-icon" />
        <input
          v-model="searchQuery"
          type="search"
          class="search-input"
          :placeholder="$t('admin.categories.searchPlaceholder')"
          :aria-label="$t('admin.categories.searchAria')"
        />
        <button
          v-if="searchQuery"
          type="button"
          class="search-clear"
          :aria-label="$t('admin.categories.searchClear')"
          @click="searchQuery = ''"
        >
          <Icon name="ph:x-bold" />
        </button>
      </label>
      <span v-if="searchQuery" class="search-hits tabular-nums">
        {{ $t('admin.categories.searchResults', { n: filteredFlatCount }) }}
      </span>
    </section>

    <!-- ── Empty state — only the seeder shortcut ───────────── -->
    <section
      v-if="!categories || categories.length === 0"
      class="atlas-empty"
    >
      <div class="atlas-empty-stamp" aria-hidden="true">
        <Icon name="ph:tag-simple-bold" />
      </div>
      <h2 class="atlas-empty-title">
        {{ $t('admin.categories.empty.title') }}
      </h2>
      <p class="atlas-empty-hint">
        {{ $t('admin.categories.empty.hint') }}
      </p>
      <button
        type="button"
        class="atlas-empty-cta"
        :disabled="isSeeding"
        @click="seedCategories"
      >
        <Icon
          :name="isSeeding ? 'ph:circle-notch' : 'ph:plant-bold'"
          :class="isSeeding ? 'spin' : ''"
        />
        <span>{{ $t('admin.categories.empty.seedCta') }}</span>
      </button>
    </section>

    <!-- ── Search no-results ───────────────────────────────── -->
    <section
      v-else-if="searchQuery && filteredCategories.length === 0"
      class="atlas-noresults"
    >
      <Icon name="ph:binoculars-bold" class="atlas-noresults-icon" />
      <p>{{ $t('admin.categories.noResults', { q: searchQuery }) }}</p>
    </section>

    <!-- ── Atlas entries ──────────────────────────────────── -->
    <ul v-else class="entries">
      <li
        v-for="(category, index) in filteredCategories"
        :key="category.id"
        class="entry"
        :class="{
          'entry--adult': category.isAdult,
          'entry--expanded': expandedCategories.has(category.id),
        }"
        :style="{ '--stagger': `${Math.min(index, 16) * 40}ms` }"
      >
        <!-- ── Root row ─────────────────────────────────── -->
        <div class="entry-row entry-row--root">
          <!-- Call-number panel — the Newznab id reads like a
               library reference code. -->
          <span
            class="entry-code"
            :class="{ 'entry-code--missing': !category.newznabId }"
          >
            <span v-if="category.newznabId" class="entry-code-num">
              {{ category.newznabId }}
            </span>
            <span v-else class="entry-code-dash">—</span>
          </span>

          <!-- Identity column — the headline of the entry. -->
          <div class="entry-id">
            <h2 class="entry-name">{{ category.name }}</h2>
            <div class="entry-attrs">
              <code class="entry-slug">/{{ category.slug }}</code>
              <CategoryTypeBadge :type="category.type" />
              <span v-if="category.isAdult" class="entry-flag entry-flag--adult">
                <Icon name="ph:eye-slash-fill" />
                {{ $t('admin.categories.row.adultBadge') }}
              </span>
              <span
                v-if="category.subcategories?.length"
                class="entry-flag entry-flag--children"
              >
                <Icon name="ph:tree-structure-bold" />
                {{ $t('admin.categories.row.subCount', { n: category.subcategories.length }) }}
              </span>
            </div>
          </div>

          <!-- Action cluster — expand toggle (if has children),
               then edit / delete. -->
          <div class="entry-actions">
            <button
              v-if="category.subcategories?.length"
              type="button"
              class="entry-toggle"
              :class="{ 'entry-toggle--open': expandedCategories.has(category.id) }"
              :aria-expanded="expandedCategories.has(category.id)"
              :aria-label="$t('admin.categories.row.toggleChildren')"
              @click="toggleCategory(category.id)"
            >
              <Icon name="ph:caret-down-bold" />
            </button>
            <button
              type="button"
              class="entry-act entry-act--edit"
              :aria-label="$t('admin.categories.row.editCategory')"
              :title="$t('admin.categories.row.editCategory')"
              @click="openEdit(category)"
            >
              <Icon name="ph:pencil-simple-bold" />
            </button>
            <button
              type="button"
              class="entry-act entry-act--add"
              :aria-label="$t('admin.categories.row.addChild')"
              :title="$t('admin.categories.row.addChild')"
              @click="openCreate(category.id)"
            >
              <Icon name="ph:plus-bold" />
            </button>
            <button
              type="button"
              class="entry-act entry-act--delete"
              :aria-label="$t('admin.categories.row.deleteCategory')"
              :title="$t('admin.categories.row.deleteCategory')"
              @click="deleteCategory(category.id)"
            >
              <Icon name="ph:trash-bold" />
            </button>
          </div>
        </div>

        <!-- ── Subcategories — threaded under the parent ──── -->
        <transition name="expand">
          <ul
            v-if="
              category.subcategories?.length &&
              expandedCategories.has(category.id)
            "
            class="entry-children"
          >
            <li
              v-for="(sub, subIndex) in visibleSubs(category)"
              :key="sub.id"
              class="entry"
              :class="{ 'entry--adult': sub.isAdult }"
              :style="{ '--stagger': `${subIndex * 25}ms` }"
            >
              <div class="entry-row entry-row--sub">
                <span class="entry-thread" aria-hidden="true" />
                <span
                  class="entry-code entry-code--sub"
                  :class="{ 'entry-code--missing': !sub.newznabId }"
                >
                  <span v-if="sub.newznabId" class="entry-code-num">
                    {{ sub.newznabId }}
                  </span>
                  <span v-else class="entry-code-dash">—</span>
                </span>
                <div class="entry-id">
                  <h3 class="entry-name entry-name--sub">{{ sub.name }}</h3>
                  <div class="entry-attrs">
                    <code class="entry-slug">/{{ sub.slug }}</code>
                    <CategoryTypeBadge :type="sub.type" />
                    <span v-if="sub.isAdult" class="entry-flag entry-flag--adult">
                      <Icon name="ph:eye-slash-fill" />
                      {{ $t('admin.categories.row.adultBadge') }}
                    </span>
                  </div>
                </div>
                <div class="entry-actions">
                  <button
                    type="button"
                    class="entry-act entry-act--edit"
                    :aria-label="$t('admin.categories.row.editSubcategory')"
                    :title="$t('admin.categories.row.editSubcategory')"
                    @click="openEdit(sub)"
                  >
                    <Icon name="ph:pencil-simple-bold" />
                  </button>
                  <button
                    type="button"
                    class="entry-act entry-act--delete"
                    :aria-label="$t('admin.categories.row.deleteSubcategory')"
                    :title="$t('admin.categories.row.deleteSubcategory')"
                    @click="deleteCategory(sub.id)"
                  >
                    <Icon name="ph:trash-bold" />
                  </button>
                </div>
              </div>
            </li>
          </ul>
        </transition>
      </li>
    </ul>

    <!-- ── Create / edit modal — bespoke atlas-style editor ──── -->
    <Modal
      v-model="modalOpen"
      :title="editing.id ? $t('admin.categories.editTitles.edit') : $t('admin.categories.editTitles.create')"
      icon="ph:folders-bold"
      size="lg"
      :persistent="saving"
      bodyClass="!p-0"
    >
      <form class="ed" @submit.prevent="submit">
        <!-- ── Live preview — operator sees the catalog card they
             are about to commit, updates as they type. ─────── -->
        <section class="ed-preview">
          <span class="ed-eyebrow">
            <span class="ed-eyebrow-rule" aria-hidden="true" />
            {{ editing.id ? $t('admin.categories.modal.previewEditing') : $t('admin.categories.modal.previewCreating') }}
          </span>
          <div
            class="ed-card"
            :class="{ 'ed-card--adult': form.isAdult }"
          >
            <span
              class="ed-card-code"
              :class="{ 'ed-card-code--missing': !form.newznabId }"
            >
              <span v-if="form.newznabId" class="ed-card-code-num">
                {{ form.newznabId }}
              </span>
              <span v-else class="ed-card-code-dash">—</span>
            </span>
            <div class="ed-card-id">
              <h3 class="ed-card-name">
                {{ form.name || $t('admin.categories.modal.previewUntitled') }}
              </h3>
              <div class="ed-card-attrs">
                <code class="ed-card-slug">/{{ slugPreview }}</code>
                <CategoryTypeBadge :type="form.type ?? null" />
                <span v-if="form.isAdult" class="ed-card-flag">
                  <Icon name="ph:eye-slash-fill" />
                  {{ $t('admin.categories.row.adultBadge') }}
                </span>
              </div>
            </div>
          </div>
        </section>

        <!-- ── Numbered control sections ──────────────────── -->
        <div class="ed-body">
          <fieldset class="ed-block">
            <header class="ed-block-head">
              <span class="ed-num">01</span>
              <div class="ed-block-id">
                <h4>{{ $t('admin.categories.fields.name') }}</h4>
              </div>
            </header>
            <input
              ref="nameRef"
              v-model="form.name"
              type="text"
              maxlength="100"
              :placeholder="$t('admin.categories.fields.namePlaceholder')"
              class="ed-input"
              :disabled="saving"
            />
            <p class="ed-hint">
              {{ $t('admin.categories.fields.slug') }}
              <code class="ed-slug">{{ slugPreview }}</code>
            </p>
          </fieldset>

          <fieldset
            v-if="!editing.id || !editing.parentId"
            class="ed-block"
          >
            <header class="ed-block-head">
              <span class="ed-num">02</span>
              <div class="ed-block-id">
                <h4>{{ $t('admin.categories.fields.parent') }}</h4>
              </div>
            </header>
            <div class="ed-select-wrap">
              <select
                v-model="form.parentId"
                class="ed-input ed-input--select"
                :disabled="!!editing.id || saving"
              >
                <option :value="null">{{ $t('admin.categories.fields.rootCategory') }}</option>
                <option
                  v-for="root in rootCategories"
                  :key="root.id"
                  :value="root.id"
                >
                  ↳ {{ root.name }}
                </option>
              </select>
              <Icon name="ph:caret-down-bold" class="ed-select-caret" />
            </div>
            <p v-if="editing.id" class="ed-hint">
              {{ $t('admin.categories.fields.parentReassignHint') }}
            </p>
          </fieldset>

          <fieldset class="ed-block">
            <header class="ed-block-head">
              <span class="ed-num">{{ editing.id && editing.parentId ? '02' : '03' }}</span>
              <div class="ed-block-id">
                <h4>{{ $t('admin.categories.fields.newznabId') }}</h4>
              </div>
            </header>
            <input
              v-model.number="form.newznabId"
              type="number"
              min="1000"
              max="199999"
              :placeholder="$t('admin.categories.fields.newznabIdPlaceholder')"
              class="ed-input ed-input--mono"
              :disabled="saving"
            />
            <p class="ed-hint">
              {{ $t('admin.categories.fields.newznabIdHintShort') }}
            </p>
          </fieldset>

          <fieldset class="ed-block">
            <header class="ed-block-head">
              <span class="ed-num">{{ editing.id && editing.parentId ? '03' : '04' }}</span>
              <div class="ed-block-id">
                <h4>{{ $t('admin.categories.fields.mediaType') }}</h4>
              </div>
            </header>
            <div class="ed-types" role="radiogroup">
              <label
                v-for="opt in TYPE_OPTIONS"
                :key="opt.value ?? 'none'"
                class="ed-type"
                :class="{ 'ed-type--on': form.type === opt.value }"
                :title="opt.sub"
              >
                <input
                  type="radio"
                  :checked="form.type === opt.value"
                  :disabled="saving"
                  @change="form.type = opt.value"
                />
                <Icon :name="opt.icon" class="ed-type-icon" />
                <span class="ed-type-head">{{ opt.label }}</span>
              </label>
            </div>
            <p class="ed-hint">
              {{ $t('admin.categories.fields.mediaTypeHintShort') }}
            </p>
          </fieldset>

          <fieldset class="ed-block">
            <header class="ed-block-head">
              <span class="ed-num">{{ editing.id && editing.parentId ? '04' : '05' }}</span>
              <div class="ed-block-id">
                <h4>{{ $t('admin.categories.adult.title') }}</h4>
              </div>
            </header>
            <label
              class="ed-adult"
              :class="{ 'ed-adult--on': form.isAdult }"
            >
              <button
                type="button"
                role="switch"
                :aria-checked="form.isAdult"
                class="ed-toggle"
                :class="{ 'ed-toggle--on': form.isAdult }"
                :disabled="saving"
                @click="form.isAdult = !form.isAdult"
              >
                <span class="ed-toggle-knob" />
              </button>
              <span class="ed-adult-body">
                <span class="ed-adult-title">
                  {{ form.isAdult
                    ? $t('admin.categories.modal.adultOn')
                    : $t('admin.categories.modal.adultOff') }}
                </span>
                <span class="ed-adult-sub">
                  {{ $t('admin.categories.adult.subPart1') }}
                </span>
              </span>
            </label>
          </fieldset>

          <p v-if="formError" class="ed-error">
            <Icon name="ph:warning-circle-fill" />
            {{ formError }}
          </p>
        </div>
      </form>

      <template #footer>
        <button
          type="button"
          class="ed-btn ed-btn--ghost"
          :disabled="saving"
          @click="modalOpen = false"
        >
          {{ $t('common.cancel') }}
        </button>
        <button
          type="button"
          class="ed-btn ed-btn--primary"
          :disabled="!canSubmit"
          @click="submit"
        >
          <Icon
            :name="saving ? 'ph:circle-notch' : (editing.id ? 'ph:floppy-disk-bold' : 'ph:plus-bold')"
            :class="{ spin: saving }"
          />
          <span>{{ editing.id ? $t('admin.categories.actions.saveChanges') : $t('admin.categories.actions.createCategory') }}</span>
        </button>
      </template>
    </Modal>
  </div>
</template>

<script setup lang="ts">
import Modal from '~/components/Modal.vue';

const { t } = useI18n();

interface Category {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  newznabId: number | null;
  isAdult?: boolean;
  type?: 'movie' | 'tv' | 'game' | null;
  createdAt: string;
  subcategories?: Category[];
}

type MediaType = 'movie' | 'tv' | 'game' | null;

const TYPE_OPTIONS = computed<Array<{
  value: MediaType;
  label: string;
  sub: string;
  icon: string;
}>>(() => [
  {
    value: null,
    label: t('admin.categories.type.auto'),
    sub: t('admin.categories.type.autoSub'),
    icon: 'ph:wand',
  },
  {
    value: 'movie',
    label: t('admin.categories.type.movie'),
    sub: t('admin.categories.type.movieSub'),
    icon: 'ph:film-strip',
  },
  {
    value: 'tv',
    label: t('admin.categories.type.tv'),
    sub: t('admin.categories.type.tvSub'),
    icon: 'ph:television',
  },
  {
    value: 'game',
    label: t('admin.categories.type.game'),
    sub: t('admin.categories.type.gameSub'),
    icon: 'ph:game-controller',
  },
]);

// Admin tree management needs the full picture, including the XXX
// subtree, regardless of the operator's own showAdultContent setting.
// The /api/categories endpoint honours `?includeAdult=true` for staff
// callers (admin/mod) so we can keep the public path filtered.
const { data: categories, refresh } = await useFetch<Category[]>(
  '/api/categories',
  { query: { includeAdult: 'true' } }
);
const notifications = useNotificationStore();
const confirm = useConfirm();

const expandedCategories = ref(new Set<string>());
function toggleCategory(id: string) {
  if (expandedCategories.value.has(id)) {
    expandedCategories.value.delete(id);
  } else {
    expandedCategories.value.add(id);
  }
}

// Roots only — used to populate the modal's parent picker.
const rootCategories = computed(
  () => categories.value?.filter((c) => !c.parentId) ?? []
);

// ── Search filter ─────────────────────────────────────────
// Filters the visible tree in real time. A root is kept if it
// matches itself OR any of its descendants matches; in the
// "descendant match" case we auto-expand the root so the operator
// can see why it surfaced.
const searchQuery = ref('');
const normalizedQuery = computed(() => searchQuery.value.trim().toLowerCase());

function categoryMatches(c: Category, q: string): boolean {
  if (!q) return true;
  return (
    c.name.toLowerCase().includes(q) ||
    c.slug.toLowerCase().includes(q) ||
    (c.newznabId?.toString().includes(q) ?? false)
  );
}

const filteredCategories = computed(() => {
  const q = normalizedQuery.value;
  if (!q) return categories.value ?? [];
  const list: Category[] = [];
  for (const root of categories.value ?? []) {
    const rootHit = categoryMatches(root, q);
    const subHits =
      root.subcategories?.filter((s) => categoryMatches(s, q)) ?? [];
    if (rootHit || subHits.length > 0) list.push(root);
  }
  return list;
});

// Subs to show inside a parent. When searching, only matching
// children show; when idle, all children show.
function visibleSubs(parent: Category): Category[] {
  const q = normalizedQuery.value;
  if (!q) return parent.subcategories ?? [];
  if (categoryMatches(parent, q)) return parent.subcategories ?? [];
  return parent.subcategories?.filter((s) => categoryMatches(s, q)) ?? [];
}

// Auto-expand any parent whose subcategory matched the search.
watch(normalizedQuery, (q) => {
  if (!q) return;
  for (const root of categories.value ?? []) {
    const subHit = root.subcategories?.some((s) => categoryMatches(s, q)) ?? false;
    if (subHit && !categoryMatches(root, q)) {
      expandedCategories.value.add(root.id);
    }
  }
});

const filteredFlatCount = computed(() => {
  if (!normalizedQuery.value) return 0;
  let n = 0;
  for (const root of filteredCategories.value) {
    if (categoryMatches(root, normalizedQuery.value)) n += 1;
    n += visibleSubs(root).filter((s) =>
      categoryMatches(s, normalizedQuery.value)
    ).length;
  }
  return n;
});

// ── Stats ────────────────────────────────────────────────
const stats = computed(() => {
  const all = categories.value ?? [];
  let roots = 0;
  let subs = 0;
  let movies = 0;
  let tv = 0;
  let games = 0;
  let adult = 0;
  for (const root of all) {
    roots += 1;
    if (root.type === 'movie') movies += 1;
    if (root.type === 'tv') tv += 1;
    if (root.type === 'game') games += 1;
    if (root.isAdult) adult += 1;
    for (const sub of root.subcategories ?? []) {
      subs += 1;
      if (sub.type === 'movie') movies += 1;
      if (sub.type === 'tv') tv += 1;
      if (sub.type === 'game') games += 1;
      if (sub.isAdult) adult += 1;
    }
  }
  return { roots, subs, movies, tv, games, adult };
});

// ── Modal state ─────────────────────────────────────────────────
interface Editing {
  id: string | null;
  parentId: string | null;
}
interface FormState {
  name: string;
  parentId: string | null;
  newznabId: number | null;
  type: MediaType;
  isAdult: boolean;
}

const modalOpen = ref(false);
const editing = reactive<Editing>({ id: null, parentId: null });
const form = reactive<FormState>({
  name: '',
  parentId: null,
  newznabId: null,
  type: null,
  isAdult: false,
});
const saving = ref(false);
const formError = ref<string | null>(null);
const nameRef = ref<HTMLInputElement | null>(null);

function resetForm() {
  form.name = '';
  form.parentId = null;
  form.newznabId = null;
  form.type = null;
  form.isAdult = false;
  formError.value = null;
}

function openCreate(parentId: string | null) {
  editing.id = null;
  editing.parentId = parentId;
  resetForm();
  form.parentId = parentId;
  modalOpen.value = true;
  nextTick(() => nameRef.value?.focus());
}

function openEdit(cat: Category) {
  editing.id = cat.id;
  editing.parentId = cat.parentId;
  form.name = cat.name;
  form.parentId = cat.parentId;
  form.newznabId = cat.newznabId ?? null;
  form.type = cat.type ?? null;
  form.isAdult = cat.isAdult ?? false;
  formError.value = null;
  modalOpen.value = true;
  nextTick(() => nameRef.value?.focus());
}

// ── Slug preview ────────────────────────────────────────────────
function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    // Strip combining diacritical marks (U+0300..U+036F) using the
    // explicit unicode escape so the regex isn't sensitive to how an
    // editor stores the literal characters.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
const slugPreview = computed(() => {
  const base = slugify(form.name) || '—';
  if (!form.parentId) return base;
  const parent = rootCategories.value.find((p) => p.id === form.parentId);
  return parent ? `${parent.slug}-${base}` : base;
});

const canSubmit = computed(
  () => form.name.trim().length > 0 && !saving.value
);

async function submit() {
  if (!canSubmit.value) return;
  saving.value = true;
  formError.value = null;
  try {
    if (editing.id) {
      await $fetch(`/api/admin/categories/${editing.id}`, {
        method: 'PUT',
        body: {
          name: form.name.trim(),
          newznabId: form.newznabId ?? null,
          type: form.type,
          isAdult: form.isAdult,
        },
      });
      notifications.success(t('admin.categories.toasts.updated'));
    } else {
      await $fetch('/api/admin/categories', {
        method: 'POST',
        body: {
          name: form.name.trim(),
          parentId: form.parentId,
          newznabId: form.newznabId ?? null,
          type: form.type,
          isAdult: form.isAdult,
        },
      });
      if (form.parentId) {
        expandedCategories.value.add(form.parentId);
      }
      notifications.success(t('admin.categories.toasts.created'));
    }
    modalOpen.value = false;
    await refresh();
  } catch (err: any) {
    formError.value =
      err?.data?.message || err?.message || t('admin.categories.errors.saveFailed');
  } finally {
    saving.value = false;
  }
}

// Pending-delete guard: rapid double-clicks on a delete button
// would otherwise pop two confirm dialogs against the same row
// (the second one races against a stale `target`).
const deletingIds = ref(new Set<string>());

async function deleteCategory(id: string) {
  if (deletingIds.value.has(id)) return;
  let target: { name: string } | undefined;
  for (const cat of categories.value || []) {
    if (cat.id === id) {
      target = cat;
      break;
    }
    target = cat.subcategories?.find((s) => s.id === id);
    if (target) break;
  }
  deletingIds.value.add(id);
  try {
    const ok = await confirm({
      title: t('admin.categories.deleteConfirm.title'),
      message: target
        ? t('admin.categories.deleteConfirm.messageNamed', { name: target.name })
        : t('admin.categories.deleteConfirm.messageGeneric'),
      confirmText: t('admin.categories.deleteConfirm.action'),
      destructive: true,
    });
    if (!ok) return;
    await $fetch(`/api/admin/categories/${id}`, { method: 'DELETE' });
    await refresh();
    notifications.success(t('admin.categories.toasts.deleted'));
  } catch (error: any) {
    notifications.error(error.data?.message || t('admin.categories.errors.deleteFailed'));
  } finally {
    deletingIds.value.delete(id);
  }
}

const isSeeding = ref(false);
async function seedCategories() {
  const ok = await confirm({
    title: t('admin.categories.seedConfirm.title'),
    message: t('admin.categories.seedConfirm.message'),
    confirmText: t('admin.categories.seedConfirm.action'),
  });
  if (!ok) return;
  isSeeding.value = true;
  try {
    const result = await $fetch<{ created: number }>(
      '/api/admin/categories/seed',
      { method: 'POST' }
    );
    await refresh();
    notifications.success(t('admin.categories.toasts.seeded', { n: result.created }));
  } catch (error: any) {
    notifications.error(error.data?.message || t('admin.categories.errors.seedFailed'));
  } finally {
    isSeeding.value = false;
  }
}
</script>

<style scoped>
/* ── Page shell ──────────────────────────────────────────── */
.adm {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  position: relative;
}

/* ── Header ─────────────────────────────────────────────── */
.atlas-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: flex-end;
  gap: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid rgb(var(--line-default));
  position: relative;
}
.atlas-head::after {
  content: '';
  position: absolute;
  left: 0;
  bottom: -1px;
  width: 64px;
  height: 1px;
  background: #d4a734;
}
.atlas-head-id {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  min-width: 0;
}
.atlas-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: #d4a734;
}
.atlas-eyebrow-rule {
  display: inline-block;
  width: 26px;
  height: 1px;
  background: #d4a734;
}
.atlas-title {
  margin: 0;
  font-size: 1.65rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: rgb(var(--fg-strong));
}
.atlas-intro {
  margin: 0;
  max-width: 64ch;
  font-size: 0.82rem;
  color: rgb(var(--fg-muted));
  line-height: 1.55;
}
.atlas-cta {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 1.05rem;
  background: #d4a734;
  border: 1px solid #d4a734;
  border-radius: var(--radius-sm);
  font-family: inherit;
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #1a1a1a;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}
.atlas-cta:hover {
  background: #e8b94e;
  border-color: #e8b94e;
  transform: translateY(-1px);
  box-shadow: 0 6px 18px -8px rgba(212, 167, 52, 0.4);
}

/* ── Stats strip ────────────────────────────────────────── */
.atlas-stats {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.65rem 1.1rem;
  padding: 0.85rem 1.1rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
}
.stat {
  display: inline-flex;
  align-items: baseline;
  gap: 0.4rem;
}
.stat-icon {
  align-self: center;
  font-size: 0.95rem;
  color: rgb(var(--fg-muted));
}
.stat-num {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 1.15rem;
  font-weight: 800;
  color: rgb(var(--fg-strong));
  letter-spacing: -0.01em;
}
.stat-label {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.stat-divider {
  width: 1px;
  height: 22px;
  background: rgb(var(--line-default));
}
.stat--movie .stat-icon { color: #60a5fa; }
.stat--tv .stat-icon { color: #c084fc; }
.stat--game .stat-icon { color: #a78bfa; }
.stat--adult .stat-icon { color: #f43f5e; }
.stat--adult .stat-num { color: #f43f5e; }

/* ── Toolbar (search) ────────────────────────────────────── */
.atlas-toolbar {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  flex-wrap: wrap;
}
.search {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 260px;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}
.search:focus-within {
  border-color: rgba(212, 167, 52, 0.55);
  box-shadow: 0 0 0 3px rgba(212, 167, 52, 0.1);
}
.search-icon {
  margin-left: 0.65rem;
  font-size: 0.95rem;
  color: rgb(var(--fg-muted));
}
.search-input {
  flex: 1;
  background: transparent;
  border: 0;
  padding: 0.55rem 0.65rem;
  color: rgb(var(--fg-strong));
  font-size: 0.85rem;
  font-family: inherit;
  outline: none;
  min-width: 0;
}
.search-input::placeholder {
  color: rgb(var(--fg-faint));
}
.search-clear {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  margin-right: 0.35rem;
  background: transparent;
  border: 0;
  color: rgb(var(--fg-muted));
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s ease;
}
.search-clear:hover {
  color: rgb(var(--fg-strong));
  background: rgb(var(--bg-inset));
}
.search-hits {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #d4a734;
}

/* ── Empty + no-results states ──────────────────────────── */
.atlas-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.7rem;
  padding: 4rem 1.5rem;
  text-align: center;
  background: rgb(var(--bg-elevated));
  border: 1px dashed rgb(var(--line-default));
  border-radius: var(--radius-md);
}
.atlas-empty-stamp {
  display: grid;
  place-items: center;
  width: 68px;
  height: 68px;
  border-radius: 50%;
  background: rgba(212, 167, 52, 0.08);
  border: 1px solid rgba(212, 167, 52, 0.4);
  color: #d4a734;
  font-size: 1.8rem;
}
.atlas-empty-title {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
}
.atlas-empty-hint {
  margin: 0;
  font-size: 0.82rem;
  color: rgb(var(--fg-muted));
  max-width: 44ch;
  line-height: 1.5;
}
.atlas-empty-cta {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.5rem;
  padding: 0.6rem 1.05rem;
  background: #d4a734;
  border: 1px solid #d4a734;
  border-radius: var(--radius-sm);
  color: #1a1a1a;
  font-family: inherit;
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.15s ease;
}
.atlas-empty-cta:hover:not(:disabled) {
  background: #e8b94e;
  border-color: #e8b94e;
}
.atlas-empty-cta:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.atlas-noresults {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 3rem 1.5rem;
  text-align: center;
  font-size: 0.85rem;
  color: rgb(var(--fg-muted));
  background: rgb(var(--bg-elevated));
  border: 1px dashed rgb(var(--line-default));
  border-radius: var(--radius-md);
}
.atlas-noresults-icon {
  font-size: 2rem;
  color: rgb(var(--fg-muted));
  opacity: 0.6;
}

/* ── Entries list ───────────────────────────────────────── */
.entries {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}
.entry {
  animation: entry-in 0.38s cubic-bezier(0.2, 0.7, 0.2, 1) backwards;
  animation-delay: var(--stagger, 0ms);
}
@keyframes entry-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ── Entry row scaffold ─────────────────────────────────── */
.entry-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.85rem;
  padding: 0.85rem 1rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  transition: border-color 0.2s ease, transform 0.2s ease,
    box-shadow 0.2s ease;
}
/* On narrow viewports the 3-col grid + the 64px call-number panel
   + the 4-button action cluster overflowed sideways. Stack the
   action row beneath the identity column and let the code panel
   sit inline with the name. */
@media (max-width: 640px) {
  .entry-row {
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-areas:
      'code id'
      'actions actions';
    gap: 0.6rem 0.75rem;
    padding: 0.7rem 0.85rem;
  }
  .entry-row > .entry-code { grid-area: code; }
  .entry-row > .entry-id { grid-area: id; }
  .entry-row > .entry-actions {
    grid-area: actions;
    justify-content: flex-end;
    padding-top: 0.15rem;
    border-top: 1px solid rgb(var(--line-default));
  }
}
.entry-row:hover {
  border-color: rgba(212, 167, 52, 0.4);
  transform: translateY(-1px);
  box-shadow: 0 8px 22px -16px rgba(0, 0, 0, 0.55);
}
.entry-row--root {
  position: relative;
}
.entry--expanded .entry-row--root {
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
  border-bottom-color: rgba(212, 167, 52, 0.25);
}

/* Adult rows carry the diagonal warning hatch from the gate
   page so the operator recognises filtered categories. */
.entry--adult .entry-row {
  background-image: repeating-linear-gradient(
    -45deg,
    transparent,
    transparent 14px,
    rgba(244, 63, 94, 0.035) 14px,
    rgba(244, 63, 94, 0.035) 16px
  );
  border-color: rgba(244, 63, 94, 0.25);
}
.entry--adult .entry-row:hover {
  border-color: rgba(244, 63, 94, 0.5);
}

/* ── Call-number panel (Newznab id) ─────────────────────── */
.entry-code {
  display: grid;
  place-items: center;
  width: 64px;
  min-height: 52px;
  padding: 0.35rem 0.45rem;
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  flex-shrink: 0;
  position: relative;
  overflow: hidden;
}
.entry-code::before {
  /* Faint gold rule along the top — the "library spine" hint. */
  content: '';
  position: absolute;
  top: 0;
  left: 0.4rem;
  right: 0.4rem;
  height: 1px;
  background: linear-gradient(
    to right,
    rgba(212, 167, 52, 0.55) 0%,
    rgba(212, 167, 52, 0) 100%
  );
}
.entry-code--sub {
  width: 54px;
  min-height: 42px;
}
.entry-code--missing {
  background: repeating-linear-gradient(
    -45deg,
    rgb(var(--bg-base)) 0,
    rgb(var(--bg-base)) 5px,
    rgb(var(--bg-elevated)) 5px,
    rgb(var(--bg-elevated)) 10px
  );
}
.entry-code-num {
  font-family: ui-monospace, SFMono-Regular, monospace;
  /* Sized so the widest legitimate Newznab id (199999, six digits)
     still fits inside the 64px call-number panel. */
  font-size: 0.85rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
  color: #d4a734;
  line-height: 1;
}
.entry-code--sub .entry-code-num {
  font-size: 0.75rem;
}
.entry-code-dash {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 1.1rem;
  color: rgb(var(--fg-faint));
  font-weight: 700;
}

/* ── Identity column ────────────────────────────────────── */
.entry-id {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 0;
}
.entry-name {
  margin: 0;
  font-size: 1rem;
  font-weight: 800;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
  line-height: 1.2;
  word-break: break-word;
}
.entry-name--sub {
  font-size: 0.88rem;
  letter-spacing: 0.04em;
}
.entry-attrs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 0.6rem;
}
.entry-slug {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  color: rgb(var(--fg-muted));
  letter-spacing: 0.04em;
  background: transparent;
  padding: 0;
}
.entry-flag {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.15rem 0.45rem;
  border-radius: var(--radius-sm);
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-base));
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.entry-flag svg { font-size: 0.85rem; }
.entry-flag--adult {
  color: #f43f5e;
  border-color: rgba(244, 63, 94, 0.4);
  background: rgba(244, 63, 94, 0.06);
}
.entry-flag--children {
  color: #d4a734;
  border-color: rgba(212, 167, 52, 0.4);
  background: rgba(212, 167, 52, 0.06);
}

/* ── Actions ─────────────────────────────────────────────── */
.entry-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}
.entry-toggle {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-base));
  border-radius: var(--radius-sm);
  color: rgb(var(--fg-muted));
  cursor: pointer;
  transition: all 0.18s ease;
  font-size: 0.85rem;
}
.entry-toggle svg {
  transition: transform 0.22s ease;
}
.entry-toggle--open svg {
  transform: rotate(180deg);
}
.entry-toggle:hover {
  color: #d4a734;
  border-color: rgba(212, 167, 52, 0.4);
}
.entry-act {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  background: transparent;
  border: 0;
  color: rgb(var(--fg-muted));
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.16s ease;
}
.entry-act:hover {
  background: rgb(var(--bg-base));
  color: rgb(var(--fg-strong));
}
.entry-act--add:hover {
  color: #6cd161;
  background: rgba(108, 209, 97, 0.08);
}
.entry-act--delete:hover {
  color: #f43f5e;
  background: rgba(244, 63, 94, 0.08);
}

/* ── Subcategory thread ─────────────────────────────────── */
.entry-children {
  list-style: none;
  margin: 0;
  padding: 0;
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-top: 0;
  border-radius: 0 0 var(--radius-md) var(--radius-md);
  position: relative;
  overflow: hidden;
}
.entry-children::before {
  /* Gold rail running down the left edge of the children stack —
     visually threads the subs back to their parent. */
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 1.4rem;
  width: 1px;
  background: linear-gradient(
    to bottom,
    rgba(212, 167, 52, 0.5) 0%,
    rgba(212, 167, 52, 0.18) 50%,
    rgba(212, 167, 52, 0) 100%
  );
}
.entry-children .entry-row--sub {
  background: transparent;
  border: 0;
  border-bottom: 1px solid rgb(var(--line-default));
  border-radius: 0;
  padding: 0.7rem 1rem 0.7rem 2.6rem;
  position: relative;
}
.entry-children .entry-row--sub:last-child {
  border-bottom: 0;
}
.entry-children .entry-row--sub:hover {
  background: rgb(var(--bg-elevated));
  transform: none;
  box-shadow: none;
}
.entry-thread {
  position: absolute;
  left: 1.4rem;
  top: 50%;
  width: 0.9rem;
  height: 1px;
  background: rgba(212, 167, 52, 0.45);
  pointer-events: none;
}

/* Expand/collapse transition. The children block animates open
   via max-height (capped so it doesn't snap on long subs lists). */
.expand-enter-active,
.expand-leave-active {
  overflow: hidden;
  transition: max-height 0.3s cubic-bezier(0.2, 0.7, 0.2, 1),
    opacity 0.22s ease;
  max-height: 900px;
}
.expand-enter-from,
.expand-leave-to {
  max-height: 0;
  opacity: 0;
}

/* ── Modal: atlas editor ─────────────────────────────────── */
.ed {
  display: flex;
  flex-direction: column;
}

/* Live preview block sits at the top, before any control. The
   operator sees the catalog card they're about to commit
   updating in real time as they type. */
.ed-preview {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 0.7rem 1rem 0.85rem;
  background: rgb(var(--bg-base));
  border-bottom: 1px solid rgb(var(--line-default));
  position: relative;
}
.ed-preview::before {
  /* Subtle dot-grid behind the preview — mirrors the
     watchtower's "control room" texture, dialed way down. */
  content: '';
  position: absolute;
  inset: 0;
  background-image: radial-gradient(
    circle at 1px 1px,
    rgba(212, 167, 52, 0.05) 1px,
    transparent 0
  );
  background-size: 20px 20px;
  mask-image: linear-gradient(to bottom, black 0%, transparent 90%);
  -webkit-mask-image: linear-gradient(to bottom, black 0%, transparent 90%);
  pointer-events: none;
}
.ed-preview > * { position: relative; z-index: 1; }

.ed-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: #d4a734;
}
.ed-eyebrow-rule {
  display: inline-block;
  width: 22px;
  height: 1px;
  background: #d4a734;
}

.ed-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 0.85rem;
  padding: 0.6rem 0.85rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  transition: border-color 0.2s ease;
}
.ed-card--adult {
  border-color: rgba(244, 63, 94, 0.4);
  background-image: repeating-linear-gradient(
    -45deg,
    transparent,
    transparent 14px,
    rgba(244, 63, 94, 0.04) 14px,
    rgba(244, 63, 94, 0.04) 16px
  );
}
.ed-card-code {
  display: grid;
  place-items: center;
  width: 56px;
  min-height: 44px;
  padding: 0.3rem 0.4rem;
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  flex-shrink: 0;
  position: relative;
  overflow: hidden;
}
.ed-card-code::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0.4rem;
  right: 0.4rem;
  height: 1px;
  background: linear-gradient(
    to right,
    rgba(212, 167, 52, 0.55) 0%,
    rgba(212, 167, 52, 0) 100%
  );
}
.ed-card-code--missing {
  background: repeating-linear-gradient(
    -45deg,
    rgb(var(--bg-base)) 0,
    rgb(var(--bg-base)) 5px,
    rgb(var(--bg-elevated)) 5px,
    rgb(var(--bg-elevated)) 10px
  );
}
.ed-card-code-num {
  font-family: ui-monospace, SFMono-Regular, monospace;
  /* Same sizing rule as the list rows — must fit 6-digit ids. */
  font-size: 0.85rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
  color: #d4a734;
  line-height: 1;
}
.ed-card-code-dash {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 1.1rem;
  color: rgb(var(--fg-faint));
  font-weight: 700;
}
.ed-card-id {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 0;
}
.ed-card-name {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 800;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
  line-height: 1.15;
  word-break: break-word;
}
.ed-card-attrs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 0.55rem;
}
.ed-card-slug {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  color: rgb(var(--fg-muted));
  letter-spacing: 0.04em;
  background: transparent;
  padding: 0;
}
.ed-card-flag {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.15rem 0.45rem;
  border-radius: var(--radius-sm);
  border: 1px solid rgba(244, 63, 94, 0.4);
  background: rgba(244, 63, 94, 0.06);
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #f43f5e;
}
.ed-card-flag svg { font-size: 0.85rem; }

/* ── Body — numbered control blocks ───────────────────── */
.ed-body {
  display: flex;
  flex-direction: column;
  gap: 0.95rem;
  padding: 0.9rem 1rem 1rem;
  position: relative;
}
.ed-body::before {
  /* Faint gold rail running down the left edge — visually
     threads the numbered blocks together. */
  content: '';
  position: absolute;
  left: 0.5rem;
  top: 0.5rem;
  bottom: 0.5rem;
  width: 1px;
  background: linear-gradient(
    to bottom,
    rgba(212, 167, 52, 0) 0%,
    rgba(212, 167, 52, 0.3) 12%,
    rgba(212, 167, 52, 0.3) 88%,
    rgba(212, 167, 52, 0) 100%
  );
  pointer-events: none;
}

.ed-block {
  border: 0;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  min-width: 0;
}
.ed-block-head {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 0.7rem;
}
.ed-num {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.18em;
  color: #d4a734;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgba(212, 167, 52, 0.35);
  padding: 0.22rem 0.45rem;
  border-radius: var(--radius-sm);
}
.ed-block-id h4 {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
}

.ed-input {
  width: 100%;
  padding: 0.5rem 0.75rem;
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  color: rgb(var(--fg-strong));
  font-size: 0.85rem;
  font-family: inherit;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}
.ed-input:focus {
  outline: none;
  border-color: rgba(212, 167, 52, 0.55);
  box-shadow: 0 0 0 3px rgba(212, 167, 52, 0.12);
}
.ed-input--mono {
  font-family: ui-monospace, SFMono-Regular, monospace;
  letter-spacing: 0.04em;
}

/* Wrap the native select so we can layer our own caret on top
   without losing the OS dropdown popup. */
.ed-select-wrap {
  position: relative;
}
.ed-input--select {
  appearance: none;
  -webkit-appearance: none;
  padding-right: 2.25rem;
  cursor: pointer;
}
.ed-input--select:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.ed-select-caret {
  position: absolute;
  right: 0.8rem;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.85rem;
  color: rgb(var(--fg-muted));
  pointer-events: none;
}

.ed-hint {
  margin: 0;
  font-size: 11px;
  color: rgb(var(--fg-muted));
  line-height: 1.5;
}
.ed-slug {
  font-family: ui-monospace, SFMono-Regular, monospace;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.25rem;
  padding: 0.05rem 0.35rem;
  color: #d4a734;
  letter-spacing: 0.02em;
}

.ed-error {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  font-size: 11.5px;
  color: rgb(var(--danger));
}

/* ── Type picker — single-row chips ───────────────────── */
.ed-types {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.ed-type {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.45rem 0.8rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  background: rgb(var(--bg-elevated));
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: inherit;
}
.ed-type:hover:not(.ed-type--on) {
  border-color: rgb(var(--line-strong));
  color: rgb(var(--fg-strong));
}
.ed-type input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}
.ed-type-icon {
  font-size: 0.95rem;
  color: rgb(var(--fg-muted));
  transition: color 0.18s ease;
}
.ed-type-head {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  transition: color 0.18s ease;
}
.ed-type--on {
  border-color: rgba(212, 167, 52, 0.6);
  background: rgba(212, 167, 52, 0.08);
  box-shadow: inset 0 0 0 1px rgba(212, 167, 52, 0.3);
}
.ed-type--on .ed-type-icon,
.ed-type--on .ed-type-head { color: #d4a734; }

/* ── Adult toggle ───────────────────────────────────── */
.ed-adult {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding: 0.55rem 0.85rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  background: rgb(var(--bg-elevated));
  cursor: pointer;
  transition: border-color 0.18s ease, background 0.18s ease;
}
.ed-adult--on {
  border-color: rgba(244, 63, 94, 0.45);
  background-image: repeating-linear-gradient(
    -45deg,
    transparent,
    transparent 14px,
    rgba(244, 63, 94, 0.04) 14px,
    rgba(244, 63, 94, 0.04) 16px
  );
}
.ed-adult-body {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}
.ed-adult-title {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
  transition: color 0.18s ease;
}
.ed-adult--on .ed-adult-title { color: #f43f5e; }
.ed-adult-sub {
  font-size: 10.5px;
  color: rgb(var(--fg-muted));
  line-height: 1.4;
}

.ed-toggle {
  position: relative;
  flex-shrink: 0;
  width: 2.6rem;
  height: 1.5rem;
  border-radius: 9999px;
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-base));
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease;
}
.ed-toggle--on {
  background: #f43f5e;
  border-color: #f43f5e;
  box-shadow: 0 0 12px -2px rgba(244, 63, 94, 0.45);
}
.ed-toggle:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.ed-toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 1.15rem;
  height: 1.15rem;
  border-radius: 9999px;
  background: rgb(var(--bg-elevated));
  transition: transform 0.22s cubic-bezier(0.2, 0.7, 0.2, 1),
    background 0.18s ease;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
}
.ed-toggle--on .ed-toggle-knob {
  transform: translateX(1.05rem);
  background: #fff;
}

/* ── Footer buttons ─────────────────────────────────── */
.ed-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.55rem 1rem;
  border-radius: var(--radius-sm);
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-base));
  color: rgb(var(--fg-strong));
  font-family: inherit;
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}
.ed-btn:hover:not(:disabled) {
  border-color: rgb(var(--line-strong));
}
.ed-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ed-btn--ghost {
  background: transparent;
  color: rgb(var(--fg-muted));
}
.ed-btn--primary {
  background: #d4a734;
  border-color: #d4a734;
  color: #1a1a1a;
}
.ed-btn--primary:hover:not(:disabled) {
  background: #e8b94e;
  border-color: #e8b94e;
  box-shadow: 0 6px 18px -8px rgba(212, 167, 52, 0.45);
}

.spin {
  animation: cat-spin 1s linear infinite;
}
@keyframes cat-spin {
  to { transform: rotate(360deg); }
}
</style>
