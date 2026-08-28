<template>
  <div class="space-y-6">
    <!-- ── Site-wide settings ─────────────────────────────────────── -->
    <div class="card">
      <div class="card-header">
        <div class="flex items-center gap-2">
          <Icon name="ph:palette" class="text-text-muted" />
          <h3 class="text-xs font-bold uppercase tracking-wider text-text-primary">
            {{ $t('admin.themes.settingsTitle') }}
          </h3>
        </div>
      </div>
      <div class="card-body">
        <SettingsGroup
          :label="$t('admin.themes.defaultLabel')"
          :description="$t('admin.themes.defaultDescription')"
        >
          <select v-model="settings.themeDefault" class="input">
            <option value="system">{{ $t('admin.themes.systemOption') }}</option>
            <option v-for="o in pickable" :key="o.slug" :value="o.slug">
              {{ o.name }}
            </option>
          </select>
        </SettingsGroup>

        <SettingsGroup
          :label="$t('admin.themes.systemLabel')"
          :description="$t('admin.themes.systemDescription')"
        >
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label class="block">
              <span class="block text-[10px] font-bold uppercase tracking-widest text-text-muted mb-1">
                <Icon name="ph:sun-bold" /> {{ $t('admin.themes.whenLight') }}
              </span>
              <select v-model="settings.systemLight" class="input">
                <option v-for="o in pickable" :key="o.slug" :value="o.slug">
                  {{ o.name }}
                </option>
              </select>
            </label>
            <label class="block">
              <span class="block text-[10px] font-bold uppercase tracking-widest text-text-muted mb-1">
                <Icon name="ph:moon-stars-bold" /> {{ $t('admin.themes.whenDark') }}
              </span>
              <select v-model="settings.systemDark" class="input">
                <option v-for="o in pickable" :key="o.slug" :value="o.slug">
                  {{ o.name }}
                </option>
              </select>
            </label>
          </div>
          <p v-if="sameSystemHalves" class="mt-2 text-xs text-error">
            {{ $t('admin.themes.systemMustDiffer') }}
          </p>
        </SettingsGroup>

        <div class="flex items-center gap-3 pt-4">
          <button
            class="btn btn-primary btn-sm"
            :disabled="savingSettings || sameSystemHalves"
            @click="saveSettings"
          >
            <Icon name="ph:check-bold" /> {{ $t('common.save') }}
          </button>
          <span v-if="settingsSaved" class="text-xs text-success">
            {{ $t('common.saved') }}
          </span>
          <span v-if="settingsError" class="text-xs text-error">{{ settingsError }}</span>
        </div>
      </div>
    </div>

    <!-- ── The list ───────────────────────────────────────────────── -->
    <div class="card">
      <div class="card-header flex items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <Icon name="ph:swatches" class="text-text-muted" />
          <h3 class="text-xs font-bold uppercase tracking-wider text-text-primary">
            {{ $t('admin.themes.listTitle') }}
          </h3>
          <span class="text-[10px] font-mono text-text-faint">
            {{ $t('admin.themes.enabledCount', { n: enabledCount, max: maxEnabled }) }}
          </span>
        </div>
        <div class="flex items-center gap-2">
          <button class="btn btn-sm" @click="importFile?.click()">
            <Icon name="ph:upload-simple-bold" /> {{ $t('admin.themes.import') }}
          </button>
          <input
            ref="importFile"
            type="file"
            accept="application/json,.json"
            class="hidden"
            @change="onImport"
          />
          <button class="btn btn-primary btn-sm" @click="startCreate()">
            <Icon name="ph:plus-bold" /> {{ $t('admin.themes.create') }}
          </button>
        </div>
      </div>

      <div class="card-body">
        <p v-if="!themes.length" class="text-sm text-text-muted py-6 text-center">
          {{ $t('admin.themes.empty') }}
        </p>

        <ul v-else class="flex flex-col gap-2">
          <li
            v-for="t in themes"
            :key="t.id"
            class="theme-row"
            :class="{ 'theme-row--off': !t.enabled }"
          >
            <span class="theme-swatches" :title="t.slug">
              <span
                v-for="k in ['bg-base', 'bg-surface', 'accent', 'fg-default']"
                :key="k"
                class="theme-swatch"
                :style="{ background: `rgb(${resolvedFor(t)[k]})` }"
              />
            </span>

            <span class="theme-ident">
              <span class="theme-name">{{ t.name }}</span>
              <code class="theme-slug">{{ t.slug }}</code>
            </span>

            <span class="theme-badges">
              <span class="theme-badge">{{ t.base }}</span>
              <span v-if="t.visibility === 'roles'" class="theme-badge theme-badge--role">
                <Icon name="ph:lock-simple-bold" />
                {{ roleNames(t.requiredRoles) }}
              </span>
              <span
                v-for="w in warningsFor(t)"
                :key="w.pair.what"
                class="theme-badge theme-badge--warn"
                :title="$t('admin.themes.contrastDetail', {
                  what: w.pair.what,
                  ratio: w.ratio,
                  required: w.required,
                })"
              >
                <Icon name="ph:warning-bold" /> {{ w.pair.what }}
              </span>
            </span>

            <span class="theme-actions">
              <button class="theme-act" :title="$t('admin.themes.edit')" @click="startEdit(t)">
                <Icon name="ph:pencil-simple-bold" />
              </button>
              <button
                class="theme-act"
                :title="$t('admin.themes.duplicate')"
                @click="duplicate(t.slug, t.name)"
              >
                <Icon name="ph:copy-bold" />
              </button>
              <button class="theme-act" :title="$t('admin.themes.export')" @click="exportOne(t)">
                <Icon name="ph:download-simple-bold" />
              </button>
              <button
                class="theme-act"
                :title="t.enabled ? $t('admin.themes.disable') : $t('admin.themes.enable')"
                @click="toggleEnabled(t)"
              >
                <Icon :name="t.enabled ? 'ph:eye-bold' : 'ph:eye-slash-bold'" />
              </button>
              <button
                class="theme-act theme-act--danger"
                :title="$t('admin.themes.delete')"
                @click="remove(t)"
              >
                <Icon name="ph:trash-bold" />
              </button>
            </span>
          </li>
        </ul>
      </div>
    </div>

    <!-- ── The editor ─────────────────────────────────────────────────
         An inline panel rather than a modal, and for one reason: the live
         preview repaints the whole page, so a dialog covering it would hide
         the thing being previewed. -->
    <div v-if="draft" class="card">
      <div class="card-header flex items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <Icon name="ph:sliders-horizontal" class="text-text-muted" />
          <h3 class="text-xs font-bold uppercase tracking-wider text-text-primary">
            {{ draft.id ? $t('admin.themes.editing', { name: draft.name }) : $t('admin.themes.creating') }}
          </h3>
        </div>
        <label class="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-text-muted cursor-pointer">
          <input v-model="previewOn" type="checkbox" class="accent-accent" />
          {{ $t('admin.themes.livePreview') }}
        </label>
      </div>

      <div class="card-body space-y-4">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label class="block">
            <span class="field-label">{{ $t('admin.themes.name') }}</span>
            <input v-model="draft.name" class="input" maxlength="60" />
          </label>
          <label class="block">
            <span class="field-label">{{ $t('admin.themes.base') }}</span>
            <select v-model="draft.base" class="input">
              <option value="dark">dark</option>
              <option value="light">light</option>
            </select>
            <span class="field-help">{{ $t('admin.themes.baseHelp') }}</span>
          </label>
        </div>

        <label class="block">
          <span class="field-label">{{ $t('admin.themes.description') }}</span>
          <input v-model="draft.description" class="input" maxlength="300" />
        </label>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label class="block">
            <span class="field-label">{{ $t('admin.themes.visibility') }}</span>
            <select v-model="draft.visibility" class="input">
              <option value="site">{{ $t('admin.themes.visibilitySite') }}</option>
              <option value="roles">{{ $t('admin.themes.visibilityRoles') }}</option>
            </select>
          </label>
          <div v-if="draft.visibility === 'roles'">
            <span class="field-label">{{ $t('admin.themes.requiredRoles') }}</span>
            <div class="role-picker">
              <label v-for="r in roles" :key="r.id" class="role-chip">
                <input
                  type="checkbox"
                  :value="r.id"
                  :checked="draft.requiredRoles.includes(r.id)"
                  @change="toggleRole(r.id)"
                />
                {{ r.name }}
              </label>
            </div>
          </div>
        </div>

        <!-- The honesty note. It is in the interface and not only in a code
             comment because an operator setting this up will otherwise read it
             as an access control. -->
        <p v-if="draft.visibility === 'roles'" class="notice">
          <Icon name="ph:info-bold" />
          {{ $t('admin.themes.visibilityNotAccessControl') }}
        </p>

        <!-- ── Tokens ───────────────────────────────────────────────── -->
        <div v-for="group in tokenGroups" :key="group.key" class="token-group">
          <button class="token-group-head" @click="toggleGroup(group.key)">
            <Icon
              :name="openGroups.has(group.key) ? 'ph:caret-down-bold' : 'ph:caret-right-bold'"
            />
            {{ $t(`admin.themes.groups.${group.key}`) }}
            <span class="token-group-count">
              {{ overriddenIn(group.keys) }}/{{ group.keys.length }}
            </span>
          </button>

          <div v-if="openGroups.has(group.key)" class="token-grid">
            <div
              v-for="def in group.defs"
              :key="def.key"
              class="token-field"
              :class="{ 'token-field--overridden': isOverridden(def.key) }"
            >
              <span class="token-key">--{{ def.key }}</span>

              <!-- An `enum` is a select; everything else is a value the base
                   supplies a placeholder for, so an empty field SHOWS what it
                   would inherit without storing it. -->
              <select
                v-if="def.kind === 'enum'"
                class="input input-xs"
                :value="draft.tokens[def.key] ?? ''"
                @change="setToken(def.key, ($event.target as HTMLSelectElement).value)"
              >
                <option value="">
                  {{ $t('admin.themes.inherited', { value: baseValue(def.key) }) }}
                </option>
                <option v-for="o in def.options" :key="o" :value="o">{{ o }}</option>
              </select>

              <!-- A scalar is the most expressive control in the editor —
                   `shadow-strength` and `motion-scale` each move hundreds of
                   declarations at once — so it gets a slider, with the text
                   field kept alongside for typing an exact value and for
                   clearing back to inherited. -->
              <template v-else-if="def.kind === 'scalar'">
                <input
                  type="range"
                  class="token-range"
                  min="0"
                  :max="def.max ?? 1"
                  step="0.05"
                  :value="draft.tokens[def.key] ?? baseValue(def.key)"
                  @input="setToken(def.key, ($event.target as HTMLInputElement).value)"
                />
                <input
                  class="input input-xs token-scalar"
                  :value="draft.tokens[def.key] ?? ''"
                  :placeholder="baseValue(def.key)"
                  @change="setToken(def.key, ($event.target as HTMLInputElement).value)"
                />
              </template>

              <template v-else-if="def.kind === 'bezier'">
                <input
                  class="input input-xs"
                  :list="`ease-${def.key}`"
                  :value="draft.tokens[def.key] ?? ''"
                  :placeholder="baseValue(def.key)"
                  @change="setToken(def.key, ($event.target as HTMLInputElement).value)"
                />
                <!-- Suggestions, not a closed list: any four-number bezier is
                     valid, and the overshoot curve is the whole point of
                     offering one at all. -->
                <datalist :id="`ease-${def.key}`">
                  <option v-for="e in EASING_SUGGESTIONS" :key="e" :value="e" />
                </datalist>
              </template>

              <template v-else-if="def.kind === 'rgb'">
                <input
                  type="color"
                  class="token-colour"
                  :value="hexOf(draft.tokens[def.key] ?? baseValue(def.key))"
                  @input="setToken(def.key, tripletOf(($event.target as HTMLInputElement).value))"
                />
                <input
                  class="input input-xs token-triplet"
                  :value="draft.tokens[def.key] ?? ''"
                  :placeholder="baseValue(def.key)"
                  @change="setToken(def.key, ($event.target as HTMLInputElement).value)"
                />
              </template>

              <input
                v-else
                class="input input-xs"
                :value="draft.tokens[def.key] ?? ''"
                :placeholder="baseValue(def.key)"
                @change="setToken(def.key, ($event.target as HTMLInputElement).value)"
              />

              <button
                v-if="isOverridden(def.key)"
                class="token-reset"
                :title="$t('admin.themes.reset')"
                @click="resetToken(def.key)"
              >
                <Icon name="ph:arrow-counter-clockwise-bold" />
              </button>
            </div>
          </div>
        </div>

        <!-- Contrast, on the draft as it stands. -->
        <div v-if="draftWarnings.length" class="notice notice--warn">
          <Icon name="ph:warning-bold" />
          <span>
            {{ $t('admin.themes.contrastHeader') }}
            <ul class="mt-1 space-y-0.5">
              <li v-for="w in draftWarnings" :key="w.pair.what">
                {{ $t('admin.themes.contrastDetail', {
                  what: w.pair.what,
                  ratio: w.ratio,
                  required: w.required,
                }) }}
              </li>
            </ul>
          </span>
        </div>

        <div class="flex items-center gap-3 pt-2">
          <button class="btn btn-primary btn-sm" :disabled="saving" @click="save">
            <Icon name="ph:check-bold" /> {{ $t('common.save') }}
          </button>
          <button class="btn btn-sm" @click="cancel">{{ $t('common.cancel') }}</button>
          <span v-if="editorError" class="text-xs text-error">{{ editorError }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * The theme editor.
 *
 * Three things here are decisions rather than layout, and each is commented where
 * it happens:
 *
 * 1. **A field left empty is an inheritance, not a value.** `tokens` stores only
 *    what diverges from the base, so the base value goes in the `placeholder` and
 *    "reset" DELETES the key rather than writing a copy of the default. That is
 *    what keeps a theme receiving later corrections to the built-ins instead of
 *    forking from them the first time it is saved — the failure WordPress style
 *    variations have.
 * 2. **The live preview writes through CSSOM**, not through a stylesheet. It is
 *    instant, it needs no round trip, an invalid value is simply not applied (so
 *    a bad token cannot break the page being edited), and `element.style` is
 *    outside CSP entirely. The previously-applied keys are tracked so switching
 *    themes clears the stale ones instead of leaking them.
 * 3. **The editor is an inline panel, not a modal.** The preview repaints the
 *    whole page; a dialog on top of it would hide the thing being judged.
 */
import {
  BUILT_IN_TOKENS,
  THEME_TOKENS,
  contrastWarnings,
  parseRgb,
  resolveTokens,
  type TokenGroup,
} from '@trackarr/shared/theme';

interface ThemeRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  base: 'light' | 'dark';
  tokens: Record<string, string>;
  enabled: boolean;
  position: number;
  visibility: string;
  requiredRoles: string[] | null;
}

