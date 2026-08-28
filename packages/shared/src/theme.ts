/**
 * The theme token schema — what an admin-defined theme is allowed to contain.
 *
 * ## Why the schema lives in code and not in the database
 *
 * Not a preference: a constraint. Tailwind freezes utility names at build time
 * and compiles their values to `var(--token)`, so `bg-bg-primary` exists because
 * `tailwind.config.ts` said so months ago. A row in a table cannot invent a
 * utility. What a theme CAN do is supply a different value for a name the build
 * already knows — which is exactly what this file enumerates.
 *
 * So: the shape is versioned with the code, the database carries values only.
 * The immediate consequence is that adding a token category later needs no
 * migration, and removing one silently ignores whatever rows still hold it.
 *
 * ## Why the validators are hand-written and not `css-tree`
 *
 * Every token wave 1 exposes is either an RGB triplet or a closed enum, and for
 * those a hand-written check is STRICTER than a CSS parser: `css-tree` would
 * happily accept `red` as a `<color>`, and `red` is not three integers. A
 * triplet validated as three numbers in 0-255 cannot carry CSS syntax at all —
 * no `url(`, no `;`, no `}` — which makes injection impossible by construction
 * rather than by blocklist.
 *
 * `css-tree` earns its place the moment shadows and lengths arrive (wave 2),
 * where the grammar is genuinely too large to hand-write. `TOKEN_KINDS` is the
 * seam: add a kind, add its validator.
 *
 * ## The built-in values are duplicated here, on purpose
 *
 * `light` and `dark` live in `apps/web/app/assets/css/main.css` as code
 * constants — nothing in the admin console can edit them, so an instance always
 * has a working appearance to fall back to. But both the CSS emitter and the
 * admin editor need to know what a theme inherits: the emitter to resolve a
 * partial theme, the editor to show the inherited value as a placeholder.
 *
 * Copying them into TypeScript is therefore unavoidable, and a copy that can
 * drift is a copy that will. `apps/web/test/themeTokens.test.ts` parses
 * `main.css` and asserts every value here matches it, so the stylesheet stays
 * the single source of truth and the duplicate cannot rot quietly.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Kinds
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `rgb` — three integers 0-255, space separated ("250 250 250").
 *
 * The site's whole colour system is stored this way so Tailwind's opacity
 * modifiers work: every colour resolves through `rgb(var(--x) / <alpha-value>)`,
 * which is what makes `bg-bg-secondary/50` valid. Keeping the convention here
 * is not conservatism — it is also the strongest validator available.
 *
 * `alpha` — a number in 0..1, for the layers composed out of a triplet.
 * `enum` — one of a closed list.
 *
 * Wave 2 adds three, and none of them needed `css-tree` after all — the note
 * above expected it to. The reason is the same one that made the triplet safe:
 * each of these is a closed grammar small enough to write out, and writing it
 * out is stricter than parsing. A parser accepts every valid CSS length; the
 * check below accepts a bounded number followed by `px` or `rem`, which cannot
 * express `calc(1px + var(--x))`, a negative, or anything with a paren in it.
 *
 * `scalar` — a bare non-negative number with a per-token ceiling. This is the
 *   shape that gives a theme a global lever: `shadow-strength: 0` flattens every
 *   elevation on the site, `motion-scale: 0` stops every transition, because
 *   both are multiplied into the value with `calc()` at the point of use.
 * `length` — a bounded number with `px` or `rem`. Bounded because a radius of
 *   400px on a card is not a theme, it is a broken page.
 * `bezier` — one of the five CSS easing keywords, or `cubic-bezier()` with
 *   exactly four numbers. `steps()` and `linear()` are refused: both can carry
 *   arbitrarily long argument lists, and neither buys a theme anything a
 *   bezier cannot express.
 */
export type TokenKind = 'rgb' | 'alpha' | 'enum' | 'scalar' | 'length' | 'bezier';

/** Groups exist only to lay the admin editor out. They carry no behaviour. */
export type TokenGroup =
  | 'surface'
  | 'foreground'
  | 'line'
  | 'accent'
  | 'semantic'
  | 'elevation'
  | 'shape'
  | 'motion'
  | 'ambience'
  | 'chrome';

