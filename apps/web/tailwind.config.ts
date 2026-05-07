import type { Config } from 'tailwindcss';

/**
 * Tailwind config — token-driven via CSS variables.
 *
 * The class names below (`bg-bg-primary`, `text-text-muted`, `border-border`,
 * etc.) are kept identical to what the existing markup uses — they just point
 * at CSS custom properties now. Switching `data-theme` on <html> swaps the
 * underlying values without touching any template.
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
        bg: {
          primary:   'var(--bg-base)',
          secondary: 'var(--bg-surface)',
          tertiary:  'var(--bg-elevated)',
          hover:     'var(--bg-hover)',
          inset:     'var(--bg-inset)',
        },
        text: {
          primary:   'var(--fg-default)',
          secondary: 'var(--fg-muted)',
          muted:     'var(--fg-subtle)',
          faint:     'var(--fg-faint)',
          strong:    'var(--fg-strong)',
        },
        border: {
          DEFAULT: 'var(--line-default)',
          hover:   'var(--line-strong)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          muted:   'var(--fg-subtle)',
          fg:      'var(--accent-fg)',
          soft:    'var(--accent-soft)',
        },
        success: 'var(--online)',
        online:  'var(--online)',
        warning: 'var(--warning)',
        error:   'var(--danger)',
        danger:  'var(--danger)',
        info:    'var(--info)',
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
