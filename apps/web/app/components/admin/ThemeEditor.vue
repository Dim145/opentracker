<template>
  <!--
    Guarded, and not only for the compiler.

    `load()` fills the draft from the row the list already carries, and
    does nothing when the id names no row — a theme deleted in another
    tab, or a hand-typed URL. The whole template below reads `draft.*`
    unguarded, so that case was a TypeError on render rather than a page
    saying what happened. The script has guarded `draft.value` throughout
    from the start; the template never did.
  -->
  <div v-if="!draft" class="card">
    <div class="card-body space-y-2">
      <p class="text-sm font-semibold">{{ $t('admin.themes.notFoundTitle') }}</p>
      <p class="text-xs text-text-muted">{{ $t('admin.themes.notFoundBody') }}</p>
      <NuxtLink to="/admin/themes" class="btn btn-sm">
        {{ $t('admin.themes.editorBack') }}
      </NuxtLink>
    </div>
  </div>

  <div v-else class="space-y-6">
    <div class="card">
      <div class="card-header flex items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <NuxtLink to="/admin/themes" class="theme-back" :title="$t('admin.themes.editorBack')">
            <Icon name="ph:arrow-left-bold" />
          </NuxtLink>
          <Icon name="ph:sliders-horizontal" class="text-text-muted" />
          <h3 class="text-xs font-bold uppercase tracking-wider text-text-primary">
            {{ draft.id ? $t('admin.themes.editing', { name: draft.name }) : $t('admin.themes.editorTitleNew') }}
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
        <label class="flex items-center gap-2 text-2xs text-muted">
          <input v-model="overridesOnly" type="checkbox" />
          {{ $t('admin.themes.overridesOnly', { n: overriddenCount }) }}
        </label>

        <div v-for="group in visibleGroups" :key="group.key" class="token-group">
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
              v-for="def in visibleDefs(group.defs)"
              :key="def.key"
              class="token-field"
              :class="{ 'token-field--overridden': isOverridden(def.key) }"
            >
              <AdminThemeTokenHint
                :def="def"
                :value="draft.tokens[def.key] ?? baseValue(def.key)"
                :resolved="resolvedDraft"
              />

              <!-- An `enum` is a select; everything else is a value the base
                   supplies a placeholder for, so an empty field SHOWS what it
                   would inherit without storing it. -->
              <select
                v-if="def.kind === 'enum'"
                :aria-label="`--${def.key}`"
                class="input input-xs"
                :value="draft.tokens[def.key] ?? ''"
                @change="setToken(def.key, ($event.target as HTMLSelectElement).value)"
              >
                <option value="">
                  {{ $t('admin.themes.inherited', { value: baseValue(def.key) }) }}
                </option>
                <option v-for="o in def.options" :key="o" :value="o">{{ o }}</option>
                <!-- The owner's uploaded faces, for the three font roles only:
                     a face is uploaded FOR a role, and offering a display serif
                     for the mono role is how a column of hashes stops lining
                     up. -->
                <optgroup
                  v-if="uploadsFor(def.key).length"
                  :label="$t('admin.themes.uploadedFonts')"
                >
                  <option
                    v-for="f in uploadsFor(def.key)"
                    :key="f.id"
                    :value="`upload:${f.id}`"
                  >
                    {{ f.family }}
                  </option>
                </optgroup>
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
                  :aria-label="`--${def.key}`"
                  :min="def.min ?? 0"
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
                  :aria-label="`--${def.key}`"
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

        <!-- Contrast, on the draft as it stands. The notice interrupts; the
             group below it is the whole measurement, because 4.6:1 and 12:1
             both look like silence and only one of them survives a nudge. -->
        <div v-if="draftWarnings.length" class="notice notice--warn">
          <Icon name="ph:warning-bold" />
          <span>
            {{ $t('admin.themes.contrastHeader') }}
            <ul class="mt-1 space-y-0.5">
              <!-- `pairLabel`, not `w.pair.what`. The raw English label went
                   straight into a translated sentence, so a French console read
                   « Sous WCAG AA : muted labels on cards : 4,23:1 » — and this
                   file's own note about deriving the key from the token names
                   sits a few hundred lines below, describing the fix. -->
              <li v-for="w in draftWarnings" :key="w.pair.what">
                {{ $t('admin.themes.contrastDetail', {
                  what: pairLabel(w.pair),
                  ratio: w.ratio,
                  required: w.required,
                }) }}
              </li>
            </ul>
          </span>
        </div>

        <div class="token-group">
          <button class="token-group-head" @click="toggleGroup('contrast')">
            <Icon
              :name="openGroups.has('contrast') ? 'ph:caret-down-bold' : 'ph:caret-right-bold'"
            />
            {{ $t('admin.themes.contrastGroup') }}
            <span
              class="token-group-count"
              :class="{ 'contrast-count--fail': draftWarnings.length > 0 }"
            >
              {{ passingPairs }}/{{ draftReport.length }}
            </span>
          </button>
          <div v-if="openGroups.has('contrast')" class="contrast-list">
            <p class="field-help">{{ $t('admin.themes.contrastAbout') }}</p>
            <!-- Column names, once, instead of the word "minimum" repeated
                 twenty times down a column of its own for two distinct values.
                 The number alone says it, and the column shrinks from ~66px to
                 ~24px — which is most of what made the panel unreadable on a
                 phone. -->
            <div class="contrast-row contrast-head" aria-hidden="true">
              <span />
              <span class="field-label">{{ $t('admin.themes.contrastCol.pair') }}</span>
              <span class="field-label contrast-num">{{ $t('admin.themes.contrastCol.measured') }}</span>
              <span class="field-label contrast-num">{{ $t('admin.themes.contrastCol.needs') }}</span>
              <span />
            </div>
            <div
              v-for="r in draftReport"
              :key="`${r.pair.fg}-${r.pair.bg}`"
              class="contrast-row"
              :class="{ 'contrast-row--fail': !r.passes }"
            >
              <!-- The sample is the point: it shows what the number means, in
                   the two colours being measured, at the size they are used —
                   which for a pair measured against the 3:1 large-text
                   threshold means large. It used to be 12px for every row,
                   including those, so the sample under-sold the case where the
                   allowance mattered most. -->
              <span
                class="contrast-sample"
                :class="{ 'contrast-sample--large': r.pair.large }"
                :style="sampleStyle(r.pair)"
                >Aa</span
              >
              <span class="contrast-what">
                {{ pairLabel(r.pair) }}
                <!-- The two tokens, named. The panel used to diagnose and stop:
                     an operator reading "4.23:1, needs 4.5" had to guess which
                     of two tokens to change, scroll back up, and reopen the
                     right group. -->
                <code class="contrast-tokens">--{{ r.pair.fg }} / --{{ r.pair.bg }}</code>
              </span>
              <span class="contrast-ratio">{{ r.ratio.toFixed(2) }}</span>
              <span class="contrast-min">{{ r.required }}</span>
              <!-- Named, because the only audible difference between a passing
                   and a failing row was arithmetic. -->
              <Icon
                class="contrast-verdict"
                :name="r.passes ? 'ph:check-bold' : 'ph:warning-bold'"
                :aria-label="r.passes ? $t('admin.themes.contrastPass') : $t('admin.themes.contrastFail')"
                role="img"
              />
            </div>
          </div>
        </div>

        <!-- Uploaded fonts. Owner only to ADD one; every administrator may then
             select it above. The panel lives in the editor because that is where
             an author discovers they want a face the build does not ship. -->
        <div v-if="isOwner" class="token-group">
          <button class="token-group-head" @click="toggleGroup('fonts')">
            <Icon
              :name="openGroups.has('fonts') ? 'ph:caret-down-bold' : 'ph:caret-right-bold'"
            />
            {{ $t('admin.themes.fontUpload') }}
            <span class="token-group-count">{{ fonts.length }}</span>
          </button>
          <div v-if="openGroups.has('fonts')" class="space-y-2 pt-2">
            <p class="text-2xs text-muted">{{ $t('admin.themes.fontUploadHelp') }}</p>
            <ul v-if="fonts.length" class="space-y-1">
              <li
                v-for="f in fonts"
                :key="f.id"
                class="flex items-center gap-2 text-2xs"
              >
                <span class="font-mono">{{ f.role }}</span>
                <span class="flex-1 truncate">{{ f.family }}</span>
                <span class="text-muted">{{ Math.round(f.bytes / 1024) }} kB</span>
                <button class="token-reset" :title="$t('common.delete')" @click="removeFont(f.id)">
                  <Icon name="ph:trash-bold" />
                </button>
              </li>
            </ul>
            <div class="flex flex-wrap items-center gap-2">
              <select
              v-model="fontRole"
              class="input input-xs"
              style="width: 7rem"
              :aria-label="$t('admin.themes.fontRoleLabel')"
            >
                <option value="sans">sans</option>
                <option value="mono">mono</option>
                <option value="display">display</option>
              </select>
              <input
                v-model="fontFamily"
                class="input input-xs"
                style="width: 11rem"
                list="font-family-suggestions"
                :placeholder="$t('admin.themes.fontFamilyName')"
              />
              <!-- Suggestions rather than a closed list: the name is a label
                   for the picker and the owner may call a face whatever they
                   like. What is offered is what they are most likely to want —
                   see `familySuggestions`. -->
              <datalist id="font-family-suggestions">
                <option v-for="s in familySuggestions" :key="s" :value="s" />
              </datalist>
              <input
                ref="fontInput"
                :aria-label="$t('admin.themes.fontFileLabel')"
                type="file"
                accept=".woff2,font/woff2"
                class="text-2xs"
                @change="onFontPicked"
              />
              <button
                class="btn btn-sm"
                :disabled="fontUploading || !fontFamily.trim() || !fontFile"
                @click="uploadFont"
              >
                <Icon name="ph:upload-bold" /> {{ $t('admin.themes.fontUploadAction') }}
              </button>
            </div>
            <p class="text-2xs text-subtle">{{ $t('admin.themes.fontFamilySuggest') }}</p>
            <p v-if="fontError" class="text-xs text-error">{{ fontError }}</p>
          </div>
        </div>

        <!-- Raw CSS. Owner only, and saved by its own route: the tokens above
             are bounded and every administrator may set them, this is not. The
             button is separate for the same reason — saving it re-authenticates,
             and that must not be the price of changing a colour. -->
        <div v-if="isOwner && draft.id" class="token-group">
          <button class="token-group-head" @click="toggleGroup('css')">
            <Icon
              :name="openGroups.has('css') ? 'ph:caret-down-bold' : 'ph:caret-right-bold'"
            />
            {{ $t('admin.themes.rawCss') }}
            <span class="token-group-count">
              {{ cssBytes }}/{{ cssMaxBytes }} B
            </span>
          </button>
          <div v-if="openGroups.has('css')" class="space-y-2 pt-2">
            <p class="text-2xs text-muted">{{ $t('admin.themes.rawCssHelp') }}</p>
            <AdminThemeCssEditor
              v-model="customCss"
              :max-bytes="cssMaxBytes"
              :placeholder="RAW_CSS_EXAMPLE"
            />
            <div v-if="cssIssues.length" class="notice notice--warn">
              <Icon name="ph:warning-bold" />
              <span>
                {{ $t('admin.themes.rawCssRefused') }}
                <ul class="mt-1 space-y-0.5">
                  <li v-for="(i, n) in cssIssues" :key="n" class="font-mono text-2xs">
                    {{ i.line ? `L${i.line}: ` : '' }}{{ i.reason }}
                  </li>
                </ul>
              </span>
            </div>
            <div class="flex items-center gap-3">
              <button class="btn btn-sm" :disabled="cssSaving" @click="saveCss">
                <Icon name="ph:code-bold" /> {{ $t('admin.themes.rawCssSave') }}
              </button>
              <span v-if="cssSaved" class="text-xs text-online">
                {{ $t('common.saved') }}
              </span>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-3 pt-2">
          <button class="btn btn-primary btn-sm" :disabled="saving" @click="save">
            <Icon name="ph:check-bold" /> {{ $t('common.save') }}
          </button>
          <NuxtLink to="/admin/themes" class="btn btn-sm" @click="clearPreview">
            {{ $t('common.cancel') }}
          </NuxtLink>
          <span v-if="editorError" class="text-xs text-error">{{ editorError }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * The theme editor: one theme, on its own page.
 *
 * It used to be a panel below the list, and the list page was 1350 lines. Forty
 * seven fields over thirteen groups, a font upload panel and a CSS editor are
 * not a section of a list — they are the work — and a URL for one theme is worth
 * having on its own: it can be linked, reloaded, and left open in a tab.
 *
 * A page rather than a dialog, and the original panel's reason still holds and
 * is the stronger one: the live preview repaints the WHOLE page, so a modal on
 * top of it would cover the thing being judged.
 *
 * Four things here are decisions rather than layout, and each is commented where
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
 *    a half-typed token cannot break the page being edited), and inline style
 *    sits outside the CSP.
 * 3. **Raw CSS is a separate route and a separate button.** Saving it
 *    re-authenticates, and that must not be the price of changing a colour.
 * 4. **A token name explains itself on hover.** `--bg-inset` and `--fg-subtle`
 *    are clear once you know the system and opaque before that; the alternative
 *    to a sentence and a live sample is an admin changing one and watching what
 *    moves. See `AdminThemeTokenHint`.
 */