interface Payload {
  themes: ThemeRow[];
  settings: { themeDefault: string; systemLight: string; systemDark: string };
  maxEnabled: number;
  enabledCount: number;
  roles: Array<{ id: string; name: string }>;
}

const { t } = useI18n();
const { data, refresh } = await useFetch<Payload>('/api/admin/themes', {
  default: () => ({
    themes: [],
    settings: { themeDefault: 'dark', systemLight: 'light', systemDark: 'dark' },
    maxEnabled: 10,
    enabledCount: 0,
    roles: [],
  }),
});

const themes = computed(() => data.value.themes);
const roles = computed(() => data.value.roles);
const maxEnabled = computed(() => data.value.maxEnabled);
const enabledCount = computed(() => themes.value.filter((x) => x.enabled).length);

/** Every slug an admin may point a setting at: the built-ins plus enabled rows. */
const pickable = computed(() => [
  { slug: 'light', name: 'Light (built-in)' },
  { slug: 'dark', name: 'Dark (built-in)' },
  ...themes.value.filter((x) => x.enabled).map((x) => ({ slug: x.slug, name: x.name })),
]);

// ── Site settings ────────────────────────────────────────────────────
const settings = ref({ themeDefault: 'dark', systemLight: 'light', systemDark: 'dark' });
watch(
  () => data.value.settings,
  (s) => { if (s) settings.value = { ...s }; },
  { immediate: true, deep: true },
);
const sameSystemHalves = computed(
  () => settings.value.systemLight === settings.value.systemDark,
);
const savingSettings = ref(false);
const settingsSaved = ref(false);
const settingsError = ref('');

