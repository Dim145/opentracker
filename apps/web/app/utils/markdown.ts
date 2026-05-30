import { marked } from 'marked';
import DOMPurify from 'isomorphic-dompurify';

/**
 * Strict DOMPurify config used for every untrusted v-html injection.
 * The default profile leaves `<style>`, `<form>`, `style="…"` and
 * arbitrary URL schemes on links (`javascript:`, `data:` blob, etc.),
 * which is fine for the typical "rich text email" use case but a
 * full-XSS surface for a multi-tenant tracker where torrent
 * descriptions, branding and forum posts all flow back into
 * unauthenticated pages.
 *
 * The profile below:
 *   - Allows only `http(s)`, `mailto:`, and inline anchors
 *     (`#fragment`) for any href / src attribute.
 *   - Strips `<style>` / `<form>` / `<input>` / `<iframe>` / `<base>`
 *     / `<meta>` and `style="…"` attributes outright.
 *   - Adds `rel="noopener noreferrer"` and `target="_blank"` to every
 *     anchor pointing off-origin so authored links can't tabnab the
 *     opener and don't leak referrers.
 */
const SAFE_PROFILE: DOMPurify.Config = {
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|#)/i,
  FORBID_TAGS: ['style', 'iframe', 'form', 'input', 'base', 'meta', 'object'],
  FORBID_ATTR: ['style', 'srcdoc', 'autofocus'],
};

/**
 * "Rich" profile for rendered user descriptions (BBCode / WYSIWYG).
 *
 * Identical to SAFE_PROFILE except it permits the `style` ATTRIBUTE
 * (never the `<style>` tag) — but ONLY a hard-coded whitelist of
 * presentational properties survives, via the `uponSanitizeAttribute`
 * hook below. This restores BBCode formatting that emits inline
 * styles ([center]/[left]/[right] → text-align, [color] → color,
 * [size] → font-size) which the strict profile stripped, WITHOUT
 * re-opening the `style` attribute to arbitrary CSS (no url(),
 * expression(), positioning, etc.). The hook is gated on `richActive`
 * so it never loosens the strict path used for branding/forum/markdown.
 */
const RICH_PROFILE: DOMPurify.Config = {
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|#)/i,
  FORBID_TAGS: ['style', 'iframe', 'form', 'input', 'base', 'meta', 'object'],
  FORBID_ATTR: ['srcdoc', 'autofocus'],
};

// CSS properties safe to keep on a `style=""` — purely presentational,
// none can execute script or fetch a resource in a modern browser.
// Positioning / z-index / url-bearing props are deliberately absent.
const SAFE_STYLE_PROPS = new Set([
  'text-align',
  'color',
  'background-color',
  'font-size',
  'font-weight',
  'font-style',
  'font-family',
  'text-decoration',
]);

/**
 * Keep only whitelisted, value-safe declarations from a style string.
 * Returns '' when nothing safe remains (caller then drops the attr).
 */
function sanitizeStyleValue(style: string): string {
  if (style.length > 600) return ''; // absurd → drop wholesale
  const out: string[] = [];
  for (const decl of style.split(';')) {
    const idx = decl.indexOf(':');
    if (idx < 0) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const value = decl.slice(idx + 1).trim();
    if (!SAFE_STYLE_PROPS.has(prop)) continue;
    // Reject any value that could carry a fetch / script / escape /
    // nested block — the BBCode emitter never produces these.
    if (/url\(|expression\(|javascript:|@import|[<>{}\\]|\/\*/i.test(value)) {
      continue;
    }
    if (!value) continue;
    out.push(`${prop}: ${value}`);
  }
  return out.join('; ');
}

// True only for the duration of a `sanitizeRichHtml` call, so the
// style-whitelisting hook below never affects the strict `sanitize`
// path (DOMPurify.sanitize is synchronous, so this flag can't
// interleave across calls).
let richActive = false;

// Add the rel/target hardening once, globally — DOMPurify keeps the
// hook list across calls and dedupes by reference.
let hooksInstalled = false;
function ensureHooks() {
  if (hooksInstalled) return;
  hooksInstalled = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node: Element) => {
    if (node.tagName === 'A' && node.hasAttribute('href')) {
      const href = node.getAttribute('href') ?? '';
      const isExternal = /^https?:\/\//i.test(href);
      if (isExternal) {
        node.setAttribute('rel', 'noopener noreferrer');
        node.setAttribute('target', '_blank');
      }
    }
  });
  // Constrain `style=""` to the SAFE_STYLE_PROPS whitelist — only
  // active under sanitizeRichHtml (RICH_PROFILE allows the attr); the
  // strict profile forbids `style` outright so this is a no-op there.
  DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
    if (!richActive || data.attrName !== 'style') return;
    const cleaned = sanitizeStyleValue(data.attrValue || '');
    if (!cleaned) {
      data.keepAttr = false;
      return;
    }
    data.attrValue = cleaned;
  });
}

function sanitize(html: string): string {
  ensureHooks();
  return DOMPurify.sanitize(html, SAFE_PROFILE) as unknown as string;
}

/**
 * Sanitize rendered rich user content (BBCode / WYSIWYG descriptions)
 * with the same hardening as `sanitizeHtml` PLUS a whitelisted subset
 * of inline `style` (text-align / color / font-size / …) preserved,
 * so presentational BBCode like [center] / [color] / [size] survives.
 */
export function sanitizeRichHtml(input: string | null | undefined): string {
  if (!input) return '';
  ensureHooks();
  richActive = true;
  try {
    return DOMPurify.sanitize(input, RICH_PROFILE) as unknown as string;
  } finally {
    richActive = false;
  }
}

/**
 * Render an untrusted markdown string as HTML, then strip any tags or
 * attributes that aren't safe to inject with v-html.
 */
export function renderMarkdown(input: string | null | undefined): string {
  if (!input) return '';
  const rendered = marked.parse(input, {
    async: false,
    // Disable raw-HTML passthrough quirks that would slip past the
    // DOMPurify pass we run next.
    breaks: true,
    gfm: true,
  }) as string;
  return sanitize(rendered);
}

/**
 * Sanitize a server-authored HTML string (e.g. branding values from
 * the admin WYSIWYG) before binding it with v-html. Same strict
 * profile + same anchor hardening as `renderMarkdown`.
 */
export function sanitizeHtml(input: string | null | undefined): string {
  if (!input) return '';
  return sanitize(input);
}
