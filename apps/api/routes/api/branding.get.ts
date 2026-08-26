import {
  getSiteName,
  getSiteLogo,
  getSiteLogoImage,
  getSiteFavicon,
  getSiteSubtitle,
  getSiteNameColor,
  isSiteNameBold,
  getAuthTitle,
  getAuthSubtitle,
  getFooterText,
  getPageTitleSuffix,
} from '~~/utils/server';
import { isFederationEnabledCosmetic } from '~~/utils/federation/config';

/**
 * GET /api/branding
 * Public endpoint for site branding (no auth required).
 *
 * Also carries `federationEnabled`, which is not branding. It is here rather
 * than behind its own endpoint because the default layout already awaits this
 * payload on every page, so gating a nav item on it costs no extra round trip.
 *
 * Every field here reads from a cache, so the endpoint costs no query in the
 * steady state and keeps answering through a brief database hiccup — which is
 * worth preserving on the one route every page load depends on.
 */
export default defineEventHandler(async () => {
  const siteName = await getSiteName();
  const siteLogo = await getSiteLogo();
  const siteLogoImage = await getSiteLogoImage();
  const siteFavicon = await getSiteFavicon();
  const siteSubtitle = await getSiteSubtitle();
  const siteNameColor = await getSiteNameColor();
  const siteNameBold = await isSiteNameBold();
  const authTitle = await getAuthTitle();
  const authSubtitle = await getAuthSubtitle();
  const footerText = await getFooterText();
  const pageTitleSuffix = await getPageTitleSuffix();
  const federationEnabled = await isFederationEnabledCosmetic();

  return {
    siteName,
    siteLogo,
    siteLogoImage,
    siteFavicon,
    siteSubtitle,
    siteNameColor,
    siteNameBold,
    authTitle,
    authSubtitle,
    footerText,
    pageTitleSuffix,
    // False when federation was never configured, which is the same answer as
    // configured-and-off for anything the browser does with it.
    federationEnabled,
  };
});