async function saveSettings() {
  savingSettings.value = true;
  settingsError.value = '';
  try {
    await $fetch('/api/admin/themes/settings', { method: 'PUT', body: settings.value });
    settingsSaved.value = true;
    setTimeout(() => (settingsSaved.value = false), 2000);
    await refresh();
  } catch (e) {
    settingsError.value = messageOf(e);
  } finally {
    savingSettings.value = false;
  }
}

// ── Tokens, grouped for the editor ───────────────────────────────────
const GROUP_ORDER: TokenGroup[] = [
  'surface',
  'foreground',
  'line',
  'accent',
  'semantic',
  'elevation',
  'shape',
  'motion',
  'chrome',
  'ambience',
];

/**
 * Offered in the easing fields' datalist.
 *
 * The first two are the site's own curves, so a theme can start from what it
 * already looks like. The overshoot is there because it is the one a theme
 * author cannot guess and the one that most changes how the interface feels.
 */
const EASING_SUGGESTIONS = [
  'cubic-bezier(0.2, 0.7, 0.2, 1)',
  'cubic-bezier(0.22, 1, 0.36, 1)',
  'cubic-bezier(0.34, 1.56, 0.64, 1)',
  'ease',
  'ease-out',
  'linear',
];
const tokenGroups = computed(() =>
  GROUP_ORDER.map((key) => {
    const defs = THEME_TOKENS.filter((d) => d.group === key);
    return { key, defs, keys: defs.map((d) => d.key) };
  }).filter((g) => g.defs.length),
);
const openGroups = ref(new Set<string>(['surface', 'foreground', 'accent']));
function toggleGroup(key: string) {
  const next = new Set(openGroups.value);
  next.has(key) ? next.delete(key) : next.add(key);
  openGroups.value = next;
}

