<template>
  <div class="space-y-6">
    <!-- ── Global rules card ───────────────────────────────────── -->
    <section class="card">
      <header class="card-header">
        <div class="flex items-center gap-2">
          <Icon name="ph:shield-check" class="text-text-muted" />
          <h3 class="text-xs font-bold uppercase tracking-wider text-text-primary">
            {{ $t('admin.uploadRules.globalRules') }}
          </h3>
        </div>
      </header>
      <div class="card-body space-y-5">
        <!-- NFO required -->
        <UploadRulesToggle
          v-model="form.nfoRequired"
          :title="$t('admin.uploadRules.nfo.title')"
          :description="$t('admin.uploadRules.nfo.description')"
        />

        <!-- Description required + min length -->
        <UploadRulesToggle
          v-model="form.descriptionRequired"
          :title="$t('admin.uploadRules.description.title')"
          :description="$t('admin.uploadRules.description.description')"
        >
          <div v-if="form.descriptionRequired" class="ur-subfield">
            <label class="ur-subfield-label">
              {{ $t('admin.uploadRules.description.minLength') }}
            </label>
            <input
              v-model.number="form.descriptionMinLength"
              type="number"
              min="0"
              max="10000"
              class="input ur-subfield-input"
            />
            <p class="ur-hint">
              {{ $t('admin.uploadRules.description.minLengthHint') }}
            </p>
          </div>
        </UploadRulesToggle>

        <!-- Title blocklist -->
        <div class="ur-field">
          <div class="ur-field-head">
            <p class="ur-field-title">
              {{ $t('admin.uploadRules.titleBlocklist.title') }}
            </p>
            <p class="ur-field-desc">
              {{ $t('admin.uploadRules.titleBlocklist.description') }}
            </p>
          </div>
          <input
            v-model="form.titleBlocklist"
            type="text"
            :class="['input', { 'input--invalid': !!errors.titleBlocklist }]"
            :placeholder="$t('admin.uploadRules.titleBlocklist.placeholder')"
          />
          <p v-if="errors.titleBlocklist" class="ur-error">
            <Icon name="ph:warning-bold" />
            {{ $t('admin.uploadRules.invalidRegex') }}
          </p>
          <p v-else class="ur-hint">
            <Icon name="ph:info" />
            {{ $t('admin.uploadRules.titleBlocklist.hint') }}
          </p>
        </div>

        <!-- TMDb ID required -->
        <UploadRulesToggle
          v-model="form.tmdbIdRequired"
          :title="$t('admin.uploadRules.tmdb.title')"
          :description="$t('admin.uploadRules.tmdb.description')"
        />

        <!-- Max torrent size -->
        <div class="ur-field">
          <div class="ur-field-head">
            <p class="ur-field-title">
              {{ $t('admin.uploadRules.maxSize.title') }}
            </p>
            <p class="ur-field-desc">
              {{ $t('admin.uploadRules.maxSize.description') }}
            </p>
          </div>
          <div class="ur-size-row">
            <input
              v-model.number="maxSizeGiB"
              type="number"
              min="0"
              step="0.1"
              class="input ur-size-input"
              :placeholder="$t('admin.uploadRules.maxSize.placeholder')"
            />
            <span class="ur-size-unit">GiB</span>
            <button
              v-if="form.maxTorrentSize !== null"
              type="button"
              class="ur-clear"
              :title="$t('admin.uploadRules.maxSize.clear')"
              @click="form.maxTorrentSize = null"
            >
              <Icon name="ph:x" />
            </button>
          </div>
          <p class="ur-hint">
            <Icon name="ph:info" />
            {{ $t('admin.uploadRules.maxSize.hint') }}
          </p>
        </div>

        <!-- Staff bypass -->
        <UploadRulesToggle
          v-model="form.staffBypass"
          :title="$t('admin.uploadRules.staffBypass.title')"
          :description="$t('admin.uploadRules.staffBypass.description')"
        />
      </div>
    </section>

    <!-- ── Title pattern per category ─────────────────────────── -->
    <section class="card">
      <header class="card-header">
        <div class="flex items-center gap-2">
          <Icon name="ph:textbox" class="text-text-muted" />
          <h3 class="text-xs font-bold uppercase tracking-wider text-text-primary">
            {{ $t('admin.uploadRules.titlePattern.title') }}
          </h3>
        </div>
      </header>
      <div class="card-body space-y-4">
        <UploadRulesToggle
          v-model="form.titlePatternEnforced"
          :title="$t('admin.uploadRules.titlePattern.enabledTitle')"
          :description="$t('admin.uploadRules.titlePattern.enabledDescription')"
        />

        <p class="ur-explainer">
          <Icon name="ph:info" class="ur-explainer-icon" />
          <span>{{ $t('admin.uploadRules.titlePattern.explain') }}</span>
        </p>

        <div v-if="!form.titlePatternEnforced" class="ur-disabled-note">
          {{ $t('admin.uploadRules.titlePattern.toggleHint') }}
        </div>

        <div v-else-if="categoryTree.length === 0" class="ur-empty">
          {{ $t('admin.uploadRules.titlePattern.noCategories') }}
        </div>

        <!-- Tree-flattened list. Each row's depth drives the
             indentation; the inheritance hint above the input
             surfaces when this category has no own pattern but
             does have an ancestor that does. Setting a regex on a
             parent automatically lights up the same hint on every
             descendant. -->
        <ul v-else class="ur-cat-list">
          <li
            v-for="cat in categoryTree"
            :key="cat.id"
            class="ur-cat-row"
            :class="{
              'ur-cat-row--has': !!form.categoryPatterns[cat.id],
              'ur-cat-row--inherits':
                !form.categoryPatterns[cat.id] && !!inheritedPatternFor(cat),
            }"
            :style="{ '--depth': cat.depth }"
          >
            <div class="ur-cat-meta">
              <span class="ur-cat-tree-prefix" aria-hidden="true">
                <span v-if="cat.depth > 0" class="ur-cat-tree-corner">└</span>
              </span>
              <span class="ur-cat-name">{{ cat.name }}</span>
              <span
                v-if="
                  !form.categoryPatterns[cat.id] && !!inheritedPatternFor(cat)
                "
                class="ur-cat-inherit-tag"
                :title="inheritedPatternFor(cat)?.pattern"
              >
                <Icon name="ph:arrow-elbow-up-right-bold" />
                {{
                  $t('admin.uploadRules.titlePattern.inheritedFrom', {
                    name: inheritedPatternFor(cat)?.fromName,
                  })
                }}
              </span>
            </div>
            <input
              :value="form.categoryPatterns[cat.id] ?? ''"
              type="text"
              :class="[
                'input ur-cat-input',
                { 'input--invalid': !!errors.categoryPatterns[cat.id] },
              ]"
              :placeholder="
                inheritedPatternFor(cat)
                  ? $t('admin.uploadRules.titlePattern.overridePlaceholder', {
                      pattern: inheritedPatternFor(cat)?.pattern,
                    })
                  : $t('admin.uploadRules.titlePattern.placeholder')
              "
              @input="onCategoryPatternInput(cat.id, $event)"
            />
            <Icon
              v-if="errors.categoryPatterns[cat.id]"
              name="ph:warning-bold"
              class="ur-cat-warning"
              :title="$t('admin.uploadRules.invalidRegex')"
            />
          </li>
        </ul>
      </div>
    </section>

    <!-- ── Sticky save bar ─────────────────────────────────────── -->
    <div class="ur-savebar">
      <p v-if="hasErrors" class="ur-savebar-error">
        <Icon name="ph:warning-bold" />
        {{ $t('admin.uploadRules.fixErrorsFirst') }}
      </p>
      <p v-else-if="dirty" class="ur-savebar-dirty">
        <Icon name="ph:circle-dashed" />
        {{ $t('admin.uploadRules.unsavedChanges') }}
      </p>
      <button
        type="button"
        class="btn btn-primary"
        :disabled="!dirty || hasErrors || saving"
        @click="save"
      >
        <Icon
          :name="saving ? 'ph:circle-notch' : 'ph:floppy-disk-bold'"
          :class="{ 'animate-spin': saving }"
        />
        <span>{{ $t('common.saveChanges') }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import UploadRulesToggle from './UploadRulesToggle.vue';

interface Category {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  /** `/api/categories` returns roots with their children pre-nested
   *  rather than as a flat list — we recurse on this field to walk
   *  the tree without re-grouping. May be `undefined` on leaf
   *  responses; the recursion handles that. */
  subcategories?: Category[];
}

interface RulesPayload {
  nfoRequired: boolean;
  descriptionRequired: boolean;
  descriptionMinLength: number;
  titlePatternEnforced: boolean;
  titleBlocklist: string | null;
  tmdbIdRequired: boolean;
  maxTorrentSize: number | null;
  staffBypass: boolean;
  /** Raw patterns — only categories where the admin explicitly set
   *  a regex. The admin form mirrors this exactly. */
  categoryPatterns: Record<string, string>;
  /** Inheritance-resolved patterns — every category that has an
   *  effective rule (own or inherited from an ancestor). Used by
   *  the runtime enforcer; the admin form derives "inherited from
   *  X" hints by diffing this against `categoryPatterns`. */
  effectiveCategoryPatterns: Record<string, string>;
}

const { t } = useI18n();
const notifications = useNotificationStore();

// ── Source data ────────────────────────────────────────────────
const { data: serverRules, refresh: refreshRules } = await useFetch<RulesPayload>(
  '/api/admin/upload-rules',
  { default: () => emptyRules() },
);
const { data: categories } = await useFetch<Category[]>('/api/categories');

function emptyRules(): RulesPayload {
  return {
    nfoRequired: false,
    descriptionRequired: false,
    descriptionMinLength: 0,
    titlePatternEnforced: false,
    titleBlocklist: null,
    tmdbIdRequired: false,
    maxTorrentSize: null,
    staffBypass: true,
    categoryPatterns: {},
    effectiveCategoryPatterns: {},
  };
}

// ── Form state (mutable copy of the server snapshot) ──────────
//
// We keep a deep clone of the server payload and diff against it
// to drive the dirty / save-bar state. Re-fetching after a save
// also re-seeds this ref so the "unsaved" badge clears cleanly.
const form = ref<RulesPayload>(structuredClone(serverRules.value));

// Surface size in GiB for the input (UX) while persisting bytes
// (DB). Round-trips cleanly: bytes ÷ 1024³ → display, display ×
// 1024³ → bytes on save. Empty input maps to null = no cap.
const maxSizeGiB = computed({
  get() {
    if (form.value.maxTorrentSize === null) return null;
    return Math.round((form.value.maxTorrentSize / 1024 ** 3) * 100) / 100;
  },
  set(v: number | null) {
    if (v === null || Number.isNaN(v) || v <= 0) {
      form.value.maxTorrentSize = null;
    } else {
      form.value.maxTorrentSize = Math.round(v * 1024 ** 3);
    }
  },
});

watch(serverRules, (next) => {
  if (next) form.value = structuredClone(next);
});

// ── Category tree (flattened with depth) ────────────────────
//
// Categories form a parent/child tree. We render the whole tree
// (not just leaves) because the inheritance rule means an operator
// can set a single regex on a parent and have every descendant
// pick it up. Flattened DFS with a `depth` field per row gives us
// a tree-shaped list that's trivial to indent in CSS.
//
// For every node we also compute the nearest ancestor that has an
// explicit own pattern — that's what the input's placeholder
// surfaces ("inherits from X") when the row itself has no own
// regex. Resolved against the current form state (not the server
// snapshot) so editing a parent's regex updates every descendant's
// hint in real time.
interface CategoryRow {
  id: string;
  name: string;
  depth: number;
  parentChain: { id: string; name: string }[]; // root → direct parent
}

const categoryTree = computed<CategoryRow[]>(() => {
  const roots = categories.value ?? [];
  const out: CategoryRow[] = [];

  // Walk the *nested* response shape directly — `/api/categories`
  // ships roots with their children pre-grouped via `subcategories`,
  // so there's nothing to group by parentId here. Sort siblings
  // alphabetically to match the order in /admin/categories.
  const visit = (
    nodes: Category[],
    depth: number,
    chain: { id: string; name: string }[],
  ) => {
    const sorted = [...nodes].sort((a, b) => a.name.localeCompare(b.name));
    for (const c of sorted) {
      out.push({ id: c.id, name: c.name, depth, parentChain: [...chain] });
      if (c.subcategories && c.subcategories.length > 0) {
        visit(c.subcategories, depth + 1, [
          ...chain,
          { id: c.id, name: c.name },
        ]);
      }
    }
  };
  visit(roots, 0, []);
  return out;
});

/**
 * Walk the live form's `categoryPatterns` map (not the server
 * snapshot) to find the nearest ancestor with an own regex. Lets
 * the placeholder update in real time as the operator edits.
 */
function inheritedPatternFor(row: CategoryRow): {
  pattern: string;
  fromName: string;
} | null {
  for (let i = row.parentChain.length - 1; i >= 0; i--) {
    const parent = row.parentChain[i];
    const p = form.value.categoryPatterns[parent.id];
    if (p) return { pattern: p, fromName: parent.name };
  }
  return null;
}

// ── Regex validation (live, mirrors the server) ───────────────
//
// `evaluateRegex` returns true when the candidate compiles as a
// JS regex after the implicit ^…$ wrap the server applies on
// save. We never re-wrap the value the user typed — the textbox
// shows their original input.
const errors = reactive<{
  titleBlocklist: boolean;
  categoryPatterns: Record<string, boolean>;
}>({
  titleBlocklist: false,
  categoryPatterns: {},
});

function isValidRegex(raw: string): boolean {
  let candidate = raw.trim();
  if (!candidate) return true;
  if (!candidate.startsWith('^')) candidate = `^${candidate}`;
  if (!candidate.endsWith('$')) candidate = `${candidate}$`;
  try {
    new RegExp(candidate, 'i');
    return true;
  } catch {
    return false;
  }
}

watch(
  () => form.value.titleBlocklist,
  (v) => {
    errors.titleBlocklist = !!v && !isValidRegex(v);
  },
  { immediate: true },
);

function onCategoryPatternInput(catId: string, ev: Event) {
  const target = ev.target as HTMLInputElement;
  const v = target.value;
  if (!v) {
    delete form.value.categoryPatterns[catId];
    delete errors.categoryPatterns[catId];
  } else {
    form.value.categoryPatterns[catId] = v;
    errors.categoryPatterns[catId] = !isValidRegex(v);
  }
}

// ── Save guard ────────────────────────────────────────────────
const hasErrors = computed(
  () =>
    errors.titleBlocklist ||
    Object.values(errors.categoryPatterns).some(Boolean),
);

const dirty = computed(
  () =>
    JSON.stringify(form.value) !== JSON.stringify(serverRules.value),
);

const saving = ref(false);
async function save() {
  if (saving.value || hasErrors.value || !dirty.value) return;
  saving.value = true;
  try {
    await $fetch('/api/admin/upload-rules', {
      method: 'PUT',
      body: {
        nfoRequired: form.value.nfoRequired,
        descriptionRequired: form.value.descriptionRequired,
        descriptionMinLength: form.value.descriptionMinLength,
        titlePatternEnforced: form.value.titlePatternEnforced,
        titleBlocklist: form.value.titleBlocklist?.trim() || null,
        tmdbIdRequired: form.value.tmdbIdRequired,
        maxTorrentSize: form.value.maxTorrentSize,
        staffBypass: form.value.staffBypass,
        categoryPatterns: Object.fromEntries(
          Object.entries(form.value.categoryPatterns).filter(([, v]) =>
            v.trim() !== '',
          ),
        ),
      },
    });
    notifications.success(t('admin.uploadRules.saved'));
    await refreshRules();
  } catch (err: any) {
    // The server returns a 400 with `data.invalidFields` listing
    // the field paths that failed validation. Mirror them onto
    // the form so the operator sees red borders without having to
    // squint at the toast.
    const invalid = err?.data?.invalidFields as string[] | undefined;
    if (Array.isArray(invalid)) {
      for (const path of invalid) {
        if (path === 'titleBlocklist') errors.titleBlocklist = true;
        else if (path.startsWith('categoryPatterns.')) {
          errors.categoryPatterns[path.slice('categoryPatterns.'.length)] =
            true;
        }
      }
    }
    notifications.error(
      err?.data?.message || err?.message || t('admin.uploadRules.saveFailed'),
    );
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
/* ─── Generic field block ─────────────────────────────────── */
.ur-field {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.ur-field-head {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.ur-field-title {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 600;
  color: rgb(var(--fg-strong));
}
.ur-field-desc {
  margin: 0;
  font-size: 0.75rem;
  color: rgb(var(--fg-muted));
  line-height: 1.45;
}

.ur-subfield {
  margin-top: 0.6rem;
  padding-left: 0.85rem;
  border-left: 2px solid rgb(var(--accent) / 0.4);
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.ur-subfield-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.ur-subfield-input {
  max-width: 8rem;
}

.ur-hint,
.ur-error {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.72rem;
  margin: 0;
  line-height: 1.4;
}
.ur-hint {
  color: rgb(var(--fg-muted));
}
.ur-error {
  color: rgb(var(--danger));
  font-weight: 600;
}

/* Red border on the invalid regex input. Uses a class hook
   rather than :invalid since we drive the state ourselves. */
:deep(.input--invalid) {
  border-color: rgb(var(--danger)) !important;
  box-shadow: 0 0 0 1px rgb(var(--danger) / 0.5);
}

/* ─── Size input row ──────────────────────────────────────── */
.ur-size-row {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}
.ur-size-input {
  max-width: 9rem;
}
.ur-size-unit {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.ur-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.6rem;
  height: 1.6rem;
  padding: 0;
  background: transparent;
  border: 1px solid rgb(var(--line-default));
  border-radius: 4px;
  color: rgb(var(--fg-muted));
  cursor: pointer;
  transition: all 0.14s ease;
}
.ur-clear:hover {
  border-color: rgb(var(--danger) / 0.6);
  color: rgb(var(--danger));
}

/* ─── Title pattern table ─────────────────────────────────── */
.ur-explainer {
  display: flex;
  gap: 0.5rem;
  margin: 0;
  padding: 0.6rem 0.8rem;
  background: rgb(var(--bg-elevated) / 0.5);
  border: 1px dashed rgb(var(--line-default));
  border-radius: 4px;
  font-size: 0.72rem;
  color: rgb(var(--fg-muted));
  line-height: 1.5;
}
.ur-explainer-icon {
  flex-shrink: 0;
  margin-top: 0.1rem;
  color: rgb(var(--accent));
}

.ur-disabled-note,
.ur-empty {
  padding: 1.25rem 1rem;
  text-align: center;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgb(var(--fg-faint));
  font-style: italic;
  border: 1px dashed rgb(var(--line-default));
  border-radius: 4px;
}

.ur-cat-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
  border: 1px solid rgb(var(--line-default));
  border-radius: 4px;
  overflow: hidden;
}
.ur-cat-row {
  /* `--depth` is set per-row from Vue; we use it to push the name
     column right while leaving the input column at a stable origin
     — the regex inputs all line up vertically regardless of nesting,
     which makes the table scannable as a single column of patterns. */
  display: grid;
  grid-template-columns:
    calc(11rem + var(--depth, 0) * 1.1rem)
    minmax(0, 1fr)
    auto;
  gap: 0.75rem;
  align-items: center;
  padding: 0.55rem 0.85rem;
  background: rgb(var(--bg-elevated) / 0.4);
  border-top: 1px solid rgb(var(--line-default));
}
.ur-cat-row:first-child {
  border-top: 0;
}
.ur-cat-row--has {
  background: rgb(var(--accent) / 0.06);
}
.ur-cat-row--inherits {
  background: rgb(var(--bg-elevated) / 0.65);
}
/* Subtle vertical guide on every nested row — 1px line in the
   parent-name column hints at the tree without needing ASCII art
   for shallow trees. */
.ur-cat-row[style*='--depth: 1'],
.ur-cat-row[style*='--depth: 2'],
.ur-cat-row[style*='--depth: 3'],
.ur-cat-row[style*='--depth: 4'] {
  position: relative;
}
.ur-cat-row[style*='--depth: 1']::before,
.ur-cat-row[style*='--depth: 2']::before,
.ur-cat-row[style*='--depth: 3']::before,
.ur-cat-row[style*='--depth: 4']::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: calc(0.85rem + var(--depth, 0) * 1.1rem - 0.7rem);
  width: 1px;
  background: rgb(var(--line-default));
}

.ur-cat-meta {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
  flex-wrap: wrap;
}
.ur-cat-tree-prefix {
  display: inline-flex;
  width: 0;
}
.ur-cat-tree-corner {
  display: inline-block;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
  color: rgb(var(--fg-faint));
  transform: translate(-0.9rem, 0.05rem);
}
.ur-cat-name {
  font-size: 0.82rem;
  font-weight: 600;
  color: rgb(var(--fg-strong));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ur-cat-inherit-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.15rem 0.45rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  background: rgb(var(--bg-base) / 0.6);
  border: 1px solid rgb(var(--line-default));
  border-radius: 9999px;
  cursor: help;
}
.ur-cat-inherit-tag svg {
  font-size: 10px;
  color: rgb(var(--accent));
}
.ur-cat-input {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
  width: 100%;
}
.ur-cat-input::placeholder {
  color: rgb(var(--fg-faint));
  /* Italic + lighter so the inherited placeholder reads as
     "this is what's currently effective" rather than as a literal
     suggested value. */
  font-style: italic;
}
.ur-cat-warning {
  color: rgb(var(--danger));
  font-size: 1rem;
  flex-shrink: 0;
}

@media (max-width: 640px) {
  .ur-cat-row {
    grid-template-columns: 1fr;
    gap: 0.4rem;
  }
}

/* ─── Sticky save bar ─────────────────────────────────────── */
.ur-savebar {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.85rem 1rem;
  background: rgb(var(--bg-base) / 0.92);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgb(var(--line-default));
  border-radius: 4px;
  box-shadow: 0 -4px 12px rgb(0 0 0 / 0.12);
}
.ur-savebar-error,
.ur-savebar-dirty {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  margin-right: auto;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}
.ur-savebar-error {
  color: rgb(var(--danger));
}
.ur-savebar-dirty {
  color: #d4a734;
}
.ur-savebar button[disabled] {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