export interface TokenDef {
  /** The custom property, without the leading `--`. */
  readonly key: string;
  readonly kind: TokenKind;
  readonly group: TokenGroup;
  /** Allowed values, for `enum`. */
  readonly options?: readonly string[];
  /** Inclusive ceiling for `scalar` and `length`. Floor is always 0. */
  readonly max?: number;
  /** Allowed units for `length`. */
  readonly units?: readonly string[];
  /**
   * A token the interface does not consume yet, flagged as such.
   *
   * The editor still offers it — pre-setting it is useful, and it is emitted
   * like any other — but the group label says so, because an admin changing it
   * and seeing nothing move would otherwise read that as a bug.
   *
   * Wave 1 reserves the two remaining ambience names so a theme created now
   * stays valid when wave 4 converts the 111 per-page variables that will
   * consume them. Emitting them from the start also means a theme author can
   * already set them by hand through import/export.
   *
   * `accent-warm` was reserved this way and no longer is — wave 1 converted the
   * gold, so it is a live token in the `accent` group.
   */
  readonly reserved?: true;
}

// ─────────────────────────────────────────────────────────────────────────────
// The schema
// ─────────────────────────────────────────────────────────────────────────────

export const THEME_TOKENS: readonly TokenDef[] = [
  // Surfaces
  { key: 'bg-base', kind: 'rgb', group: 'surface' },
  { key: 'bg-surface', kind: 'rgb', group: 'surface' },
  { key: 'bg-elevated', kind: 'rgb', group: 'surface' },
  { key: 'bg-hover', kind: 'rgb', group: 'surface' },
  { key: 'bg-inset', kind: 'rgb', group: 'surface' },

  // Foreground
  { key: 'fg-default', kind: 'rgb', group: 'foreground' },
  { key: 'fg-strong', kind: 'rgb', group: 'foreground' },
  { key: 'fg-muted', kind: 'rgb', group: 'foreground' },
  { key: 'fg-subtle', kind: 'rgb', group: 'foreground' },
  { key: 'fg-faint', kind: 'rgb', group: 'foreground' },

  // Lines
  { key: 'line-default', kind: 'rgb', group: 'line' },
  { key: 'line-strong', kind: 'rgb', group: 'line' },

  // Accent
  //
  // Two of them, and that is not redundancy. `accent` is the monochrome one the
  // design system declares — white on dark, near-black on light — and it paints
  // the `.btn--primary` of `main.css`. `accent-warm` is the gold this site is
  // actually recognised by, and after wave 1 it is what the 590 converted
  // component sites paint: every primary button, badge, hover glow and
  // highlight border outside the shared layer.
  //
  // The two were merged in neither direction on purpose. Folding gold into
  // `accent` would repaint the shared layer gold; folding `accent` into gold
  // would turn the whole site monochrome. Both are visible redesigns nobody
  // asked for. Wave 4 reconciles them properly, along with the 111 per-page
  // ambience variables.
  { key: 'accent', kind: 'rgb', group: 'accent' },
  { key: 'accent-hover', kind: 'rgb', group: 'accent' },
  { key: 'accent-fg', kind: 'rgb', group: 'accent' },
  { key: 'accent-warm', kind: 'rgb', group: 'accent' },
  // The mark drawn on a warm-accent fill. One value serves both built-ins —
  // near-black reads at 7.8:1 on the dark theme's gold and 5.2:1 on the light
  // theme's darker gold — but it is a token rather than a literal because a
  // theme setting `accent-warm` to a dark colour needs to move this with it.
  { key: 'accent-warm-fg', kind: 'rgb', group: 'accent' },

  // Semantic — status badges and notifications, never chrome
  { key: 'online', kind: 'rgb', group: 'semantic' },
  { key: 'warning', kind: 'rgb', group: 'semantic' },
  { key: 'danger', kind: 'rgb', group: 'semantic' },
  { key: 'info', kind: 'rgb', group: 'semantic' },

  // Chrome
  //
  // `focus-ring` is new, and it exists so the unlayered rule in main.css that
  // painted every outline `#d4a734` could be deleted without the ring falling
  // back to the monochrome accent. Its default IS that gold, so nothing changes
  // visually — it just becomes something a theme can reach.
  { key: 'focus-ring', kind: 'rgb', group: 'chrome' },
  // The body dot-grid, split from one `rgba()` literal into a triplet plus an
  // alpha. One value could not be validated as anything narrower than "some
  // colour"; two can be validated exactly, and the pattern becomes tintable
  // instead of being two hardcoded near-transparent whites.
  { key: 'bg-pattern-rgb', kind: 'rgb', group: 'chrome' },
  { key: 'bg-pattern-alpha', kind: 'alpha', group: 'chrome' },
  // The geometry, not just the tint. `none` matters as much as the other two:
  // plenty of themes want a plain page, and before this the dot grid was
  // unavoidable at any opacity above zero.
  //
  // An enum rather than a free-form image, and that is what makes it safe. CSS
  // cannot branch on the value of a custom property, so the emitter maps the
  // name to a literal from `PATTERN_IMAGES` below and writes
  // `--bg-pattern-image` alongside it. The database therefore holds one of
  // three words, and the CSS comes from code — where a free-form
  // `background-image` would have handed a theme `url()`, and with
  // `img-src 'self' data: https:` in the CSP that is an exfiltration channel
  // no validator could close.
  {
    key: 'bg-pattern-kind',
    kind: 'enum',
    group: 'chrome',
    options: ['dots', 'grid', 'none'] as const,
  },
  { key: 'bg-pattern-step', kind: 'length', group: 'chrome', max: 400, units: ['px', 'rem'] },
  // Native controls — scrollbars, `<select>`, date pickers, form widgets. Set
  // as a token rather than derived from the base, because a custom theme built
  // on `dark` may well read as light and vice versa, and getting this wrong
  // leaves pale scrollbars on a black page.
  {
    key: 'color-scheme',
    kind: 'enum',
    group: 'chrome',
    options: ['light', 'dark'] as const,
  },

  // Elevation
  //
  // Two levers rather than a list of shadow strings, and that is the whole
  // design. The 238 `box-shadow` declarations in this codebase are hand-tuned
  // and mostly unique; replacing them with three canonical elevations would
  // flatten deliberate differences, and exposing them as free-form strings
  // would put a CSS grammar nobody can validate into a database column.
  //
  // Instead every black shadow in the codebase is rewritten as
  // `rgb(var(--shadow-color) / calc(<its own alpha> * var(--shadow-strength)))`.
  // Each site keeps its own weight; a theme moves all of them together. The
  // "flat mode" the plan asked for is `shadow-strength: 0` — no special case,
  // no second code path, every shadow simply becomes transparent.
  { key: 'shadow-color', kind: 'rgb', group: 'elevation' },
  // Up to 3: a shadow can be pushed well past its designed weight for a heavy,
  // theatrical theme. Past that the page is soot.
  { key: 'shadow-strength', kind: 'scalar', group: 'elevation', max: 3 },

  // Shape
  //
  // One scalar with the rest derived by `calc()` in the stylesheet, which is
  // shadcn's proportional scale rather than a list of independent radii. A
  // single number takes the whole personality of the corners from square to
  // very round, and the five steps keep their relative proportions while it
  // moves — which a list of five editable values would not.
  { key: 'radius', kind: 'length', group: 'shape', max: 32, units: ['px', 'rem'] },
  // NOT derived from `--radius`. A pill is a pill at any radius scale, so it
  // needs its own value — and a brutalist theme wanting square pills has to be
  // able to say so without flattening every card as collateral.
  { key: 'radius-pill', kind: 'length', group: 'shape', max: 9999, units: ['px', 'rem'] },

  // Motion
  //
  // A multiplier, not a table of durations. The measured spread was seven
  // values between 120 ms and 220 ms across 528 sites — one band, hand-tuned
  // within itself. A theme wants "snappier" or "slower", which is one number;
  // per-step durations would be six more tokens for a distinction nobody makes.
  //
  // `motion-scale: 0` is a valid value and it removes every transition on the
  // site. That is deliberate: it makes "no animation" a theme rather than a
  // browser setting, and it is the same mechanism, so there is no second path
  // to keep correct.
  { key: 'motion-scale', kind: 'scalar', group: 'motion', max: 4 },
  { key: 'ease-standard', kind: 'bezier', group: 'motion' },
  { key: 'ease-emphasis', kind: 'bezier', group: 'motion' },

  // Ambience — reserved (see `TokenDef.reserved`)
  //
  // `accent-warm` started here and moved up to `accent`: wave 1 converted the
  // gold, so it is no longer a name held for later.
  { key: 'accent-cool', kind: 'rgb', group: 'ambience', reserved: true },
  { key: 'accent-paper', kind: 'rgb', group: 'ambience', reserved: true },
] as const;

