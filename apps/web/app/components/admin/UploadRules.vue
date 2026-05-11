<template>
  <!--
    Upload-rules admin — gatekeeper console.

    Every torrent upload runs through a series of admission gates
    before it lands in the queue. This page lets the operator
    configure each gate independently:

      01 — Global gates: six policy levers (NFO, description, title
            blocklist, TMDb id, max size, staff bypass). Each gate
            is colour-coded by its nature (file integrity, content,
            denial, external metadata, capacity, privilege) so the
            eye sorts them at a glance.

      02 — Title pattern routing: per-category regex enforcement on
            torrent titles. Patterns inherit from the parent category
            so an admin can set "TV.S0Xe0Y" once on the "Television"
            root and every subcategory picks it up; setting a
            different regex on a child overrides the inherited one.

    A "policy snapshot" strip up top surfaces the live state at a
    glance: how many gates are armed, how many categories carry an
    explicit pattern, the current size cap, and whether staff are
    subject to the same gates as regular users.

    A floating save bar appears only when the form is dirty;
    discards reset to the last server snapshot.
  -->
  <div class="ur">
    <!-- ── Policy snapshot ─────────────────────────────────────── -->
    <section class="snapshot">
      <article class="snap snap--gates">
        <span class="snap-num tabular-nums">
          <strong>{{ enabledGatesCount }}</strong>
          <span class="snap-frac">/{{ TOTAL_GATES }}</span>
        </span>
        <span class="snap-label">{{ $t('admin.uploadRules.snap.gatesArmed') }}</span>
        <Icon name="ph:shield-check-bold" class="snap-icon" />
      </article>
      <article class="snap snap--patterns">
        <span class="snap-num tabular-nums">
          <strong>{{ explicitPatternsCount }}</strong>
          <span class="snap-frac">/{{ categoryTree.length }}</span>
        </span>
        <span class="snap-label">{{ $t('admin.uploadRules.snap.titlePatterns') }}</span>
        <Icon name="ph:tree-structure-bold" class="snap-icon" />
      </article>
      <article class="snap snap--size">
        <span class="snap-num tabular-nums">{{ sizeCapLabel }}</span>
        <span class="snap-label">{{ $t('admin.uploadRules.snap.sizeCap') }}</span>
        <Icon name="ph:gauge-bold" class="snap-icon" />
      </article>
      <article class="snap snap--bypass" :class="{ 'snap--bypass-on': form.staffBypass }">
        <span class="snap-num">
          <strong>{{ form.staffBypass ? $t('admin.uploadRules.snap.bypassOn') : $t('admin.uploadRules.snap.bypassOff') }}</strong>
        </span>
        <span class="snap-label">{{ $t('admin.uploadRules.snap.staffBypass') }}</span>
        <Icon name="ph:user-circle-gear-bold" class="snap-icon" />
      </article>
    </section>

    <!-- ── Section 01 — Global gates ──────────────────────────── -->
    <section class="block">
      <header class="block-head">
        <span class="block-num">01</span>
        <div class="block-id">
          <h2>{{ $t('admin.uploadRules.gates.title') }}</h2>
          <p>{{ $t('admin.uploadRules.gates.intro') }}</p>
        </div>
        <span class="block-meta">
          <strong>{{ enabledGatesCount }}</strong>
          / {{ TOTAL_GATES }} {{ $t('admin.uploadRules.snap.armed') }}
        </span>
      </header>

      <ul class="gate-grid">
        <!-- Gate 1 — NFO required -->
        <li
          class="gate gate--nfo"
          :class="{ 'gate--off': !form.nfoRequired }"
          :style="{ '--gate-color': '#34d4d8', '--stagger': '0ms' }"
        >
          <header class="gate-head">
            <span class="gate-glyph">
              <Icon name="ph:file-text-bold" />
            </span>
            <div class="gate-id">
              <h3 class="gate-name">{{ $t('admin.uploadRules.nfo.title') }}</h3>
              <p class="gate-desc">{{ $t('admin.uploadRules.nfo.description') }}</p>
            </div>
            <UploadRulesToggle
              v-model="form.nfoRequired"
              :title="$t('admin.uploadRules.nfo.title')"
              variant="bare"
            />
          </header>
        </li>

        <!-- Gate 2 — Description required (+ min length) -->
        <li
          class="gate gate--desc"
          :class="{ 'gate--off': !form.descriptionRequired }"
          :style="{ '--gate-color': '#a78bfa', '--stagger': '60ms' }"
        >
          <header class="gate-head">
            <span class="gate-glyph">
              <Icon name="ph:text-aa-bold" />
            </span>
            <div class="gate-id">
              <h3 class="gate-name">{{ $t('admin.uploadRules.description.title') }}</h3>
              <p class="gate-desc">{{ $t('admin.uploadRules.description.description') }}</p>
            </div>
            <UploadRulesToggle
              v-model="form.descriptionRequired"
              :title="$t('admin.uploadRules.description.title')"
              variant="bare"
            />
          </header>
          <Transition name="gate-cfg">
            <div v-if="form.descriptionRequired" class="gate-cfg">
              <label class="field">
                <span class="field-label">
                  {{ $t('admin.uploadRules.description.minLength') }}
                  <span class="field-unit">{{ $t('admin.uploadRules.units.chars') }}</span>
                </span>
                <input
                  v-model.number="form.descriptionMinLength"
                  type="number"
                  min="0"
                  max="10000"
                  class="field-input"
                />
                <span class="field-hint">{{ $t('admin.uploadRules.description.minLengthHint') }}</span>
              </label>
            </div>
          </Transition>
        </li>

        <!-- Gate 3 — Title blocklist (regex, no toggle — empty = disabled) -->
        <li
          class="gate gate--block"
          :class="{ 'gate--off': !form.titleBlocklist }"
          :style="{ '--gate-color': '#ff6b6b', '--stagger': '120ms' }"
        >
          <header class="gate-head">
            <span class="gate-glyph">
              <Icon name="ph:shield-warning-bold" />
            </span>
            <div class="gate-id">
              <h3 class="gate-name">{{ $t('admin.uploadRules.titleBlocklist.title') }}</h3>
              <p class="gate-desc">{{ $t('admin.uploadRules.titleBlocklist.description') }}</p>
            </div>
          </header>
          <div class="gate-cfg">
            <label class="field field--full">
              <span class="field-label">
                <Icon name="ph:asterisk-bold" class="field-label-icon" />
                {{ $t('admin.uploadRules.titleBlocklist.regexLabel') }}
              </span>
              <input
                v-model="form.titleBlocklist"
                type="text"
                :class="['field-input field-input--mono', { 'field-input--invalid': !!errors.titleBlocklist }]"
                :placeholder="$t('admin.uploadRules.titleBlocklist.placeholder')"
              />
              <p v-if="errors.titleBlocklist" class="field-error">
                <Icon name="ph:warning-bold" />
                {{ $t('admin.uploadRules.invalidRegex') }}
              </p>
              <p v-else class="field-hint">
                <Icon name="ph:info" />
                {{ $t('admin.uploadRules.titleBlocklist.hint') }}
              </p>
            </label>
          </div>
        </li>

        <!-- Gate 4 — TMDb id required -->
        <li
          class="gate gate--tmdb"
          :class="{ 'gate--off': !form.tmdbIdRequired }"
          :style="{ '--gate-color': '#fb923c', '--stagger': '180ms' }"
        >
          <header class="gate-head">
            <span class="gate-glyph">
              <Icon name="ph:film-strip-bold" />
            </span>
            <div class="gate-id">
              <h3 class="gate-name">{{ $t('admin.uploadRules.tmdb.title') }}</h3>
              <p class="gate-desc">{{ $t('admin.uploadRules.tmdb.description') }}</p>
            </div>
            <UploadRulesToggle
              v-model="form.tmdbIdRequired"
              :title="$t('admin.uploadRules.tmdb.title')"
              variant="bare"
            />
          </header>
        </li>

        <!-- Gate 5 — Max torrent size (number + clear) -->
        <li
          class="gate gate--size"
          :class="{ 'gate--off': form.maxTorrentSize === null }"
          :style="{ '--gate-color': '#f5c518', '--stagger': '240ms' }"
        >
          <header class="gate-head">
            <span class="gate-glyph">
              <Icon name="ph:gauge-bold" />
            </span>
            <div class="gate-id">
              <h3 class="gate-name">{{ $t('admin.uploadRules.maxSize.title') }}</h3>
              <p class="gate-desc">{{ $t('admin.uploadRules.maxSize.description') }}</p>
            </div>
          </header>
          <div class="gate-cfg">
            <label class="field">
              <span class="field-label">
                {{ $t('admin.uploadRules.maxSize.title') }}
                <span class="field-unit">GiB</span>
              </span>
              <div class="size-row">
                <input
                  v-model.number="maxSizeGiB"
                  type="number"
                  min="0"
                  step="0.1"
                  class="field-input field-input--mono"
                  :placeholder="$t('admin.uploadRules.maxSize.placeholder')"
                />
                <button
                  v-if="form.maxTorrentSize !== null"
                  type="button"
                  class="size-clear"
                  :title="$t('admin.uploadRules.maxSize.clear')"
                  @click="form.maxTorrentSize = null"
                >
                  <Icon name="ph:x-bold" />
                </button>
              </div>
              <p class="field-hint">
                <Icon name="ph:info" />
                {{ $t('admin.uploadRules.maxSize.hint') }}
              </p>
            </label>
          </div>
        </li>

        <!-- Gate 6 — Staff bypass -->
        <li
          class="gate gate--bypass"
          :class="{ 'gate--off': !form.staffBypass }"
          :style="{ '--gate-color': '#d4a734', '--stagger': '300ms' }"
        >
          <header class="gate-head">
            <span class="gate-glyph">
              <Icon name="ph:user-circle-gear-bold" />
            </span>
            <div class="gate-id">
              <h3 class="gate-name">{{ $t('admin.uploadRules.staffBypass.title') }}</h3>
              <p class="gate-desc">{{ $t('admin.uploadRules.staffBypass.description') }}</p>
            </div>
            <UploadRulesToggle
              v-model="form.staffBypass"
              :title="$t('admin.uploadRules.staffBypass.title')"
              variant="bare"
            />
          </header>
        </li>
      </ul>
    </section>

    <!-- ── Section 02 — Title pattern matrix ─────────────────── -->
    <section class="block">
      <header class="block-head">
        <span class="block-num">02</span>
        <div class="block-id">
          <h2>{{ $t('admin.uploadRules.titlePattern.title') }}</h2>
          <p>{{ $t('admin.uploadRules.titlePattern.intro') }}</p>
        </div>
        <span class="block-meta" v-if="form.titlePatternEnforced">
          <strong>{{ effectivePatternsCount }}</strong>
          / {{ categoryTree.length }} {{ $t('admin.uploadRules.snap.covered') }}
        </span>
      </header>

      <div class="pattern-control">
        <UploadRulesToggle
          v-model="form.titlePatternEnforced"
          :title="$t('admin.uploadRules.titlePattern.enabledTitle')"
          :description="$t('admin.uploadRules.titlePattern.enabledDescription')"
        />
      </div>

      <p class="pattern-explainer">
        <Icon name="ph:info-bold" class="pattern-explainer-icon" />
        <span>{{ $t('admin.uploadRules.titlePattern.explain') }}</span>
      </p>

      <div v-if="!form.titlePatternEnforced" class="pattern-disabled">
        <Icon name="ph:lock-laminated-bold" />
        <span>{{ $t('admin.uploadRules.titlePattern.toggleHint') }}</span>
      </div>

      <div v-else-if="categoryTree.length === 0" class="pattern-empty">
        {{ $t('admin.uploadRules.titlePattern.noCategories') }}
      </div>

      <ul v-else class="cat-tree">
        <li
          v-for="(cat, i) in categoryTree"
          :key="cat.id"
          class="cat-row"
          :class="{
            'cat-row--has': !!form.categoryPatterns[cat.id],
            'cat-row--inherits': !form.categoryPatterns[cat.id] && !!inheritedPatternFor(cat),
          }"
          :style="{ '--depth': cat.depth, '--stagger': `${i * 25}ms` }"
        >
          <div class="cat-line" aria-hidden="true">
            <span v-for="d in cat.depth" :key="d" class="cat-tab" />
            <span v-if="cat.depth > 0" class="cat-corner">└</span>
          </div>
          <div class="cat-meta">
            <span class="cat-name">{{ cat.name }}</span>
            <span
              v-if="!form.categoryPatterns[cat.id] && !!inheritedPatternFor(cat)"
              class="cat-inherit"
              :title="inheritedPatternFor(cat)?.pattern"
            >
              <Icon name="ph:arrow-elbow-up-right-bold" />
              {{
                $t('admin.uploadRules.titlePattern.inheritedFrom', {
                  name: inheritedPatternFor(cat)?.fromName,
                })
              }}
            </span>
            <span
              v-else-if="form.categoryPatterns[cat.id]"
              class="cat-own-tag"
            >
              <span class="cat-own-dot" />
              {{ $t('admin.uploadRules.titlePattern.ownPattern') }}
            </span>
          </div>
          <div class="cat-input-wrap">
            <input
              :value="form.categoryPatterns[cat.id] ?? ''"
              type="text"
              :class="[
                'field-input field-input--mono cat-input',
                { 'field-input--invalid': !!errors.categoryPatterns[cat.id] },
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
              class="cat-warning"
              :title="$t('admin.uploadRules.invalidRegex')"
            />
          </div>
        </li>
      </ul>
    </section>

    <!-- ── Floating save bar ──────────────────────────────────── -->
    <Transition name="savebar">
      <div v-if="dirty || hasErrors" class="savebar">
        <span v-if="hasErrors" class="savebar-status savebar-status--error">
          <Icon name="ph:warning-bold" />
          {{ $t('admin.uploadRules.fixErrorsFirst') }}
        </span>
        <span v-else class="savebar-status savebar-status--dirty">
          <Icon name="ph:floppy-disk-bold" />
          {{ $t('admin.uploadRules.unsavedChanges') }}
        </span>
        <button
          v-if="dirty"
          type="button"
          class="btn btn--ghost"
          :disabled="saving"
          @click="discard"
        >
          {{ $t('common.discard') }}
        </button>
        <button
          type="button"
          class="btn btn--primary"
          :disabled="!dirty || hasErrors || saving"
          @click="save"
        >
          <Icon
            :name="saving ? 'ph:circle-notch' : 'ph:check-bold'"
            :class="saving ? 'spin' : ''"
          />
          <span>{{ $t('common.saveChanges') }}</span>
        </button>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import UploadRulesToggle from './UploadRulesToggle.vue';

