import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Trackarr',
  description: 'A modern, high-performance private BitTorrent tracker',

  // GitHub Pages base — deployed at https://dim145.github.io/opentracker/
  // The repo is `Dim145/opentracker`; the product itself is still
  // called Trackarr inside the app, but the URL space follows the
  // repo name.
  base: '/opentracker/',

  ignoreDeadLinks: [/^http:\/\/localhost/],

  head: [
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    [
      'link',
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
    ],
    [
      'link',
      {
        href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
        rel: 'stylesheet',
      },
    ],
  ],

  vite: {
    plugins: [
      // @ts-ignore
      (await import('@tailwindcss/vite')).default(),
    ],
  },

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Integrations', link: '/integrations/torznab' },
      { text: 'Reference', link: '/reference/api' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Configuration', link: '/guide/configuration' },
            { text: 'Backup & Restore', link: '/guide/backup-restore' },
            { text: 'Local Production', link: '/guide/local-production' },
            { text: 'Roadmap', link: '/guide/roadmap' },
          ],
        },
        {
          text: 'Security',
          items: [
            { text: 'Overview', link: '/guide/security' },
            { text: 'Zero-Knowledge Auth', link: '/guide/zero-knowledge-auth' },
            { text: 'Two-Factor Auth', link: '/guide/two-factor-auth' },
            { text: 'Panic Mode', link: '/guide/panic-mode' },
          ],
        },
        {
          text: 'Operations',
          items: [
            { text: 'Invitations', link: '/guide/invitations' },
            { text: 'Moderation', link: '/guide/moderation' },
            { text: 'Bonus Events', link: '/guide/bonus-events' },
          ],
        },
        {
          text: 'Help',
          items: [
            { text: 'Troubleshooting', link: '/guide/troubleshooting' },
            { text: 'Load Testing', link: '/guide/load-testing' },
          ],
        },
      ],
      '/integrations/': [
        {
          text: 'Integrations',
          items: [{ text: 'Torznab API', link: '/integrations/torznab' }],
        },
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'API', link: '/reference/api' },
            { text: 'Environment Variables', link: '/reference/env' },
            { text: 'Prometheus Metrics', link: '/reference/metrics' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/Dim145/opentracker' },
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: '2026-present Trackarr (Dim145/opentracker fork)',
    },

    search: {
      provider: 'local',
    },

    outline: {
      level: [2, 3],
      label: 'On this page',
    },
  },
});
