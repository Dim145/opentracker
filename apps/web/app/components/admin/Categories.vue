<template>
  <div class="card">
    <div class="card-header">
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <Icon name="ph:tag-bold" class="text-text-muted" />
          <h3
            class="text-xs font-bold uppercase tracking-wider text-text-primary"
          >
            Category Management
          </h3>
        </div>
        <button
          v-if="categories?.length"
          type="button"
          class="btn btn-primary !px-4 !py-2 text-xs font-bold uppercase tracking-wider flex items-center gap-2"
          @click="openCreate(null)"
        >
          <Icon name="ph:plus-bold" />
          <span>New category</span>
        </button>
      </div>
    </div>
    <div class="card-body">
      <!-- Empty state — only the seeder shortcut, no inline form. -->
      <div
        v-if="!categories || categories.length === 0"
        class="text-center py-12 border border-dashed border-border rounded bg-bg-primary/30"
      >
        <Icon name="ph:tag-slash" class="text-3xl text-text-muted mb-2" />
        <p
          class="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-4"
        >
          No categories defined
        </p>
        <button
          class="btn btn-primary !px-4 !py-2 text-xs font-bold uppercase tracking-wider"
          :disabled="isSeeding"
          @click="seedCategories"
        >
          <Icon
            v-if="isSeeding"
            name="ph:circle-notch"
            class="animate-spin mr-2"
          />
          <Icon v-else name="ph:plant" class="mr-2" />
          Seed Torznab Categories
        </button>
      </div>

      <div v-else class="space-y-3">
        <div
          v-for="category in categories"
          :key="category.id"
          class="border border-border rounded overflow-hidden"
        >
          <!-- Parent row -->
          <div
            class="cat-row flex items-center justify-between p-3 bg-bg-tertiary/50 hover:border-fg-default/20 transition-colors group"
            :class="{ 'cat-row--adult': category.isAdult }"
          >
            <div class="flex items-center gap-3 min-w-0">
              <button
                v-if="category.subcategories?.length"
                class="w-6 h-6 rounded bg-bg-primary border border-border flex items-center justify-center hover:border-fg-default/30 transition-colors flex-shrink-0"
                @click="toggleCategory(category.id)"
              >
                <Icon
                  :name="
                    expandedCategories.has(category.id)
                      ? 'ph:caret-down-bold'
                      : 'ph:caret-right-bold'
                  "
                  class="text-text-muted text-xs"
                />
              </button>
              <div
                v-else
                class="w-6 h-6 rounded bg-bg-primary border border-border flex items-center justify-center flex-shrink-0"
              >
                <Icon name="ph:folder" class="text-text-muted text-xs" />
              </div>
              <div class="flex-1 min-w-0">
                <p
                  class="text-xs font-bold text-text-primary uppercase tracking-wider truncate"
                >
                  {{ category.name }}
                  <span
                    v-if="category.newznabId"
                    class="text-text-muted font-mono text-[10px] ml-2"
                  >
                    [{{ category.newznabId }}]
                  </span>
                </p>
                <div class="flex items-center gap-2 flex-wrap mt-0.5">
                  <span class="text-[10px] font-mono text-text-muted">
                    {{ category.slug }}
                  </span>
                  <CategoryTypeBadge :type="category.type" />
                  <span
                    v-if="category.isAdult"
                    class="cat-chip cat-chip--adult"
                    >XXX</span
                  >
                  <span
                    v-if="category.subcategories?.length"
                    class="text-[10px] text-text-muted/60"
                  >
                    · {{ category.subcategories.length }} sub
                  </span>
                </div>
              </div>
            </div>
            <div
              class="flex items-center gap-1 opacity-0 group-hover:opacity-100"
            >
              <button
                class="p-2 text-text-muted hover:text-text-primary transition-colors rounded hover:bg-bg-tertiary"
                title="Edit category"
                @click="openEdit(category)"
              >
                <Icon name="ph:pencil-bold" />
              </button>
              <button
                class="p-2 text-text-muted hover:text-error transition-colors rounded hover:bg-error/10"
                title="Delete category"
                @click="deleteCategory(category.id)"
              >
                <Icon name="ph:trash-bold" />
              </button>
            </div>
          </div>

          <!-- Subcategories -->
          <div
            v-if="
              category.subcategories?.length &&
              expandedCategories.has(category.id)
            "
            class="border-t border-border bg-bg-primary/30"
          >
            <div
              v-for="sub in category.subcategories"
              :key="sub.id"
              class="cat-row flex items-center justify-between p-3 pl-12 hover:bg-bg-tertiary/30 transition-colors group border-b border-border/50 last:border-b-0"
              :class="{ 'cat-row--adult': sub.isAdult }"
            >
              <div class="flex items-center gap-3 min-w-0">
                <div
                  class="w-6 h-6 rounded bg-bg-primary border border-border flex items-center justify-center flex-shrink-0"
                >
                  <Icon name="ph:tag" class="text-text-muted text-xs" />
                </div>
                <div class="flex-1 min-w-0">
                  <p
                    class="text-xs font-bold text-text-primary uppercase tracking-wider truncate"
                  >
                    {{ sub.name }}
                    <span
                      v-if="sub.newznabId"
                      class="text-text-muted font-mono text-[10px] ml-2"
                    >
                      [{{ sub.newznabId }}]
                    </span>
                  </p>
                  <div class="flex items-center gap-2 flex-wrap mt-0.5">
                    <span class="text-[10px] font-mono text-text-muted">
                      {{ sub.slug }}
                    </span>
                    <CategoryTypeBadge :type="sub.type" />
                    <span
                      v-if="sub.isAdult"
                      class="cat-chip cat-chip--adult"
                      >XXX</span
                    >
                  </div>
                </div>
              </div>
              <div
                class="flex items-center gap-1 opacity-0 group-hover:opacity-100"
              >
                <button
                  class="p-2 text-text-muted hover:text-text-primary transition-colors rounded hover:bg-bg-tertiary"
                  title="Edit subcategory"
                  @click="openEdit(sub)"
                >
                  <Icon name="ph:pencil-bold" />
                </button>
                <button
                  class="p-2 text-text-muted hover:text-error transition-colors rounded hover:bg-error/10"
                  title="Delete subcategory"
                  @click="deleteCategory(sub.id)"
                >
                  <Icon name="ph:trash-bold" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Create / edit modal ─────────────────────────────────────
         Single modal handles both flows: when `editing.id` is null we
         POST to /api/admin/categories, otherwise PUT /:id. The form
         keeps every operator-facing column on a single screen so the
         tree no longer needs inline editors that were getting cramped
         as we added isAdult and type. -->
    <Modal
      v-model="modalOpen"
      :title="editing.id ? 'Edit category' : 'New category'"
      icon="ph:folders-bold"
      size="md"
      :persistent="saving"
    >
      <form class="cat-form" @submit.prevent="submit">
        <fieldset class="cat-form__row">
          <label class="cat-form__label">Name</label>
          <input
            ref="nameRef"
            v-model="form.name"
            type="text"
            maxlength="100"
            placeholder="e.g. Hentai"
            class="input cat-form__input"
            :disabled="saving"
          />
          <p class="cat-form__hint">
            Slug:
            <code class="cat-form__slug">{{ slugPreview }}</code>
          </p>
        </fieldset>

        <fieldset
          v-if="!editing.id || !editing.parentId"
          class="cat-form__row"
        >
          <label class="cat-form__label">Parent</label>
          <select
            v-model="form.parentId"
            class="input cat-form__input"
            :disabled="!!editing.id || saving"
          >
            <option :value="null">— Root category —</option>
            <option
              v-for="root in rootCategories"
              :key="root.id"
              :value="root.id"
            >
              ↳ {{ root.name }}
            </option>
          </select>
          <p v-if="editing.id" class="cat-form__hint">
            Parent reassignment isn't supported yet — delete &amp; recreate
            if you need to move a row.
          </p>
        </fieldset>

        <fieldset class="cat-form__row">
          <label class="cat-form__label">Newznab id</label>
          <input
            v-model.number="form.newznabId"
            type="number"
            min="1000"
            max="9999"
            placeholder="e.g. 5070"
            class="input cat-form__input"
            :disabled="saving"
          />
          <p class="cat-form__hint">
            4-digit Torznab category id used by *Arr clients. Leave
            empty if none applies.
          </p>
        </fieldset>

        <fieldset class="cat-form__row">
          <label class="cat-form__label">Media type</label>
          <div class="type-grid" role="radiogroup">
            <label
              v-for="opt in TYPE_OPTIONS"
              :key="opt.value ?? 'none'"
              class="type-option"
              :class="{ 'type-option--on': form.type === opt.value }"
            >
              <input
                type="radio"
                :checked="form.type === opt.value"
                :disabled="saving"
                @change="form.type = opt.value"
              />
              <span class="type-option__head">
                <Icon :name="opt.icon" />
                {{ opt.label }}
              </span>
              <span class="type-option__sub">{{ opt.sub }}</span>
            </label>
          </div>
          <p class="cat-form__hint">
            Drives the TMDb namespace hint. <strong>Auto</strong> falls back to
            the slug + Newznab heuristic.
          </p>
        </fieldset>

        <fieldset class="cat-form__row">
          <label
            class="adult-toggle"
            :class="{ 'adult-toggle--on': form.isAdult }"
          >
            <button
              type="button"
              role="switch"
              :aria-checked="form.isAdult"
              class="toggle"
              :class="{ 'toggle--on': form.isAdult }"
              :disabled="saving"
              @click="form.isAdult = !form.isAdult"
            >
              <span class="toggle-knob" />
            </button>
            <span class="adult-toggle__body">
              <span class="adult-toggle__title">
                Mark as adult content
              </span>
              <span class="adult-toggle__sub">
                Hidden from users who haven't enabled XXX in their
                profile settings — applies to listings, search, RSS,
                Torznab and the homepage feed.
              </span>
            </span>
          </label>
        </fieldset>

        <p v-if="formError" class="cat-form__error">
          <Icon name="ph:warning-circle-fill" />
          {{ formError }}
        </p>
      </form>

      <template #footer>
        <button
          type="button"
          class="btn btn-ghost !px-4 !py-2 text-xs font-bold uppercase tracking-wider"
          :disabled="saving"
          @click="modalOpen = false"
        >
          Cancel
        </button>
        <button
          type="button"
          class="btn btn-primary !px-4 !py-2 text-xs font-bold uppercase tracking-wider flex items-center gap-2"
          :disabled="!canSubmit"
          @click="submit"
        >
          <Icon
            :name="saving ? 'ph:circle-notch' : 'ph:floppy-disk-bold'"
            :class="{ 'animate-spin': saving }"
          />
          <span>{{ editing.id ? 'Save changes' : 'Create category' }}</span>
        </button>
      </template>
    </Modal>
  </div>
