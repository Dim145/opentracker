import { marked } from 'marked';
import DOMPurify from 'isomorphic-dompurify';

/**
 * Render an untrusted markdown string as HTML, then strip any tags or
 * attributes that aren't safe to inject with v-html. Always go through
 * this helper before passing to v-html — `marked.parse()` alone is not safe.
 */
export function renderMarkdown(input: string | null | undefined): string {
  if (!input) return '';
  const rendered = marked.parse(input, { async: false }) as string;
  return DOMPurify.sanitize(rendered);
}

/**
 * Sanitize an HTML string we got from the server (e.g. branding values
 * authored in the WYSIWYG editor) before binding it with v-html. Same
 * isomorphic helper so SSR and CSR produce identical output.
 */
export function sanitizeHtml(input: string | null | undefined): string {
  if (!input) return '';
  return DOMPurify.sanitize(input);
}
