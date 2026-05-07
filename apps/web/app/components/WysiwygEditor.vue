<template>
  <div class="wysiwyg-editor">
    <!-- Toolbar -->
    <div
      v-if="editor"
      class="flex items-center flex-wrap gap-0.5 p-1.5 bg-bg-tertiary border border-border rounded-t border-b-0"
    >
      <!-- Inline marks -->
      <button
        type="button"
        :class="['toolbar-btn', { active: editor.isActive('bold') }]"
        title="Bold"
        @click="editor.chain().focus().toggleBold().run()"
      >
        <Icon name="ph:text-b-bold" />
      </button>
      <button
        type="button"
        :class="['toolbar-btn', { active: editor.isActive('italic') }]"
        title="Italic"
        @click="editor.chain().focus().toggleItalic().run()"
      >
        <Icon name="ph:text-italic" />
      </button>
      <button
        type="button"
        :class="['toolbar-btn', { active: editor.isActive('underline') }]"
        title="Underline"
        @click="editor.chain().focus().toggleUnderline().run()"
      >
        <Icon name="ph:text-underline" />
      </button>
      <button
        type="button"
        :class="['toolbar-btn', { active: editor.isActive('strike') }]"
        title="Strikethrough"
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
        title="Heading 1"
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
        title="Heading 2"
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
        title="Heading 3"
        @click="editor.chain().focus().toggleHeading({ level: 3 }).run()"
      >
        <Icon name="ph:text-h-three" />
      </button>

      <span class="divider" />

      <!-- Lists -->
      <button
        type="button"
        :class="['toolbar-btn', { active: editor.isActive('bulletList') }]"
        title="Bullet list"
        @click="editor.chain().focus().toggleBulletList().run()"
      >
        <Icon name="ph:list-bullets" />
      </button>
      <button
        type="button"
        :class="['toolbar-btn', { active: editor.isActive('orderedList') }]"
        title="Numbered list"
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
        title="Align left"
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
        title="Align center"
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
        title="Align right"
        @click="editor.chain().focus().setTextAlign('right').run()"
      >
        <Icon name="ph:text-align-right" />
      </button>

      <span class="divider" />

      <!-- Block -->
      <button
        type="button"
        :class="['toolbar-btn', { active: editor.isActive('blockquote') }]"
        title="Quote"
        @click="editor.chain().focus().toggleBlockquote().run()"
      >
        <Icon name="ph:quotes" />
      </button>
      <button
        type="button"
        :class="['toolbar-btn', { active: editor.isActive('codeBlock') }]"
        title="Code block"
        @click="editor.chain().focus().toggleCodeBlock().run()"
      >
        <Icon name="ph:code" />
      </button>
      <button
        type="button"
        class="toolbar-btn"
        title="Horizontal rule"
        @click="editor.chain().focus().setHorizontalRule().run()"
      >
        <Icon name="ph:minus" />
      </button>

      <span class="divider" />

      <!-- Link / Image -->
      <button
        type="button"
        :class="['toolbar-btn', { active: editor.isActive('link') }]"
        title="Link"
        @click="promptLink"
      >
        <Icon name="ph:link" />
      </button>
      <button
        type="button"
        class="toolbar-btn"
        title="Image"
        @click="promptImage"
      >
        <Icon name="ph:image" />
      </button>

      <span class="divider" />

      <!-- Color -->
      <label class="toolbar-btn cursor-pointer relative" title="Text color">
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
        title="Clear formatting"
        @click="editor.chain().focus().unsetAllMarks().clearNodes().run()"
      >
        <Icon name="ph:eraser" />
      </button>
      <button
        type="button"
        class="toolbar-btn"
        :disabled="!editor.can().undo()"
        title="Undo"
        @click="editor.chain().focus().undo().run()"
      >
        <Icon name="ph:arrow-counter-clockwise" />
      </button>
      <button
        type="button"
        class="toolbar-btn"
        :disabled="!editor.can().redo()"
        title="Redo"
        @click="editor.chain().focus().redo().run()"
      >
        <Icon name="ph:arrow-clockwise" />
      </button>
    </div>

    <!-- Format hint — visible only when content was just imported from
         another format, gives the user a sense of what the editor is doing. -->
    <div
      v-if="lastImportedFormat && lastImportedFormat !== 'html'"
      class="flex items-center gap-1.5 px-3 py-1 bg-bg-tertiary/60 border border-border border-b-0 text-[10px] uppercase tracking-widest text-text-muted"
    >
      <Icon name="ph:magic-wand" />
      Pasted as {{ lastImportedFormat }} — converted automatically
    </div>

    <!-- Editor -->
    <EditorContent
      :editor="editor"
      class="wysiwyg-content bg-bg-tertiary border border-border rounded-b px-3 py-2 min-h-[120px] focus-within:border-fg-default/20 transition-colors"
    />

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
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: 'Start typing…',
  format: 'html',
  maxLength: undefined,
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
}>();

const lastImportedFormat = ref<EditorFormat | null>(null);

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
    Placeholder.configure({ placeholder: () => props.placeholder }),
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
  const url = window.prompt('Link URL', previous || 'https://');
  if (url === null) return;
  if (url === '') {
    editor.value?.chain().focus().extendMarkRange('link').unsetLink().run();
    return;
  }
  if (!/^https?:\/\//i.test(url)) {
    window.alert('Only http(s) links are accepted.');
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
  const url = window.prompt('Image URL', 'https://');
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) {
    window.alert('Only http(s) image URLs are accepted.');
    return;
  }
  editor.value?.chain().focus().setImage({ src: url }).run();
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
