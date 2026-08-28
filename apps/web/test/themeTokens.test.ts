import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BUILT_IN_TOKENS,
  CONTRAST_PAIRS,
  THEME_TOKENS,
  THEME_TOKEN_KEYS,
  contrastRatio,
  contrastWarnings,
  isValidTokenValue,
  parseRgb,
  resolveTokens,
  validateTokens,
} from '@trackarr/shared/theme';

// The theme token schema, and the one duplication it cannot avoid.
//
// `light` and `dark` are code constants in `main.css` — nothing in the admin
// console can edit them, so an instance always has a working appearance to fall
// back to. But the CSS emitter and the admin editor both need to know what a
// theme inherits, so the values are copied into `packages/shared/src/theme.ts`.
//
// A copy that can drift is a copy that will. The first block below parses the
// stylesheet and asserts the copy still matches it, which keeps `main.css` the
// single source of truth rather than merely calling it that in a comment.

const CSS_RAW = readFileSync(
  fileURLToPath(new URL('../app/assets/css/main.css', import.meta.url)),
  'utf8',
);

/**
 * Comments stripped before anything is scanned.
 *
 * Not tidiness. `main.css` documents its own tokens, and a comment explaining
 * what `--motion-scale: 0` does is indistinguishable from a declaration to a
 * regex — the naive version of this parser read the comment first and reported
 * the schema as drifted. Any prose mentioning a token in `name: value` form
 * would have done it.
 */
const CSS = CSS_RAW.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every `--token: value;` inside one `:root…{ }` block. */
function tokensIn(selector: string): Record<string, string> {
  const at = CSS.indexOf(selector);
  expect(at, `selector not found: ${selector}`).toBeGreaterThan(-1);
  const open = CSS.indexOf('{', at);
  const close = CSS.indexOf('\n}', open);
  const body = CSS.slice(open + 1, close);
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    out[m[1]!] = m[2]!.trim();
  }
  return out;
}

describe('the schema and the stylesheet agree', () => {
  const dark = tokensIn(":root[data-theme='dark']");
  const light = tokensIn(":root[data-theme='light']");

  it('every declared token exists in the dark block', () => {
    // Dark is the block that carries the full set (light overrides only what
    // differs), so a token absent here is a token no theme can ever inherit.
    for (const key of THEME_TOKEN_KEYS) {
      expect(dark[key], `--${key} missing from main.css`).toBeDefined();
    }
  });

  it('every value in the schema matches the stylesheet', () => {
    for (const [key, value] of Object.entries(BUILT_IN_TOKENS.dark)) {
      expect(dark[key], `--${key} (dark)`).toBe(value);
    }
    for (const [key, value] of Object.entries(BUILT_IN_TOKENS.light)) {
      // Light inherits from the `:root` block for anything it does not restate,
      // so only compare what it actually declares.
      if (light[key] !== undefined) {
        expect(light[key], `--${key} (light)`).toBe(value);
      }
    }
  });

  it('light restates every token whose value differs from dark', () => {
    // The failure this catches is subtle: a token declared only in the dark
    // block is inherited by light through `:root`, which is right for something
    // theme-invariant (`--header-h`) and wrong for a colour. If a colour's two
    // values differ in the schema, the stylesheet has to say so too.
    for (const key of THEME_TOKEN_KEYS) {
      const d = BUILT_IN_TOKENS.dark[key];
      const l = BUILT_IN_TOKENS.light[key];
      if (d !== l) {
        expect(light[key], `--${key} differs but light does not restate it`)
          .toBeDefined();
      }
    }
  });

  it('declares no token the schema does not know', () => {
    // The reverse direction, and the reason it matters: a colour added to
    // main.css and not to the schema is a colour no theme can change, which is
    // exactly how the site ended up with 1 400 hardcoded literals.
    const known = new Set(THEME_TOKEN_KEYS);
    // Structural tokens are deliberately outside the theme system — they
    // generate no at-rules but they are layout, not appearance.
    const structural = new Set([
      'header-h',
      'header-total',
      'container-pad',
      'container-max',
      // The derived radius steps and durations. Structural on purpose: they are
      // `calc()` expressions over `--radius` / `--motion-scale`, which ARE
      // tokens — exposing the derived values too would let a theme break the
      // proportions the scale exists to keep.
      'radius-xs',
      'radius-sm',
      'radius-md',
      'radius-lg',
      'radius-xl',
      'dur-1',
      'dur-2',
      'dur-3',
      'dur-4',
      'dur-slow',
      'shadow-overlay',
      'shadow-popover',
      // The three font roles. Structural in wave 1 — a face swap changes line
      // breaks, so wave 3 is what exposes them, with the curated list.
      'font-sans',
      'font-mono',
      'font-display',
      'bg-pattern',
      // Derived from the `bg-pattern-kind` enum by the emitter, because CSS
      // cannot select a `background-image` by the value of a custom property.
      'bg-pattern-image',
    ]);
    const unknown = Object.keys(dark).filter(
      (k) => !known.has(k) && !structural.has(k),
    );
    expect(unknown, 'add these to THEME_TOKENS or to `structural`').toEqual([]);
  });
});