import {
  BUILT_IN_TOKENS,
  FONT_STACKS,
  THEME_TOKENS,
  contrastReport,
  contrastWarnings,
  isValidTokenValue,
  parseRgb,
  resolveTokens,
  validateTokens,
  type TokenDef,
  type TokenGroup,
} from '@trackarr/shared/theme';
import {
  emptyThemeAdminPayload,
  useThemeAdmin,
  type Draft,
  type ThemeAdminPayload,
  type ThemeRow,
  type UploadedFont,
} from '~/composables/useThemeAdmin';

const props = defineProps<{
  /** The theme to edit, or `null` for a new one. */
  themeId: string | null;
}>();

const { t, te } = useI18n();
const confirm = useConfirm();
const router = useRouter();
const { messageOf, reloadThemeStylesheet } = useThemeAdmin();

const { data, refresh } = await useFetch<ThemeAdminPayload>('/api/admin/themes', {
  default: emptyThemeAdminPayload,
});

const roles = computed(() => data.value.roles);
const fonts = computed(() => data.value.fonts ?? []);
// ── Uploaded fonts ───────────────────────────────────────────────────
//
// Any administrator may SELECT one; only the owner may add or remove one. The
// role travels with the file rather than being chosen at selection time, which
// is why `uploadsFor` filters: a display serif offered for the mono role is how
// a column of hashes stops lining up.
const ROLE_FOR_TOKEN: Record<string, string> = {
  'font-sans': 'sans',
  'font-mono': 'mono',
  'font-display': 'display',
};

