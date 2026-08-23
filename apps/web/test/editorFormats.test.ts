import { describe, it, expect } from 'vitest';
import {
  bbcodeToHtml,
  detectFormat,
  htmlToMarkdown,
  markdownToHtml,
  toEditorHtml,
} from '../app/utils/editorFormats';

// The editor accepts Markdown, HTML or BBCode indifferently: that is what lets
// someone paste a listing from another tracker without rewriting it. Format
// detection is therefore a silent switch — getting it wrong raises no error,
// it just prints the delimiters literally in the middle of the text.
//
// The BBCode converter is the only part of the project that builds raw HTML
// from user input. It escapes everything up front and only re-injects what it
// emits itself; these tests pin that discipline, then check that
// `toEditorHtml` still runs the result through the sanitiser — the
// defence-in-depth that would catch a future badly written tag.

describe('detectFormat', () => {
  it('recognises BBCode by its closing tag', () => {
    // That is what distinguishes it from a Markdown `[label](url)` link.
    expect(detectFormat('[b]bold[/b]')).toBe('bbcode');
    expect(detectFormat('[center][size=13]Listing[/size][/center]')).toBe('bbcode');
  });

  it('does not mistake a markdown link for BBCode', () => {
    expect(detectFormat('See [the site](https://ok.example)')).toBe('markdown');
  });

  it('prefers markdown even when inline HTML is mixed in', () => {
    // Many trackers already accepted `<u>` on top of Markdown. A naive
    // "contains an HTML tag" probe classified that as pure HTML, and the `**`
    // ended up printed literally.
    expect(detectFormat('**bold** and <u>underlined</u>')).toBe('markdown');
    expect(detectFormat('# Title\n\n<br>line')).toBe('markdown');
  });

  it('recognises HTML when there is no markdown syntax at all', () => {
    expect(detectFormat('<p>Hello <b>you</b></p>')).toBe('html');
  });

  it('falls back to markdown for bare or empty text', () => {
    expect(detectFormat('just a sentence')).toBe('markdown');
    expect(detectFormat('   ')).toBe('markdown');
  });
});

describe('bbcodeToHtml — formatting', () => {
  it('translates simple and nested tags', () => {
    const html = bbcodeToHtml('[b][i]both[/i][/b]');
    expect(html).toContain('<strong>');
    expect(html).toContain('<em>');
  });

  it('resolves same-kind wrappers nested in one another', () => {
    // The historical defect, visible on torrents exported from a forum: an
    // outer `[size=13]` closed on the first inner `[/size]`, and the orphaned
    // `[size=10]` was printed verbatim.
    const html = bbcodeToHtml('[size=13]outside [size=10]inside[/size] back[/size]');
    expect(html).not.toContain('[size=');
    expect(html).not.toContain('[/size]');
    expect(html.match(/font-size/g)).toHaveLength(2);
  });

  it('bounds an absurd size instead of blowing up the layout', () => {
    expect(bbcodeToHtml('[size=300]huge[/size]')).toContain('font-size:48px');
    expect(bbcodeToHtml('[size=1]tiny[/size]')).toContain('font-size:0.80em');
  });

  it('converts ordered and unordered lists', () => {
    expect(bbcodeToHtml('[list][*]one[*]two[/list]')).toBe('<ul><li>one</li><li>two</li></ul>');
    expect(bbcodeToHtml('[list=1][*]one[/list]')).toBe('<ol><li>one</li></ol>');
  });

  it('carries over numeric image dimensions', () => {
    const a = bbcodeToHtml('[img width=75]https://ok.example/p.jpg[/img]');
    expect(a).toContain('width="75"');
    const b = bbcodeToHtml('[img=320x180]https://ok.example/p.jpg[/img]');
    expect(b).toContain('width="320"');
    expect(b).toContain('height="180"');
  });

  it('keeps both paragraphs under a single wrapper', () => {
    const html = bbcodeToHtml('[size=13]para 1\n\npara 2[/size]');
    expect(html.match(/font-size/g)).toHaveLength(1);
    expect(html).toContain('para 2');
  });
});

describe('bbcodeToHtml — the input is not trusted', () => {
  it('escapes HTML present in the input', () => {
    const html = bbcodeToHtml('<script>alert(1)</script>');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
  });

  it('emits a link for http(s) only', () => {
    expect(bbcodeToHtml('[url=javascript:alert(1)]click[/url]')).not.toContain('<a ');
    expect(bbcodeToHtml('[url=https://ok.example]click[/url]')).toContain(
      'href="https://ok.example"',
    );
    // The label stays visible: we drop the link, not the text.
    expect(bbcodeToHtml('[url=javascript:alert(1)]click[/url]')).toContain('click');
  });

  it('emits an image for http(s) only', () => {
    expect(bbcodeToHtml('[img]javascript:alert(1)[/img]')).toBe('');
    expect(bbcodeToHtml('[img]data:image/svg+xml,<svg onload=alert(1)>[/img]')).toBe('');
  });

  it('refuses a colour that is not one', () => {
    const html = bbcodeToHtml('[color=red;background:url(https://tracker.example)]x[/color]');
    expect(html).not.toContain('url(');
    expect(html).toContain('x');
  });

  it('hardens outbound links', () => {
    expect(bbcodeToHtml('[url=https://elsewhere.example]x[/url]')).toContain(
      'rel="noopener noreferrer"',
    );
  });
});

