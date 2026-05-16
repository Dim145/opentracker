<template>
  <div class="wysiwyg-editor">
    <!-- Mode bar — always visible. The three icons toggle between
         the WYSIWYG editor, the raw-source textarea, and the
         read-only render. Mode-specific tools (the formatting
         toolbar, the BBCode tag chips, etc.) sit on the same row
         to the right of the divider. -->
    <div
      class="we-modebar flex items-center flex-wrap gap-0.5 p-1.5 bg-bg-tertiary border border-border rounded-t border-b-0"
    >
      <div class="we-modes" role="tablist" :aria-label="t('components.wysiwyg.modeAria')">
        <button
          type="button"
          :class="['toolbar-btn', { active: mode === 'editor' }]"
          :title="t('components.wysiwyg.mode.editor')"
          role="tab"
          :aria-selected="mode === 'editor'"
          @click="setMode('editor')"
        >
          <Icon name="ph:pencil-bold" />
        </button>
        <button
          type="button"
          :class="['toolbar-btn', { active: mode === 'code' }]"
          :title="t('components.wysiwyg.mode.code')"
          role="tab"
          :aria-selected="mode === 'code'"
          @click="setMode('code')"
        >
          <Icon name="ph:code-bold" />
        </button>
        <button
          type="button"
          :class="['toolbar-btn', { active: mode === 'preview' }]"
          :title="t('components.wysiwyg.mode.preview')"
          role="tab"
          :aria-selected="mode === 'preview'"
          @click="setMode('preview')"
        >
          <Icon name="ph:eye-bold" />
        </button>
      </div>

      <span class="divider" />

      <!-- ── Mode: CODE — BBCode/Markdown tag chips ───────────── -->
      <div v-if="mode === 'code'" class="we-tags">
        <span class="we-tags-label">{{ t('components.wysiwyg.tagsLabel') }}</span>
        <button
          v-for="tag in CODE_TAGS"
          :key="tag.label"
          type="button"
          class="we-tag-chip"
          :title="tag.title"
          @click="insertTag(tag)"
        >
          [{{ tag.label }}]
        </button>
      </div>

      <!-- ── Mode: PREVIEW — read-only badge ──────────────────── -->
      <div v-if="mode === 'preview'" class="we-preview-badge">
        <Icon name="ph:eye-bold" />
        {{ t('components.wysiwyg.previewBadge') }}
      </div>
    </div>

    <!-- Editor toolbar (only in editor mode). Same buttons as
         before, just gated by `mode === 'editor'`. -->
    <div
      v-if="mode === 'editor' && editor"
      class="we-toolbar flex items-center flex-wrap gap-0.5 p-1.5 bg-bg-tertiary border border-border border-t-0 border-b-0"
    >
      <!-- Inline marks -->
      <button
        type="button"
        :class="['toolbar-btn', { active: editor.isActive('bold') }]"
        :title="t('components.wysiwyg.tooltips.bold')"
        @click="editor.chain().focus().toggleBold().run()"
      >
        <Icon name="ph:text-b-bold" />
      </button>
      <button
        type="button"
        :class="['toolbar-btn', { active: editor.isActive('italic') }]"
        :title="t('components.wysiwyg.tooltips.italic')"
        @click="editor.chain().focus().toggleItalic().run()"
      >
        <Icon name="ph:text-italic" />
      </button>
      <button
        type="button"
        :class="['toolbar-btn', { active: editor.isActive('underline') }]"
        :title="t('components.wysiwyg.tooltips.underline')"
        @click="editor.chain().focus().toggleUnderline().run()"
      >
        <Icon name="ph:text-underline" />
      </button>
      <button
        type="button"
        :class="['toolbar-btn', { active: editor.isActive('strike') }]"
        :title="t('components.wysiwyg.tooltips.strike')"
        @click="editor.chain().focus().toggleStrike().run()"
      >
        <Icon name="ph:text-strikethrough" />
      </button>

      <span class="divider" />

      <!-- Headings -->
      <button
        type="button"
        :class="[
          'toolbar-btn',
          { active: editor.isActive('heading', { level: 1 }) },
        ]"
        :title="t('components.wysiwyg.tooltips.h1')"
        @click="editor.chain().focus().toggleHeading({ level: 1 }).run()"
      >
        <Icon name="ph:text-h-one" />
      </button>
      <button
        type="button"
        :class="[
          'toolbar-btn',
          { active: editor.isActive('heading', { level: 2 }) },
        ]"
        :title="t('components.wysiwyg.tooltips.h2')"
        @click="editor.chain().focus().toggleHeading({ level: 2 }).run()"
      >
        <Icon name="ph:text-h-two" />
      </button>
      <button
        type="button"
        :class="[
          'toolbar-btn',
          { active: editor.isActive('heading', { level: 3 }) },
        ]"
        :title="t('components.wysiwyg.tooltips.h3')"
        @click="editor.chain().focus().toggleHeading({ level: 3 }).run()"
      >
        <Icon name="ph:text-h-three" />
      </button>

      <span class="divider" />

      <!-- Lists -->
      <button
        type="button"
        :class="['toolbar-btn', { active: editor.isActive('bulletList') }]"
        :title="t('components.wysiwyg.tooltips.bulletList')"
        @click="editor.chain().focus().toggleBulletList().run()"
      >
        <Icon name="ph:list-bullets" />
      </button>
      <button
        type="button"
        :class="['toolbar-btn', { active: editor.isActive('orderedList') }]"
        :title="t('components.wysiwyg.tooltips.orderedList')"
        @click="editor.chain().focus().toggleOrderedList().run()"
      >
        <Icon name="ph:list-numbers" />
      </button>

      <span class="divider" />

      <!-- Alignment -->
      <button
        type="button"
        :class="[
          'toolbar-btn',
          { active: editor.isActive({ textAlign: 'left' }) },
        ]"
        :title="t('components.wysiwyg.tooltips.alignLeft')"
        @click="editor.chain().focus().setTextAlign('left').run()"
      >
        <Icon name="ph:text-align-left" />
      </button>
      <button
        type="button"
        :class="[
          'toolbar-btn',
          { active: editor.isActive({ textAlign: 'center' }) },
        ]"
        :title="t('components.wysiwyg.tooltips.alignCenter')"
        @click="editor.chain().focus().setTextAlign('center').run()"
      >
        <Icon name="ph:text-align-center" />
      </button>
      <button
        type="button"
        :class="[
          'toolbar-btn',
          { active: editor.isActive({ textAlign: 'right' }) },
        ]"
        :title="t('components.wysiwyg.tooltips.alignRight')"
        @click="editor.chain().focus().setTextAlign('right').run()"
      >
        <Icon name="ph:text-align-right" />
      </button>

      <span class="divider" />

      <!-- Block -->
      <button
        type="button"
        :class="['toolbar-btn', { active: editor.isActive('blockquote') }]"
        :title="t('components.wysiwyg.tooltips.quote')"
        @click="editor.chain().focus().toggleBlockquote().run()"
      >
        <Icon name="ph:quotes" />
      </button>
      <button
        type="button"
        :class="['toolbar-btn', { active: editor.isActive('codeBlock') }]"
        :title="t('components.wysiwyg.tooltips.codeBlock')"
        @click="editor.chain().focus().toggleCodeBlock().run()"
      >
        <Icon name="ph:code" />
      </button>
      <button
        type="button"
        class="toolbar-btn"
        :title="t('components.wysiwyg.tooltips.horizontalRule')"
        @click="editor.chain().focus().setHorizontalRule().run()"
      >
        <Icon name="ph:minus" />
      </button>

      <span class="divider" />

      <!-- Link / Image -->
      <button
        type="button"
        :class="['toolbar-btn', { active: editor.isActive('link') }]"
        :title="t('components.wysiwyg.tooltips.link')"
        @click="promptLink"
      >
        <Icon name="ph:link" />
      </button>
      <button
        type="button"
        class="toolbar-btn"
        :title="t('components.wysiwyg.tooltips.image')"
        @click="promptImage"
      >
        <Icon name="ph:image" />
      </button>

      <span class="divider" />

      <!-- Color -->
      <label class="toolbar-btn cursor-pointer relative" :title="t('components.wysiwyg.tooltips.textColor')">
        <Icon name="ph:paint-bucket" />
        <input
          type="color"
          class="absolute inset-0 opacity-0 cursor-pointer"
          :value="currentColor"
          @input="setColor"
        />
      </label>

      <span class="ml-auto" />

      <!-- Clear / Undo / Redo -->
      <button
        type="button"
        class="toolbar-btn"
        :title="t('components.wysiwyg.tooltips.clearFormatting')"
        @click="editor.chain().focus().unsetAllMarks().clearNodes().run()"
      >
        <Icon name="ph:eraser" />
      </button>
      <button
        type="button"
        class="toolbar-btn"
        :disabled="!editor.can().undo()"
        :title="t('components.wysiwyg.tooltips.undo')"
        @click="editor.chain().focus().undo().run()"
      >
        <Icon name="ph:arrow-counter-clockwise" />
      </button>
      <button
        type="button"
        class="toolbar-btn"
        :disabled="!editor.can().redo()"
        :title="t('components.wysiwyg.tooltips.redo')"
        @click="editor.chain().focus().redo().run()"
      >
        <Icon name="ph:arrow-clockwise" />
      </button>
    </div>

    <!-- Format hint — visible only when content was just imported from
         another format, gives the user a sense of what the editor is doing. -->
    <div
      v-if="mode === 'editor' && lastImportedFormat && lastImportedFormat !== 'html'"
      class="flex items-center gap-1.5 px-3 py-1 bg-bg-tertiary/60 border border-border border-b-0 text-[10px] uppercase tracking-widest text-text-muted"
    >
      <Icon name="ph:magic-wand" />
      {{ t('components.wysiwyg.pastedAs', { format: lastImportedFormat }) }}
    </div>

    <!-- Editor (TipTap, WYSIWYG) -->
    <EditorContent
      v-show="mode === 'editor'"
      :editor="editor"
      class="wysiwyg-content bg-bg-tertiary border border-border rounded-b px-3 py-2 min-h-[160px] focus-within:border-fg-default/20 transition-colors"
    />

    <!-- Code mode — raw source textarea. The textarea is the *truth*
         while this mode is active; we don't shadow the value through
         the TipTap model. Users can paste BBCode or Markdown freely;
         on save the parent decides what to do (auto-detect happens
         at render-time on the public detail page). -->
    <textarea
      v-show="mode === 'code'"
      ref="codeAreaRef"
      :value="modelValue"
      :placeholder="resolvedPlaceholder"
      class="we-code-area bg-bg-tertiary border border-border rounded-b px-3 py-2 w-full min-h-[260px] font-mono text-[12.5px] leading-relaxed text-text-default outline-none focus:border-fg-default/20 transition-colors"
      @input="onCodeInput"
    />

    <!-- Preview mode — read-only render of the current source.
         Routes through <DescriptionRender>, the same component the
         public detail page uses, so what you see here is byte-for-
         byte what the viewer will see post-publish. -->
    <div
      v-show="mode === 'preview'"
      class="we-preview bg-bg-tertiary border border-border rounded-b px-4 py-3 min-h-[180px]"
    >
      <DescriptionRender :source="previewSource" />
    </div>

    <!-- Character count -->
    <div v-if="maxLength && editor" class="text-right mt-1">
      <span
        :class="[
          'text-[10px] font-mono',
          characterCount > maxLength ? 'text-error' : 'text-text-muted',
        ]"
      >
        {{ characterCount }} / {{ maxLength }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useEditor, EditorContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import TextAlign from '@tiptap/extension-text-align';
import {
  htmlToMarkdown,
  toEditorHtml,
  detectFormat,
  type EditorFormat,
} from '~/utils/editorFormats';
import DescriptionRender from '~/components/DescriptionRender.vue';

/* The three editor modes. `editor` is the visual TipTap surface,
   `code` is a raw source textarea (BBCode / Markdown / HTML — the
   render pass auto-detects), `preview` is the read-only render of
   whichever source the user typed last. */
type EditorMode = 'editor' | 'code' | 'preview';

interface CodeTag {
  /** Label shown inside the chip — also drives `[…]` insertion. */
  label: string;
  /** Tooltip explaining what the tag does. */
  title: string;
  /** Optional override for the inserted text (e.g. `url=https://`). */
  open?: string;
  /** Closing tag override (defaults to `/label`). */
  close?: string;
  /** When true, no closing tag is inserted (e.g. `[hr]`-style). */
  selfClosing?: boolean;
}

const CODE_TAGS: CodeTag[] = [
  { label: 'b', title: 'Gras' },
  { label: 'i', title: 'Italique' },
  { label: 'u', title: 'Souligné' },
  { label: 's', title: 'Barré' },
  { label: 'url', title: 'Lien', open: 'url=https://' },
  { label: 'img', title: 'Image' },
  { label: 'quote', title: 'Citation' },
  { label: 'code', title: 'Bloc de code' },
  { label: 'list', title: 'Liste' },
  { label: 'color', title: 'Couleur', open: 'color=#ffffff' },
  { label: 'size', title: 'Taille', open: 'size=16' },
  { label: 'center', title: 'Centrer' },
];

const { t } = useI18n();

interface Props {
  modelValue: string;
  placeholder?: string;
  maxLength?: number;
  /**
   * What format the parent stores. `'markdown'` (default) round-trips
   * MD↔HTML so existing data and `renderMarkdown()` callers keep working.
   * `'html'` skips the round-trip — used by admin Branding which already
   * stores raw HTML.
   */
  format?: 'markdown' | 'html';
  /**
   * Which mode the editor starts in. Defaults to the visual editor so
   * an empty new-upload form drops the cursor straight into the WYSIWYG
   * surface. The edit page passes `'preview'` so an existing
   * description (which may include exotic BBCode formatting TipTap
   * can't round-trip) is shown as the viewer will see it before the
   * uploader commits to a destructive edit.
   */
  defaultMode?: EditorMode;
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: '',
  format: 'html',
  maxLength: undefined,
  defaultMode: 'editor',
});

