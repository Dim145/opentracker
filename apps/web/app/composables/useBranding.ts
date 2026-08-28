/**
 * Shared accessor for site branding (`/api/branding`).
 *
 * Multiple surfaces fetch the same payload — the default layout
 * for the navbar + favicon + title template, the homepage hero,
 * the auth/login + auth/register pages — and the request was
 * being duplicated across components. `useState` gives every
 * caller a single shared ref per SSR request, so the first
 * `useBranding()` lazily fires `useFetch` and the rest reuse the
 * cached result.
 */
export interface BrandingPayload {
  siteName: string;
  siteLogo: string;
  siteLogoImage: string | null;
  siteFavicon: string | null;
  siteSubtitle: string | null;
  siteNameColor: string | null;
  siteNameBold: boolean | undefined;
  authTitle: string | null;
  authSubtitle: string | null;
  footerText: string | null;
  pageTitleSuffix: string | null;
  /** Gates the federation nav items. False when federation was never set up. */
  federationEnabled: boolean;
  /**
   * The theme every anonymous visitor and every new member starts on.
   *
   * `'system'`, a built-in, or a slug. Carried here rather than fetched
   * separately for the same reason `federationEnabled` is: the layout already
   * awaits this payload on every page.
   */
  themeDefault: string;
  /**
   * Every enabled theme, including role-gated ones.
   *
   * The picker filters those out per member. They are listed here because this
   * payload must NOT vary by session — it is the one response every page waits
   * for, and making it session-dependent would turn a shared answer into a
   * per-viewer one. The tokens are not here either: they come from
   * `/api/theme.css`, which is cacheable where this is not.
   */
  // Already filtered to what this visitor may choose: a role-gated theme is
  // dropped server-side, because the session payload carries no roles for the
  // client to check against.
  themes: Array<{ slug: string; name: string; base: 'light' | 'dark' }>;
}

export async function useBranding() {
  const cached = useState<BrandingPayload | null>('branding', () => null);
  // Already populated on a prior call this request — return it.
  if (cached.value) return cached;

  // `useFetch` with a stable `key` lets Nuxt dedupe parallel
  // callers (e.g. SSR rendering of /auth/login that mounts both
  // the default layout and the page). The first caller pays the
  // fetch, the rest receive the shared promise.
  const { data } = await useFetch<BrandingPayload>('/api/branding', {
    key: 'branding',
  });
  if (data.value) cached.value = data.value;
  return cached;
}