describe('the kinds wave 2 added', () => {
  // Each of these is a closed grammar written out by hand rather than parsed,
  // and the reason is the same as for the RGB triplet: what is written out is
  // stricter than what a CSS parser accepts, and a value that cannot express a
  // paren cannot carry an injection.

  it('accepts a bounded scalar and refuses everything shaped like one', () => {
    expect(isValidTokenValue('shadow-strength', '0')).toBe(true);
    expect(isValidTokenValue('shadow-strength', '1')).toBe(true);
    expect(isValidTokenValue('shadow-strength', '2.75')).toBe(true);
    expect(isValidTokenValue('shadow-strength', '3')).toBe(true);
    // Past the ceiling.
    expect(isValidTokenValue('shadow-strength', '3.01')).toBe(false);
    expect(isValidTokenValue('shadow-strength', '99')).toBe(false);
    // Shapes that are numbers to a parser and not to us.
    for (const bad of ['-1', '+1', '1e2', '1.234', '1px', '.5', 'calc(1)', '', ' 1']) {
      expect(isValidTokenValue('shadow-strength', bad), bad).toBe(false);
    }
  });

  it('floors ui-scale, because zero is a blank page', () => {
    // The other two scalars treat 0 as a feature: a flat theme, a still one.
    // This one cannot — the interface is full of 0.5625rem labels, and at 0.5
    // they are 4.5 px. So `scalar` grew a floor rather than every consumer
    // learning to distrust it.
    expect(isValidTokenValue('ui-scale', '0')).toBe(false);
    expect(isValidTokenValue('ui-scale', '0.74')).toBe(false);
    expect(isValidTokenValue('ui-scale', '0.75')).toBe(true);
    expect(isValidTokenValue('ui-scale', '1.4')).toBe(true);
    expect(isValidTokenValue('ui-scale', '1.41')).toBe(false);
    // And zero stays valid where it means something.
    expect(isValidTokenValue('shadow-strength', '0')).toBe(true);
    expect(isValidTokenValue('motion-scale', '0')).toBe(true);
  });

  it('gives motion-scale a wider ceiling than shadow-strength', () => {
    // Not symmetry for its own sake: a 4x slower interface is a legible theme,
    // a 4x heavier shadow is soot.
    expect(isValidTokenValue('motion-scale', '4')).toBe(true);
    expect(isValidTokenValue('shadow-strength', '4')).toBe(false);
  });

  it('accepts a bounded length in the units the token allows', () => {
    expect(isValidTokenValue('radius', '0px')).toBe(true);
    expect(isValidTokenValue('radius', '6px')).toBe(true);
    expect(isValidTokenValue('radius', '1.5rem')).toBe(true);
    expect(isValidTokenValue('radius', '32px')).toBe(true);
    expect(isValidTokenValue('radius', '33px')).toBe(false);
    for (const bad of ['6', '6em', '6%', '6pt', '-6px', 'calc(6px * 2)', '6 px']) {
      expect(isValidTokenValue('radius', bad), bad).toBe(false);
    }
  });

  it('lets the pill go far higher than the radius scale', () => {
    // `9999px` is the idiom for a pill and has to remain expressible, while a
    // 9999px card radius is a broken page.
    expect(isValidTokenValue('radius-pill', '9999px')).toBe(true);
    expect(isValidTokenValue('radius', '9999px')).toBe(false);
    // And a square pill is a legitimate brutalist choice.
    expect(isValidTokenValue('radius-pill', '0px')).toBe(true);
  });

  it('accepts the easing keywords and a four-number bezier', () => {
    for (const ok of ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out']) {
      expect(isValidTokenValue('ease-standard', ok), ok).toBe(true);
    }
    expect(isValidTokenValue('ease-standard', 'cubic-bezier(0.2, 0.7, 0.2, 1)')).toBe(true);
    // The overshoot a spring needs: y outside 0..1 is legal, x is not.
    expect(isValidTokenValue('ease-standard', 'cubic-bezier(0.34, 1.56, 0.64, 1)')).toBe(true);
    expect(isValidTokenValue('ease-standard', 'cubic-bezier(0.34, -0.6, 0.64, 1)')).toBe(true);
    expect(isValidTokenValue('ease-standard', 'cubic-bezier(1.2, 0, 0.5, 1)')).toBe(false);
  });

  it('refuses the easing functions with unbounded arguments', () => {
    // `steps()` and `linear()` are valid CSS and deliberately unsupported: both
    // take argument lists of any length, and neither expresses anything a
    // bezier cannot.
    for (const bad of [
      'steps(4, end)',
      'linear(0, 0.25, 1)',
      'cubic-bezier(0.2, 0.7, 0.2)',
      'cubic-bezier(0.2, 0.7, 0.2, 1, 1)',
      'cubic-bezier(0.2, 0.7, 0.2, 1) , url(x)',
      'cubic-bezier(a, b, c, d)',
      'var(--x)',
    ]) {
      expect(isValidTokenValue('ease-standard', bad), bad).toBe(false);
    }
  });

  it('refuses a value for the wrong kind of token', () => {
    // The kinds are not interchangeable, which is what stops a paste from one
    // field landing in another.
    expect(isValidTokenValue('radius', '1')).toBe(false);
    expect(isValidTokenValue('shadow-strength', '6px')).toBe(false);
    expect(isValidTokenValue('shadow-color', '6px')).toBe(false);
    expect(isValidTokenValue('ease-standard', '1')).toBe(false);
  });
});

