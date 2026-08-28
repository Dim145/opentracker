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
import {
  choosableFor,
  enabledThemes,
  getDefaultTheme,
  roleIdsFor,
} from '~~/utils/themes';

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
 * worth preserving on the one route every page load depends on. The single
 * exception is the member's role lookup, and it only happens on an instance that
 * has a role-gated theme; see the note on `themes` below.
 */
export default defineEventHandler(async (event) => {
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

  // Themes ride this payload for the same reason `federationEnabled` does: the
  // default layout already awaits it on every page, so the front end learns
  // which appearance to render without a second round trip. What is carried is
  // the LIST and the default, not the tokens — those come from
  // `/api/theme.css`, which is cacheable where this response is not.
  //
  // `themes` is what THIS visitor may choose, so a role-gated theme is filtered
  // out for everyone who does not hold the role. That makes this one field vary
  // by session on an otherwise session-independent payload, which was the reason
  // the filtering was first left to the client — until the session payload
  // turned out to carry no roles, so the client could not have done it. Doing
  // it here costs one query, and only when a role-gated theme actually exists:
  // the common case skips the lookup entirely.
  //
  // Nothing is hidden by this. Every enabled theme is in `/api/theme.css`
  // regardless — see `themes.visibility` — and the enforcement that matters is
  // on the write path in `PATCH /api/me`. This is about not offering a member a
  // theme the server will then refuse to store.
  const allThemes = await enabledThemes();
  const userId = (await getUserSession(event)).user?.id;
  const themeList = allThemes.some((t) => t.visibility === 'roles')
    ? choosableFor(allThemes, userId ? await roleIdsFor(userId) : [])
    : allThemes;
  const themeDefault = await getDefaultTheme();

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
    themeDefault,
    // No `visibility` / `requiredRoles`: the list is already filtered, and
    // publishing which role unlocks which theme is information the picker has
    // no use for.
    themes: themeList.map((t) => ({
      slug: t.slug,
      name: t.name,
      base: t.base,
    })),
  };
});
