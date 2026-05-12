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
