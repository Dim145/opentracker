<template>
  <!-- Renders a single forum post's body. Supports a tiny markdown subset:
       - blockquotes (`> ...` lines)
       - fenced code blocks (```lang)
       - inline code (`token`)
       - bold (`**word**`)
       - italics (`*word*`)
       - bare URLs auto-linked (no JS-scheme allowed)
       - paragraph breaks on blank lines

       The renderer never invokes `v-html` on user input — we build a
       Vue VNode tree from parsed tokens, so even malicious markup is
       neutralised by the framework's text escaping. -->
  <div class="post-body-prose">
    <component
      v-for="(block, i) in blocks"
      :is="block.tag"
      :key="i"
      :class="block.class"
    >
      <template v-if="block.kind === 'pre'">
        <code v-text="block.text" />
      </template>
      <template v-else-if="block.kind === 'quote'">
        <component
          :is="line.tag"
          v-for="(line, j) in (block.lines as InlineLine[])"
          :key="j"
        >
          <component
            v-for="(seg, k) in line.segs"
            :is="seg.tag"
            :key="k"
            :href="seg.tag === 'a' ? seg.href : undefined"
            :target="seg.tag === 'a' ? '_blank' : undefined"
            :rel="seg.tag === 'a' ? 'noreferrer noopener' : undefined"
            :class="seg.class"
          >
            {{ seg.text }}
          </component>
        </component>
      </template>
      <template v-else>
        <component
          v-for="(seg, k) in (block.segs as InlineSeg[])"
          :is="seg.tag"
          :key="k"
          :href="seg.tag === 'a' ? seg.href : undefined"
          :target="seg.tag === 'a' ? '_blank' : undefined"
          :rel="seg.tag === 'a' ? 'noreferrer noopener' : undefined"
          :class="seg.class"
        >
          {{ seg.text }}
        </component>
      </template>
    </component>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ content: string }>();

interface InlineSeg {
  tag: 'span' | 'a' | 'strong' | 'em' | 'code';
  text: string;
  href?: string;
  class?: string;
}
interface InlineLine {
  tag: 'p' | 'br';
  segs: InlineSeg[];
}
interface Block {
  tag: 'p' | 'pre' | 'blockquote';
  kind: 'p' | 'pre' | 'quote';
  class?: string;
  text?: string;
  segs?: InlineSeg[];
  lines?: InlineLine[];
}

// Match http(s) and bare www. URLs, capturing trailing punctuation so it
// stays outside the link.
const URL_RE = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/g;

function parseInline(text: string): InlineSeg[] {
  const segs: InlineSeg[] = [];

  // Pre-tokenise the inline string by splitting around inline code spans
  // first (so we don't bold inside `code`), then bold/italic markers.
  let cursor = 0;
  const codeRe = /`([^`\n]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = codeRe.exec(text)) !== null) {
    if (m.index > cursor) {
      segs.push(...formatStyles(text.slice(cursor, m.index)));
    }
    segs.push({ tag: 'code', text: m[1], class: 'pb-code' });
    cursor = m.index + m[0].length;
  }
  if (cursor < text.length) {
    segs.push(...formatStyles(text.slice(cursor)));
  }

  // Auto-link URLs after the bold/italic pass. We rebuild the segment
  // list rather than mutating in place so URL spans don't get wrapped
  // in <strong>/<em> by accident.
  const out: InlineSeg[] = [];
  for (const s of segs) {
    if (s.tag !== 'span' || s.class === 'pb-code') {
      out.push(s);
      continue;
    }
    let last = 0;
    URL_RE.lastIndex = 0;
    let mm: RegExpExecArray | null;
    while ((mm = URL_RE.exec(s.text)) !== null) {
      if (mm.index > last) {
        out.push({ tag: 'span', text: s.text.slice(last, mm.index) });
      }
      const url = mm[0];
      const href = url.startsWith('www.') ? `https://${url}` : url;
      out.push({ tag: 'a', text: url, href, class: 'pb-link' });
      last = mm.index + url.length;
    }
    if (last < s.text.length) {
      out.push({ tag: 'span', text: s.text.slice(last) });
    }
  }
  return out;
}