// Resolve runtime placeholder: prefer the prop if explicitly passed,
// fall back to the localised default. Computed so it reacts to locale switches.
const resolvedPlaceholder = computed(() =>
  props.placeholder && props.placeholder.length > 0
    ? props.placeholder
    : t('components.wysiwyg.placeholderDefault'),
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
}>();

const lastImportedFormat = ref<EditorFormat | null>(null);
const mode = ref<EditorMode>(props.defaultMode);
const codeAreaRef = ref<HTMLTextAreaElement | null>(null);

/* Preview routes through <DescriptionRender>, which calls
   `toEditorHtml` internally — same code path as the public detail
   page. We just hand it the *raw* source: HTML straight from
   TipTap when the user has been editing visually, or the raw
   textarea content when they were in code mode. That way the
   preview output is identical to what the visitor will see, even
   if the editor's WYSIWYG round-trip would have stripped some
   BBCode-specific formatting (font-size, colour, …). */
const previewSource = computed(() => {
  if (mode.value === 'editor' && editor.value) {
    return editor.value.getHTML();
  }
  return props.modelValue;
});

// Convert the parent's stored value into HTML for TipTap. For markdown
// mode we also accept the legacy mix of MD with embedded HTML/BBCode.
function inputToHtml(value: string): string {
  if (!value) return '';
  if (props.format === 'html') return value;
  return toEditorHtml(value);
}