</template>

<script setup lang="ts">
import Modal from '~/components/Modal.vue';

interface Category {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  newznabId: number | null;
  isAdult?: boolean;
  type?: 'movie' | 'tv' | null;
  createdAt: string;
  subcategories?: Category[];
}

type MediaType = 'movie' | 'tv' | null;

const TYPE_OPTIONS: Array<{
  value: MediaType;
  label: string;
  sub: string;
  icon: string;
}> = [
  {
    value: null,
    label: 'Auto',
    sub: 'Heuristic on slug + Newznab',
    icon: 'ph:wand',
  },
  {
    value: 'movie',
    label: 'Movie',
    sub: 'TMDb /movie',
    icon: 'ph:film-strip',
  },
  {
    value: 'tv',
    label: 'TV / Series',
    sub: 'TMDb /tv',
    icon: 'ph:television',
  },
];

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
  // Defer focus until the teleported modal lives in the DOM.
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
    .replace(/[̀-ͯ]/g, '')
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
      notifications.success('Category updated');
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
      // Auto-expand the parent so the new subcategory is immediately visible.
      if (form.parentId) {
        expandedCategories.value.add(form.parentId);
      }
      notifications.success('Category created');
    }
    modalOpen.value = false;
    await refresh();
  } catch (err: any) {
    formError.value =
      err?.data?.message || err?.message || 'Failed to save category';
  } finally {
    saving.value = false;
  }
}