describe('toEditorHtml — the whole switch', () => {
  it('sanitises whichever branch is taken', () => {
    // Three formats, one guarantee: nothing executable reaches TipTap.
    expect(toEditorHtml('<script>alert(1)</script>')).not.toContain('<script');
    expect(toEditorHtml('[b]<script>alert(1)</script>[/b]')).not.toContain('<script');
    expect(toEditorHtml('# Title\n<script>alert(1)</script>')).not.toContain('<script');
  });

  it('preserves BBCode formatting through the rich profile', () => {
    // The strict profile stripped every `style` and made [center], [color] and
    // [size] vanish the moment the editor opened.
    const html = toEditorHtml('[center][color=#ff0000]Red and centred[/color][/center]');
    expect(html).toContain('text-align');
    expect(html).toContain('color');
    expect(html).toContain('Red and centred');
  });

  it('returns an empty string on absent input', () => {
    expect(toEditorHtml(null)).toBe('');
    expect(toEditorHtml(undefined)).toBe('');
    expect(toEditorHtml('')).toBe('');
  });
});

describe('markdown ↔ html round trip', () => {
  it('preserves the ordinary structure', () => {
    const md = '# Title\n\nSome **bold**, some *italic* and a [link](https://ok.example).';
    const back = htmlToMarkdown(markdownToHtml(md));
    expect(back).toContain('# Title');
    expect(back).toContain('**bold**');
    expect(back).toContain('[link](https://ok.example)');
  });

  it('preserves lists and code blocks', () => {
    const md = '- one\n- two\n\n```\ncode\n```';
    const back = htmlToMarkdown(markdownToHtml(md));
    expect(back).toMatch(/^-\s+one$/m);
    expect(back).toContain('```');
  });

  it('preserves underline, which markdown cannot write', () => {
    // Without the dedicated turndown rule, `<u>` disappeared on save.
    expect(htmlToMarkdown('<p><u>underlined</u></p>')).toContain('<u>underlined</u>');
  });

  it('preserves centring', () => {
    const md = htmlToMarkdown('<p style="text-align:center">centred</p>');
    expect(md).toContain('text-align:center');
  });

  it('is stable on a second pass', () => {
    // This is what really matters: opening then re-saving a listing without
    // touching it must not make it drift a little further every time.
    const md = '# Title\n\nSome **bold** and a list:\n\n- one\n- two';
    const first = htmlToMarkdown(markdownToHtml(md));
    const second = htmlToMarkdown(markdownToHtml(first));
    expect(second).toBe(first);
  });
});

describe('bbcodeToHtml — the unmatched-opener guard', () => {
  // Each pass is skipped when its closing tag is absent. The guard is only
  // sound if it cannot change the output, so that is what these assert — the
  // speed is the reason it exists, not the property being protected.
  it('leaves unmatched openers as literal text, exactly as before', () => {
    for (const open of ['[b]', '[i]', '[u]', '[s]', '[code]', '[h2]', '[center]',
                        '[url=https://x.test]', '[img]', '[quote]', '[list]',
                        '[color=red]', '[size=13]', '[font=Verdana]']) {
      const html = bbcodeToHtml(`${open}hello`);
      // The opener never becomes a tag, and the text survives.
      expect(html).toContain('hello');
      expect(html).not.toMatch(/<(strong|em|u|s|pre|h2|div|a |img|blockquote|ul|span)/);
    }
  });

  it('still converts a tag that IS closed, including nested and mixed input', () => {
    expect(bbcodeToHtml('[b]bold[/b]')).toBe('<strong>bold</strong>');
    // A stray opener next to a closed pair must not disable the pair.
    expect(bbcodeToHtml('[i][b]bold[/b]')).toContain('<strong>bold</strong>');
    expect(bbcodeToHtml('[i][b]bold[/b]')).toContain('[i]');
    expect(bbcodeToHtml('[h3]t[/h3]')).toBe('<h3>t</h3>');
  });

  it('does not choke on thousands of unmatched openers', () => {
    /* The behaviour this guards. Lazy quantifiers made the engine retry from
       every opener and expand to the end of input each time — k×n — so a paste
       like this froze the tab. The threshold is loose on purpose: it has to
       fail on quadratic and pass on linear, not measure a machine. */
    const pathological = '[b][i][u][color=red][size=13]'.repeat(4_000);
    const started = Date.now();
    const html = bbcodeToHtml(pathological);
    const elapsed = Date.now() - started;
    expect(html.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(1_000);
  });
});
