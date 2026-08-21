import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  MAX_ROUNDS,
  arraySource,
  fingerprint,
  opening,
  respond,
  type Range,
  type SetSource,
} from '../utils/federation/rbsr';

// Range-based set reconciliation.
//
// The thing being tested is convergence: two sides that share nothing at the
// start must end up agreeing on exactly which ids each is missing, in a
// bounded number of round trips, having said nothing false along the way.
//
// The dangerous failure is not "it crashes". It is "it stops early and both
// sides believe they agree" — a catalogue that is quietly short by a hundred
// records, with no error anywhere. So every test below drives the protocol to
// completion and then checks the answer against the sets it was given, rather
// than against what the protocol said about itself.

/** Drive a full conversation and report what the puller learned. */
async function reconcile(
  mine: SetSource,
  theirs: SetSource,
): Promise<{ missing: string[]; extra: string[]; rounds: number }> {
  const missing = new Set<string>();
  const extra = new Set<string>();
  let out = await opening(mine);
  let rounds = 0;

  while (out.length && rounds < MAX_ROUNDS) {
    rounds++;
    // The responder answers, learning nothing it needs to keep.
    const server = await respond(out, theirs, { echoIds: true });
    if (!server.reply.length) break;
    // The puller consumes, accumulating the difference.
    const client = await respond(server.reply, mine, { echoIds: false });
    for (const id of client.missing) missing.add(id);
    for (const id of client.extra) extra.add(id);
    out = client.reply;
  }

  return { missing: [...missing].sort(), extra: [...extra].sort(), rounds };
}

/** Deterministic ids that look like the real ones: `sha256:<hex>`. */
function ids(n: number, salt = ''): string[] {
  return Array.from({ length: n }, (_, i) => {
    const h = createHash('sha256').update(`${salt}:${i}`).digest('hex');
    return `sha256:${h}`;
  });
}

describe('the fingerprint', () => {
  it('is exactly the documented string, hashed', async () => {
    // Written out because the SQL implementation has to match it character
    // for character. A store that fingerprints its own way reconciles to a
    // confident wrong answer, which is the worst kind.
    const expected = createHash('sha256')
      .update('a\nb|2')
      .digest('hex')
      .slice(0, 32);
    expect(fingerprint(['a', 'b'])).toBe(expected);
  });

  it('separates the empty range from nothing at all', async () => {
    expect(fingerprint([])).toBe(
      createHash('sha256').update('|0').digest('hex').slice(0, 32),
    );
  });

  it('tells a set from the same set with a repeat', () => {
    expect(fingerprint(['a'])).not.toBe(fingerprint(['a', 'a']));
  });

  it('tells one long id from two short ones that concatenate to it', () => {
    // The separator earns its place here: without it `['ab']` and `['a','b']`
    // would hash the same input.
    expect(fingerprint(['ab'])).not.toBe(fingerprint(['a', 'b']));
  });
});

describe('convergence', () => {
  it('says nothing when the two sides already agree', async () => {
    const set = ids(500);
    const r = await reconcile(arraySource(set), arraySource(set));

    expect(r.missing).toEqual([]);
    expect(r.extra).toEqual([]);
    // The steady state is one exchange: a fingerprint out, a skip back. This
    // is what replaces the watermark, so it has to stay this cheap.
    expect(r.rounds).toBe(1);
  });

  it('finds the one record added on the other side', async () => {
    const base = ids(1000);
    const added = `sha256:${'f'.repeat(64)}`;
    const r = await reconcile(arraySource(base), arraySource([...base, added]));

    expect(r.missing).toEqual([added]);
    expect(r.extra).toEqual([]);
  });

  it('finds the one record removed on the other side', async () => {
    const base = ids(1000);
    const r = await reconcile(
      arraySource(base),
      arraySource(base.slice(0, -1)),
    );

    expect(r.missing).toEqual([]);
    // An absence IS the withdrawal. Nothing had to be sent to say so, which
    // is the property the tombstone channel existed to provide.
    expect(r.extra).toEqual([base[base.length - 1]]);
  });

  it('reconciles two sets that overlap only partly', async () => {
    const shared = ids(400, 'shared');
    const onlyMine = ids(60, 'mine');
    const onlyTheirs = ids(80, 'theirs');

    const r = await reconcile(
      arraySource([...shared, ...onlyMine]),
      arraySource([...shared, ...onlyTheirs]),
    );

    expect(r.missing).toEqual([...onlyTheirs].sort());
    expect(r.extra).toEqual([...onlyMine].sort());
  });

  it('starts from nothing and learns the whole catalogue', async () => {
    // A partner we have just started following. The empty side cannot name a
    // single bound, and still has to end up with all of it.
    const theirs = ids(2000, 'catalogue');
    const r = await reconcile(arraySource([]), arraySource(theirs));

    expect(r.missing.length).toBe(2000);
    expect(new Set(r.missing)).toEqual(new Set(theirs));
  });

  it('empties out when the other side has dropped everything', async () => {
    const mine = ids(700);
    const r = await reconcile(arraySource(mine), arraySource([]));

    expect(r.missing).toEqual([]);
    expect(r.extra.length).toBe(700);
  });

  it('stays logarithmic as the catalogue grows', async () => {
    // The claim that makes this worth building. A hundredfold more records
    // must not cost a hundredfold more round trips.
    const small = ids(200, 'g');
    const large = ids(20_000, 'g');
    const oneMore = `sha256:${'e'.repeat(64)}`;

    const a = await reconcile(arraySource(small), arraySource([...small, oneMore]));
    const b = await reconcile(arraySource(large), arraySource([...large, oneMore]));

    expect(a.missing).toEqual([oneMore]);
    expect(b.missing).toEqual([oneMore]);
    expect(b.rounds).toBeLessThanOrEqual(a.rounds + 2);
    expect(b.rounds).toBeLessThan(6);
  });

  it('converges on scattered differences, not just adjacent ones', async () => {
    const base = ids(5000, 'scatter');
    const mine = base.filter((_, i) => i % 7 !== 0);
    const theirs = base.filter((_, i) => i % 11 !== 0);

    const r = await reconcile(arraySource(mine), arraySource(theirs));

    const mineSet = new Set(mine);
    const theirsSet = new Set(theirs);
    expect(r.missing).toEqual(theirs.filter((id) => !mineSet.has(id)).sort());
    expect(r.extra).toEqual(mine.filter((id) => !theirsSet.has(id)).sort());
  });
});