// ── The draft ────────────────────────────────────────────────────────
interface Draft {
  id: string | null;
  slug: string | null;
  name: string;
  description: string;
  base: 'light' | 'dark';
  tokens: Record<string, string>;
  enabled: boolean;
  visibility: string;
  requiredRoles: string[];
  duplicateOf?: string;
}
const draft = ref<Draft | null>(null);
const saving = ref(false);
const editorError = ref('');

function blankDraft(over: Partial<Draft> = {}): Draft {
  return {
    id: null,
    slug: null,
    name: '',
    description: '',
    base: 'dark',
    tokens: {},
    enabled: true,
    visibility: 'site',
    requiredRoles: [],
    ...over,
  };
}

function startCreate(over: Partial<Draft> = {}) {
  draft.value = blankDraft(over);
  editorError.value = '';
}

function startEdit(row: ThemeRow) {
  draft.value = {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? '',
    base: row.base,
    tokens: { ...row.tokens },
    enabled: row.enabled,
    visibility: row.visibility,
    requiredRoles: [...(row.requiredRoles ?? [])],
  };
  editorError.value = '';
}

function cancel() {
  draft.value = null;
  clearPreview();
}

function baseValue(key: string): string {
  return BUILT_IN_TOKENS[draft.value?.base ?? 'dark'][key] ?? '';
}

