<template>
  <!-- Single source of truth for rendering a torrent description.
       Wraps `toEditorHtml()` (the format auto-detector that
       dispatches to BBCode / Markdown / HTML parsers and sanitises
       via DOMPurify) and the styles that go with it. Every surface
       that displays a description — the public detail page, the
       WysiwygEditor's preview mode, the upload/edit pages' preview
       panels — should route through this component so the rendered
       output is byte-for-byte the same everywhere. -->
  <div
    class="description-render prose prose-invert prose-sm max-w-none"
    :class="$attrs.class"
    v-html="rendered"
  />
</template>

<script setup lang="ts">
import { toEditorHtml } from '~/utils/editorFormats';

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  /** Raw description as stored in the DB (BBCode, Markdown, or
   *  HTML — the renderer auto-detects). `null`/`undefined`/empty
   *  produce an empty render (no warning, no fallback text). */
  source?: string | null | undefined;
}>();

const rendered = computed(() => toEditorHtml(props.source));
</script>

<style scoped>
.description-render {
  color: rgb(var(--fg-default));
  font-size: 0.875rem;
  line-height: 1.65;
}
</style>

<!-- Unscoped block: prose-style typography for the rendered HTML.
     The descendant selectors need to reach the `v-html`-injected
     children, which scoped attribute selectors don't see. The
     `.description-render` prefix scopes them tightly enough. -->
<style>
.description-render p {
  margin-bottom: 1rem;
}
.description-render p:last-child {
  margin-bottom: 0;
}
.description-render a {
  color: rgb(var(--info));
  text-decoration: underline;
  text-underline-offset: 2px;
}
.description-render a:hover {
  filter: brightness(1.15);
}
.description-render ul,
.description-render ol {
  margin-bottom: 1rem;
  padding-left: 1.5rem;
}
.description-render ul { list-style-type: disc; }
.description-render ol { list-style-type: decimal; }
.description-render li {
  margin-bottom: 0.25rem;
}
.description-render blockquote {
  border-left: 2px solid rgb(var(--line-default));
  padding-left: 0.75rem;
  margin: 0.75rem 0;
  font-style: italic;
  color: rgb(var(--fg-muted));
}
.description-render pre {
  background: rgb(var(--bg-inset, var(--bg-elevated)));
  border-radius: 0.25rem;
  padding: 0.75rem;
  font-family: ui-monospace, monospace;
  font-size: 0.75rem;
  overflow-x: auto;
  margin: 0.75rem 0;
}
.description-render code {
  background: rgb(var(--bg-inset, var(--bg-elevated)));
  padding: 0 0.25rem;
  border-radius: 0.25rem;
  font-family: ui-monospace, monospace;
  font-size: 0.85em;
}
.description-render hr {
  border: 0;
  border-top: 1px solid rgb(var(--line-default));
  margin: 1rem 0;
}
.description-render h1,
.description-render h2,
.description-render h3,
.description-render h4,
.description-render h5,
.description-render h6 {
  font-weight: 700;
  margin: 1rem 0 0.5rem;
  line-height: 1.25;
}
.description-render h1 { font-size: 1.4rem; }
.description-render h2 { font-size: 1.25rem; }
.description-render h3 { font-size: 1.1rem; }

/* Images — keep them inline-block so the parent's
   `text-align: center` (from `[center]` blocks) actually centres
   them. Tailwind typography defaults `prose img` to block-level
   with huge top/bottom margins, which (a) defeats text-align and
   (b) stacks giant gaps between consecutive dividers. No border /
   no radius: descriptions often embed divider banners on a white
   plate (`Le Pitch`, `La Série`, …) where a faint frame would read
   as accidental chrome around the asset. */
.description-render img {
  max-width: 100%;
  height: auto;
  display: inline-block;
  vertical-align: middle;
  margin: 0;
  border: 0;
}
</style>