/**
 * What each `bg-pattern-kind` actually paints.
 *
 * Kept here rather than in the emitter so the admin editor, the emitter and
 * `main.css`'s built-ins all agree, and so the only thing that ever reaches CSS
 * is one of these three strings. Each composes `--bg-pattern` (the tint) and
 * `--bg-pattern-step` (the pitch), so a theme still controls colour and scale
 * independently of geometry.
 */
export const PATTERN_IMAGES: Record<string, string> = {
  dots: 'radial-gradient(circle at 2px 2px, var(--bg-pattern) 1px, transparent 0)',
  grid:
    'linear-gradient(to right, var(--bg-pattern) 1px, transparent 1px), ' +
    'linear-gradient(to bottom, var(--bg-pattern) 1px, transparent 1px)',
  none: 'none',
};

/** The literal for a kind, falling back to the dot grid. */
export function patternImage(kind: string | undefined): string {
  return PATTERN_IMAGES[kind ?? ''] ?? PATTERN_IMAGES.dots!;
}

export const THEME_TOKEN_KEYS: readonly string[] = THEME_TOKENS.map(
  (t) => t.key,
);

const BY_KEY = new Map(THEME_TOKENS.map((t) => [t.key, t]));

export function tokenDef(key: string): TokenDef | undefined {
  return BY_KEY.get(key);
}