async function deleteCategory(id: string) {
  let target: { name: string } | undefined;
  for (const cat of categories.value || []) {
    if (cat.id === id) {
      target = cat;
      break;
    }
    target = cat.subcategories?.find((s) => s.id === id);
    if (target) break;
  }
  const ok = await confirm({
    title: 'Delete category',
    message: target
      ? `Permanently delete the category “${target.name}”? Torrents currently in it will become uncategorised.`
      : 'Permanently delete this category? Torrents currently in it will become uncategorised.',
    confirmText: 'Delete category',
    destructive: true,
  });
  if (!ok) return;
  try {
    await $fetch(`/api/admin/categories/${id}`, { method: 'DELETE' });
    await refresh();
    notifications.success('Category deleted');
  } catch (error: any) {
    notifications.error(error.data?.message || 'Failed to delete category');
  }
}

const isSeeding = ref(false);
async function seedCategories() {
  const ok = await confirm({
    title: 'Seed default categories',
    message:
      'Create the recommended Torznab-compatible category set on top of what already exists?',
    confirmText: 'Seed categories',
  });
  if (!ok) return;
  isSeeding.value = true;
  try {
    const result = await $fetch<{ created: number }>(
      '/api/admin/categories/seed',
      { method: 'POST' }
    );
    await refresh();
    notifications.success(`Created ${result.created} categories`);
  } catch (error: any) {
    notifications.error(error.data?.message || 'Failed to seed categories');
  } finally {
    isSeeding.value = false;
  }
}
</script>

