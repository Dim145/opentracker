<template>
  <div class="ed">
    <div class="ed-bar">
      <button type="button" class="ed-act" @click="tidy">
        <Icon name="ph:broom-bold" /> {{ $t('admin.themes.cssFormat') }}
      </button>
      <span class="ed-spacer" />
      <span class="ed-count" :class="{ 'ed-count--over': bytes > maxBytes }">
        {{ bytes }}/{{ maxBytes }} B
      </span>
    </div>

    <div ref="frame" class="ed-frame" :style="{ '--gutter': gutterWidth }">
      <!-- Three layers, all sharing one set of metrics. The gutter and the
           highlight are painted; the textarea on top is the real control, made
           transparent so the caret, the selection and every native editing
           behaviour stay the browser's job. -->
      <div ref="gutter" class="ed-gutter" aria-hidden="true">
        <div v-for="n in lineCount" :key="n">{{ n }}</div>
      </div>

      <pre ref="paint" class="ed-paint" aria-hidden="true"><code><span
        v-for="(tok, i) in tokens"
        :key="i"
        :class="['t-' + tok.type, tok.refused ? 't-refused' : '']"
      >{{ tok.text }}</span><span class="t-tail">{{ '\n' }}</span></code></pre>

      <textarea
        ref="area"
        class="ed-area"
        spellcheck="false"
        autocapitalize="off"
        autocorrect="off"
        :placeholder="placeholder"
        :value="modelValue"
        @input="onInput"
        @keydown.tab.exact.prevent="indent"
        @keydown.tab.shift.exact.prevent="outdent"
        @scroll="syncScroll"
      />
    </div>

    <ul v-if="refusals.length" class="ed-refusals">
      <li class="ed-refusals-head">
        <Icon name="ph:warning-bold" /> {{ $t('admin.themes.cssWillRefuse') }}
      </li>
      <li v-for="(r, i) in refusals" :key="i">
        <code>{{ r.text }}</code> — {{ r.reason }}
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
/**
 * The owner's free-form CSS, with colouring, line numbers and a warning list.
 *
 * ## A textarea, not a contenteditable
 *
 * The highlighting is a `<pre>` painted UNDER a real `<textarea>` whose text is
 * transparent. Every editor that replaces the textarea — contenteditable, or a
 * full editor framework — takes on the caret, the selection, undo, IME, mobile
 * keyboards, spellcheck and the accessibility tree, and gets some of them
 * subtly wrong. Here the browser keeps all of it and the only thing this
 * component owns is the paint.
 *
 * That trade has exactly one cost, and it is the reason `cssHighlight` is
 * careful to lose nothing: the two layers are aligned character by character, so
 * a scanner that swallowed a space, or a stylesheet that gave them different
 * metrics, slides the colours out from under the text. `--gutter`, the shared
 * padding and `white-space: pre-wrap` on both layers are load-bearing.
 *
 * ## Why the warnings are here and also on the server
 *
 * `cssRefusals` says what the server is going to refuse. It has no authority:
 * `apps/api/utils/themeCss.ts` is the gate, it parses with `css-tree`, and it
 * regenerates its output from the AST. This exists so an owner learns before
 * pressing save rather than after — and the server's own reply is still shown,
 * because it is the one that counts.
 */
import { cssRefusals, formatCss, tokenizeCss } from '~/utils/cssHighlight';

const props = defineProps<{
  modelValue: string;
  maxBytes: number;
  placeholder?: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [string] }>();

const area = ref<HTMLTextAreaElement | null>(null);
const paint = ref<HTMLElement | null>(null);
const gutter = ref<HTMLElement | null>(null);

const tokens = computed(() => tokenizeCss(props.modelValue));
const refusals = computed(() => cssRefusals(props.modelValue));
const bytes = computed(() => new TextEncoder().encode(props.modelValue).length);
const lineCount = computed(() => props.modelValue.split('\n').length);
/** Wide enough for the largest line number, so the gutter never reflows as you type. */
const gutterWidth = computed(() => `${String(lineCount.value).length + 1}ch`);

function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLTextAreaElement).value);
}

function syncScroll() {
  const el = area.value;
  if (!el) return;
  if (paint.value) {
    paint.value.scrollTop = el.scrollTop;
    paint.value.scrollLeft = el.scrollLeft;
  }
  if (gutter.value) gutter.value.scrollTop = el.scrollTop;
}

/** Replace the selection and put the caret back where the typist expects it. */
function splice(from: number, to: number, text: string, caret: number) {
  const next = props.modelValue.slice(0, from) + text + props.modelValue.slice(to);
  emit('update:modelValue', next);
  nextTick(() => {
    const el = area.value;
    if (!el) return;
    el.selectionStart = el.selectionEnd = caret;
  });
}

const INDENT = '  ';

/**
 * Tab indents rather than leaving the field.
 *
 * A deliberate accessibility trade, and the reason Shift-Tab outdents rather
 * than doing nothing: a keyboard user who lands here needs a way out, and
 * Escape-then-Tab is the browser's, but Shift-Tab at column zero is the one
 * people try. So it outdents only when there is indentation to remove, and
 * otherwise falls through and moves focus.
 */
