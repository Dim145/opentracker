<template>
  <!--
    Listing-template editor.

    Two panes because the two halves are read at different moments: the
    author types on the left and checks the result on the right, and a
    single-column form would put the result below the fold of a modal that
    is already 90vh tall.

    The source editor is a plain textarea rather than `WysiwygEditor`
    because there is no HTML -> BBCode direction anywhere in the app
    (`editorFormats.ts` only converts BBCode -> HTML). Round-tripping a
    template through TipTap would silently rewrite `{{TITLE}}` and flatten
    the `[color=#3d85c6]` scaffolding, so the raw source is the truth and
    stays byte-for-byte what the author typed.
  -->
  <Modal
    :model-value="modelValue"
    size="xl"
    body-class="!p-0"
    :icon="readonly ? 'ph:eye' : 'ph:brackets-curly'"
    :title="
      readonly
        ? $t('components.templateEditor.viewTitle')
        : template
          ? $t('components.templateEditor.editTitle')
          : $t('components.templateEditor.createTitle')
    "
    @update:model-value="onModalToggle"
  >
    <div class="tpl-editor">
      <!-- ─────────── LEFT: metadata + raw source ─────────── -->
      <section class="tpl-pane tpl-pane--form" :aria-label="$t('components.templateEditor.formPane')">
        <div class="space-y-1">
          <label class="tpl-label" for="tpl-name">
            {{ $t('components.templateEditor.fields.name') }}
            <span class="tpl-required" aria-hidden="true">*</span>
          </label>
          <input
            id="tpl-name"
            v-model="name"
            type="text"
            class="input w-full"
            :maxlength="FICHE_TEMPLATE_NAME_MAX"
            :readonly="readonly"
            :required="!readonly"
            :aria-invalid="showNameError"
            :aria-describedby="showNameError ? 'tpl-name-error' : undefined"
            :placeholder="$t('components.templateEditor.fields.namePlaceholder')"
            @blur="nameTouched = true"
          />
          <p v-if="showNameError" id="tpl-name-error" class="tpl-inline-error" role="alert">
            {{ nameError }}
          </p>
        </div>

        <div class="space-y-1">
          <label class="tpl-label" for="tpl-description">
            {{ $t('components.templateEditor.fields.description') }}
            <span class="tpl-optional">{{ $t('components.templateEditor.optional') }}</span>
          </label>
          <input
            id="tpl-description"
            v-model="description"
            type="text"
            class="input w-full"
            :maxlength="FICHE_TEMPLATE_DESCRIPTION_MAX"
            :readonly="readonly"
            :placeholder="$t('components.templateEditor.fields.descriptionPlaceholder')"
          />
        </div>

        <div class="space-y-1">
          <label class="tpl-label" for="tpl-category">
            {{ $t('components.templateEditor.fields.category') }}
          </label>
          <!-- Bare <select>: there is no Select component in this app, and
               FicheCombo's free-text escape hatch is wrong here because the
               category set is closed. `disabled` rather than the `readonly`
               used above only because <select> has no readonly. -->
          <select
            id="tpl-category"
            v-model="category"
            class="input w-full"
            :disabled="readonly"
            aria-describedby="tpl-category-hint"
          >
            <option v-for="c in CATEGORIES" :key="c" :value="c">
              {{ $t(`templates.categories.${c}`) }}
            </option>
          </select>
          <p id="tpl-category-hint" class="tpl-hint">
            {{ $t('components.templateEditor.hints.category') }}
          </p>
        </div>

        <div class="space-y-1">
          <div class="flex items-end justify-between gap-2 flex-wrap">
            <label class="tpl-label" for="tpl-content">
              {{ $t('components.templateEditor.fields.source') }}
            </label>
            <div class="flex items-center gap-1 flex-wrap">
              <button
                v-if="canRevert"
                type="button"
                class="btn btn-xs btn-ghost"
                @click="revertToSaved"
              >
                <Icon name="ph:clock-counter-clockwise" class="text-sm" />
                {{ $t('components.templateEditor.revertToSaved') }}
              </button>
              <button
                v-if="!readonly"
                type="button"
                class="btn btn-xs btn-ghost"
                @click="resetToDefault"
              >
                <Icon name="ph:arrow-counter-clockwise" class="text-sm" />
                {{ $t('components.templateEditor.resetToDefault') }}
              </button>
            </div>
          </div>
          <!-- Tag buttons for the BBCode the scaffolding is made of, mirroring
               the code mode of the upload editor. Every one of them is also a
               shortcut, and the shortcut is in the tooltip: a toolbar that
               teaches its own keyboard equivalent is how people stop using the
               toolbar. -->
          <div v-if="!readonly" class="tpl-toolbar" role="group" :aria-label="$t('components.templateEditor.toolbar.label')">
            <button
              v-for="tool in TOOLS"
              :key="tool.key"
              type="button"
              class="tpl-tool"
              :title="
                tool.hint
                  ? `${$t(`components.templateEditor.toolbar.${tool.key}`)} · ${tool.hint}`
                  : $t(`components.templateEditor.toolbar.${tool.key}`)
              "
              :aria-label="$t(`components.templateEditor.toolbar.${tool.key}`)"
              @click="applyTool(tool)"
            >
              <Icon :name="tool.icon" aria-hidden="true" />
            </button>
            <span class="tpl-toolbar-sep" aria-hidden="true" />
            <span class="tpl-toolbar-hint">{{ $t('components.templateEditor.toolbar.undoHint') }}</span>
          </div>
          <textarea
            id="tpl-content"
            ref="editorRef"
            @keydown="source.onKeydown"
            v-model="content"
            class="input tpl-source"
            rows="16"
            spellcheck="false"
            autocapitalize="off"
            autocomplete="off"
            :readonly="readonly"
            :aria-describedby="contentDescribedBy"
            :aria-invalid="templateIssue ? 'true' : undefined"
            :placeholder="$t('components.templateEditor.fields.sourcePlaceholder')"
          />
          <div class="flex items-start justify-between gap-3">
            <p
              v-if="templateIssue"
              id="tpl-content-error"
              class="tpl-inline-error flex-1"
              role="alert"
            >
              <!-- Verbatim: TemplateError messages already name the problem
                   and the line, in the words the author needs. -->
              {{ templateIssue }}
            </p>
            <p
              v-else-if="unknownVariables.length"
              id="tpl-content-warn"
              class="tpl-warn flex-1"
              role="status"
            >
              {{
                $t('components.templateEditor.unknownVariables', {
                  names: unknownVariables.join(', '),
                })
              }}
            </p>
            <p v-else class="tpl-hint flex-1">
              {{ $t('components.templateEditor.hints.blocks') }}
            </p>
            <p
              id="tpl-content-counter"
              class="tpl-counter"
              :class="{ 'tpl-counter--over': overCap }"
            >
              {{ content.length }} / {{ FICHE_TEMPLATE_CONTENT_MAX }}
            </p>
          </div>
        </div>

        <p v-if="formError" class="tpl-form-error" role="alert">
          <Icon name="ph:warning-circle-bold" class="text-base flex-shrink-0" />
          <span>{{ formError }}</span>
        </p>
      </section>

      <!-- ─────────── RIGHT: preview / variable palette ─────────── -->
      <section class="tpl-pane tpl-pane--side" :aria-label="$t('components.templateEditor.sidePane')">
        <!-- Hand-rolled tabs: no Tabs component exists in this app.
             `role="tablist"` is a promise about the keyboard, not just a
             label: a screen-reader user told "tab 1 of 2" then reaches for
             the arrow keys. Hence the roving tabindex — only the selected
             tab is in the tab order, and Left/Right/Home/End move between
             them — rather than two independently tabbable buttons. -->
        <div
          class="tpl-tabs"
          role="tablist"
          :aria-label="$t('components.templateEditor.sidePane')"
          @keydown="onTabKeydown"
        >
          <button
            v-for="p in PANES"
            :key="p"
            type="button"
            role="tab"
            class="tpl-tab"
            :class="{ 'tpl-tab--active': pane === p }"
            :aria-selected="pane === p"
            :tabindex="pane === p ? 0 : -1"
            :id="`tpl-tab-${p}`"
            :aria-controls="`tpl-panel-${p}`"
            @click="pane = p"
          >
            <Icon :name="p === 'preview' ? 'ph:eye' : 'ph:brackets-curly'" class="text-sm" />
            {{ $t(`components.templateEditor.panes.${p}`) }}
          </button>
        </div>

        <!-- `tabindex="0"` because this panel scrolls and contains nothing
             focusable: without it the arrow keys have nowhere to act and a
             keyboard-only user cannot read a preview taller than the pane. -->
        <div
          v-show="pane === 'preview'"
          id="tpl-panel-preview"
          role="tabpanel"
          aria-labelledby="tpl-tab-preview"
          tabindex="0"
          class="tpl-panel"
        >
          <p class="tpl-hint mb-2">{{ $t('components.templateEditor.hints.preview') }}</p>
          <div v-if="templateIssue" class="tpl-panel-empty">
            <Icon name="ph:warning-circle" class="text-2xl" />
            <p>{{ $t('components.templateEditor.previewBlocked') }}</p>
          </div>
          <!-- Says why rather than showing a blank pane: a preview that stops
               working with no explanation reads as a bug in the editor. -->
          <div v-else-if="previewTooLarge" class="tpl-panel-empty">
            <Icon name="ph:arrows-out-line-horizontal" class="text-2xl" />
            <p>{{ $t('components.templateEditor.previewTooLarge') }}</p>
          </div>
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div v-else-if="preview" class="tpl-preview" v-html="preview" />
          <div v-else class="tpl-panel-empty">
            <Icon name="ph:file-dashed" class="text-2xl" />
            <p>{{ $t('components.templateEditor.previewEmpty') }}</p>
          </div>
        </div>

        <div
          v-show="pane === 'variables'"
          id="tpl-panel-variables"
          role="tabpanel"
          aria-labelledby="tpl-tab-variables"
          class="tpl-panel"
        >
          <p class="tpl-hint mb-3">
            {{
              readonly
                ? $t('components.templateEditor.hints.variablesReadonly')
                : $t('components.templateEditor.hints.variables')
            }}
          </p>
          <div v-for="g in variableGroups" :key="g.key" class="tpl-group">
            <h4 class="tpl-group-head">
              <Icon :name="g.icon" class="text-sm text-text-muted" />
              {{ $t(`templates.groups.${g.key}`) }}
            </h4>
            <ul class="tpl-group-list">
              <li v-for="v in g.vars" :key="v.name" class="tpl-var">
                <button
                  type="button"
                  class="tpl-chip"
                  :disabled="readonly"
                  :aria-label="$t('components.templateEditor.insertVariable', { name: v.name })"
                  @click="insertVariable(v.name)"
                >
                  <!-- Built in the script: a literal `{{` inside a mustache
                       terminates the interpolation and the SFC fails to
                       compile. -->
                  <span class="tpl-chip-name">{{ chipLabel(v) }}</span>
                  <Icon v-if="v.block" name="ph:rows" class="text-[10px]" aria-hidden="true" />
                </button>
                <p class="tpl-var-desc">{{ variableLabel(v) }}</p>
              </li>
            </ul>
          </div>
        </div>
      </section>
    </div>

    <template #footer>
      <div class="flex items-center justify-between gap-2 w-full flex-wrap">
        <button
          v-if="template && template.canEdit && !readonly"
          type="button"
          class="btn btn-xs btn-ghost text-error"
          :disabled="saving"
          @click="requestDelete"
        >
          <Icon name="ph:trash" class="text-sm" />
          {{ $t('common.delete') }}
        </button>
        <span v-else />

        <div class="flex items-center gap-2">
          <button
            type="button"
            class="btn btn-sm btn-ghost"
            :disabled="saving"
            @click="requestClose"
          >
            {{ readonly ? $t('common.close') : $t('common.cancel') }}
          </button>
          <button
            v-if="readonly"
            type="button"
            class="btn btn-sm btn-primary"
            @click="emit('duplicate', template ?? null)"
          >
            <Icon name="ph:copy" class="text-sm" />
            {{ $t('templates.actions.duplicate') }}
          </button>
          <button
            v-else
            type="button"
            class="btn btn-sm btn-primary"
            :disabled="saving"
            @click="save"
          >
            <Icon
              :name="saving ? 'ph:circle-notch' : 'ph:check-circle-bold'"
              :class="saving ? 'animate-spin' : ''"
            />
            {{ saving ? $t('common.loading') : $t('common.saveChanges') }}
          </button>
        </div>
      </div>
    </template>
  </Modal>
