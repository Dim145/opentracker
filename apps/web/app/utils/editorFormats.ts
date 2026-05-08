/**
 * Format helpers for the WYSIWYG editor (issue #45).
 *
 * The torrent description column has always been Markdown — we keep it
 * that way (no migration, `renderMarkdown()` keeps working for display)
 * but the *editor* now accepts BBCode, HTML and Markdown indifferently.
 * Whatever the user pastes, we convert it to HTML so TipTap can ingest
 * it; on save we round-trip back to Markdown.
 *
 * Round-tripping through marked + turndown isn't lossless (font sizes,
 * arbitrary colours, alignment don't round-trip cleanly into commonmark),
 * but the same caveat exists in any tracker that stores rich text as
 * Markdown — it's the same trade-off OXYDER chose in the issue thread.
 *
 * Detection is lazy: we look at the first non-whitespace fragment of the
 * input. If it starts with `[…]` and contains a closing `[/…]`, we
 * assume BBCode. If it has the typical "<…>" tag pattern, we assume HTML.
 * Otherwise we treat it as Markdown — which is also what the legacy
 * column already holds.
 */
import { marked } from 'marked';
import TurndownService from 'turndown';
import { sanitizeHtml } from '~/utils/markdown';

// Turndown is configured to mirror common Markdown writing conventions
// (fenced code blocks, ATX headings) so a save → reload round-trip
// looks like what the user typed.
let _td: TurndownService | null = null;
function turndown(): TurndownService {
  if (_td) return _td;
  const td = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    fence: '```',
    emDelimiter: '*',
  });
  // Underline: Markdown has no native syntax. Keep it as <u>…</u> so the
  // round-trip is at least visible; renderMarkdown() also accepts the
  // tag because we sanitise via DOMPurify with default rules.
  td.addRule('underline', {
    filter: ['u'],
    replacement: (content) => `<u>${content}</u>`,
  });
  // Centered text — same problem; preserve as a wrapper div.
  td.addRule('center', {
    filter: (node) =>
      node.nodeName === 'P' &&
      (node as HTMLElement).style.textAlign === 'center',
    replacement: (content) =>
      `\n\n<p style="text-align:center">${content}</p>\n\n`,
  });
  _td = td;
  return td;
}

export function htmlToMarkdown(html: string): string {
  if (!html) return '';
  return turndown().turndown(html).trim();
}

export function markdownToHtml(md: string): string {
  if (!md) return '';
  const out = marked.parse(md, { async: false }) as string;
  return sanitizeHtml(out);
}

// ─── BBCode → HTML ──────────────────────────────────────────────────────────

const SIMPLE_TAGS: Array<[RegExp, string]> = [
  [/\[b\](.*?)\[\/b\]/gis, '<strong>$1</strong>'],
  [/\[i\](.*?)\[\/i\]/gis, '<em>$1</em>'],
  [/\[u\](.*?)\[\/u\]/gis, '<u>$1</u>'],
  [/\[s\](.*?)\[\/s\]/gis, '<s>$1</s>'],
  [/\[code\](.*?)\[\/code\]/gis, '<pre><code>$1</code></pre>'],
  [/\[h([1-6])\](.*?)\[\/h\1\]/gis, '<h$1>$2</h$1>'],
  [/\[center\](.*?)\[\/center\]/gis, '<p style="text-align:center">$1</p>'],
  [/\[right\](.*?)\[\/right\]/gis, '<p style="text-align:right">$1</p>'],
  [/\[left\](.*?)\[\/left\]/gis, '<p style="text-align:left">$1</p>'],
];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/`/g, '&#96;');
}

/**
 * Whitelist for `[color=…]`. Allow:
 *   - named colours (`red`, `cornflowerblue`) — restricted to A-Za-z
 *   - hex `#rgb` / `#rrggbb`
 *   - rgb()/rgba()/hsl()/hsla() with safe digits-only contents
 *
 * Anything else is dropped to avoid CSS injection (e.g. `url(javascript:…)`).
 */
function safeColor(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (/^[a-z]{3,32}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return v;
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^rgba?\(\s*\d+(?:\s*,\s*\d+){2,3}(?:\s*,\s*0?\.\d+|\s*,\s*1)?\s*\)$/.test(v))
    return v;
  return null;
}

/**
 * Best-effort BBCode → HTML converter. Not a full parser — applies tag
 * replacements iteratively so [b][i]nested[/i][/b] resolves correctly.
 * Inputs ARE NOT trusted; everything is escaped first, and only the
 * fragments we explicitly emit get raw HTML.
 */