// Reverse: when emitting, give the parent back the stored format.
function htmlToOutput(html: string): string {
  return props.format === 'html' ? html : htmlToMarkdown(html);
}

const editor = useEditor({
  content: inputToHtml(props.modelValue),
  extensions: [
    StarterKit.configure({
      // The link extension owns linking; the starter-kit version doesn't
      // give us target / rel attributes.
      link: false,
    }),
    Placeholder.configure({ placeholder: () => resolvedPlaceholder.value }),
    TextStyle,
    Color,
    Underline,
    Link.configure({
      openOnClick: false,
      autolink: true,
      HTMLAttributes: {
        rel: 'noopener noreferrer',
        target: '_blank',
      },
    }),
    Image.configure({ inline: false, allowBase64: false }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
  ],
  editorProps: {
    attributes: {
      class:
        'prose prose-invert prose-sm max-w-none focus:outline-none min-h-[140px]',
    },
    /**
     * Detect BBCode / Markdown / HTML on paste and convert before
     * insertion. Returning `true` tells TipTap we handled it ourselves;
     * we defer the actual `insertContent` to a microtask so TipTap's
     * own paste pipeline finishes unwinding first (otherwise the
     * insertion can race with the still-pending default handler).
     */
    handlePaste(_view, event) {
      const cd = event.clipboardData;
      if (!cd) return false;
      const text = cd.getData('text/plain') || '';
      const html = cd.getData('text/html') || '';

      // Browser already pasted real HTML (Word, Google Docs, web page) —
      // let TipTap handle it natively to keep formatting fidelity.
      if (html.trim()) return false;
      if (!text.trim()) return false;

      const fmt = detectFormat(text);
      if (fmt === 'html') return false;

      const converted = toEditorHtml(text);
      if (!converted || converted === text) return false;

      lastImportedFormat.value = fmt;
      setTimeout(() => {
        if (lastImportedFormat.value === fmt) lastImportedFormat.value = null;
      }, 5000);

      queueMicrotask(() => {
        editor.value
          ?.chain()
          .focus()
          .insertContent(converted, {
            parseOptions: { preserveWhitespace: 'full' },
          })
          .run();
      });
      return true;
    },
  },
  onUpdate: ({ editor }) => {
    emit('update:modelValue', htmlToOutput(editor.getHTML()));
  },
});

const characterCount = computed(() => {
  return editor.value?.getText().length ?? 0;
});

const currentColor = computed(() => {
  const c = editor.value?.getAttributes('textStyle')?.color as
    | string
    | undefined;
  return c || '#888888';
});

function setColor(event: Event) {
  const color = (event.target as HTMLInputElement).value;
  editor.value?.chain().focus().setColor(color).run();
}

function promptLink() {
  const previous = editor.value?.getAttributes('link')?.href as
    | string
    | undefined;
  const url = window.prompt(t('components.wysiwyg.linkPrompt'), previous || 'https://');
  if (url === null) return;
  if (url === '') {
    editor.value?.chain().focus().extendMarkRange('link').unsetLink().run();
    return;
  }
  if (!/^https?:\/\//i.test(url)) {
    window.alert(t('components.wysiwyg.linkOnlyHttp'));
    return;
  }
  editor.value
    ?.chain()
    .focus()
    .extendMarkRange('link')
    .setLink({ href: url })
    .run();
}

function promptImage() {
  const url = window.prompt(t('components.wysiwyg.imagePrompt'), 'https://');
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) {
    window.alert(t('components.wysiwyg.imageOnlyHttp'));
    return;
  }
  editor.value?.chain().focus().setImage({ src: url }).run();
}

