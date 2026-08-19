import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderMarkdown, sanitizeHtml, sanitizeRichHtml } from '../app/utils/markdown';
import { safeHttpUrl } from '../app/utils/safeUrl';
import { safeInAppPath } from '../app/utils/safePath';

// The application's XSS boundary.
//
// Everything that ends up in a `v-html` passes through here: torrent
// descriptions, forum posts, admin branding, listings imported from another
// tracker. On a private tracker those texts are written by members and read by
// everyone else, staff included with an admin session open — one `<script>`
// getting through is the admin account falling.
//
// The DOMPurify profile is deliberately stricter than the default one, which
// lets `<style>`, `<form>` and arbitrary URL schemes through. Two profiles
// coexist, and that is where the real risk sits: the "rich" profile reopens
// the `style` attribute so BBCode formatting survives. It must reopen it ONLY
// for a whitelist of properties, and above all must never contaminate the
// strict profile — the two share a DOMPurify instance and a scope flag.

describe('renderMarkdown', () => {
  it('renders ordinary markdown', () => {
    const html = renderMarkdown('# Title\n\nSome **bold** and a [link](https://ok.example).');
    expect(html).toContain('<h1');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('href="https://ok.example"');
  });

  it('strips a script injected as raw HTML', () => {
    const html = renderMarkdown('Hello <script>alert(1)</script> everyone');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
  });

  it('neutralises event handlers', () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">');
    expect(html).not.toContain('onerror');
  });

  it('refuses executable URL schemes on a markdown link', () => {
    // `[click](javascript:…)` is the most common shape: it sails through
    // marked untouched and is only stopped by ALLOWED_URI_REGEXP.
    for (const bad of [
      '[click](javascript:alert(1))',
      '[click](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
      '[click](vbscript:msgbox)',
    ]) {
      const html = renderMarkdown(bad);
      expect(html).not.toMatch(/javascript:|data:text\/html|vbscript:/i);
    }
  });

  it('lets http, https, mailto and anchors through', () => {
    expect(renderMarkdown('[a](https://ok.example)')).toContain('https://ok.example');
    expect(renderMarkdown('[a](http://ok.example)')).toContain('http://ok.example');
    expect(renderMarkdown('[a](mailto:x@ok.example)')).toContain('mailto:');
    expect(renderMarkdown('[a](#section)')).toContain('#section');
  });

  it('hardens outbound links against tabnabbing', () => {
    const html = renderMarkdown('[a](https://elsewhere.example)');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });

  it('leaves in-page anchors without an external target', () => {
    expect(renderMarkdown('[a](#bottom)')).not.toContain('target="_blank"');
  });

  it('removes the dangerous structural tags', () => {
    const html = sanitizeHtml(
      '<style>body{display:none}</style><form action="/x"><input name="p"></form>' +
        '<iframe src="https://evil.example"></iframe><base href="https://evil.example">',
    );
    for (const tag of ['<style', '<form', '<input', '<iframe', '<base']) {
      expect(html).not.toContain(tag);
    }
  });

  it('returns an empty string rather than "null"', () => {
    expect(renderMarkdown(null)).toBe('');
    expect(renderMarkdown(undefined)).toBe('');
    expect(sanitizeHtml('')).toBe('');
  });
});

describe('sanitizeRichHtml — the style attribute reopened, but fenced in', () => {
  it('keeps the purely presentational properties', () => {
    // These are exactly the ones BBCode emits: [center], [color], [size].
    const html = sanitizeRichHtml(
      '<p style="text-align:center;color:#ff0000;font-size:1.2em">Hello</p>',
    );
    expect(html).toContain('text-align: center');
    expect(html).toContain('color: #ff0000');
    expect(html).toContain('font-size: 1.2em');
  });

  it('drops properties outside the whitelist', () => {
    const html = sanitizeRichHtml(
      '<p style="position:fixed;top:0;left:0;z-index:9999;opacity:0;color:red">x</p>',
    );
    // A block positioned as an overlay is clickjacking, not formatting.
    expect(html).not.toContain('position');
    expect(html).not.toContain('z-index');
    expect(html).toContain('color: red');
  });

  it('drops values able to fetch a resource or break out', () => {
    for (const bad of [
      'background-color: url(https://tracker.example/x.png)',
      'color: expression(alert(1))',
      'font-family: javascript:alert(1)',
      'color: red} body { display:none',
      'font-size: 12px; /* @import "evil" */',
    ]) {
      const html = sanitizeRichHtml(`<p style="${bad}">x</p>`);
      expect(html).not.toMatch(/url\(|expression\(|javascript:|@import|[{}]/);
    }
  });

  it('drops an absurdly long style wholesale', () => {
    const html = sanitizeRichHtml(`<p style="${'color:red;'.repeat(100)}">x</p>`);
    expect(html).not.toContain('style');
  });

  it('stays as severe as the strict profile on everything else', () => {
    const html = sanitizeRichHtml(
      '<script>alert(1)</script><a href="javascript:alert(1)">x</a><iframe></iframe>',
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<iframe');
  });

  it('has not loosened the strict profile on its way past', () => {
    // Both profiles share a DOMPurify instance and a scope flag. If the rich
    // profile's hook leaked, style would survive here — and the whole admin
    // branding surface would become injectable.
    sanitizeRichHtml('<p style="color:red">rich</p>');
    expect(sanitizeHtml('<p style="color:red">strict</p>')).not.toContain('style');
    expect(renderMarkdown('<p style="color:red">strict</p>')).not.toContain('style');
  });
});

describe('safeHttpUrl', () => {
  it('accepts only an absolute http(s) URL', () => {
    expect(safeHttpUrl('https://ok.example/x')).toBe('https://ok.example/x');
    expect(safeHttpUrl('  http://ok.example/  ')).toBe('http://ok.example/');
  });

  it('refuses everything else', () => {
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      '//evil.example/x',
      '/relative/path',
      'ftp://ok.example',
      'https://',
      42,
      null,
      undefined,
    ]) {
      expect(safeHttpUrl(bad)).toBeNull();
    }
  });
});

describe('safeInAppPath', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('accepts an absolute in-app path', () => {
    expect(safeInAppPath('/torrents/42')).toBe('/torrents/42');
  });

  it('refuses anything that could leave the site', () => {
    // The link comes from a server-written notification row and is handed to
    // `router.push`. A protocol-relative URL is enough to take the member
    // elsewhere — an ideal vehicle for a phishing page.
    for (const bad of ['//evil.example/x', 'https://evil.example', 'evil', '', null, undefined]) {
      expect(safeInAppPath(bad)).toBe('/');
    }
  });

  it('checks the real origin when a browser is present', () => {
    vi.stubGlobal('window', { location: { origin: 'https://tracker.example' } });
    expect(safeInAppPath('/torrents?page=2#top')).toBe('/torrents?page=2#top');
    // `/\evil.example`: some browsers treat the backslash as a slash and end
    // up off-origin.
    expect(safeInAppPath('/\\evil.example')).toBe('/');
  });
});