export function bbcodeToHtml(input: string): string {
  let s = escapeHtml(input);

  // [url=https://…]label[/url] and [url]https://…[/url]
  s = s.replace(
    /\[url=([^\]\s]+)\](.*?)\[\/url\]/gis,
    (_m, href: string, label: string) => {
      // Unescape the URL we previously escaped, then re-escape as an attr.
      const decoded = href.replace(/&amp;/g, '&').replace(/&quot;/g, '"');
      if (!/^https?:\/\//i.test(decoded)) return label; // drop unsafe schemes
      return `<a href="${escapeAttr(decoded)}" rel="noopener noreferrer" target="_blank">${label}</a>`;
    }
  );
  s = s.replace(/\[url\](.*?)\[\/url\]/gis, (_m, href: string) => {
    const decoded = href.replace(/&amp;/g, '&').replace(/&quot;/g, '"');
    if (!/^https?:\/\//i.test(decoded)) return decoded;
    return `<a href="${escapeAttr(decoded)}" rel="noopener noreferrer" target="_blank">${escapeHtml(decoded)}</a>`;
  });

  // [img]url[/img]
  s = s.replace(/\[img\](.*?)\[\/img\]/gis, (_m, src: string) => {
    const decoded = src.replace(/&amp;/g, '&').replace(/&quot;/g, '"');
    if (!/^https?:\/\//i.test(decoded)) return '';
    return `<img src="${escapeAttr(decoded)}" alt="" />`;
  });

  // [color=red] / [color=#ff0000]
  s = s.replace(
    /\[color=([^\]]+)\](.*?)\[\/color\]/gis,
    (_m, raw: string, content: string) => {
      const c = safeColor(raw.replace(/&amp;/g, '&').replace(/&quot;/g, '"'));
      return c ? `<span style="color:${c}">${content}</span>` : content;
    }
  );

  // [size=N] (1..7 are common BBCode sizes; clamp & map to em)
  s = s.replace(
    /\[size=(\d{1,2})\](.*?)\[\/size\]/gis,
    (_m, raw: string, content: string) => {
      const n = Math.max(1, Math.min(7, parseInt(raw, 10) || 3));
      const em = (0.7 + n * 0.1).toFixed(2); // 1→0.8, 7→1.4
      return `<span style="font-size:${em}em">${content}</span>`;
    }
  );

  // [quote] and [quote=author]
  s = s.replace(
    /\[quote(?:=[^\]]+)?\](.*?)\[\/quote\]/gis,
    '<blockquote>$1</blockquote>'
  );

  // Lists: [list] [*]item [*]item [/list], optionally [list=1] for ordered.
  s = s.replace(
    /\[list(=1)?\]([\s\S]*?)\[\/list\]/gi,
    (_m, ordered, body: string) => {
      const items = body
        .split(/\[\*\]/g)
        .map((it: string) => it.trim())
        .filter(Boolean);
      const tag = ordered ? 'ol' : 'ul';
      return `<${tag}>${items.map((it: string) => `<li>${it}</li>`).join('')}</${tag}>`;
    }
  );

  for (const [re, html] of SIMPLE_TAGS) s = s.replace(re, html);

  // Treat lone newlines as line breaks so a pasted BBCode paragraph
  // doesn't collapse into a single line. Block-level tags above already
  // create their own breaks, so we only convert newlines that aren't
  // adjacent to a tag boundary.
  s = s
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');

  return s;
}

// ─── Smart paste / load detection ──────────────────────────────────────────

export type EditorFormat = 'markdown' | 'html' | 'bbcode';

export function detectFormat(input: string): EditorFormat {
  const trimmed = input.trim();
  if (!trimmed) return 'markdown';

  // BBCode wins if we see at least one `[tag]…[/tag]` pair; the closing
  // form is what distinguishes it from a Markdown link `[label](url)`.
  if (/\[[a-z]+(?:=[^\]]+)?\][\s\S]*?\[\/[a-z]+\]/i.test(trimmed)) {
    return 'bbcode';
  }

  // Markdown-first heuristic: any commonmark-flavour syntax wins, even
  // when the input also contains inline HTML (`<u>`, `<br>`, `<sub>` —
  // all common in trackers that already supported some HTML on top of
  // Markdown). Marked happily parses MD with inline HTML, but a naive
  // "has-an-HTML-tag" probe would misclassify it as pure HTML and the
  // markdown delimiters end up rendered literally.
  const mdPatterns: RegExp[] = [
    /^#{1,6}\s+/m, // ATX heading
    /(^|\s)\*\*[^\s*][\s\S]*?\*\*/, // **bold**
    /(^|\s)__[^\s_][\s\S]*?__/, // __bold__
    /(^|\s)\*[^\s*][\s\S]*?\*(\s|$)/, // *italic*
    /(^|\s)_[^\s_][\s\S]*?_(\s|$)/, // _italic_
    /^\s*[-*+]\s+/m, // bullet list
    /^\s*\d+\.\s+/m, // ordered list
    /\[[^\]]+\]\([^)]+\)/, // [label](url)
    /^>\s+/m, // blockquote
    /```[\s\S]*?```/, // fenced code
    /^---+$/m, // horizontal rule
  ];
  if (mdPatterns.some((re) => re.test(trimmed))) return 'markdown';

  // HTML: at least one opening AND closing tag, no markdown syntax.
  if (/<[a-z][a-z0-9]*\b[^>]*>/i.test(trimmed) && /<\/[a-z]/i.test(trimmed)) {
    return 'html';
  }

  return 'markdown';
}

/**
 * Convert any-format input into HTML that TipTap can ingest. Used both
 * when the editor first loads stored content and when the user pastes.
 */
export function toEditorHtml(input: string | null | undefined): string {
  if (!input) return '';
  switch (detectFormat(input)) {
    case 'bbcode':
      return bbcodeToHtml(input);
    case 'html':
      // Sanitise just in case it came from clipboard.
      return sanitizeHtml(input);
    case 'markdown':
    default:
      return markdownToHtml(input);
  }
}