function isOverridden(key: string): boolean {
  return draft.value ? key in draft.value.tokens : false;
}

function overriddenIn(keys: string[]): number {
  return keys.filter((k) => isOverridden(k)).length;
}

/** An empty value is a RESET, not a stored empty string. */
function setToken(key: string, raw: string) {
  if (!draft.value) return;
  const value = raw.trim();
  if (!value) {
    resetToken(key);
    return;
  }
  draft.value.tokens = { ...draft.value.tokens, [key]: value };
}

function resetToken(key: string) {
  if (!draft.value) return;
  const next = { ...draft.value.tokens };
  delete next[key];
  draft.value.tokens = next;
}

function toggleRole(id: string) {
  if (!draft.value) return;
  const held = draft.value.requiredRoles;
  draft.value.requiredRoles = held.includes(id)
    ? held.filter((r) => r !== id)
    : [...held, id];
}

// ── Colour input: hex in the picker, triplet on the wire ──────────────
function hexOf(triplet: string): string {
  const rgb = parseRgb(triplet);
  if (!rgb) return '#000000';
  return `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
function tripletOf(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '';
  const n = parseInt(m[1]!, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

// ── Contrast ─────────────────────────────────────────────────────────
function resolvedFor(row: { base: 'light' | 'dark'; tokens: Record<string, string> }) {
  return resolveTokens(row.base, row.tokens);
}
function warningsFor(row: ThemeRow) {
  return contrastWarnings(resolvedFor(row));
}
const draftWarnings = computed(() =>
  draft.value ? contrastWarnings(resolvedFor(draft.value)) : [],
);

// ── Live preview ─────────────────────────────────────────────────────
//
// Through CSSOM on `<html>`, which beats every alternative here: no request, no
// stylesheet to insert and remove, an invalid value is silently not applied (so
// a half-typed token cannot break the page being edited), and inline style is
// outside CSP.
//
// `applied` is what makes switching safe. Without tracking which properties were
// set, moving from a theme that overrides `--accent` to one that does not would
// leave the first theme's accent painted over the second.
const previewOn = ref(true);
const applied = ref<string[]>([]);

function clearPreview() {
  if (!import.meta.client) return;
  for (const key of applied.value) {
    document.documentElement.style.removeProperty(key);
  }
  applied.value = [];
}

function paintPreview() {
  if (!import.meta.client || !draft.value) return;
  clearPreview();
  const next: string[] = [];
  for (const [key, value] of Object.entries(draft.value.tokens)) {
    const prop = `--${key}`;
    document.documentElement.style.setProperty(prop, value);
    next.push(prop);
  }
  applied.value = next;
}

watch(
  [() => draft.value?.tokens, previewOn, () => draft.value?.base],
  () => {
    if (previewOn.value && draft.value) paintPreview();
    else clearPreview();
  },
  { deep: true },
);
onBeforeUnmount(clearPreview);

// ── Writes ───────────────────────────────────────────────────────────
function messageOf(e: unknown): string {
  const d = (e as { data?: { message?: string }; message?: string }) ?? {};
  return d.data?.message || d.message || t('admin.themes.saveFailed');
}

async function save() {
  if (!draft.value) return;
  saving.value = true;
  editorError.value = '';
  const body = {
    name: draft.value.name,
    description: draft.value.description || null,
    base: draft.value.base,
    tokens: draft.value.tokens,
    enabled: draft.value.enabled,
    visibility: draft.value.visibility,
    requiredRoles:
      draft.value.visibility === 'roles' ? draft.value.requiredRoles : null,
    ...(draft.value.duplicateOf ? { duplicateOf: draft.value.duplicateOf } : {}),
  };
  try {
    if (draft.value.id) {
      await $fetch(`/api/admin/themes/${draft.value.id}`, { method: 'PUT', body });
    } else {
      await $fetch('/api/admin/themes', { method: 'POST', body });
    }
    clearPreview();
    draft.value = null;
    await refresh();
    // The served stylesheet has a new version, and this page is showing the old
    // one. Reloading is the honest way to see the saved result — a partial
    // in-place update would show the preview, not the truth.
    await reloadThemeStylesheet();
  } catch (e) {
    editorError.value = messageOf(e);
  } finally {
    saving.value = false;
  }
}

async function toggleEnabled(row: ThemeRow) {
  try {
    await $fetch(`/api/admin/themes/${row.id}`, {
      method: 'PUT',
      body: {
        enabled: !row.enabled,
        visibility: row.visibility,
        requiredRoles: row.visibility === 'roles' ? row.requiredRoles : null,
      },
    });
    await refresh();
    await reloadThemeStylesheet();
  } catch (e) {
    settingsError.value = messageOf(e);
  }
}

function duplicate(slug: string, name: string) {
  startCreate({
    name: t('admin.themes.copyOf', { name }),
    duplicateOf: slug,
  });
}

async function remove(row: ThemeRow) {
  if (!confirm(t('admin.themes.confirmDelete', { name: row.name }))) return;
  try {
    await $fetch(`/api/admin/themes/${row.id}`, { method: 'DELETE' });
    if (draft.value?.id === row.id) cancel();
    await refresh();
    await reloadThemeStylesheet();
  } catch (e) {
    settingsError.value = messageOf(e);
  }
}

/**
 * Re-fetch `/api/theme.css` after a write.
 *
 * The response is cached for a minute with an ETag, so a plain reload of the
 * document would very likely serve the previous version. Swapping the `<link>`
 * href with a cache-busting query is the narrow way to make the page show what
 * was just saved without reloading it.
 */
async function reloadThemeStylesheet() {
  if (!import.meta.client) return;
  const link = document.querySelector<HTMLLinkElement>(
    'link[rel="stylesheet"][href^="/api/theme.css"]',
  );
  if (link) link.href = `/api/theme.css?v=${Date.now()}`;
}

// ── Import / export ──────────────────────────────────────────────────
const importFile = ref<HTMLInputElement | null>(null);

function exportOne(row: ThemeRow) {
  // Only what the theme actually says — name, base and its divergences. Exporting
  // the resolved set would produce a file that never tracks the built-ins again
  // when imported, which is the same fork this design exists to avoid.
  const doc = {
    trackarrTheme: 1,
    name: row.name,
    description: row.description,
    base: row.base,
    tokens: row.tokens,
  };
  const blob = new Blob([JSON.stringify(doc, null, 2)], {
    type: 'application/json',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${row.slug}.trackarr-theme.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function onImport(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0];
  if (!file) return;
  (ev.target as HTMLInputElement).value = '';
  try {
    const doc = JSON.parse(await file.text()) as {
      name?: string;
      description?: string | null;
      base?: 'light' | 'dark';
      tokens?: Record<string, string>;
    };
    // Loaded into the editor rather than saved outright: an imported theme is
    // somebody else's work on somebody else's palette, and the contrast warnings
    // are worth reading before it goes live. The server validates it again on
    // save, so nothing here is a security check.
    startCreate({
      name: doc.name || file.name.replace(/\.json$/i, ''),
      description: doc.description ?? '',
      base: doc.base === 'light' ? 'light' : 'dark',
      tokens: doc.tokens ?? {},
    });
  } catch {
    settingsError.value = t('admin.themes.importFailed');
  }
}

function roleNames(ids: string[] | null): string {
  if (!ids?.length) return '';
  const byId = new Map(roles.value.map((r) => [r.id, r.name]));
  return ids.map((i) => byId.get(i) ?? '?').join(', ');
}

</script>

<style scoped>
.field-label {
  display: block;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: rgb(var(--fg-muted));
  margin-bottom: 0.25rem;
}
.field-help {
  display: block;
  margin-top: 0.25rem;
  font-size: 11px;
  color: rgb(var(--fg-subtle));
}

.theme-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 0.75rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  background: rgb(var(--bg-elevated) / 0.5);
}
.theme-row--off { opacity: 0.55; }

.theme-swatches { display: flex; flex: none; }
.theme-swatch {
  width: 0.9rem;
  height: 1.6rem;
  border: 1px solid rgb(var(--line-strong));
  margin-left: -1px;
}
.theme-swatch:first-child { border-radius: var(--radius-sm) 0 0 var(--radius-sm); margin-left: 0; }
.theme-swatch:last-child { border-radius: 0 var(--radius-sm) var(--radius-sm) 0; }

.theme-ident { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.theme-name { font-weight: 600; font-size: 0.875rem; }
.theme-slug {
  font-family: var(--font-mono);
  font-size: 10px;
  color: rgb(var(--fg-faint));
}

.theme-badges { display: flex; flex-wrap: wrap; gap: 0.3rem; flex: none; }
.theme-badge {
  font-family: var(--font-mono);
  font-size: 9.5px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 0.15rem 0.4rem;
  border-radius: var(--radius-sm);
  background: rgb(var(--fg-default) / 0.07);
  color: rgb(var(--fg-muted));
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
}
.theme-badge--role { color: rgb(var(--info)); background: rgb(var(--info) / 0.12); }
.theme-badge--warn { color: rgb(var(--warning)); background: rgb(var(--warning) / 0.12); }

.theme-actions { display: flex; gap: 0.2rem; flex: none; }
.theme-act {
  padding: 0.3rem;
  border-radius: var(--radius-sm);
  color: rgb(var(--fg-muted));
  transition: background-color var(--dur-2), color var(--dur-2);
}
.theme-act:hover { background: rgb(var(--fg-default) / 0.08); color: rgb(var(--fg-default)); }
.theme-act--danger:hover { color: rgb(var(--danger)); background: rgb(var(--danger) / 0.1); }

.token-group { border-top: 1px solid rgb(var(--line-default) / 0.7); padding-top: 0.5rem; }
.token-group-head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: rgb(var(--fg-muted));
  padding: 0.35rem 0;
}
.token-range {
  flex: 1;
  min-width: 0;
  accent-color: rgb(var(--accent-warm));
}
.token-scalar { width: 4.5rem; flex: none; text-align: right; }
.token-group-count { margin-left: auto; font-family: var(--font-mono); color: rgb(var(--fg-faint)); }

.token-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
  gap: 0.4rem 0.75rem;
  padding: 0.25rem 0 0.5rem;
}
.token-field {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding-left: 0.5rem;
  /* The VS Code convention: a bar in the gutter marks a value that diverges from
     what it would inherit. Cheap, and instantly readable next to twenty fields
     that mostly do not. */
  border-left: 2px solid transparent;
}
.token-field--overridden { border-left-color: rgb(var(--accent) / 0.7); }
.token-key {
  font-family: var(--font-mono);
  font-size: 10px;
  color: rgb(var(--fg-subtle));
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.token-colour {
  width: 1.6rem;
  height: 1.6rem;
  border: 1px solid rgb(var(--line-strong));
  border-radius: var(--radius-sm);
  background: none;
  padding: 0;
  flex: none;
  cursor: pointer;
}
.token-triplet { width: 7rem; flex: none; }
.input-xs { padding: 0.2rem 0.4rem; font-size: 11px; }
.token-reset { padding: 0.2rem; color: rgb(var(--fg-faint)); flex: none; }
.token-reset:hover { color: rgb(var(--fg-default)); }

.role-picker { display: flex; flex-wrap: wrap; gap: 0.35rem; }
.role-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 11px;
  padding: 0.25rem 0.5rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.notice {
  display: flex;
  gap: 0.5rem;
  font-size: 11px;
  line-height: 1.5;
  color: rgb(var(--fg-muted));
  background: rgb(var(--info) / 0.08);
  border: 1px solid rgb(var(--info) / 0.25);
  border-radius: var(--radius-sm);
  padding: 0.5rem 0.6rem;
}
.notice--warn {
  color: rgb(var(--fg-default));
  background: rgb(var(--warning) / 0.08);
  border-color: rgb(var(--warning) / 0.3);
}
</style>
