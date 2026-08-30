import { describe, expect, it } from 'vitest';
import {
  signMessagingToken,
  verifyMessagingToken,
} from '../utils/messaging/token';

// The relay's bearer, from the minting side.
//
// The other half of this test is `apps/relay/internal/token/token_test.go`,
// which pins the same string. Two languages producing one format is exactly
// the kind of thing that drifts silently — a reordered field, a base64
// alphabet with padding — and the failure mode is a 401 nobody can explain.
// Pinning the bytes turns that into a red test on the side that moved.

const SECRET = '0123456789abcdef0123456789abcdef';
const GOLDEN =
  'eyJ1aWQiOiJ1LTEiLCJleHAiOjE3MDAwMDAwNjB9.Gg9HRcJiJgSkA0u9UxTMvTcRlqxf8nPflZL_bvBE0Bw';

describe('the messaging token', () => {
  it('produces the bytes the Go relay expects', () => {
    expect(signMessagingToken({ uid: 'u-1', exp: 1_700_000_060 }, SECRET)).toBe(
      GOLDEN
    );
  });

  it('round-trips', () => {
    const raw = signMessagingToken({ uid: 'u-1', exp: 1_700_000_060 }, SECRET);
    expect(verifyMessagingToken(raw, SECRET, 1_700_000_000)?.uid).toBe('u-1');
  });

  it('refuses another key', () => {
    expect(
      verifyMessagingToken(GOLDEN, 'f'.repeat(32), 1_700_000_000)
    ).toBeNull();
  });

  it('refuses an expired token, at the exact second it dies', () => {
    expect(verifyMessagingToken(GOLDEN, SECRET, 1_700_000_059)).not.toBeNull();
    expect(verifyMessagingToken(GOLDEN, SECRET, 1_700_000_060)).toBeNull();
  });

  it('refuses a payload swapped under a valid signature', () => {
    // The whole trust boundary is that the signature came from the API.
    const mine = signMessagingToken({ uid: 'u-1', exp: 1_700_000_060 }, SECRET);
    const theirs = signMessagingToken({ uid: 'u-2', exp: 1_700_000_060 }, SECRET);
    const forged = `${theirs.split('.')[0]}.${mine.split('.')[1]}`;
    expect(verifyMessagingToken(forged, SECRET, 1_700_000_000)).toBeNull();
  });

  it('refuses malformed input rather than throwing', () => {
    for (const bad of ['', '.', 'nodot', 'a.b', `${GOLDEN}extra`]) {
      expect(verifyMessagingToken(bad, SECRET, 1_700_000_000)).toBeNull();
    }
  });
});