</template>

<script setup lang="ts">
import { bbcodeToHtml } from '~/utils/editorFormats';
import {
  DEFAULT_FICHE_TEMPLATE,
  FICHE_VARIABLES,
  sampleFicheContext,
  type FicheVariable,
  type FicheVariableGroup,
} from '~/utils/ficheTemplate';
import { sanitizeRichHtml } from '~/utils/markdown';
import { DISABLED_BLOCK_NAME, type SourceWrap } from '~/composables/useSourceEditor';
import {
  TemplateError,
  assertTemplateValid,
  renderTemplate,
  templateVariables,
} from '@trackarr/shared/templateEngine';
import {
  FICHE_TEMPLATE_CATEGORIES,
  FICHE_TEMPLATE_CONTENT_MAX,
  FICHE_TEMPLATE_DESCRIPTION_MAX,
  FICHE_TEMPLATE_NAME_MAX,
  type FicheTemplateCategory,
  type FicheTemplateRow,
  type FicheTemplateWriteBody,
} from '~/utils/ficheTemplateApi';

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    /** The row being edited; null when creating. */
    template?: FicheTemplateRow | null;
    /** Pre-fills a brand-new template — the duplicate and "start from built-in" flows. */
    initialName?: string;
    initialContent?: string;
    /** A site template the caller cannot write: everything visible, nothing writable. */
    readonly?: boolean;
    /**
     * Where a save goes. `/api/me/templates` for a member's own; the admin
     * screen passes `/api/admin/templates` so the site catalogue is edited by
     * this same editor — same grammar check, same preview, same variables
     * palette — instead of a second one that would drift from it.
     *
     * A prop rather than a computed guess: which endpoint to write is the
     * caller's business, and a component that infers it from a row's shape is
     * one refactor away from writing to the wrong one.
     */
    endpoint?: string;
  }>(),
  {
    template: null,
    initialName: '',
    initialContent: '',
    readonly: false,
    endpoint: '/api/me/templates',
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'saved'): void;
  (e: 'delete', row: FicheTemplateRow): void;
  (e: 'duplicate', row: FicheTemplateRow | null): void;
}>();