// ─────────────────────────────────────────────────────────────────────────────
// The built-in values
// ─────────────────────────────────────────────────────────────────────────────

export type TokenMap = Readonly<Record<string, string>>;

/** Every token, for the theme every other theme inherits from. */
export const BUILT_IN_TOKENS: Readonly<Record<'light' | 'dark', TokenMap>> = {
  dark: {
    'bg-base': '10 10 10',
    'bg-surface': '20 20 20',
    'bg-elevated': '26 26 26',
    'bg-hover': '35 35 35',
    'bg-inset': '15 15 15',
    'fg-default': '250 250 250',
    'fg-strong': '255 255 255',
    'fg-muted': '161 161 161',
    'fg-subtle': '121 121 121',
    'fg-faint': '130 130 130',
    'line-default': '42 42 42',
    'line-strong': '58 58 58',
    accent: '255 255 255',
    'accent-hover': '229 229 229',
    'accent-fg': '10 10 10',
    online: '34 197 94',
    warning: '234 179 8',
    danger: '239 68 68',
    info: '56 189 248',
    'focus-ring': '212 167 52',
    'bg-pattern-rgb': '255 255 255',
    'bg-pattern-alpha': '0.025',
    'bg-pattern-kind': 'dots',
    'bg-pattern-step': '40px',
    'color-scheme': 'dark',
    'accent-warm': '212 167 52',
    'accent-warm-fg': '26 26 26',
    'shadow-color': '0 0 0',
    'shadow-strength': '1',
    radius: '6px',
    'radius-pill': '9999px',
    'motion-scale': '1',
    'ease-standard': 'cubic-bezier(0.2, 0.7, 0.2, 1)',
    'ease-emphasis': 'cubic-bezier(0.22, 1, 0.36, 1)',
    'accent-cool': '52 212 216',
    'accent-paper': '20 20 20',
  },
  light: {
    'bg-base': '250 250 250',
    'bg-surface': '255 255 255',
    'bg-elevated': '255 255 255',
    'bg-hover': '243 243 243',
    'bg-inset': '245 245 245',
    'fg-default': '10 10 10',
    'fg-strong': '0 0 0',
    'fg-muted': '85 85 85',
    'fg-subtle': '115 115 115',
    'fg-faint': '115 115 115',
    'line-default': '229 229 229',
    'line-strong': '208 208 208',
    accent: '10 10 10',
    'accent-hover': '31 31 31',
    'accent-fg': '255 255 255',
    online: '21 128 61',
    warning: '180 83 9',
    danger: '185 28 28',
    info: '3 105 161',
    'focus-ring': '176 133 24',
    'bg-pattern-rgb': '0 0 0',
    'bg-pattern-alpha': '0.04',
    'bg-pattern-kind': 'dots',
    'bg-pattern-step': '40px',
    'color-scheme': 'light',
    'accent-warm': '176 133 24',
    'accent-warm-fg': '26 26 26',
    'shadow-color': '0 0 0',
    'shadow-strength': '1',
    radius: '6px',
    'radius-pill': '9999px',
    'motion-scale': '1',
    'ease-standard': 'cubic-bezier(0.2, 0.7, 0.2, 1)',
    'ease-emphasis': 'cubic-bezier(0.22, 1, 0.36, 1)',
    'accent-cool': '14 145 148',
    'accent-paper': '252 250 245',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

const RGB_TRIPLET = /^(\d{1,3}) (\d{1,3}) (\d{1,3})$/;

/** Parse a triplet into its three channels, or null. Exact, not lenient. */
export function parseRgb(value: string): [number, number, number] | null {
  const m = RGB_TRIPLET.exec(value);
  if (!m) return null;
  const parts = [Number(m[1]), Number(m[2]), Number(m[3])] as [
    number,
    number,
    number,
  ];
  return parts.every((n) => n >= 0 && n <= 255) ? parts : null;
}

/**
 * Is this a value the named token may hold?
 *
 * Rejects an unknown key as well as a bad value, which matters more than it
 * looks: a permissive key set turns a token schema into a transport for
 * arbitrary CSS. Home Assistant's `card-mod` does exactly that — it smuggles
 * whole rulesets through keys the schema never enumerated.
 */
/**
 * The keyword easings, and only these.
 *
 * `steps()` and `linear()` are left out on purpose — both accept argument lists
 * of unbounded length, and a theme gains nothing from either that a bezier
 * cannot express.
 */
const EASING_KEYWORDS: readonly string[] = [
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
];

export function isValidTokenValue(key: string, value: unknown): boolean {
  const def = BY_KEY.get(key);
  if (!def) return false;
  if (typeof value !== 'string') return false;

  switch (def.kind) {
    case 'rgb':
      return parseRgb(value) !== null;
    case 'alpha': {
      // A bare decimal, and nothing else. `calc()`, `%` and scientific notation
      // are all refused — not because they would break anything, but because
      // every form allowed is a form the emitter has to stay correct for.
      if (!/^(?:0|1|0?\.\d{1,4})$/.test(value)) return false;
      const n = Number(value);
      return n >= 0 && n <= 1;
    }
    case 'enum':
      return !!def.options?.includes(value);
    case 'scalar': {
      // Up to two decimals, no sign, no exponent, no unit. Every form allowed
      // is a form the `calc()` at the point of use has to stay correct for.
      if (!/^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/.test(value)) return false;
      return Number(value) <= (def.max ?? 1);
    }
    case 'length': {
      const m = /^(0|[1-9]\d{0,3})(?:\.\d{1,2})?(px|rem)$/.exec(value);
      if (!m) return false;
      if (!(def.units ?? ['px']).includes(m[2]!)) return false;
      return parseFloat(value) <= (def.max ?? 0);
    }
    case 'bezier': {
      if (EASING_KEYWORDS.includes(value)) return true;
      const m = /^cubic-bezier\(([^()]*)\)$/.exec(value);
      if (!m) return false;
      const parts = m[1]!.split(',').map((p) => p.trim());
      if (parts.length !== 4) return false;
      // The x coordinates of a cubic-bezier timing function must be in 0..1 or
      // the browser discards the whole declaration; y may overshoot, which is
      // what makes a spring curve possible.
      return parts.every((p, i) => {
        if (!/^-?(?:0|[1-9]\d?)(?:\.\d{1,4})?$/.test(p)) return false;
        const n = Number(p);
        return i % 2 === 0 ? n >= 0 && n <= 1 : n >= -5 && n <= 5;
      });
    }
  }
}

export interface TokenIssue {
  key: string;
  reason: 'unknown-key' | 'bad-value';
}

/**
 * Check a whole token map. Returns every problem rather than the first.
 *
 * An admin pasting an exported theme wants to know all of what is wrong with
 * it, not to fix twenty-six errors one round trip at a time.
 */
export function validateTokens(tokens: Record<string, unknown>): TokenIssue[] {
  const issues: TokenIssue[] = [];
  for (const [key, value] of Object.entries(tokens)) {
    if (!BY_KEY.has(key)) {
      issues.push({ key, reason: 'unknown-key' });
      continue;
    }
    if (!isValidTokenValue(key, value)) {
      issues.push({ key, reason: 'bad-value' });
    }
  }
  return issues;
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A theme's full token map: the base, then its overrides.
 *
 * Flat on purpose — there are no derived tokens yet, and when there are (hover
 * states, surface tints) they get computed AFTER this merge, never stored. The
 * DTCG resolver spells out why: flatten the layers first, resolve aliases
 * second. Resolving before merging means an override that redirects an alias
 * silently does nothing.
 */
export function resolveTokens(
  base: 'light' | 'dark',
  overrides: Record<string, unknown> | null | undefined,
): TokenMap {
  const out: Record<string, string> = { ...BUILT_IN_TOKENS[base] };
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      // Validated again at read time, not only at write time. A row can predate
      // a schema change, and one bad value must not take the stylesheet with it.
      if (isValidTokenValue(key, value)) out[key] = value as string;
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Contrast
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The pairs the interface actually renders.
 *
 * Contrast cannot be checked token by token — a colour is neither readable nor
 * unreadable on its own. So the pairs are declared, and only these are checked.
 * The list is short because it is meant to be true: every entry is a
 * combination that appears in `main.css` or in the shell.
 *
 * `large` follows WCAG's definition (≥18.66px bold or ≥24px), which is what the
 * page titles and the stat figures use. `nonText` covers borders and the focus
 * ring, where 3:1 is the requirement (1.4.11).
 */
export interface ContrastPair {
  readonly fg: string;
  readonly bg: string;
  readonly large?: true;
  readonly nonText?: true;
  /** What this pair is, for the warning the admin reads. */
  readonly what: string;
}

export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  { fg: 'fg-default', bg: 'bg-base', what: 'body text' },
  { fg: 'fg-default', bg: 'bg-surface', what: 'text on cards' },
  { fg: 'fg-strong', bg: 'bg-base', what: 'headings', large: true },
  { fg: 'fg-muted', bg: 'bg-base', what: 'secondary text' },
  { fg: 'fg-muted', bg: 'bg-surface', what: 'secondary text on cards' },
  { fg: 'fg-subtle', bg: 'bg-base', what: 'muted labels' },
  // The one the codebase has already been bitten by: `--fg-faint` shipped at
  // 1.84:1 and had to be raised to ~5.2:1 because a dozen mono micro-labels use
  // it as a text colour.
  { fg: 'fg-faint', bg: 'bg-base', what: 'micro labels' },
  { fg: 'accent-fg', bg: 'accent', what: 'primary button' },
  // The gold button, which is the one an admin will actually see: the shared
  // `.btn--primary` uses `accent`, but 590 component sites use `accent-warm`.
  { fg: 'accent-warm-fg', bg: 'accent-warm', what: 'gold button' },
  // Deliberately NOT `line-default` on `bg-base`. 1.4.11 covers "visual
  // information required to identify user interface components", and on this
  // site a border does not carry that: `.input` is identified by its fill
  // (`--bg-elevated`, distinct from the page) and the hairlines elsewhere
  // separate sections rather than delimit controls. Both shipped themes sit
  // around 1.2-1.4:1 there, and requiring 3:1 would force every theme into
  // chunky high-contrast rules — a worse site, in the name of a clause that
  // does not apply. The focus ring below is the real 1.4.11 case.
  { fg: 'focus-ring', bg: 'bg-base', what: 'focus ring', nonText: true },
] as const;

/** Relative luminance, per WCAG 2.x. */
function luminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG 2.x contrast ratio, 1..21. Null when either value is not a triplet. */
export function contrastRatio(a: string, b: string): number | null {
  const ca = parseRgb(a);
  const cb = parseRgb(b);
  if (!ca || !cb) return null;
  const la = luminance(ca);
  const lb = luminance(cb);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export interface ContrastWarning {
  readonly pair: ContrastPair;
  readonly ratio: number;
  readonly required: number;
}

/**
 * Every declared pair that falls short, with what it needed.
 *
 * Gated on WCAG 2.x rather than APCA, and that is a current call rather than a
 * conservative one: WCAG 3 has not settled on an algorithm — the contrast
 * section of the working draft is still a placeholder — and `apca-w3` is
 * AGPL-licensed for commercial use. Nothing is imported for this: the maths is
 * eight lines and the alternative is a dependency with a licence to read.
 */
export function contrastWarnings(tokens: TokenMap): ContrastWarning[] {
  const out: ContrastWarning[] = [];
  for (const pair of CONTRAST_PAIRS) {
    const ratio = contrastRatio(tokens[pair.fg] ?? '', tokens[pair.bg] ?? '');
    if (ratio === null) continue;
    const required = pair.nonText ? 3 : pair.large ? 3 : 4.5;
    if (ratio < required) {
      out.push({ pair, ratio: Math.round(ratio * 100) / 100, required });
    }
  }
  return out;
}
