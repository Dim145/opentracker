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
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.65rem', { lineHeight: '0.85rem' }],
      },
    },
  },
  plugins: [],
} satisfies Config;