/* ── Mode switch ─────────────────────────────────────────────
   When the user toggles modes we keep the source in sync via
   `modelValue` — no shadow copies. Going to `editor` reparses
   the source (handles the case where the user typed BBCode in
   code mode and is jumping into the visual editor). Going to
   `code`/`preview` from `editor` flushes TipTap's HTML into
   markdown / raw form so the textarea / preview reflect what
   the parent will store. */
function setMode(next: EditorMode) {
  if (mode.value === next) return;

  // Editor → other: flush TipTap content into `modelValue` first.
  if (mode.value === 'editor' && editor.value) {
    const html = editor.value.getHTML();
    const out = htmlToOutput(html);
    if (out !== props.modelValue) {
      emit('update:modelValue', out);
    }
  }

  mode.value = next;

  // → editor: re-seed TipTap from the (possibly raw) source.
  if (next === 'editor' && editor.value) {
    const html = inputToHtml(props.modelValue);
    if (html !== editor.value.getHTML()) {
      editor.value.commands.setContent(html, { emitUpdate: false });
    }
  }

  // → code: drop focus onto the textarea so the user can start
  // typing immediately.
  if (next === 'code') {
    nextTick(() => codeAreaRef.value?.focus());
  }
}

function onCodeInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLTextAreaElement).value);
}