function indent(e: KeyboardEvent) {
  const el = e.target as HTMLTextAreaElement;
  const { selectionStart: a, selectionEnd: b } = el;
  if (a !== b) {
    const from = props.modelValue.lastIndexOf('\n', a - 1) + 1;
    const block = props.modelValue.slice(from, b);
    const shifted = block.replace(/^/gm, INDENT);
    splice(from, b, shifted, b + (shifted.length - block.length));
    return;
  }
  splice(a, b, INDENT, a + INDENT.length);
}

function outdent(e: KeyboardEvent) {
  const el = e.target as HTMLTextAreaElement;
  const { selectionStart: a, selectionEnd: b } = el;
  const from = props.modelValue.lastIndexOf('\n', a - 1) + 1;
  const block = props.modelValue.slice(from, Math.max(b, a));
  if (!/^[ \t]/m.test(block)) {
    // Nothing to remove: let the keystroke mean what it usually means.
    el.blur();
    return;
  }
  const shifted = block.replace(new RegExp(`^${INDENT}|^[ \\t]`, 'gm'), '');
  splice(from, Math.max(b, a), shifted, Math.max(from, a - (block.length - shifted.length)));
}

function tidy() {
  emit('update:modelValue', formatCss(props.modelValue));
}
</script>

<style scoped>
.ed {
  display: grid;
  gap: 0.4rem;
}
.ed-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.ed-act {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.15rem 0.45rem;
  font-size: 0.625rem;
  color: rgb(var(--fg-muted));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  transition: color calc(120ms * var(--motion-scale)) var(--ease-standard);
}
.ed-act:hover {
  color: rgb(var(--fg-default));
  border-color: rgb(var(--line-strong));
}
.ed-spacer {
  flex: 1;
}
.ed-count {
  font-family: var(--font-mono);
  font-size: 0.5625rem;
  color: rgb(var(--fg-faint));
}
.ed-count--over {
  color: rgb(var(--danger));
}

/* ── The three layers ─────────────────────────────────────────────────
   Everything below that affects metrics has to hold for BOTH the paint and
   the textarea, or the colours drift away from the characters. */
.ed-frame {
  position: relative;
  display: grid;
  grid-template-columns: var(--gutter) 1fr;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  background: rgb(var(--bg-inset));
  overflow: hidden;
}
.ed-gutter,
.ed-paint,
.ed-area {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  line-height: 1.6;
  tab-size: 2;
}
.ed-paint,
.ed-area {
  grid-column: 2;
  grid-row: 1;
  margin: 0;
  padding: 0.5rem 0.6rem;
  border: 0;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  overflow: auto;
  min-height: 16rem;
  max-height: 32rem;
}
.ed-gutter {
  grid-column: 1;
  grid-row: 1;
  padding: 0.5rem 0.35rem 0.5rem 0;
  text-align: right;
  color: rgb(var(--fg-faint));
  background: rgb(var(--bg-base) / 0.4);
  border-right: 1px solid rgb(var(--line-default));
  overflow: hidden;
  user-select: none;
}
.ed-paint {
  pointer-events: none;
  color: rgb(var(--fg-muted));
}
.ed-area {
  position: relative;
  resize: vertical;
  background: transparent;
  /* Transparent text over the painted copy, with a visible caret. Both are
     needed: `color: transparent` alone would hide the caret in some engines. */
  color: transparent;
  caret-color: rgb(var(--fg-default));
}
.ed-area::selection {
  background: rgb(var(--accent) / 0.28);
}
.ed-area:focus-visible {
  outline: 2px solid rgb(var(--focus-ring));
  outline-offset: -2px;
}

/* ── The palette, from the theme being edited ─────────────────────────
   Not a fixed set of colours: the editor is inside the page the theme paints,
   so a theme with a pale surface gets legible code without anyone maintaining
   a second palette for it. */
.t-comment { color: rgb(var(--fg-faint)); font-style: italic; }
.t-selector { color: rgb(var(--accent)); }
.t-atrule { color: rgb(var(--accent-warm)); font-weight: 700; }
.t-property { color: rgb(var(--fg-default)); }
.t-value { color: rgb(var(--fg-muted)); }
.t-string { color: rgb(var(--online)); }
.t-number { color: rgb(var(--chart-3)); }
.t-function { color: rgb(var(--info)); }
.t-punct { color: rgb(var(--fg-subtle)); }
.t-refused {
  color: rgb(var(--danger));
  text-decoration: underline wavy rgb(var(--danger) / 0.7);
  text-underline-offset: 2px;
}

.ed-refusals {
  display: grid;
  gap: 0.2rem;
  padding: 0.5rem 0.6rem;
  border: 1px solid rgb(var(--danger) / 0.4);
  border-radius: var(--radius-sm);
  background: rgb(var(--danger) / 0.06);
  font-size: 0.625rem;
  color: rgb(var(--fg-muted));
}
.ed-refusals-head {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-weight: 700;
  color: rgb(var(--danger));
}
.ed-refusals code {
  font-family: var(--font-mono);
  color: rgb(var(--fg-default));
}
</style>