const { t } = useI18n();
const notifications = useNotificationStore();
const confirm = useConfirm();

/**
 * One guard for EVERY confirm in this component, not one per call site.
 *
 * The first version guarded `requestClose` against itself, which stopped a
 * second Esc queueing a second discard dialog but not the case that actually
 * happens: Esc while the "reset to the built-in template?" box is up. That box
 * is a modal of its own, so the editor's window-level Esc handler still fires,
 * and the user got a discard prompt they never asked for stacked on a reset
 * prompt they were still reading.
 */
let confirmOpen = false;

const CATEGORIES = FICHE_TEMPLATE_CATEGORIES;
const PANES = ['preview', 'variables'] as const;

const name = ref('');
const description = ref('');
const category = ref<FicheTemplateCategory>('universal');
const content = ref('');
const nameTouched = ref(false);
const pane = ref<(typeof PANES)[number]>('preview');
const saving = ref(false);
const formError = ref<string | null>(null);
const editorRef = ref<HTMLTextAreaElement | null>(null);

/**
 * Programmatic edits go through here rather than assigning to `content`.
 *
 * Assigning wipes the textarea's native undo stack, so one click on a variable
 * chip used to cost the author every Ctrl+Z step they had. See
 * composables/useSourceEditor.ts — the edits are replayed as real insertions,
 * which the browser records, so undo and redo keep working and need no
 * bindings of our own.
 */
