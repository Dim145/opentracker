/**
 * What a theme's free-form CSS may contain.
 *
 * Here rather than in the API because two places need the same answer and they
 * must not drift: `apps/api/utils/themeCss.ts` REFUSES on these lists — it is
 * the gate, and it parses with `css-tree` to do it — and the admin editor warns
 * against them as you type, so an owner learns before pressing save rather than
 * after.
 *
 * The editor's warning is a courtesy and carries no authority. Anything that
 * reaches the database has been through the parser on the server; nothing here
 * is a substitute for that, and a client that skipped these checks entirely
 * would change nothing about what is accepted.
 */

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
export const ALLOWED_AT_RULES = new Set(['media', 'supports', 'container', 'keyframes']);

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
export const ALLOWED_FUNCTIONS = new Set([
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
export const REFUSED_PROPERTIES: Record<string, string> = {
  position:
    'position is not allowed: a fixed or absolutely positioned overlay can intercept every click on the page, and unlike anything else in CSS that needs no way of sending data anywhere. Use the tokens for appearance; layout changes belong in the interface.',
  '-moz-binding': '-moz-binding is not allowed: it loads and runs code.',
  behavior: 'behavior is not allowed: it loads and runs code.',
};

/** 16 kB per theme. Ten enabled themes ride in one stylesheet every visitor gets. */
export const MAX_CUSTOM_CSS_BYTES = 16 * 1024;