describe('what a token may hold', () => {
  it('accepts an RGB triplet and nothing that merely looks like a colour', () => {
    expect(isValidTokenValue('bg-base', '10 10 10')).toBe(true);
    expect(isValidTokenValue('bg-base', '0 0 0')).toBe(true);
    expect(isValidTokenValue('bg-base', '255 255 255')).toBe(true);

    // `css-tree` would accept all of these as a `<color>`. None is a triplet,
    // and that difference is the whole security argument: a value validated as
    // three integers cannot carry CSS syntax.
    for (const bad of [
      'red',
      '#fff',
      'rgb(1,2,3)',
      '10,10,10',
      '10 10',
      '10 10 10 10',
      '256 0 0',
      '-1 0 0',
      '10 10 10;background:url(https://evil.example)',
      '10 10 10}html{display:none',
      'var(--x)',
      '10 10 10 /* */',
      '',
      ' 10 10 10',
    ]) {
      expect(isValidTokenValue('bg-base', bad), bad).toBe(false);
    }
  });

  it('refuses a key the schema never declared', () => {
    // The card-mod lesson: a permissive key set turns a token schema into a
    // transport for arbitrary CSS.
    expect(isValidTokenValue('bg-base', '1 2 3')).toBe(true);
    expect(isValidTokenValue('made-up', '1 2 3')).toBe(false);
    expect(isValidTokenValue('display', 'none')).toBe(false);
  });

  it('bounds an alpha to a bare decimal in 0..1', () => {
    for (const ok of ['0', '1', '0.5', '.04', '0.025']) {
      expect(isValidTokenValue('bg-pattern-alpha', ok), ok).toBe(true);
    }
    for (const bad of ['2', '-0.1', '50%', 'calc(1/2)', '1e-2', '0.00001']) {
      expect(isValidTokenValue('bg-pattern-alpha', bad), bad).toBe(false);
    }
  });

  it('holds an enum to its options', () => {
    expect(isValidTokenValue('color-scheme', 'dark')).toBe(true);
    expect(isValidTokenValue('color-scheme', 'light')).toBe(true);
    expect(isValidTokenValue('color-scheme', 'light dark')).toBe(false);
    expect(isValidTokenValue('color-scheme', 'normal')).toBe(false);
  });

  it('reports every problem in a map, not just the first', () => {
    // An admin pasting an exported theme wants the whole list, not twenty-six
    // round trips.
    const issues = validateTokens({
      'bg-base': 'red',
      nonsense: '1 2 3',
      accent: '0 0 0',
      'color-scheme': 'sepia',
    });
    expect(issues).toHaveLength(3);
    expect(issues.map((i) => i.key).sort()).toEqual([
      'bg-base',
      'color-scheme',
      'nonsense',
    ]);
    expect(issues.find((i) => i.key === 'nonsense')!.reason).toBe(
      'unknown-key',
    );
  });

  it('rejects a non-string, so a JSON import cannot smuggle a shape through', () => {
    for (const bad of [null, undefined, 42, [], {}, true]) {
      expect(isValidTokenValue('bg-base', bad)).toBe(false);
    }
  });
});

