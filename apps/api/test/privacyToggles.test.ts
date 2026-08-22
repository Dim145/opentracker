/**
 * The two decisions behind the account privacy toggles.
 *
 * Both are pure functions on purpose: who may comment and who may see an
 * uploader's name are the kind of rules that get quietly inverted by a later
 * edit, and a test that needs a database to catch that is a test nobody runs.
 */
import { describe, it, expect } from 'vitest';
import {
  canComment,
  COMMENT_MIN_ACCOUNT_AGE_DAYS,
} from '../utils/commentPolicy';
import { redactUploader } from '../utils/uploaderVisibility';

const NOW = new Date('2026-08-22T12:00:00Z');
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

const member = (createdAt: Date, id = 'author') => ({
  id,
  createdAt,
  isAdmin: false,
  isModerator: false,
});

describe('canComment', () => {
  const restricted = { id: 'uploader', restrictComments: true };
  const open = { id: 'uploader', restrictComments: false };

  it('lets anyone comment when the uploader has not asked for a restriction', () => {
    const brandNew = member(daysAgo(0));
    expect(canComment({ uploader: open, author: brandNew, now: NOW }).allowed).toBe(true);
  });

  it('turns away an account younger than the threshold', () => {
    const verdict = canComment({ uploader: restricted, author: member(daysAgo(3)), now: NOW });
    expect(verdict.allowed).toBe(false);
    // The wait is what the UI shows, so it has to be a usable number.
    expect(verdict.daysRemaining).toBe(COMMENT_MIN_ACCOUNT_AGE_DAYS - 3);
  });

  it('admits an account that has reached the threshold exactly', () => {
    // The boundary is the whole point of a fixed window: at exactly 30 days
    // the account is in, not one day short of it.
    const atBoundary = member(daysAgo(COMMENT_MIN_ACCOUNT_AGE_DAYS));
    expect(canComment({ uploader: restricted, author: atBoundary, now: NOW }).allowed).toBe(true);
  });

  it('never reports zero days left to an account that still cannot post', () => {
    // 29.5 days elapsed rounds to "1 more day"; reporting 0 would tell the
    // member to try again immediately and fail.
    const almost = member(new Date(NOW.getTime() - 29.5 * 24 * 60 * 60 * 1000));
    const verdict = canComment({ uploader: restricted, author: almost, now: NOW });
    expect(verdict.allowed).toBe(false);
    expect(verdict.daysRemaining).toBeGreaterThanOrEqual(1);
  });

  it('exempts staff, however new the account', () => {
    for (const role of [{ isAdmin: true, isModerator: false }, { isAdmin: false, isModerator: true }]) {
      const staff = { ...member(daysAgo(0)), ...role };
      expect(canComment({ uploader: restricted, author: staff, now: NOW }).allowed).toBe(true);
    }
  });

  it('never locks the uploader out of their own release', () => {
    const self = member(daysAgo(1), 'uploader');
    expect(canComment({ uploader: restricted, author: self, now: NOW }).allowed).toBe(true);
  });

  it('falls back to open when the release has no uploader left', () => {
    // An orphaned row has nobody to shield, and refusing every comment on it
    // would be a restriction nobody chose.
    expect(canComment({ uploader: null, author: member(daysAgo(0)), now: NOW }).allowed).toBe(true);
  });
});

describe('redactUploader', () => {
  const anon = { id: 'u1', username: 'ghost', anonymousUploads: true };
  const named = { id: 'u1', username: 'ghost', anonymousUploads: false };

  it('passes the uploader through when they have not asked to be hidden', () => {
    const out = redactUploader(named, { id: 'someone-else' });
    expect(out.uploader).toEqual(named);
    expect(out.uploaderId).toBe('u1');
    expect(out.uploaderAnonymous).toBe(false);
  });

  it('hides the name from another member', () => {
    const out = redactUploader(anon, { id: 'someone-else' });
    expect(out.uploader).toBeNull();
    expect(out.uploaderAnonymous).toBe(true);
  });

  it('blanks the id along with the name', () => {
    // The public profile endpoint turns an id straight back into a username,
    // so leaking the id would leave the anonymity one request deep.
    const out = redactUploader(anon, { id: 'someone-else' });
    expect(out.uploaderId).toBeNull();
  });

  it('still shows the uploader their own name', () => {
    const out = redactUploader(anon, { id: 'u1' });
    expect(out.uploader).toEqual(anon);
    expect(out.uploaderId).toBe('u1');
    expect(out.uploaderAnonymous).toBe(false);
  });

  it('exempts staff, so a release stays traceable to whoever posted it', () => {
    for (const viewer of [
      { id: 'mod', isModerator: true },
      { id: 'admin', isAdmin: true },
    ]) {
      const out = redactUploader(anon, viewer);
      expect(out.uploader).toEqual(anon);
      expect(out.uploaderId).toBe('u1');
    }
  });

  it('distinguishes a concealed uploader from a deleted one', () => {
    // Both yield `uploader: null`; only the flag tells the page whether to
    // say "Anonymous" or "account deleted".
    expect(redactUploader(null, { id: 'x' }).uploaderAnonymous).toBe(false);
    expect(redactUploader(anon, { id: 'x' }).uploaderAnonymous).toBe(true);
  });
});