/* Insert a BBCode tag at the textarea cursor, wrapping the current
   selection if there is one. Restores focus + leaves the caret
   between the tags so the user can keep typing without having to
   reach for the mouse. */
function insertTag(tag: CodeTag) {
  const ta = codeAreaRef.value;
  if (!ta) return;
  ta.focus();
  const value = ta.value;
  const start = ta.selectionStart ?? value.length;
  const end = ta.selectionEnd ?? value.length;
  const selected = value.slice(start, end);
  const openTag = `[${tag.open ?? tag.label}]`;
  const closeTag = tag.selfClosing ? '' : `[${tag.close ?? `/${tag.label}`}]`;
  const next = value.slice(0, start) + openTag + selected + closeTag + value.slice(end);
  emit('update:modelValue', next);
  nextTick(() => {
    const caret = start + openTag.length + selected.length;
    ta.setSelectionRange(caret, caret);
  });
}

// Keep the editor in sync if the parent reassigns modelValue (e.g. when
// the modal opens for a different torrent).
watch(
  () => props.modelValue,
  (newValue) => {
    if (!editor.value) return;
    const currentOut = htmlToOutput(editor.value.getHTML());
    if (currentOut === newValue) return;
    editor.value.commands.setContent(inputToHtml(newValue), {
      emitUpdate: false,
    });
  }
);