const source = useSourceEditor(editorRef, { readonly: () => props.readonly });

/**
 * The toolbar, and the shortcuts it doubles.
 *
 * Deliberately short. These are the tags the built-in scaffolding is built
 * from — everything else a template needs is a variable, and those have their
 * own palette on the right. `hint` is the printed shortcut rather than a
 * derived one: showing "Ctrl+B" to a mac user would be wrong, so the label is
 * built from the platform once, below.
 */
const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = isMac ? '\u2318' : 'Ctrl';

interface SourceTool {
  key: string;
  icon: string;
  hint: string;
  wrap?: SourceWrap;
  disable?: true;
}

const TOOLS: SourceTool[] = [
  { key: 'bold', icon: 'ph:text-b-bold', hint: `${MOD}+B`, wrap: { open: '[b]', close: '[/b]' } },
  { key: 'italic', icon: 'ph:text-italic', hint: `${MOD}+I`, wrap: { open: '[i]', close: '[/i]' } },
  { key: 'underline', icon: 'ph:text-underline', hint: `${MOD}+U`, wrap: { open: '[u]', close: '[/u]' } },
  { key: 'link', icon: 'ph:link-simple', hint: `${MOD}+K`, wrap: { open: '[url=]', close: '[/url]' } },
  { key: 'image', icon: 'ph:image', hint: '', wrap: { open: '[img]', close: '[/img]' } },
  { key: 'center', icon: 'ph:text-align-center', hint: '', wrap: { open: '[center]', close: '[/center]' } },
  { key: 'color', icon: 'ph:palette', hint: '', wrap: { open: '[color=#3d85c6]', close: '[/color]' } },
  { key: 'size', icon: 'ph:text-aa', hint: '', wrap: { open: '[size=13]', close: '[/size]' } },
  { key: 'disable', icon: 'ph:eye-slash', hint: `${MOD}+/`, disable: true },
];

function applyTool(tool: SourceTool) {
  if (tool.disable) {
    source.toggleDisabled();
    return;
  }
  if (tool.wrap) source.wrap(tool.wrap);
}

/**
 * The state as it was when the modal opened. Comparing against a snapshot
 * rather than tracking a `dirty` flag per field means a user who types a
 * character and deletes it again is not asked to confirm a discard.
 */
const snapshot = () =>
  JSON.stringify([name.value, description.value, category.value, content.value]);
let pristine = snapshot();

/**
 * The source as stored, kept so the author can walk back to it.
 *
 * "Reset to default" replaces the body with the BUILT-IN layout, which is the
 * one thing an editor of a saved template almost never wants: it throws away
 * their work AND the version they had saved. Reverting is the other direction
 * and the common one — undo everything since I opened this — so it needs its
 * own control rather than a comment explaining why the reset button is not it.
 *
 * A ref, not a plain string, because the revert control appears and disappears
 * with it.
 */
const savedContent = ref('');

const dirty = computed(() => !props.readonly && snapshot() !== pristine);