describe('a partner is not to be trusted with our loop', () => {
  const source = arraySource(ids(100));

  it('ignores a message that is not a list', async () => {
    for (const bad of [null, undefined, 'ranges', 42, { lo: '' }]) {
      const r = await respond(bad, source, { echoIds: true });
      expect(r.reply).toEqual([]);
    }
  });

  it('drops a malformed range without losing the rest of the message', async () => {
    const good: Range = { lo: '', hi: null, mode: 'fp', fp: 'nope', n: 1 };
    const r = await respond(
      [
        null,
        { lo: 5, hi: null, mode: 'fp', fp: 'x', n: 1 },
        { lo: 'z', hi: 'a', mode: 'fp', fp: 'x', n: 1 }, // inverted
        { lo: '', hi: null, mode: 'wat' },
        good,
      ],
      source,
      { echoIds: true },
    );

    expect(r.reply).toHaveLength(1);
    expect(r.reply[0]!.lo).toBe('');
  });

  it('refuses an id list larger than it will ever answer with', async () => {
    const r = await respond(
      [{ lo: '', hi: null, mode: 'ids', ids: ids(5000) }],
      source,
      { echoIds: true },
    );
    expect(r.reply).toEqual([]);
  });

  it('caps how many ranges one message can make it answer', async () => {
    const many = Array.from({ length: 4000 }, (_, i) => ({
      lo: String(i).padStart(6, '0'),
      hi: null,
      mode: 'fp' as const,
      fp: 'nope',
      n: 1,
    }));
    const r = await respond(many, source, { echoIds: true });
    expect(r.reply.length).toBeLessThanOrEqual(512);
  });

  it('does not hand over a range too large to name, it narrows it', async () => {
    // The failure this guards: answering "here is all I have" with a
    // truncated list. The records past the cut would never be asked for
    // again, and both sides would believe they had finished.
    const big = arraySource(ids(4000, 'big'));
    const r = await respond(
      [{ lo: '', hi: null, mode: 'ids', ids: [] }],
      big,
      { echoIds: true },
    );

    expect(r.reply.every((x) => x.mode === 'fp')).toBe(true);
    expect(r.reply.length).toBeGreaterThan(1);
  });

  it('terminates against a partner that keeps disagreeing', async () => {
    // A peer answering every fingerprint with a different one must cost us a
    // bounded number of rounds, not an endless conversation.
    const liar: SetSource = {
      async summary() {
        return { fp: 'always-different', n: 1_000_000 };
      },
      async ids() {
        return [];
      },
      async buckets(lo, hi) {
        return [{ lo, hi, fp: 'still-different', n: 1_000_000 }];
      },
    };
    const r = await reconcile(arraySource(ids(1000)), liar);
    expect(r.rounds).toBeLessThanOrEqual(MAX_ROUNDS);
  });
});

describe('what the initiator may act on', () => {
  it('never reports an extra it only inferred from a fingerprint', async () => {
    // `extra` drives deletion from the mirror, so it must only ever come from
    // an interval whose contents were seen in full. A reconciliation that
    // fails halfway then costs nothing worse than a partial pass.
    const mine = arraySource(ids(3000, 'x'));
    const theirs = arraySource(ids(3000, 'y'));
    const first = await respond(await opening(mine), theirs, { echoIds: true });
    const step = await respond(first.reply, mine, { echoIds: false });

    // Round one over sets this different can only have exchanged
    // fingerprints, so nothing is confirmed yet.
    expect(first.reply.every((r) => r.mode === 'fp')).toBe(true);
    expect(step.extra).toEqual([]);
    expect(step.missing).toEqual([]);
  });
});