function uploadsFor(tokenKey: string): UploadedFont[] {
  const role = ROLE_FOR_TOKEN[tokenKey];
  return role ? fonts.value.filter((f) => f.role === role) : [];
}

const fontRole = ref<'sans' | 'mono' | 'display'>('sans');
const fontFamily = ref('');
const fontFile = ref<File | null>(null);
const fontInput = ref<HTMLInputElement | null>(null);
const fontUploading = ref(false);
const fontError = ref('');

function onFontPicked(e: Event) {
  fontFile.value = (e.target as HTMLInputElement).files?.[0] ?? null;
  fontError.value = '';
}

async function uploadFont() {
  if (!fontFile.value) return;
  fontUploading.value = true;
  fontError.value = '';
  try {
    const body = new FormData();
    body.append('font', fontFile.value);
    body.append('role', fontRole.value);
    body.append('family', fontFamily.value.trim());
    // No `content-type` header: the browser has to set the multipart boundary,
    // and setting it by hand is the classic way to get an unparseable body.
    await $fetch('/api/admin/fonts', { method: 'POST', body });
    fontFamily.value = '';
    fontFile.value = null;
    if (fontInput.value) fontInput.value.value = '';
    await refresh();
    reloadThemeStylesheet();
  } catch (err: unknown) {
    fontError.value =
      (err as { data?: { message?: string } }).data?.message ??
      t('admin.themes.saveFailed');
  } finally {
    fontUploading.value = false;
  }
}