interface Category {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
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
  categoryPatterns: Record<string, string>;
  effectiveCategoryPatterns: Record<string, string>;
}

const { t } = useI18n();
const notifications = useNotificationStore();

// ── Source data ──────────────────────────────────────────────
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

// ── Mutable form state (cloned from server snapshot) ────────
const form = ref<RulesPayload>(structuredClone(serverRules.value));

// GiB <-> bytes round-trip for the size input — operators reason
// about GiB, the DB stores bytes.
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

// ── Snapshot derivations ─────────────────────────────────────
// Total gates the snapshot strip counts. Five of the six gates
// are boolean toggles; the title blocklist counts as "armed"
// when it's a non-empty regex.
const TOTAL_GATES = 6;

const enabledGatesCount = computed(() => {
  let n = 0;
  if (form.value.nfoRequired) n += 1;
  if (form.value.descriptionRequired) n += 1;
  if (form.value.tmdbIdRequired) n += 1;
  if (form.value.staffBypass) n += 1;
  if (form.value.titleBlocklist && form.value.titleBlocklist.trim() !== '') n += 1;
  if (form.value.maxTorrentSize !== null) n += 1;
  return n;
});

const explicitPatternsCount = computed(
  () => Object.keys(form.value.categoryPatterns).length,
);

const effectivePatternsCount = computed(() => {
  // Categories with either their own pattern or an inherited one
  // from any ancestor. Matches what the server's effective-map
  // resolver would compute.
  let n = 0;
  for (const row of categoryTree.value) {
    if (form.value.categoryPatterns[row.id]) n += 1;
    else if (inheritedPatternFor(row)) n += 1;
  }
  return n;
});