/** Editing a stored template whose body has moved since it was opened. */
const canRevert = computed(
  () => !props.readonly && props.template !== null && content.value !== savedContent.value,
);

// ── Seeding ─────────────────────────────────────────────────────
// One instance serves create, edit and read-only view; the parent swaps the
// `template` prop and flips `modelValue`. Re-seeding on open (not on prop
// change) is what keeps a half-typed draft from being wiped when the parent
// re-renders the list underneath.
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    const row = props.template;
    name.value = row ? row.name : props.initialName;
    description.value = row?.description ?? '';
    category.value = row?.category ?? 'universal';
    content.value = row ? row.content : props.initialContent || DEFAULT_FICHE_TEMPLATE;
    nameTouched.value = false;
    pane.value = 'preview';
    formError.value = null;
    // Reopening after a dialog was dismissed mid-flight must not leave the
    // guard stuck true, or every later close would be swallowed silently.
    confirmOpen = false;
    // Only a stored template has a version to go back to; a create starts
    // from the built-in layout or a duplicate, and "revert" there would mean
    // the same thing as "reset", which already has a button.
    savedContent.value = row ? row.content : '';
    pristine = snapshot();
  },
  { immediate: true },
);

// ── Validation ──────────────────────────────────────────────────
const nameError = computed(() => {
  const trimmed = name.value.trim();
  if (!trimmed) return t('components.templateEditor.errors.nameRequired');
  if (trimmed.length > FICHE_TEMPLATE_NAME_MAX) {
    return t('components.templateEditor.errors.nameTooLong', {
      max: FICHE_TEMPLATE_NAME_MAX,
    });
  }
  return null;
});
const showNameError = computed(() => nameTouched.value && nameError.value !== null);

const overCap = computed(() => content.value.length > FICHE_TEMPLATE_CONTENT_MAX);

/**
 * Parse errors are surfaced on every keystroke rather than on submit: an
 * unclosed `{{#SECTION}}` makes the rest of the template disappear from the
 * preview, and without the message the author has no way to tell that from
 * "my variable is empty".
 */
const templateIssue = computed<string | null>(() => {
  try {
    assertTemplateValid(content.value);
    return null;
  } catch (err) {
    return err instanceof TemplateError ? err.message : String(err);
  }
});

/**
 * `OFF` joins the catalogue for the purposes of this warning only. It is not a
 * variable — it is the name the "switch this block off" button writes, and a
 * section on it never renders precisely BECAUSE nothing fills it. Flagging it
 * as an unknown variable would scold the author for using the button.
 */
const KNOWN_NAMES = new Set([
  ...FICHE_VARIABLES.map((v) => v.name),
  DISABLED_BLOCK_NAME,
]);

/**
 * An unknown variable renders EMPTY by design, so `{{TITRE}}` is invisible
 * in the preview. Flagging the diff against the catalogue is the only way a
 * typo ever gets noticed.
 */
const unknownVariables = computed(() => {
  if (templateIssue.value) return [];
  try {
    return templateVariables(content.value).filter((n) => !KNOWN_NAMES.has(n));
  } catch {
    return [];
  }
});

// ── Live preview ────────────────────────────────────────────────
// The sample bag is built once: `sampleFicheContext()` is pure and rebuilding
// it per keystroke would re-run every formatter for nothing.
const SAMPLE = sampleFicheContext();

/**
 * The source the preview reads, a beat behind the textarea.
 *
 * The preview is three full passes over the content — render, BBCode to HTML,
 * sanitise — and it was a `computed` on `content`, so every keystroke paid for
 * all three. Debouncing makes typing smooth without the author noticing a
 * delay they are not looking at: they are watching the character they just
 * typed, not the panel.
 */
const previewSource = ref(content.value);
let previewTimer: ReturnType<typeof setTimeout> | undefined;
watch(content, (value) => {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    previewSource.value = value;
  }, 180);
});
onBeforeUnmount(() => clearTimeout(previewTimer));

/**
 * What the preview refuses to render, and why there is a second budget on top
 * of the engine's own cap.
 *
 * `content` is capped at 15 kB, but a template that repeats a block variable
 * can render far larger — up to the engine's 200 kB ceiling — and it is
 * `bbcodeToHtml` downstream that then struggles: its tag patterns use lazy
 * quantifiers, so a body full of unmatched openers costs a scan per opener.
 * On 200 kB that is tens of seconds with the tab frozen, and the person it
 * freezes is the author, mid-edit.
 *
 * 40 kB is well past any real listing (the built-in default renders to about
 * 2 kB) and far short of where the conversion gets slow.
 */
const PREVIEW_BUDGET = 40_000;

const previewTooLarge = ref(false);