onBeforeUnmount(() => {
  editor.value?.destroy();
});
</script>

<style scoped>
.toolbar-btn {
  width: 1.75rem;
  height: 1.75rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 0.25rem;
  color: rgb(var(--fg-muted));
  transition: all 0.15s ease;
}
.toolbar-btn:hover {
  color: rgb(var(--fg-strong));
  background: rgb(var(--fg-default) / 0.06);
}
.toolbar-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
.toolbar-btn.active {
  background: rgb(var(--fg-default) / 0.12);
  color: rgb(var(--fg-strong));
}
.divider {
  width: 1px;
  height: 1.25rem;
  background: rgb(var(--line-default));
  margin: 0 0.25rem;
}

/* Mode segment — three buttons grouped tight so the eye reads
   them as one control rather than three independent toggles. */
.we-modes {
  display: inline-flex;
  align-items: center;
  gap: 0.125rem;
  padding: 0.125rem;
  background: rgb(var(--bg-inset, var(--bg-elevated)));
  border-radius: 0.3rem;
  border: 1px solid rgb(var(--line-default));
}
.we-modes .toolbar-btn {
  border-radius: 0.2rem;
}

/* Tag chips for code mode. Mono, faint at rest, light up on hover
   to telegraph "click to insert". The label retains its [bracket]
   form so the chip itself doubles as a hint about what's about to
   land in the textarea. */
