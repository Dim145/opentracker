/**
 * GET /api/manifest.webmanifest — this instance, as an installable app.
 *
 * ## Why a route and not a file in `public/`
 *
 * The same reason `/api/theme.css` is a route. Everything a manifest says
 * about a site — its name, its colours, its icon — is operator-configurable
 * here, and a static JSON would hard-code one instance's branding into every
 * instance's bundle. An operator who renamed their tracker would still be
 * installed as "Trackarr", in Trackarr's colours.
 *
 * It also has to work in both shapes `apps/web` ships in: SSR, and the static
 * SPA served by nginx with no server at all. A `<link rel="manifest">` in
 * `app.head` points at this URL in both, and only the API needs to know the
 * branding.
 *
 * A manifest's `scope` is resolved against the manifest's own URL but is not
 * confined to its directory — unlike a service worker's. So a manifest served
 * from `/api/` can and does claim `/`.
 *
 * ## Icons, and the number that has to be true
 *
 * `sizes` is a claim, and browsers act on the claim rather than on the file:
 * Chrome offers to install a site only when the manifest declares an icon of
 * at least 512×512. Declaring that over a 64-pixel logo buys an install
 * prompt and a blurry home-screen icon, which is worse than no prompt — so the
 * value comes from the bytes, measured by the upload route
 * (`utils/imageSniff.manifestIconSizes`) and stored beside the URL.
 *
 * `any` means we could not measure it: an SVG (no intrinsic size), a format we
 * do not walk, or an image uploaded before the measurement existed. Firefox
 * and iOS install from `any`; Chrome does not. Re-uploading the logo is what
 * fixes it, and the operator guide says so.
 *
 * With no uploaded branding at all the only icon is the shipped `favicon.ico`
 * at 32×32, which is enough to install on iOS and not enough for Chrome. We do
 * not ship a 512-pixel default to paper over that: an invented icon that says
 * "Trackarr" on somebody else's tracker is not an improvement.
 *
 * ## Caching
 *
 * Branding is settings-cached, so a hit costs no query. `max-age=60` matches
 * that cache's TTL — the same envelope `/api/theme.css` advertises — and the
 * ETag folds in every field the document contains, so a rename revalidates
 * within the minute instead of waiting out a longer TTL.
 */
import { createHash } from 'node:crypto';
import {
  getSiteName,
  getSiteSubtitle,
  getSiteLogoImage,
  getSiteLogoImageSizes,
  getSiteFavicon,
  getSiteFaviconSizes,
} from '~~/utils/server';
import { enabledThemes, getDefaultTheme } from '~~/utils/themes';
import { resolveTokens } from '@trackarr/shared/theme';

/**
 * `"12 34 56"` → `"#0c2238"`.
 *
 * Theme tokens are stored as space-separated RGB triplets, the convention the
 * stylesheet uses so a value can be dropped into `rgb(… / <alpha>)`. A
 * manifest wants a CSS colour, and hex is the form every browser has parsed
 * for twenty years — `rgb(12 34 56)` is valid CSS Color 4 and not worth
 * betting a theme colour on.
 */
function tripletToHex(triplet: string | undefined): string | null {
  if (!triplet) return null;
  const parts = triplet.trim().split(/[\s,]+/);
  if (parts.length !== 3) return null;
  const bytes = parts.map((p) => Number.parseInt(p, 10));
  if (bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) return null;
  return `#${bytes.map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

interface ManifestIcon {
  src: string;
  sizes: string;
  type?: string;
  purpose?: string;
}

/** Extension → MIME, for the four formats the branding uploads accept. */
const ICON_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
};

function iconType(src: string): string | undefined {
  const ext = src.split('?')[0]!.split('.').pop()?.toLowerCase();
  return ext ? ICON_TYPES[ext] : undefined;
}

export default defineEventHandler(async (event) => {
  const [siteName, subtitle, logo, logoSizes, favicon, faviconSizes, themeSlug] =
    await Promise.all([
      getSiteName(),
      getSiteSubtitle(),
      getSiteLogoImage(),
      getSiteLogoImageSizes(),
      getSiteFavicon(),
      getSiteFaviconSizes(),
      getDefaultTheme(),
    ]);

  /**
   * The site default's own tokens drive the two colours. Not the visitor's
   * theme: the manifest is fetched once at install time and the values are
   * baked into the OS launcher, so a per-session answer would just mean
   * whoever installed it picked the colour for everyone.
   *
   * An instance with no rows in `themes` is the common case, not an edge one —
   * operator-authored themes are opt-in, and `getDefaultTheme()` then returns
   * the built-in slug (`dark`, or `light`). Resolving that against the built-in
   * token set is what `/api/theme.css` already does for the same situation, so
   * both surfaces agree instead of this one falling back to black.
   */
  const themes = await enabledThemes();
  const theme = themes.find((t) => t.slug === themeSlug);
  const tokens = theme
    ? resolveTokens(theme.base, theme.tokens)
    : resolveTokens(themeSlug === 'light' ? 'light' : 'dark', null);
  const themeColor = tripletToHex(tokens.accent) ?? '#000000';
  const backgroundColor = tripletToHex(tokens['bg-base']) ?? '#000000';

  // Most specific first — a browser picking one icon walks the list and the
  // logo is the larger, more deliberate image. `favicon.ico` closes it out so
  // the array is never empty, which would make the manifest unusable rather
  // than merely imperfect.
  const icons: ManifestIcon[] = [];
  if (logo) icons.push({ src: logo, sizes: logoSizes, type: iconType(logo) });
  if (favicon) {
    icons.push({ src: favicon, sizes: faviconSizes, type: iconType(favicon) });
  }
  icons.push({ src: '/favicon.ico', sizes: '32x32', type: 'image/x-icon' });

  const manifest = {
    // `id` pins the app's identity across renames. Without it the identity is
    // `start_url`, and an operator moving the site would strand every
    // installed copy as a second, separate app.
    id: '/',
    name: siteName,
    // Launchers truncate around 12 characters; the site name is what the
    // operator chose to be called, so it is used as-is rather than cut here.
    short_name: siteName,
    description: subtitle || undefined,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    theme_color: themeColor,
    background_color: backgroundColor,
    icons,
    // Deep links the launcher can offer on a long-press. Kept to the three
    // surfaces a member opens without thinking; anything gated on a role would
    // show a shortcut to a 403.
    shortcuts: [
      { name: 'Browse', url: '/torrents' },
      { name: 'Upload', url: '/torrents/upload' },
      { name: 'Notifications', url: '/notifications' },
    ],
  };

  const body = JSON.stringify(manifest);
  // Over the document, not over a version counter: branding has no counter to
  // read, and hashing what we are about to send cannot drift from it.
  const etag = `W/"manifest-${createHash('sha256').update(body).digest('hex').slice(0, 16)}"`;

  // The registered media type. Nitro would infer `application/json` from the
  // body, which browsers accept — but the spec'd type is what a validator and
  // a strict fetch check look for.
  setHeader(event, 'Content-Type', 'application/manifest+json; charset=utf-8');
  setHeader(event, 'Cache-Control', 'public, max-age=60, must-revalidate');
  setHeader(event, 'ETag', etag);
  setHeader(event, 'Vary', 'Accept-Encoding');

  if (getHeader(event, 'if-none-match') === etag) {
    setResponseStatus(event, 304);
    return null;
  }

  return body;
});