const preview = computed(() => {
  previewTooLarge.value = false;
  if (templateIssue.value) return '';
  try {
    const rendered = renderTemplate(previewSource.value, SAMPLE);
    if (rendered.length > PREVIEW_BUDGET) {
      previewTooLarge.value = true;
      return '';
    }
    return sanitizeRichHtml(bbcodeToHtml(rendered));
  } catch {
    // The render cap is the only remaining failure mode here, and the
    // message would repeat what the counter already says.
    return '';
  }
});

// ── Variable palette ────────────────────────────────────────────
const GROUP_ICONS: Record<FicheVariableGroup, string> = {
  header: 'ph:text-aa',
  facts: 'ph:list-dashes',
  rating: 'ph:star',
  synopsis: 'ph:article',
  technical: 'ph:sliders-horizontal',
  release: 'ph:package',
  options: 'ph:toggle-left',
};

/** Grouped in catalogue order, so the palette reads in the order a listing is emitted. */
const variableGroups = computed(() => {
  const order: FicheVariableGroup[] = [];
  const byGroup = new Map<FicheVariableGroup, FicheVariable[]>();
  for (const v of FICHE_VARIABLES) {
    let bucket = byGroup.get(v.group);
    if (!bucket) {
      bucket = [];
      byGroup.set(v.group, bucket);
      order.push(v.group);
    }
    bucket.push(v);
  }
  return order.map((key) => ({ key, icon: GROUP_ICONS[key], vars: byGroup.get(key)! }));
});

/**
 * `FicheVariable.description` is developer-facing English written for the
 * catalogue; the UI shows the translated wording and falls back to it only
 * when a key is missing, so a new variable is never rendered as a raw key.
 */
/** `{{NAME}}` — the exact text the chip inserts. */
function chipLabel(v: FicheVariable): string {
  return `{{${v.name}}}`;
}

function variableLabel(v: FicheVariable): string {
  const key = `templates.vars.${v.name}`;
  const translated = t(key);
  return translated === key ? v.description : translated;
}

function insertVariable(varName: string) {
  if (props.readonly) return;
  const snippet = `{{${varName}}}`;
  if (!editorRef.value) {
    // The pane is not rendered (nothing to put a caret in), so appending is
    // the only sensible reading of "insert".
    content.value += snippet;
    return;
  }
  // Recorded as an edit, so Ctrl+Z takes the variable back out and leaves
  // everything typed before it intact. `insert` also returns focus with the
  // caret after the snippet, so "insert, type, insert" chains without
  // re-tabbing.
  source.insert(snippet);
}

/**
 * Arrow-key movement across the two tabs, per the WAI-ARIA tabs pattern.
 *
 * Selection follows focus here, which is the recommended behaviour when
 * switching panels is cheap — both panels are already rendered and only
 * `v-show` apart, so there is nothing to load and no reason to make the
 * user press Enter as well.
 */
/**
 * What the textarea points at for its description.
 *
 * The unknown-variable warning used to be the one message with no id, so it
 * was the one message a screen reader never announced — and it is the message
 * that matters most, since an unknown variable renders empty rather than
 * failing. The parse error and the warning are mutually exclusive in the
 * markup, so at most one of them is ever named here.
 */
const contentDescribedBy = computed(() => {
  const ids = ['tpl-content-counter'];
  if (templateIssue.value) ids.push('tpl-content-error');
  else if (unknownVariables.value.length) ids.push('tpl-content-warn');
  return ids.join(' ');
});

function onTabKeydown(event: KeyboardEvent) {
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
  if (!keys.includes(event.key)) return;
  event.preventDefault();
  const i = PANES.indexOf(pane.value);
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? PANES.length - 1
        : // Wraps, so Right on the last tab lands on the first.
          (i + (event.key === 'ArrowRight' ? 1 : -1) + PANES.length) % PANES.length;
  const target = PANES[next];
  if (target === undefined) return;
  pane.value = target;
  // The roving tabindex means the newly selected tab is the only one that
  // can hold focus, and it has to be moved there explicitly.
  nextTick(() => {
    document.getElementById(`tpl-tab-${target}`)?.focus();
  });
}

async function resetToDefault() {
  if (content.value === DEFAULT_FICHE_TEMPLATE) return;
  if (confirmOpen) return;
  confirmOpen = true;
  try {
    await runResetConfirm();
  } finally {
    confirmOpen = false;
  }
}

async function revertToSaved() {
  if (!canRevert.value) return;
  // Shares `confirmOpen` with the reset and the discard dialogs: three
  // confirms on one modal, and stacking any two of them leaves the second
  // unreachable behind the first.
  if (confirmOpen) return;
  confirmOpen = true;
  try {
    const ok = await confirm({
      title: t('components.templateEditor.confirm.revertTitle'),
      message: t('components.templateEditor.confirm.revertMessage'),
      confirmText: t('components.templateEditor.revertToSaved'),
      cancelText: t('common.cancel'),
      destructive: true,
    });
    if (ok) source.replaceAll(savedContent.value);
  } finally {
    confirmOpen = false;
  }
}