describe('resolving a theme against its base', () => {
  it('returns the base untouched when nothing is overridden', () => {
    expect(resolveTokens('dark', {})).toEqual(BUILT_IN_TOKENS.dark);
    expect(resolveTokens('light', null)).toEqual(BUILT_IN_TOKENS.light);
  });

  it('applies only what diverges, and keeps the rest inherited', () => {
    // This is what makes a theme receive later corrections to the base: a token
    // it never touched is not a copy, it is an absence.
    const r = resolveTokens('dark', { accent: '255 0 0' });
    expect(r.accent).toBe('255 0 0');
    expect(r['bg-base']).toBe(BUILT_IN_TOKENS.dark['bg-base']);
  });

  it('drops a stored value that is no longer valid', () => {
    // A row can predate a schema change. One bad value must not take the whole
    // stylesheet with it, so resolution re-validates rather than trusting the
    // write path to have been the only door.
    const r = resolveTokens('dark', { accent: 'red', 'bg-base': '1 2 3' });
    expect(r.accent).toBe(BUILT_IN_TOKENS.dark.accent);
    expect(r['bg-base']).toBe('1 2 3');
  });

  it('ignores a key the schema does not declare', () => {
    const r = resolveTokens('dark', { display: 'none' } as never);
    expect(r.display).toBeUndefined();
  });
});

describe('contrast', () => {
  it('computes the documented WCAG ratios', () => {
    // Black on white is 21:1 by definition — the anchor that says the maths is
    // the standard one and not an approximation.
    expect(contrastRatio('0 0 0', '255 255 255')).toBeCloseTo(21, 5);
    expect(contrastRatio('255 255 255', '255 255 255')).toBeCloseTo(1, 5);
  });

  it('passes both shipped themes', () => {
    // The regression guard that matters: `--fg-faint` shipped at 1.84:1 once and
    // had to be raised. If either built-in ever falls short again, this fails
    // before anyone sees it.
    expect(contrastWarnings(BUILT_IN_TOKENS.dark)).toEqual([]);
    expect(contrastWarnings(BUILT_IN_TOKENS.light)).toEqual([]);
  });

  it('catches a theme that is unreadable', () => {
    const warnings = contrastWarnings(
      resolveTokens('dark', { 'fg-default': '20 20 20' }),
    );
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.pair.fg === 'fg-default')).toBe(true);
    expect(warnings[0]!.required).toBe(4.5);
  });

  it('holds the focus ring to 3:1, not 4.5:1', () => {
    // The focus ring is 1.4.11, not 1.4.3. Applying the text threshold to it
    // would reject a perfectly visible ring.
    const ring = CONTRAST_PAIRS.find((p) => p.fg === 'focus-ring')!;
    expect(ring.nonText).toBe(true);
    expect(contrastRatio(
      BUILT_IN_TOKENS.light['focus-ring']!,
      BUILT_IN_TOKENS.light['bg-base']!,
    )).toBeGreaterThan(3);
  });

  it('does not claim borders as a 1.4.11 pair', () => {
    // Recorded as a decision, not an omission: both shipped themes sit near
    // 1.2:1 there, and a border on this site delimits nothing — `.input` is
    // identified by its fill. Requiring 3:1 would force chunky rules on every
    // theme for a clause that does not apply.
    expect(CONTRAST_PAIRS.some((p) => p.fg === 'line-default')).toBe(false);
  });

  it('names every pair, so a warning can say what broke', () => {
    for (const pair of CONTRAST_PAIRS) {
      expect(pair.what.length).toBeGreaterThan(0);
      expect(THEME_TOKEN_KEYS).toContain(pair.fg);
      expect(THEME_TOKEN_KEYS).toContain(pair.bg);
    }
  });
});

describe('the schema itself', () => {
  it('declares no duplicate key', () => {
    expect(new Set(THEME_TOKEN_KEYS).size).toBe(THEME_TOKEN_KEYS.length);
  });

  it('gives every enum its options', () => {
    for (const t of THEME_TOKENS) {
      if (t.kind === 'enum') expect(t.options?.length).toBeGreaterThan(0);
    }
  });

  it('covers every declared token in both built-ins', () => {
    for (const key of THEME_TOKEN_KEYS) {
      expect(BUILT_IN_TOKENS.dark[key], `dark --${key}`).toBeDefined();
      expect(BUILT_IN_TOKENS.light[key], `light --${key}`).toBeDefined();
      expect(isValidTokenValue(key, BUILT_IN_TOKENS.dark[key]!)).toBe(true);
      expect(isValidTokenValue(key, BUILT_IN_TOKENS.light[key]!)).toBe(true);
    }
  });

  it('parses a triplet into channels', () => {
    expect(parseRgb('12 34 56')).toEqual([12, 34, 56]);
    expect(parseRgb('bad')).toBeNull();
  });
});