async function removeFont(id: string) {
  const ok = await confirm({
    title: t('admin.themes.confirmRemoveFont.title'),
    message: t('admin.themes.confirmRemoveFont.message'),
    confirmText: t('common.delete'),
    destructive: true,
  });
  if (!ok) return;
  fontError.value = '';
  try {
    await $fetch(`/api/admin/fonts/${id}`, { method: 'DELETE' });
    await refresh();
    reloadThemeStylesheet();
  } catch (err: unknown) {
    // The refusal that matters: a theme still names this face, and the message
    // says which ones.
    fontError.value =
      (err as { data?: { message?: string } }).data?.message ??
      t('admin.themes.saveFailed');
  }
}

// ── Tokens, grouped for the editor ───────────────────────────────────
const GROUP_ORDER: TokenGroup[] = [
  'surface',
  'foreground',
  'line',
  'accent',
  'semantic',
  'chart',
  'elevation',
  'shape',
  'density',
  'typography',
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
/**
 * The placeholder for the raw-CSS field.
 *
 * A constant and not an i18n message, for two reasons. It is CSS, so it needs no
 * translation — and it CANNOT be a message: `{ background: … }` is vue-i18n's
 * interpolation syntax, so the compiler refuses the string outright. The static
 * build caught that; the SSR build did not, because it compiles messages at
 * render time and would have thrown on the admin page instead.
 */
const RAW_CSS_EXAMPLE =
  '.torrent-row:hover { background: rgb(var(--accent-warm) / 0.06); }';

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

/** Groups with nothing left after the filter collapse rather than showing empty. */
const visibleGroups = computed(() =>
  overridesOnly.value
    ? tokenGroups.value.filter((g) => g.keys.some((k) => isOverridden(k)))
    : tokenGroups.value,
);
const openGroups = ref(new Set<string>(['surface', 'foreground', 'accent']));

/**
 * "Only the overrides" — a filter, and a diff view.
 *
 * The storage model makes this free: `tokens` holds only what diverges, so
 * "is this overridden?" is `key in tokens` with no state to keep. Its real use
 * is the one §9c named — reading back what a theme actually changes before
 * enabling it, rather than scrolling forty-seven fields looking for the seven
 * that are not inherited.
 */
const overridesOnly = ref(false);
const overriddenCount = computed(() =>
  draft.value ? Object.keys(draft.value.tokens).length : 0,
);
function visibleDefs(defs: TokenDef[]): TokenDef[] {
  return overridesOnly.value ? defs.filter((d) => isOverridden(d.key)) : defs;
}
function toggleGroup(key: string) {
  const next = new Set(openGroups.value);
  next.has(key) ? next.delete(key) : next.add(key);
  openGroups.value = next;
}


// ── The draft ────────────────────────────────────────────────────────
const draft = ref<Draft | null>(null);
const saving = ref(false);
const editorError = ref('');


// ── Raw CSS, owner only ──────────────────────────────────────────────
//
// Separate state and a separate route from the token draft, because the two have
// different permissions and different consequences. `GET /api/admin/themes` does
// not carry `customCss` for anybody, so the only way to see it is the fetch
// below — which is what makes the editor able to EDIT rather than only overwrite.
const { user } = useUserSession();
const isOwner = computed(() => !!(user.value as { isOwner?: boolean } | null)?.isOwner);
const customCss = ref('');
const cssSaving = ref(false);
const cssSaved = ref(false);
const cssMaxBytes = ref(16384);
const cssIssues = ref<Array<{ line: number; reason: string }>>([]);
const cssBytes = computed(() => new TextEncoder().encode(customCss.value).length);

async function loadCss(id: string) {
  customCss.value = '';
  cssIssues.value = [];
  cssSaved.value = false;
  if (!isOwner.value) return;
  try {
    const r = await $fetch<{ css: string; maxBytes: number }>(
      `/api/admin/themes/${id}/css`,
    );
    customCss.value = r.css;
    cssMaxBytes.value = r.maxBytes;
  } catch {
    // Not fatal: a non-owner never gets here, and an owner with a transient
    // failure should still be able to edit the tokens.
  }
}

async function saveCss() {
  if (!draft.value?.id) return;
  cssSaving.value = true;
  cssIssues.value = [];
  cssSaved.value = false;
  try {
    await $fetch(`/api/admin/themes/${draft.value.id}/css`, {
      method: 'PUT',
      body: { css: customCss.value },
    });
    cssSaved.value = true;
    reloadThemeStylesheet();
  } catch (err: unknown) {
    const data = (err as { data?: { data?: { issues?: unknown } ; message?: string } }).data;
    const issues = data?.data?.issues;
    cssIssues.value = Array.isArray(issues)
      ? (issues as Array<{ line: number; reason: string }>)
      : [{ line: 0, reason: data?.message ?? 'Could not save.' }];
  } finally {
    cssSaving.value = false;
  }
}

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
  void loadCss(row.id);
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
const draftWarnings = computed(() =>
  draft.value ? contrastWarnings(resolvedFor(draft.value)) : [],
);
const draftReport = computed(() =>
  draft.value ? contrastReport(resolvedFor(draft.value)) : [],
);
const passingPairs = computed(
  () => draftReport.value.filter((r) => r.passes).length,
);

/**
 * The pair's name, translated when we have a translation for it.
 *
 * `pair.what` is English in the shared schema — it is a code comment that
 * happens to be rendered — so the key is derived from the two token names,
 * which are stable, and the English falls through when a locale has not
 * described that pair yet. Interpolating `what` into a translated sentence, as
 * the warning line above still does, is what made a French console read
 * "muted labels on cards" in the first place.
 */
function pairLabel(pair: { fg: string; bg: string; what: string }): string {
  const key = `admin.themes.contrastPairs.${pair.fg}__${pair.bg}`;
  return te(key) ? t(key) : pair.what;
}

/** The two colours actually being measured, straight from the resolved draft. */
function sampleStyle(pair: { fg: string; bg: string }) {
  const tokens = draft.value ? resolvedFor(draft.value) : {};
  return {
    color: `rgb(${tokens[pair.fg] ?? '0 0 0'})`,
    background: `rgb(${tokens[pair.bg] ?? '255 255 255'})`,
  };
}


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
    // Belt as well as braces. Import is checked, but a field being typed into
    // holds every intermediate string on the way to a valid one, and this writes
    // to the real document — `setProperty` cannot break out of a declaration,
    // yet a custom property IS read back by the application (`var(--bg-pattern-
    // image)` lands in `background-image`), so a half-typed value is not
    // automatically inert.
    if (!isValidTokenValue(key, value)) continue;
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
    // The served stylesheet has a new version, and the page is showing the old
    // one. Refreshing the link is the honest way to see the saved result — a
    // partial in-place update would show the preview, not the truth.
    reloadThemeStylesheet();
    await router.push('/admin/themes');
  } catch (e) {
    editorError.value = messageOf(e);
  } finally {
    saving.value = false;
  }
}