async function runResetConfirm() {
  const ok = await confirm({
    title: t('components.templateEditor.confirm.resetTitle'),
    message: t('components.templateEditor.confirm.resetMessage'),
    confirmText: t('components.templateEditor.resetToDefault'),
    cancelText: t('common.cancel'),
  });
  if (!ok) return;
  source.replaceAll(DEFAULT_FICHE_TEMPLATE);
}

// ── Closing ─────────────────────────────────────────────────────
// `Modal` emits `update:modelValue false` for the X button, the backdrop and
// Esc alike, and we never bind v-model, so every one of those three routes
// lands here and gets the same dirty check. `confirmOpen` (declared above)
// keeps a second dialog from stacking on whichever one is already up.
function onModalToggle(value: boolean) {
  if (value) return;
  void requestClose();
}

async function requestClose() {
  if (confirmOpen) return;
  if (!dirty.value) {
    emit('update:modelValue', false);
    return;
  }
  confirmOpen = true;
  try {
    const ok = await confirm({
      title: t('components.templateEditor.confirm.discardTitle'),
      message: t('components.templateEditor.confirm.discardMessage'),
      confirmText: t('common.discard'),
      cancelText: t('components.templateEditor.keepEditing'),
      destructive: true,
    });
    if (ok) emit('update:modelValue', false);
  } finally {
    confirmOpen = false;
  }
}

function requestDelete() {
  if (props.template) emit('delete', props.template);
}