const sizeCapLabel = computed(() => {
  if (form.value.maxTorrentSize === null)
    return t('admin.uploadRules.snap.noCap');
  const gib = form.value.maxTorrentSize / 1024 ** 3;
  if (gib >= 1024) return `${(gib / 1024).toFixed(1)} TiB`;
  if (gib >= 1) return `${Math.round(gib * 10) / 10} GiB`;
  const mib = form.value.maxTorrentSize / 1024 ** 2;
  return `${Math.round(mib)} MiB`;
});

// ── Category tree (flattened DFS) ─────────────────────────────
interface CategoryRow {
  id: string;
  name: string;
  depth: number;
  parentChain: { id: string; name: string }[];
}

const categoryTree = computed<CategoryRow[]>(() => {
  const roots = categories.value ?? [];
  const out: CategoryRow[] = [];
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

function inheritedPatternFor(row: CategoryRow): {
  pattern: string;
  fromName: string;
} | null {
  for (let i = row.parentChain.length - 1; i >= 0; i--) {
    const parent = row.parentChain[i]!;
    const p = form.value.categoryPatterns[parent.id];
    if (p) return { pattern: p, fromName: parent.name };
  }
  return null;
}

// ── Regex validation ────────────────────────────────────────
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

// ── Save guard ──────────────────────────────────────────────
const hasErrors = computed(
  () =>
    errors.titleBlocklist ||
    Object.values(errors.categoryPatterns).some(Boolean),
);

const dirty = computed(
  () => JSON.stringify(form.value) !== JSON.stringify(serverRules.value),
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
          Object.entries(form.value.categoryPatterns).filter(
            ([, v]) => v.trim() !== '',
          ),
        ),
      },
    });
    notifications.success(t('admin.uploadRules.saved'));
    await refreshRules();
  } catch (err: any) {
    const invalid = err?.data?.invalidFields as string[] | undefined;
    if (Array.isArray(invalid)) {
      for (const path of invalid) {
        if (path === 'titleBlocklist') errors.titleBlocklist = true;
        else if (path.startsWith('categoryPatterns.')) {
          errors.categoryPatterns[path.slice('categoryPatterns.'.length)] = true;
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

function discard() {
  if (saving.value) return;
  form.value = structuredClone(serverRules.value);
  errors.titleBlocklist = false;
  for (const k of Object.keys(errors.categoryPatterns)) {
    delete errors.categoryPatterns[k];
  }
}
</script>

<style scoped>
/* ── Container ──────────────────────────────────────────────── */
.ur {
  display: flex;
  flex-direction: column;
  gap: 2.25rem;
  position: relative;
  padding-bottom: 4.5rem; /* room for floating save bar */
}
.ur::before {
  /* Hairline gold rail along the left edge of the page body —
     same thread the bonus / notifications surfaces use, signals
     "this is an admin policy surface". */
  content: '';
  position: absolute;
  left: -0.75rem;
  top: 0;
  bottom: 4.5rem;
  width: 1px;
  background: linear-gradient(
    to bottom,
    rgba(212, 167, 52, 0) 0%,
    rgba(212, 167, 52, 0.35) 12%,
    rgba(212, 167, 52, 0.35) 88%,
    rgba(212, 167, 52, 0) 100%
  );
  pointer-events: none;
}

/* ── Snapshot strip ─────────────────────────────────────────── */
.snapshot {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  background: rgb(var(--bg-elevated));
  overflow: hidden;
  position: relative;
}
.snapshot::before {
  content: '';
  position: absolute;
  inset-inline: 1rem;
  top: 0;
  height: 1px;
  background: linear-gradient(
    to right,
    rgba(212, 167, 52, 0.55) 0%,
    rgba(212, 167, 52, 0.2) 60%,
    rgba(212, 167, 52, 0) 100%
  );
}
@media (max-width: 720px) {
  .snapshot { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
.snap {
  position: relative;
  padding: 1.1rem 1.2rem 1.2rem;
  border-right: 1px solid rgb(var(--line-default));
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.snap:last-child { border-right: 0; }
@media (max-width: 720px) {
  .snap { border-bottom: 1px solid rgb(var(--line-default)); }
  .snap:nth-child(2n) { border-right: 0; }
  .snap:nth-last-child(-n + 2) { border-bottom: 0; }
}
.snap-num {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: clamp(1.5rem, 2.6vw, 1.9rem);
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1;
}
.snap-num strong { color: rgb(var(--fg-strong)); font-weight: 800; }
.snap-frac { color: rgb(var(--fg-faint)); font-size: 0.6em; font-weight: 600; margin-left: 0.2em; }
.snap--gates .snap-num strong { color: #34d4d8; }
.snap--patterns .snap-num strong { color: #a78bfa; }
.snap--size .snap-num { color: rgb(var(--fg-strong)); font-size: 1.3rem; font-weight: 700; }
.snap--bypass .snap-num strong {
  font-size: 1.05rem;
  color: rgb(var(--fg-muted));
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.snap--bypass-on .snap-num strong { color: #d4a734; }
.snap-label {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.snap-icon {
  position: absolute;
  top: 1rem;
  right: 1rem;
  font-size: 1.1rem;
  color: rgb(var(--fg-faint));
}

/* ── Block scaffold (sections 01 / 02) ──────────────────────── */
.block {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.block-head {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.85rem;
  padding-bottom: 0.85rem;
  border-bottom: 1px solid rgb(var(--line-default));
  position: relative;
}
.block-head::after {
  content: '';
  position: absolute;
  left: 0;
  bottom: -1px;
  width: 40px;
  height: 1px;
  background: #d4a734;
}
.block-num {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.2em;
  color: #d4a734;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgba(212, 167, 52, 0.35);
  padding: 0.3rem 0.55rem;
  border-radius: var(--radius-sm);
}
.block-id h2 {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
}
.block-id p {
  margin: 0.2rem 0 0;
  font-size: 0.78rem;
  color: rgb(var(--fg-muted));
  line-height: 1.5;
}
.block-meta {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  letter-spacing: 0.1em;
  color: rgb(var(--fg-muted));
  text-transform: uppercase;
}
.block-meta strong {
  color: rgb(var(--fg-strong));
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
@media (max-width: 640px) {
  .block-head { grid-template-columns: auto 1fr; }
  .block-meta { grid-column: 1 / -1; margin-top: 0.3rem; }
}

/* ── Gate grid ──────────────────────────────────────────────── */
.gate-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.85rem;
}
@media (min-width: 900px) {
  .gate-grid { grid-template-columns: 1fr 1fr; }
}

.gate {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.95rem 1.1rem 1.1rem;
  border: 1px solid rgb(var(--line-default));
  border-left: 3px solid var(--gate-color);
  border-radius: var(--radius-md);
  background: rgb(var(--bg-elevated));
  transition: border-color 0.18s ease, opacity 0.18s ease, background 0.18s ease;
  animation: gate-in 0.4s cubic-bezier(0.2, 0.7, 0.2, 1) backwards;
  animation-delay: var(--stagger, 0ms);
  overflow: hidden;
}
.gate::before {
  /* Subtle tinted glow at the left edge that picks up the gate
     colour. Sits behind content via z-index, the border-left
     stays the harder line. */
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: 2.5rem;
  background: linear-gradient(
    to right,
    color-mix(in srgb, var(--gate-color) 12%, transparent),
    transparent
  );
  pointer-events: none;
}
.gate--off {
  opacity: 0.6;
  background: rgb(var(--bg-elevated) / 0.5);
}
.gate--off::before { opacity: 0.3; }
.gate:hover:not(.gate--off) { border-color: rgb(var(--line-strong)); }

@keyframes gate-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.gate-head {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.85rem;
  position: relative;
}
.gate-glyph {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  font-size: 1.15rem;
  color: var(--gate-color);
  background: color-mix(in srgb, var(--gate-color) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--gate-color) 35%, transparent);
}
.gate-id { min-width: 0; }
.gate-name {
  margin: 0 0 0.15rem;
  font-size: 0.92rem;
  font-weight: 800;
  letter-spacing: 0.01em;
  color: rgb(var(--fg-strong));
}
.gate-desc {
  margin: 0;
  font-size: 0.74rem;
  color: rgb(var(--fg-muted));
  line-height: 1.45;
}

.gate-cfg {
  padding-top: 0.75rem;
  border-top: 1px dashed rgb(var(--line-default) / 0.6);
}
.gate-cfg-enter-active,
.gate-cfg-leave-active {
  transition: max-height 0.3s cubic-bezier(0.2, 0.7, 0.2, 1),
    opacity 0.22s ease, padding-top 0.22s ease;
  overflow: hidden;
}
.gate-cfg-enter-from,
.gate-cfg-leave-to {
  max-height: 0;
  opacity: 0;
  padding-top: 0;
}
.gate-cfg-enter-to,
.gate-cfg-leave-from {
  max-height: 800px;
  opacity: 1;
}

/* ── Fields ────────────────────────────────────────────────── */
.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
}
.field--full { width: 100%; }
.field-label {
  font-size: 0.78rem;
  font-weight: 600;
  color: rgb(var(--fg-strong));
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
.field-label-icon {
  color: var(--gate-color);
  font-size: 0.9rem;
}
.field-unit {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgb(var(--fg-subtle));
  padding: 0.05rem 0.4rem;
  background: rgb(var(--bg-inset));
  border-radius: var(--radius-sm);
}
.field-hint {
  margin: 0;
  font-size: 0.7rem;
  color: rgb(var(--fg-muted));
  line-height: 1.45;
  display: inline-flex;
  align-items: flex-start;
  gap: 0.35rem;
}
.field-hint > svg { color: rgb(var(--fg-faint)); margin-top: 0.1rem; flex-shrink: 0; }
.field-error {
  margin: 0;
  font-size: 0.72rem;
  color: rgb(var(--danger));
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}
.field-input {
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  padding: 0.5rem 0.7rem;
  color: rgb(var(--fg-strong));
  font-size: 0.9rem;
  font-family: inherit;
  min-width: 0;
  width: 100%;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}
.field-input--mono {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-variant-numeric: tabular-nums;
  font-size: 0.85rem;
}
.field-input:focus {
  outline: none;
  border-color: rgba(212, 167, 52, 0.6);
  box-shadow: 0 0 0 3px rgba(212, 167, 52, 0.12);
}
.field-input--invalid {
  border-color: rgba(239, 68, 68, 0.55);
  box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.1);
}
.field-input::placeholder {
  color: rgb(var(--fg-faint));
  font-style: italic;
}

/* Max-size input + clear button */
.size-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.5rem;
  align-items: center;
}
.size-clear {
  background: transparent;
  border: 1px solid rgb(var(--line-default));
  color: rgb(var(--fg-muted));
  border-radius: var(--radius-sm);
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: all 0.15s ease;
}
.size-clear:hover {
  color: rgb(var(--danger));
  border-color: rgba(239, 68, 68, 0.4);
  background: rgba(239, 68, 68, 0.06);
}

/* ── Pattern (section 02) preamble ─────────────────────────── */
.pattern-control {
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  background: rgb(var(--bg-elevated));
  padding: 0.95rem 1.1rem;
}
.pattern-explainer {
  margin: 0;
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  padding: 0.7rem 0.85rem;
  background: rgba(212, 167, 52, 0.06);
  border: 1px dashed rgba(212, 167, 52, 0.3);
  border-radius: var(--radius-sm);
  font-size: 0.78rem;
  color: rgb(var(--fg-strong));
  line-height: 1.5;
}
.pattern-explainer-icon {
  color: #d4a734;
  font-size: 1rem;
  flex-shrink: 0;
  margin-top: 0.1rem;
}
.pattern-disabled {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 2rem 1rem;
  border: 1px dashed rgb(var(--line-default));
  border-radius: var(--radius-md);
  background: rgb(var(--bg-elevated) / 0.5);
  font-size: 0.85rem;
  color: rgb(var(--fg-muted));
  font-style: italic;
}
.pattern-disabled > svg {
  color: rgb(var(--fg-faint));
  font-size: 1.1rem;
}
.pattern-empty {
  padding: 1.5rem 1rem;
  text-align: center;
  font-size: 0.85rem;
  color: rgb(var(--fg-muted));
  font-style: italic;
  border: 1px dashed rgb(var(--line-default));
  border-radius: var(--radius-md);
}

/* ── Category tree ─────────────────────────────────────────── */
.cat-tree {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.cat-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) minmax(0, 1.4fr);
  gap: 0.6rem;
  align-items: center;
  padding: 0.55rem 0.85rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  animation: gate-in 0.35s cubic-bezier(0.2, 0.7, 0.2, 1) backwards;
  animation-delay: var(--stagger, 0ms);
  transition: border-color 0.18s ease, background 0.18s ease;
}
.cat-row:hover { border-color: rgb(var(--line-strong)); }
.cat-row--has {
  border-left: 2px solid #d4a734;
  padding-left: calc(0.85rem - 1px);
}
.cat-row--inherits {
  border-left: 2px solid rgba(212, 167, 52, 0.35);
  border-left-style: dashed;
  padding-left: calc(0.85rem - 1px);
}

/* The depth gutter — a column of small tab spacers plus a corner
   character for non-root rows. CSS-only "tree connector" without
   needing nested DOM. */
.cat-line {
  display: inline-flex;
  align-items: center;
  font-family: ui-monospace, SFMono-Regular, monospace;
  color: rgb(var(--fg-faint));
  font-size: 0.85rem;
}
.cat-tab {
  display: inline-block;
  width: 1.1rem;
  border-left: 1px dashed rgb(var(--line-default));
  height: 1.4rem;
  margin-right: 0.05rem;
}
.cat-tab:first-child {
  border-left: 0;
}
.cat-corner {
  font-family: ui-monospace, SFMono-Regular, monospace;
  color: rgb(var(--fg-faint));
  margin-right: 0.35rem;
}

.cat-meta {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
  flex-wrap: wrap;
}
.cat-name {
  font-size: 0.85rem;
  font-weight: 600;
  color: rgb(var(--fg-strong));
}
.cat-inherit,
.cat-own-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  padding: 0.2rem 0.45rem;
  border-radius: var(--radius-sm);
}
.cat-inherit {
  color: rgb(var(--fg-muted));
  border: 1px dashed rgba(212, 167, 52, 0.4);
  background: rgba(212, 167, 52, 0.04);
}
.cat-inherit > svg { color: #d4a734; }
.cat-own-tag {
  color: #d4a734;
  border: 1px solid rgba(212, 167, 52, 0.5);
  background: rgba(212, 167, 52, 0.08);
}
.cat-own-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #d4a734;
  box-shadow: 0 0 0 3px rgba(212, 167, 52, 0.18);
}

.cat-input-wrap {
  position: relative;
  min-width: 0;
}
.cat-input {
  width: 100%;
}
.cat-warning {
  position: absolute;
  right: 0.6rem;
  top: 50%;
  transform: translateY(-50%);
  color: rgb(var(--danger));
  font-size: 0.95rem;
  pointer-events: none;
}

@media (max-width: 720px) {
  .cat-row {
    grid-template-columns: 1fr;
    gap: 0.4rem;
  }
  .cat-line { display: none; }
  /* On mobile, show indent via padding-left scaling with depth.
     Cheap proxy for the tree connector. */
  .cat-row {
    padding-left: calc(0.85rem + var(--depth, 0) * 0.7rem);
  }
}

/* ── Floating save bar ─────────────────────────────────────── */
.savebar {
  position: fixed;
  left: 50%;
  bottom: 1.25rem;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.7rem 1rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgba(212, 167, 52, 0.55);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-overlay);
  backdrop-filter: blur(10px);
  z-index: 50;
  max-width: calc(100% - 2rem);
}
.savebar-status {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.savebar-status--dirty { color: #d4a734; }
.savebar-status--error { color: rgb(var(--danger)); }

.savebar-enter-active,
.savebar-leave-active {
  transition: transform 0.3s cubic-bezier(0.2, 0.7, 0.2, 1),
    opacity 0.22s ease;
}
.savebar-enter-from,
.savebar-leave-to {
  transform: translate(-50%, 120%);
  opacity: 0;
}

/* ── Buttons ─────────────────────────────────────────────── */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.95rem;
  border-radius: var(--radius-sm);
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-base));
  color: rgb(var(--fg-strong));
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: inherit;
  white-space: nowrap;
}
.btn:hover:not(:disabled) {
  border-color: rgba(212, 167, 52, 0.5);
  background: rgba(212, 167, 52, 0.05);
}
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn--ghost { background: transparent; }
.btn--primary {
  background: #d4a734;
  border-color: #d4a734;
  color: #1a1a1a;
}
.btn--primary:hover:not(:disabled) {
  background: #e8b94e;
  border-color: #e8b94e;
}

.spin {
  animation: ur-spin 1s linear infinite;
}
@keyframes ur-spin {
  to { transform: rotate(360deg); }
}
</style>