// ── Loading the theme this page is for ───────────────────────────────
//
// From the same payload the list uses rather than a second endpoint: one row is
// already in it, and an editor that fetched separately could show a theme the
// list does not have.
function load() {
  if (!props.themeId) {
    startCreate(pendingImport.value ?? undefined);
    pendingImport.value = null;
    return;
  }
  const row = data.value.themes.find((x) => x.id === props.themeId);
  if (row) startEdit(row);
}

/**
 * A theme imported on the list page, waiting to be opened here.
 *
 * Carried through `useState` rather than through the URL: it is a whole token
 * map, and a query string is the wrong place for one. The list validates it
 * before setting this — see `onImport` there — and the server validates it again
 * on save.
 */
const pendingImport = useState<Partial<Draft> | null>('theme-import', () => null);

/**
 * Load the draft once the payload is there — and only once.
 *
 * `watch(data, …)` fires on every `refresh()`, and `refresh()` is what
 * `uploadFont` and `removeFont` call. So opening the Fonts panel to upload the
 * very face a dozen unsaved token changes were made FOR threw all of them away,
 * along with any unsaved raw CSS, because `startEdit` also refetches that.
 * Found in review.
 *
 * Keyed on the theme being edited rather than on the payload object: a refresh
 * that brings the same row back must not touch the draft, while navigating from
 * one theme to another must rebuild it.
 */