async function save() {
  if (saving.value || props.readonly) return;
  nameTouched.value = true;
  formError.value = null;

  const blocker =
    nameError.value ??
    templateIssue.value ??
    (overCap.value ? t('components.templateEditor.errors.tooLong', { max: FICHE_TEMPLATE_CONTENT_MAX }) : null) ??
    (content.value.trim() ? null : t('components.templateEditor.errors.contentRequired'));
  if (blocker) {
    formError.value = blocker;
    return;
  }

  // Sent verbatim, with no trim: a template is whitespace-sensitive — a
  // leading space inside a block and the absence of a trailing newline both
  // change the emitted listing.
  const body: FicheTemplateWriteBody = {
    name: name.value.trim(),
    // `|| null`, not `?? null`: a description trimmed to '' is an absent
    // description, and the create route stores it the same way.
    description: description.value.trim() || null,
    category: category.value,
    content: content.value,
  };

  saving.value = true;
  try {
    if (props.template) {
      await $fetch(`${props.endpoint}/${props.template.id}`, { method: 'PATCH', body });
      notifications.success(t('templates.toasts.updated'));
    } else {
      await $fetch(props.endpoint, { method: 'POST', body });
      notifications.success(t('templates.toasts.created'));
    }
    pristine = snapshot();
    emit('saved');
    emit('update:modelValue', false);
  } catch (err: unknown) {
    const e = err as { data?: { message?: string }; message?: string };
    formError.value =
      e?.data?.message || e?.message || t('components.templateEditor.errors.saveFailed');
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
/* Two columns on a wide modal, stacked below it — the preview is worth more
   beside the editor than under it, but under it beats a 320px-wide column. */
.tpl-editor {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}
@media (max-width: 860px) {
  .tpl-editor {
    grid-template-columns: 1fr;
  }
}

.tpl-pane {
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-width: 0;
}
.tpl-pane--side {
  border-left: 1px solid rgb(var(--line-default));
  background-color: rgb(var(--bg-inset));
  gap: 0.75rem;
}
@media (max-width: 860px) {
  .tpl-pane--side {
    border-left: none;
    border-top: 1px solid rgb(var(--line-default));
  }

  /* Stacked, the two panes fight for the fold. A 16-row source box pushes the
     preview entirely off-screen, which costs the editor its whole point: you
     type on one screenful and the consequence is on another. Shortening the
     source and capping the pane brings both back inside one scroll of each
     other. `rows="16"` stays the desktop shape; this only overrides the
     rendered height. */
  .tpl-source {
    height: 34vh;
    min-height: 9rem;
  }
  .tpl-panel {
    max-height: 40vh;
  }
}

.tpl-label {
  display: block;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.tpl-required {
  color: rgb(var(--danger));
}
.tpl-optional {
  margin-left: 0.35rem;
  font-weight: 400;
  letter-spacing: 0.04em;
  text-transform: none;
  color: rgb(var(--fg-muted));
}
/* Every secondary text role below uses --fg-muted rather than --fg-subtle or
   --fg-faint: measured against these surfaces, subtle lands at 3.5-4.0:1 in
   the dark theme and faint at ~2.1:1 in the light one. Only --fg-muted clears
   4.5:1 in both. */
.tpl-hint {
  font-size: 11px;
  line-height: 1.45;
  color: rgb(var(--fg-muted));
}
.tpl-inline-error {
  font-size: 11px;
  line-height: 1.45;
  color: rgb(var(--danger));
}
.tpl-warn {
  font-size: 11px;
  line-height: 1.45;
  color: rgb(var(--warning));
}
.tpl-form-error {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius-sm);
  border: 1px solid rgb(var(--danger) / 0.3);
  background-color: rgb(var(--danger) / 0.1);
  font-size: 12px;
  color: rgb(var(--danger));
}

/* Tag buttons. Sits flush on top of the textarea — one control surface, not
   a strip floating above an unrelated box. */
.tpl-toolbar {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  flex-wrap: wrap;
  padding: 0.25rem 0.3rem;
  border: 1px solid rgb(var(--line-default));
  border-bottom: none;
  border-radius: 3px 3px 0 0;
  background: rgb(var(--bg-inset, var(--bg-elevated)));
}
.tpl-tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* 26px, over the 24 CSS px WCAG 2.2 asks of a target — unlike the 22px
     `btn-xs` the other controls in this modal inherit. */
  width: 26px;
  height: 26px;
  border-radius: 2px;
  font-size: 0.85rem;
  color: rgb(var(--fg-muted));
  transition: background 0.12s ease, color 0.12s ease;
}
.tpl-tool:hover {
  background: rgb(var(--fg-default) / 0.08);
  color: rgb(var(--fg-strong));
}
.tpl-toolbar-sep {
  width: 1px;
  height: 16px;
  margin: 0 0.25rem;
  background: rgb(var(--line-default));
}
.tpl-toolbar-hint {
  font-family: var(--font-mono);
  font-size: 0.6rem;
  letter-spacing: 0.06em;
  color: rgb(var(--fg-faint));
}

.tpl-source {
  /* Square top corners: the toolbar above owns that edge. */
  border-top-left-radius: 0;
  border-top-right-radius: 0;
  width: 100%;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.55;
  /* The scaffolding is full of long single-line BBCode tags; wrapping them
     is far kinder than a horizontal scrollbar inside a modal. */
  white-space: pre-wrap;
  resize: vertical;
  tab-size: 2;
}
.tpl-counter {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  /* Tabular figures so the number does not shuffle its neighbours on every
     keystroke. */
  font-variant-numeric: tabular-nums;
  color: rgb(var(--fg-muted));
}
.tpl-counter--over {
  color: rgb(var(--danger));
  font-weight: 700;
}

/* ─── Hand-rolled tabs ─────────────────────────────────────── */
.tpl-tabs {
  display: flex;
  gap: 0.25rem;
  padding: 0.2rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  background-color: rgb(var(--bg-base));
}
.tpl-tab {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  padding: 0.35rem 0.5rem;
  border-radius: var(--radius-sm);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  transition: background-color 0.15s, color 0.15s;
}
.tpl-tab:hover {
  color: rgb(var(--fg-default));
  background-color: rgb(var(--bg-hover));
}
.tpl-tab--active {
  color: rgb(var(--fg-strong));
  background-color: rgb(var(--bg-elevated));
  box-shadow: inset 0 0 0 1px rgb(var(--line-strong));
}

.tpl-panel {
  /* Capped rather than flexed: `.modal-panel` is itself a scroll container,
     and nesting an auto-height flex child inside it collapses the pane. */
  max-height: 26rem;
  overflow-y: auto;
  padding-right: 0.25rem;
}
.tpl-panel-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 2.5rem 1rem;
  border: 1px dashed rgb(var(--line-default));
  border-radius: var(--radius-sm);
  font-size: 11px;
  text-align: center;
  color: rgb(var(--fg-muted));
}

.tpl-preview {
  font-size: 12px;
  line-height: 1.6;
  color: rgb(var(--fg-default));
  overflow-wrap: anywhere;
}
.tpl-preview :deep(img) {
  max-width: 100%;
  height: auto;
}

/* ─── Variable palette ─────────────────────────────────────── */
.tpl-group + .tpl-group {
  margin-top: 1rem;
}
.tpl-group-head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.4rem;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.tpl-group-list {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.tpl-var {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}
.tpl-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  flex-shrink: 0;
  padding: 0.15rem 0.4rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  background-color: rgb(var(--bg-surface));
  font-family: var(--font-mono);
  font-size: 11px;
  color: rgb(var(--fg-default));
  transition: border-color 0.15s, color 0.15s;
}
.tpl-chip:hover:not(:disabled) {
  border-color: rgb(var(--accent));
  color: rgb(var(--fg-strong));
}
.tpl-chip:disabled {
  opacity: 0.6;
  cursor: default;
}
.tpl-var-desc {
  font-size: 11px;
  line-height: 1.4;
  color: rgb(var(--fg-muted));
}
</style>
