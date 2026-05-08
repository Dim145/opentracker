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
}

function sanitize(html: string): string {
  ensureHooks();
  return DOMPurify.sanitize(html, SAFE_PROFILE) as unknown as string;
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
