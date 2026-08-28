import { describe, expect, it } from 'vitest';
import {
  cssRefusals,
  formatCss,
  tokenizeCss,
} from '../app/utils/cssHighlight';

// The CSS scanner behind the editor's colouring.
//
// One invariant carries most of the weight and is checked against everything
// else here: the tokens must concatenate back to the input, exactly. The editor
// draws them in a `<pre>` sitting underneath a real `<textarea>`, aligned
// character for character — so a scanner that swallowed a space, or normalised
// a tab, would slide the colours out from under the text with no error anywhere.
//
// Nothing in this file is a security test. What the server accepts is decided in
// `apps/api/utils/themeCss.ts` by a real parser; the `refused` marks are a
// courtesy so an owner learns before pressing save.

const SAMPLES = [
  '',
  '  ',
  '\n\n',
  '.a { color: red }',
  '.a{color:red;background:blue}',
  '/* just a comment */',
  '/* unterminated',
  '.a { content: "}" }',
  ".a { content: '\\'' }",
  '@media (min-width: 10px) { .a { color: red } }',
  '@keyframes spin { from { rotate: 0deg } to { rotate: 1turn } }',
  '.a { background: linear-gradient(to right, rgb(1 2 3 / .5), blue) }',
  '.a:not(.b)::before { width: calc(100% - 2rem) }',
  '.a { margin: -1.5em 0 .25rem 10px }',
  '@import "evil";',
  '.a { background-image: url(https://evil/x) }',
  '.a { position: fixed }',
  '.a { background: image-set("https://evil/x" 1x) }',
  'unbalanced { color: red',
  '} stray',
  '.a { --custom: whatever it likes }',
];

describe('the CSS scanner', () => {
  it.each(SAMPLES)('puts %j back together exactly', (src) => {
    expect(tokenizeCss(src).map((t) => t.text).join('')).toBe(src);
  });

  it('never emits an empty token, which would be a wasted span per character', () => {
    for (const src of SAMPLES) {
      expect(tokenizeCss(src).every((t) => t.text.length > 0)).toBe(true);
    }
  });

  const typesIn = (src: string) => {
    const byType = new Map<string, string[]>();
    for (const t of tokenizeCss(src)) {
      byType.set(t.type, [...(byType.get(t.type) ?? []), t.text.trim()]);
    }
    return byType;
  };

  it('tells a selector from a property', () => {
    const m = typesIn('.a { color: red }');
    expect(m.get('selector')).toEqual(['.a']);
    expect(m.get('property')).toEqual(['color']);
    expect(m.get('value')).toEqual(['red']);
  });

  it('knows a nested block holds selectors, not properties', () => {
    // The case a depth counter gets wrong: inside `@media` the next `{` opens
    // declarations, but the thing before it is a selector.
    const m = typesIn('@media screen { .a { color: red } }');
    expect(m.get('selector')).toContain('.a');
    expect(m.get('property')).toEqual(['color']);
  });

  it('treats a keyframe step as a selector', () => {
    // `from` and `50%` look exactly like a property waiting for its colon.
    const m = typesIn('@keyframes k { from { opacity: 0 } }');
    expect(m.get('selector')).toContain('from');
    expect(m.get('property')).toEqual(['opacity']);
  });

  it('does not read a colon inside a selector as a declaration', () => {
    const m = typesIn('.a:hover { color: red }');
    expect(m.get('property')).toEqual(['color']);
  });

  it('keeps a brace inside a string out of the structure', () => {
    // `content: "}"` closing the rule early would mis-colour everything after it.
    const m = typesIn('.a { content: "}" } .b { color: red }');
    expect(m.get('selector')).toContain('.b');
  });

  it('finds functions and numbers in a value', () => {
    const m = typesIn('.a { width: calc(100% - 2rem) }');
    expect(m.get('function')).toEqual(['calc']);
    expect(m.get('number')).toEqual(['100%', '2rem']);
  });
});

describe('what the scanner warns about', () => {
  const reasons = (src: string) => cssRefusals(src).map((r) => r.text);

  it('marks url()', () => {
    expect(reasons('.a { background: url(https://evil/x) }')).toEqual(['url']);
    expect(cssRefusals('.a { background: url(x) }')[0]!.reason).toMatch(/another server/);
  });

  it('marks a function that is not on the list', () => {
    expect(reasons('.a { background: image-set("x" 1x) }')).toEqual(['image-set']);
  });

  it('marks an at-rule that is not on the list', () => {
    expect(reasons('@import "x";')).toEqual(['@import']);
  });

  it('marks a refused property, on the property and not on its value', () => {
    expect(reasons('.a { position: fixed }')).toEqual(['position']);
  });

  it('says nothing about CSS the server accepts', () => {
    expect(
      reasons(`
        @media (min-width: calc(10px + 1em)) {
          .a:not(.b) { color: color-mix(in oklab, rgb(1 2 3), blue); border-radius: 4px }
        }
        @keyframes k { from { opacity: 0 } to { opacity: 1 } }
      `),
    ).toEqual([]);
  });

  it('is case-insensitive, because CSS is', () => {
    expect(reasons('.a { background: URL(x) }')).toEqual(['URL']);
    expect(reasons('.a { POSITION: fixed }')).toEqual(['POSITION']);
  });
});

describe('re-indenting', () => {
  it('puts one statement on each line', () => {
    expect(formatCss('.a{color:red;background:blue}')).toBe(
      '.a {\n  color: red;\n  background: blue;\n}',
    );
  });

  it('indents a nested block', () => {
    expect(formatCss('@media screen{.a{color:red}}')).toBe(
      '@media screen {\n  .a {\n    color: red;\n  }\n}',
    );
  });

  it('leaves a comment on its own line and does not reflow it', () => {
    expect(formatCss('/* a  b */ .a{color:red}')).toBe(
      '/* a  b */\n.a {\n  color: red;\n}',
    );
  });

  it('is idempotent, so pressing the button twice changes nothing', () => {
    const once = formatCss('@media screen{.a{color:red;width:calc(1px + 2px)}}');
    expect(formatCss(once)).toBe(once);
  });

  it('does not lose a declaration that had no trailing semicolon', () => {
    expect(formatCss('.a { color: red }')).toContain('color: red');
  });
});