let loadedFor: string | null | undefined;
watch(
  [data, () => props.themeId],
  () => {
    if (!data.value.themes.length && props.themeId) return;
    if (loadedFor === props.themeId && draft.value) return;
    loadedFor = props.themeId;
    load();
  },
  { immediate: true },
);

/**
 * Rejoin the list when the theme is gone.
 *
 * Deleting from the list navigates away already; this covers the other way in —
 * a bookmarked or reloaded URL for a theme that no longer exists.
 */
watch(
  () => data.value.themes.length,
  () => {
    if (props.themeId && !data.value.themes.some((x) => x.id === props.themeId)) {
      void router.replace('/admin/themes');
    }
  },
);

/** The draft's tokens resolved against its base, for the hover samples. */
const resolvedDraft = computed(() =>
  draft.value ? resolveTokens(draft.value.base, draft.value.tokens) : {},
);

/**
 * What to offer under the family name of a face being uploaded.
 *
 * Not a canned list of famous fonts — that would be inventing data. Three real
 * sources, in the order they are likely to be wanted: the name of the file just
 * picked (`Inter-Variable.woff2` is almost always meant to be called `Inter`),
 * the families already uploaded, so the same face keeps one name across the
 * three roles, and the curated stacks, so a self-hosted copy of a face the build
 * already ships is named the same way it is named everywhere else.
 */
