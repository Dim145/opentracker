/**
 * Who may see what in the ⌘K palette.
 *
 * The palette mixes menus, actions and live data in one list, so "what is this
 * session allowed to be shown" is the single decision the whole feature turns
 * on. It lives here, pure and exhaustively tested, rather than as four
 * computeds inside the component: the component was verified against four real
 * sessions once, and nothing but a test keeps it that way.
 *
 * None of this is a security boundary. Every endpoint behind these flags
 * enforces the same rule server-side — `/api/torrents` derives visibility from
 * the session rather than from any query parameter, and `/api/admin/users`
 * sits behind `requireModeratorSession`. What this decides is what the palette
 * *offers*: a menu that lists a door you cannot open is its own kind of leak.
 */

export interface PaletteViewer {
  isAdmin?: boolean;
  isModerator?: boolean;
  isOwner?: boolean;
  /**
   * Set by `/api/auth/status` when the operator's 2FA enforcement covers this
   * account and nothing is enrolled yet. `auth.global.ts` confines such a
   * member to `/settings` and bounces every other route.
   */
  requires2FASetup?: boolean;
}

export interface PaletteAccess {
  /** Whether the palette may open at all. */
  available: boolean;
  /** The `/admin` link and every admin destination. */
  admin: boolean;
  /** The `/mod` link. */
  moderation: boolean;
  /** The member lookup, which calls a moderator-gated endpoint. */
  memberSearch: boolean;
  /** Owner-only destinations, should any ever exist. */
  owner: boolean;
  /** The account pages, which only mean anything with a session. */
  account: boolean;
  /** The catalogue lookup — visibility itself is decided server-side. */
  torrentSearch: boolean;
}

const CLOSED: PaletteAccess = {
  available: false,
  admin: false,
  moderation: false,
  memberSearch: false,
  owner: false,
  account: false,
  torrentSearch: false,
};

/**
 * `viewer` is null when signed out. Every route but the two auth pages sits
 * behind `auth.global.ts`, and both set `layout: false`, so this component is
 * not even mounted for an anonymous visitor today — but that is a rendering
 * accident, and this returns a closed set so a layout change cannot turn it
 * into a searchable map of the site.
 */
export function paletteAccessFor(viewer: PaletteViewer | null): PaletteAccess {
  if (!viewer) return CLOSED;
  // Mid-enrolment, the only route that resolves is /settings. Offering the
  // rest would advertise a map this member cannot walk.
  if (viewer.requires2FASetup) return CLOSED;

  const admin = !!viewer.isAdmin;
  const staff = admin || !!viewer.isModerator;

  return {
    available: true,
    admin,
    moderation: staff,
    // Matches `requireModeratorSession` on /api/admin/users exactly, so the
    // palette never promises a lookup the API would refuse.
    memberSearch: staff,
    owner: !!viewer.isOwner,
    account: true,
    torrentSearch: true,
  };
}
