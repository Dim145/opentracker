import { describe, expect, it } from 'vitest';
import { paletteAccessFor } from '../app/utils/paletteAccess';

// The access matrix behind the ⌘K palette, stated as a table.
//
// These were verified once against four real sessions on a seeded stack —
// owner+admin saw 36 entries, a moderator 15 with no admin page, a plain member
// 14 with no member lookup, and signed out the panel refused both entry points.
// That proved it correct on the day. This is what keeps it correct: the gating
// used to live in four computeds inside the component, where nothing failed if
// one of them lost its condition.
//
// None of this is the security boundary — /api/torrents derives visibility from
// the session rather than any query parameter, and /api/admin/users sits behind
// requireModeratorSession; both were confirmed to answer 403 and 401 directly.
// This decides what the palette OFFERS, which is a different failure: a menu
// that lists a door you cannot open still tells you the door is there.

const OWNER = { isAdmin: true, isModerator: false, isOwner: true };
const ADMIN = { isAdmin: true, isModerator: false, isOwner: false };
const MODERATOR = { isAdmin: false, isModerator: true, isOwner: false };
const MEMBER = { isAdmin: false, isModerator: false, isOwner: false };

describe('paletteAccessFor', () => {
  it('refuses everything when signed out', () => {
    const access = paletteAccessFor(null);
    expect(access.available).toBe(false);
    // Not one flag may be true, whatever else changes here later.
    expect(Object.values(access).every((v) => v === false)).toBe(true);
  });

  it('refuses everything mid-2FA-enrolment, whatever the role', () => {
    // auth.global.ts confines these sessions to /settings and bounces the rest.
    for (const role of [OWNER, ADMIN, MODERATOR, MEMBER]) {
      const access = paletteAccessFor({ ...role, requires2FASetup: true });
      expect(Object.values(access).every((v) => v === false)).toBe(true);
    }
  });

  it('gives a plain member no staff surface at all', () => {
    const access = paletteAccessFor(MEMBER);
    expect(access).toEqual({
      available: true,
      admin: false,
      moderation: false,
      memberSearch: false,
      owner: false,
      account: true,
      torrentSearch: true,
    });
  });

  it('gives a moderator moderation but never administration', () => {
    const access = paletteAccessFor(MODERATOR);
    expect(access.moderation).toBe(true);
    // The member lookup matches requireModeratorSession on the endpoint.
    expect(access.memberSearch).toBe(true);
    expect(access.admin).toBe(false);
    expect(access.owner).toBe(false);
  });

  it('gives an admin administration but never the owner surface', () => {
    const access = paletteAccessFor(ADMIN);
    expect(access.admin).toBe(true);
    expect(access.moderation).toBe(true);
    expect(access.owner).toBe(false);
  });

  it('gives the owner everything', () => {
    const access = paletteAccessFor(OWNER);
    expect(Object.values(access).every((v) => v === true)).toBe(true);
  });

  it('never grants a role more than the role above it', () => {
    // Monotonicity: whatever a member may see, a moderator may; whatever a
    // moderator may, an admin may; and so on to the owner. A future flag that
    // breaks the ladder shows up here rather than in production.
    const ladder = [MEMBER, MODERATOR, ADMIN, OWNER].map(paletteAccessFor);
    const keys = Object.keys(ladder[0]!) as Array<keyof (typeof ladder)[0]>;
    for (let i = 1; i < ladder.length; i++) {
      for (const key of keys) {
        if (ladder[i - 1]![key]) {
          expect(ladder[i]![key], `${key} regressed at rung ${i}`).toBe(true);
        }
      }
    }
  });
});