const familySuggestions = computed(() => {
  const out: string[] = [];
  const name = fontFile.value?.name;
  if (name) {
    const stem = name.replace(/\.[^.]+$/, '');
    const words = stem.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
    const titled = words.replace(/\b\w/g, (c) => c.toUpperCase());
    out.push(titled);
    // `Inter Variable` and `Inter` are both plausible, and which one the owner
    // wants depends on whether they will upload a second cut of the same face.
    const trimmed = titled
      .replace(/\b(Variable|VF|Regular|Latin|Subset|Web|Wght)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (trimmed && trimmed !== titled) out.push(trimmed);
  }
  out.push(...fonts.value.map((f) => f.family));
  // The display name out of the stack itself, not a title-cased slug: the slug
  // `ibm-plex-sans` title-cases to `Ibm Plex Sans`, and the stack already
  // carries `'IBM Plex Sans'` because that is how the foundry spells it.
  out.push(
    ...Object.values(FONT_STACKS)
      .map((stack) => /^'([^']+)'/.exec(stack)?.[1])
      .filter((n): n is string => !!n),
  );
  return [...new Set(out.filter(Boolean))];
});
</script>

<style scoped>
.contrast-list { display: flex; flex-direction: column; gap: 0.25rem; padding: 0.5rem 0.75rem 0.75rem; }
.contrast-row {
  display: grid;
  /* Fixed widths on the two number columns, so twenty ratios share a decimal
     point. `auto` plus `text-align: start` meant "4.62" and "12.00" did not
     line up — and comparing them by eye is the entire service this table
     renders. */
  grid-template-columns: 2.25rem minmax(0, 1fr) 3.5rem 2.5rem 1rem;
  align-items: center;
  gap: 0.6rem;
  padding: 0.3rem 0.4rem;
  border-radius: var(--radius-sm);
  font-size: 0.75rem;
}
.contrast-head { padding-bottom: 0; }
.contrast-head .field-label { margin-bottom: 0; }
.contrast-num { text-align: right; }
.contrast-row--fail { background: rgb(var(--warning) / 0.08); }
.contrast-sample {
  display: grid;
  place-items: center;
  height: 1.5rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  font-weight: 600;
  /* Body size, because that is where these pairs are used. The comment above
     the markup claimed "at the size they are used" while rendering 12px against
     a 14px body. */
  font-size: 0.875rem;
}
/* A pair measured against the 3:1 large-text threshold, shown large. */
.contrast-sample--large { font-size: 1.25rem; font-weight: 700; }
.contrast-what {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.contrast-tokens {
  font-family: var(--font-mono);
  font-size: 0.625rem;
  color: rgb(var(--fg-subtle));
  overflow-wrap: anywhere;
}
.contrast-ratio {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.contrast-min {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  text-align: right;
  color: rgb(var(--fg-subtle));
  font-size: 0.6875rem;
}
/*
 * A phone, where this panel used to become useless.
 *
 * There was no media query at all. Inside a card body at 390px the fixed
 * columns ate ~206px of ~302px, leaving the label about 11 characters with
 * `text-overflow: ellipsis` — so five consecutive rows read « Étiquettes d… ».
 * The label wraps instead, and the "needs" column goes: readable before
 * compact.
 */
@media (max-width: 30rem) {
  .contrast-row {
    grid-template-columns: 2.25rem minmax(0, 1fr) 3.5rem 1rem;
  }
  .contrast-what { white-space: normal; }
  .contrast-min,
  .contrast-head .contrast-num:last-of-type { display: none; }
}
.contrast-verdict { color: rgb(var(--online)); }
.contrast-row--fail .contrast-verdict { color: rgb(var(--warning)); }
.contrast-count--fail { color: rgb(var(--warning)); }

.field-label {
  display: block;
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: calc(0.14em * var(--tracking-scale));
  color: rgb(var(--fg-muted));
  margin-bottom: 0.25rem;
}
.field-help {
  display: block;
  margin-top: 0.25rem;
  font-size: 0.6875rem;
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
  font-size: 0.625rem;
  color: rgb(var(--fg-faint));
}

.theme-badges { display: flex; flex-wrap: wrap; gap: 0.3rem; flex: none; }
.theme-badge {
  font-family: var(--font-mono);
  font-size: 0.5938rem;
  text-transform: uppercase;
  letter-spacing: calc(0.08em * var(--tracking-scale));
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
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: calc(0.14em * var(--tracking-scale));
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
  font-size: 0.625rem;
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
.input-xs { padding: 0.2rem 0.4rem; font-size: 0.6875rem; }
.token-reset { padding: 0.2rem; color: rgb(var(--fg-faint)); flex: none; }
.token-reset:hover { color: rgb(var(--fg-default)); }

.role-picker { display: flex; flex-wrap: wrap; gap: 0.35rem; }
.role-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.6875rem;
  padding: 0.25rem 0.5rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.notice {
  display: flex;
  gap: 0.5rem;
  font-size: 0.6875rem;
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