<style scoped>
/* ─── Type / adult chips ─────────────────────────────────────────── */
.cat-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.05rem 0.4rem;
  border-radius: 0.2rem;
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-elevated));
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  line-height: 1.45;
}
.cat-chip--adult {
  border-color: rgba(229, 62, 62, 0.45);
  background: rgba(229, 62, 62, 0.08);
  color: rgb(var(--danger));
}
.cat-row {
  position: relative;
}
/* The diagonal warning hatch on adult rows mirrors the gate page so
   the operator immediately recognises which categories are filtered. */
.cat-row--adult {
  background-image: repeating-linear-gradient(
    -45deg,
    transparent,
    transparent 14px,
    rgba(229, 62, 62, 0.04) 14px,
    rgba(229, 62, 62, 0.04) 16px
  );
}

/* ─── Modal form ─────────────────────────────────────────────────── */
.cat-form {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}
.cat-form__row {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  border: 0;
  padding: 0;
  margin: 0;
}
.cat-form__label {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.cat-form__input {
  width: 100%;
  padding: 0.65rem 0.85rem;
  font-size: 0.85rem;
}
.cat-form__hint {
  margin: 0;
  font-size: 11px;
  color: rgb(var(--fg-muted));
  line-height: 1.4;
}
.cat-form__slug {
  font-family: ui-monospace, SFMono-Regular, monospace;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.25rem;
  padding: 0.05rem 0.35rem;
  color: rgb(var(--fg-default));
}
.cat-form__error {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  font-size: 11.5px;
  color: rgb(var(--danger));
}

/* ─── Type radio grid ────────────────────────────────────────────── */
.type-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.55rem;
}
@media (max-width: 540px) {
  .type-grid {
    grid-template-columns: 1fr;
  }
}
.type-option {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.7rem 0.8rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.4rem;
  background: rgb(var(--bg-elevated));
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.type-option:hover {
  border-color: rgb(var(--fg-default) / 0.3);
}
.type-option input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}
.type-option--on {
  border-color: rgb(var(--fg-default) / 0.5);
  background: rgb(var(--bg-tertiary));
  box-shadow: inset 3px 0 0 rgb(var(--fg-default));
}
.type-option__head {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: rgb(var(--fg-strong));
}
.type-option__sub {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  letter-spacing: 0.08em;
  color: rgb(var(--fg-muted));
}

/* ─── Adult-content toggle in the modal ──────────────────────────── */
.adult-toggle {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  padding: 0.85rem 1rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.4rem;
  background: rgb(var(--bg-elevated));
  cursor: pointer;
  transition: border-color 0.15s;
}
.adult-toggle--on {
  border-left: 3px solid rgb(var(--danger));
  padding-left: calc(1rem - 2px);
  background-image: repeating-linear-gradient(
    -45deg,
    transparent,
    transparent 14px,
    rgba(229, 62, 62, 0.04) 14px,
    rgba(229, 62, 62, 0.04) 16px
  );
}
.adult-toggle__body {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.adult-toggle__title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: rgb(var(--fg-strong));
}
.adult-toggle__sub {
  font-size: 11px;
  color: rgb(var(--fg-muted));
  line-height: 1.4;
}

/* ─── Reusable toggle (mirrors the one in /settings) ─────────────── */
.toggle {
  position: relative;
  flex-shrink: 0;
  width: 2.6rem;
  height: 1.5rem;
  border-radius: 9999px;
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-tertiary));
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.toggle--on {
  background: rgb(var(--danger));
  border-color: rgb(var(--danger));
}
.toggle:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 1.15rem;
  height: 1.15rem;
  border-radius: 9999px;
  background: rgb(var(--bg-secondary));
  transition: transform 0.18s cubic-bezier(0.2, 0.7, 0.2, 1);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
}
.toggle--on .toggle-knob {
  transform: translateX(1.05rem);
  background: #fff;
}
</style>
