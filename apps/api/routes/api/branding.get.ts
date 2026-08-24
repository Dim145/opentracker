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
import { getFederationConfig } from '~~/utils/federation/config';

/**
 * GET /api/branding
 * Public endpoint for site branding (no auth required).
 *
 * Also carries `federationEnabled`, which is not branding. It is here rather
 * than behind its own endpoint because the default layout already awaits this
 * payload on every page, so gating a nav item on it costs no extra round trip.
 *
 * Note the asymmetry: everything above reads through the settings cache and so
 * costs no query in the steady state, while getFederationConfig() is an
 * uncached single-row lookup on a singleton — the same uncached read its twenty
 * other call sites use. Cheap, but it is the one query on this endpoint, which
 * is where to look first if it ever shows up in a profile.
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
  const federation = await getFederationConfig();

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
    // Null when federation was never configured, which is the same answer as
    // configured-and-off for anything the browser does with it.
    federationEnabled: federation?.enabled ?? false,
  };
});