.we-tags {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.25rem 0.35rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  color: rgb(var(--fg-muted));
}
.we-tags-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  margin-right: 0.25rem;
}
.we-tag-chip {
  display: inline-flex;
  align-items: center;
  padding: 0.18rem 0.5rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.25rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  letter-spacing: 0.02em;
  color: rgb(var(--fg-default));
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease,
    color 0.15s ease, transform 0.18s ease;
}
.we-tag-chip:hover {
  background: rgba(56, 189, 248, 0.12);
  border-color: rgba(56, 189, 248, 0.45);
  color: #38bdf8;
  transform: translateY(-1px);
}

.we-preview-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  padding: 0.18rem 0.5rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.25rem;
  background: rgb(var(--bg-elevated));
}

.we-code-area {
  resize: vertical;
}
.we-code-area::placeholder {
  color: rgb(var(--fg-muted));
  font-family: inherit;
}
</style>

<style>
.wysiwyg-content .ProseMirror {
  min-height: 140px;
  font-size: 0.875rem;
  color: rgb(var(--fg-default));
  outline: none;
}
.wysiwyg-content .ProseMirror p.is-editor-empty:first-child::before {
  color: rgb(var(--fg-muted));
  pointer-events: none;
  float: left;
  height: 0;
  content: attr(data-placeholder);
}
.wysiwyg-content .ProseMirror h1 {
  font-size: 1.25rem;
  font-weight: 700;
  margin: 0.5rem 0;
}
.wysiwyg-content .ProseMirror h2 {
  font-size: 1.125rem;
  font-weight: 700;
  margin: 0.5rem 0;
}
.wysiwyg-content .ProseMirror h3 {
  font-size: 1rem;
  font-weight: 700;
  margin: 0.5rem 0;
}
.wysiwyg-content .ProseMirror ul,
.wysiwyg-content .ProseMirror ol {
  padding-left: 1.25rem;
  margin: 0.5rem 0;
}
.wysiwyg-content .ProseMirror ul {
  list-style-type: disc;
}
.wysiwyg-content .ProseMirror ol {
  list-style-type: decimal;
}
.wysiwyg-content .ProseMirror blockquote {
  border-left: 2px solid rgb(var(--line-default));
  padding-left: 0.75rem;
  font-style: italic;
  color: rgb(var(--fg-muted));
  margin: 0.5rem 0;
}
.wysiwyg-content .ProseMirror pre {
  background: rgb(var(--bg-inset));
  border-radius: 0.25rem;
  padding: 0.75rem;
  font-family: ui-monospace, monospace;
  font-size: 0.75rem;
  margin: 0.5rem 0;
  overflow-x: auto;
}
.wysiwyg-content .ProseMirror code {
  background: rgb(var(--bg-inset));
  padding: 0 0.25rem;
  border-radius: 0.25rem;
  font-family: ui-monospace, monospace;
  font-size: 0.75rem;
}
.wysiwyg-content .ProseMirror hr {
  border-color: rgb(var(--line-default));
  margin: 1rem 0;
}
.wysiwyg-content .ProseMirror p {
  margin: 0.4rem 0;
}
.wysiwyg-content .ProseMirror strong {
  font-weight: 700;
}
.wysiwyg-content .ProseMirror em {
  font-style: italic;
}
.wysiwyg-content .ProseMirror u {
  text-decoration: underline;
  text-underline-offset: 2px;
}
.wysiwyg-content .ProseMirror s {
  text-decoration: line-through;
}
.wysiwyg-content .ProseMirror a {
  color: rgb(var(--fg-strong));
  text-decoration: underline;
  text-underline-offset: 2px;
}
.wysiwyg-content .ProseMirror img {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
  border: 1px solid rgb(var(--line-default));
}
</style>
