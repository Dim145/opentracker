import type { Config } from 'tailwindcss';

/**
 * Tailwind config — token-driven via CSS variables stored as RGB triplets.
 *
 * Why triplets and not hex literals: Tailwind's opacity modifiers
 * (`bg-bg-secondary/50`, `text-fg-default/10`, etc.) substitute the
 * `<alpha-value>` placeholder below into the colour value at compile time.
 * Because every colour resolves to `rgb(R G B / a)`, *every* token now
 * supports `/N` opacity. The previous `var(--bg-surface)` form silently
 * dropped the alpha and the input fell back to user-agent white in dark
 * mode (the SearchBar bug).
 *
 * Class names match the legacy markup: `bg-bg-primary`, `text-text-muted`,
 * `border-border` are unchanged. New `fg.*` group is for opacity-aware
 * foreground tints (used by header nav active state, hover overlays, etc.).
 */
export default {
  content: [
    './app/**/*.{vue,ts}',
    './components/**/*.{vue,ts}',
    './layouts/**/*.vue',
    './pages/**/*.vue',
  ],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Surfaces
        bg: {
          primary:   'rgb(var(--bg-base) / <alpha-value>)',
          secondary: 'rgb(var(--bg-surface) / <alpha-value>)',
          tertiary:  'rgb(var(--bg-elevated) / <alpha-value>)',
          hover:     'rgb(var(--bg-hover) / <alpha-value>)',
          inset:     'rgb(var(--bg-inset) / <alpha-value>)',
        },
        // Foreground (text *and* opacity-aware fills)
        text: {
          primary:   'rgb(var(--fg-default) / <alpha-value>)',
          secondary: 'rgb(var(--fg-muted) / <alpha-value>)',
          muted:     'rgb(var(--fg-subtle) / <alpha-value>)',
          faint:     'rgb(var(--fg-faint) / <alpha-value>)',
          strong:    'rgb(var(--fg-strong) / <alpha-value>)',
        },
        // `fg.*` is the same set, but exposed as bg/border-friendly names so
        // `bg-fg-default/10` and `border-fg-default/20` (the new "neutral
        // overlay" pattern) work without ambiguity.
        fg: {
          default: 'rgb(var(--fg-default) / <alpha-value>)',
          strong:  'rgb(var(--fg-strong) / <alpha-value>)',
          muted:   'rgb(var(--fg-muted) / <alpha-value>)',
          subtle:  'rgb(var(--fg-subtle) / <alpha-value>)',
          faint:   'rgb(var(--fg-faint) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'rgb(var(--line-default) / <alpha-value>)',
          hover:   'rgb(var(--line-strong) / <alpha-value>)',
          // La bordure d'un CHAMP. `border-border` est le filet décoratif des
          // cartes et des tableaux : à 1,21:1 en sombre et 1,26:1 en clair, il
          // ne peut pas porter la frontière d'un contrôle, que WCAG 1.4.11
          // veut à 3:1. `.input` passe par `--line-field` dans `main.css` ; les
          // champs habillés en utilitaires ont besoin du même jeton.
          field:   'rgb(var(--line-field) / <alpha-value>)',
        },
        line: {
          DEFAULT: 'rgb(var(--line-default) / <alpha-value>)',
          strong:  'rgb(var(--line-strong) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          hover:   'rgb(var(--accent-hover) / <alpha-value>)',
          fg:      'rgb(var(--accent-fg) / <alpha-value>)',
          muted:   'rgb(var(--fg-subtle) / <alpha-value>)',
        },
        success: 'rgb(var(--online) / <alpha-value>)',
        online:  'rgb(var(--online) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        error:   'rgb(var(--danger) / <alpha-value>)',
        danger:  'rgb(var(--danger) / <alpha-value>)',
        info:    'rgb(var(--info) / <alpha-value>)',
      },
      // The stacks live in `main.css` as `--font-sans` / `--font-mono` /
      // `--font-display`, and these utilities read them rather than restating
      // them. Two copies of a font stack is how you end up with `font-mono`
      // and `var(--font-mono)` rendering two different faces, which is exactly
      // what this codebase had.
      // No `display` entry: `main.css` already defines `.font-display` by hand,
      // with the feature settings and optical sizing a utility would not carry.
      fontFamily: {
        sans: 'var(--font-sans)',
        mono: 'var(--font-mono)',
      },
      fontSize: {
        '2xs': ['0.65rem', { lineHeight: '0.85rem' }],
      },

      // The utilities read the tokens, for the same reason `fontFamily` does:
      // 213 `rounded-*` classes in the templates were on Tailwind's own scale
      // and followed no theme at all, so a theme could round every hand-written
      // `border-radius` and leave every utility square.
      //
      // The mapping is exact rather than approximate, which is a happy accident
      // worth stating: Tailwind's default steps are 2 / 4 / 6 / 8 / 12 px, and
      // so is `--radius`'s derived scale. Nothing shifts by a pixel.
      borderRadius: {
        none: '0',
        sm: 'var(--radius-xs)',
        DEFAULT: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        '2xl': 'calc(var(--radius) * 2.6667)',
        '3xl': 'calc(var(--radius) * 4)',
        full: 'var(--radius-pill)',
      },

      // Durations already carry `--motion-scale` inside them, so
      // `motion-scale: 0` stops the utility-driven transitions too rather than
      // only the hand-written ones.
      transitionDuration: {
        DEFAULT: 'var(--dur-2)',
        75: 'calc(75ms * var(--motion-scale))',
        100: 'calc(100ms * var(--motion-scale))',
        150: 'var(--dur-2)',
        200: 'var(--dur-4)',
        300: 'var(--dur-slow)',
        500: 'calc(500ms * var(--motion-scale))',
        700: 'calc(700ms * var(--motion-scale))',
        1000: 'calc(1000ms * var(--motion-scale))',
      },
      transitionTimingFunction: {
        DEFAULT: 'var(--ease-standard)',
        standard: 'var(--ease-standard)',
        emphasis: 'var(--ease-emphasis)',
      },

      // Tailwind's own shadows are `rgb(0 0 0 / 0.1)` and up, which no theme
      // could tint or flatten. Same two levers as everything else.
      boxShadow: {
        sm: '0 1px 2px 0 rgb(var(--shadow-color) / calc(0.05 * var(--shadow-strength)))',
        DEFAULT:
          '0 1px 3px 0 rgb(var(--shadow-color) / calc(0.1 * var(--shadow-strength))), 0 1px 2px -1px rgb(var(--shadow-color) / calc(0.1 * var(--shadow-strength)))',
        md: '0 4px 6px -1px rgb(var(--shadow-color) / calc(0.1 * var(--shadow-strength))), 0 2px 4px -2px rgb(var(--shadow-color) / calc(0.1 * var(--shadow-strength)))',
        lg: '0 10px 15px -3px rgb(var(--shadow-color) / calc(0.1 * var(--shadow-strength))), 0 4px 6px -4px rgb(var(--shadow-color) / calc(0.1 * var(--shadow-strength)))',
        xl: '0 20px 25px -5px rgb(var(--shadow-color) / calc(0.1 * var(--shadow-strength))), 0 8px 10px -6px rgb(var(--shadow-color) / calc(0.1 * var(--shadow-strength)))',
        '2xl': '0 25px 50px -12px rgb(var(--shadow-color) / calc(0.25 * var(--shadow-strength)))',
        inner:
          'inset 0 2px 4px 0 rgb(var(--shadow-color) / calc(0.05 * var(--shadow-strength)))',
        none: 'none',
      },
    },
  },
  plugins: [],
} satisfies Config;