function formatStyles(text: string): InlineSeg[] {
  // Split on **bold** and *italic* alternately. The pattern is greedy
  // enough for normal usage — pathological strings (`**a**b**c`) are
  // tolerable as plain text fallbacks.
  const out: InlineSeg[] = [];
  const re = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g;
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > cursor) {
      out.push({ tag: 'span', text: text.slice(cursor, m.index) });
    }
    if (m[0].startsWith('**')) {
      out.push({ tag: 'strong', text: m[0].slice(2, -2) });
    } else {
      out.push({ tag: 'em', text: m[0].slice(1, -1) });
    }
    cursor = m.index + m[0].length;
  }
  if (cursor < text.length) {
    out.push({ tag: 'span', text: text.slice(cursor) });
  }
  return out;
}

const blocks = computed<Block[]>(() => {
  const raw = props.content || '';
  const lines = raw.split(/\r?\n/);

  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing fence
      out.push({
        tag: 'pre',
        kind: 'pre',
        class: 'pb-pre',
        text: buf.join('\n'),
      });
      continue;
    }

    // Blockquote — consume a contiguous run of `>` lines
    if (/^>\s?/.test(line)) {
      const quoteLines: InlineLine[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        const stripped = lines[i].replace(/^>\s?/, '');
        const segs = parseInline(stripped);
        quoteLines.push({ tag: 'p', segs });
        i++;
      }
      out.push({
        tag: 'blockquote',
        kind: 'quote',
        class: 'pb-quote',
        lines: quoteLines,
      });
      continue;
    }

    // Paragraph — consume up to a blank line
    if (line.trim() === '') {
      i++;
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^>\s?/.test(lines[i]) && !/^```/.test(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    out.push({
      tag: 'p',
      kind: 'p',
      class: 'pb-p',
      segs: parseInline(buf.join(' ')),
    });
  }
  return out;
});
</script>

<style scoped>
.post-body-prose {
  font-family: 'Fraunces', Georgia, serif;
  font-size: 1rem;
  line-height: 1.65;
  color: rgb(var(--fg-default));
  font-variation-settings: 'opsz' 14;
  letter-spacing: -0.005em;
}
.post-body-prose :deep(.pb-p) {
  margin: 0 0 0.85rem;
}
.post-body-prose :deep(.pb-p:last-child) {
  margin-bottom: 0;
}

.post-body-prose :deep(.pb-link) {
  color: rgb(var(--fg-strong));
  text-decoration: underline;
  text-decoration-color: rgb(var(--fg-default) / 0.45);
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
  word-break: break-word;
  transition: text-decoration-color 0.12s, color 0.12s;
}
.post-body-prose :deep(.pb-link:hover) {
  text-decoration-color: rgb(var(--fg-strong));
}

.post-body-prose :deep(.pb-code) {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.86em;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: 3px;
  padding: 0.05rem 0.35rem;
  letter-spacing: 0;
}

.post-body-prose :deep(.pb-pre) {
  margin: 0 0 0.85rem;
  padding: 0.95rem 1.1rem;
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-left: 3px solid rgb(var(--fg-default) / 0.4);
  border-radius: 4px;
  overflow-x: auto;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.84rem;
  line-height: 1.55;
  letter-spacing: 0;
  color: rgb(var(--fg-default));
}
.post-body-prose :deep(.pb-pre code) {
  background: transparent;
  border: 0;
  padding: 0;
}

.post-body-prose :deep(.pb-quote) {
  margin: 0 0 0.85rem;
  padding: 0.5rem 0.75rem 0.5rem 1rem;
  border-left: 3px solid rgb(var(--fg-default) / 0.35);
  background: rgb(var(--bg-elevated) / 0.5);
  border-radius: 0 4px 4px 0;
  color: rgb(var(--fg-muted));
  font-style: italic;
}
.post-body-prose :deep(.pb-quote p) {
  margin: 0 0 0.4rem;
}
.post-body-prose :deep(.pb-quote p:last-child) {
  margin-bottom: 0;
}

.post-body-prose :deep(strong) {
  color: rgb(var(--fg-strong));
  font-weight: 700;
}
.post-body-prose :deep(em) {
  font-style: italic;
}
</style>
