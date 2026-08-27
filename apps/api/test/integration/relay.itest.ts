import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { didKeyFromPublicKey } from '../../utils/federation/did';
import { CONTEXT, signRecord, verifyRecord } from '../../utils/federation/record';
import {
  admit,
  blockedIssuers,
  countersign,
  relayStatement,
  countersigner,
  forgetPeerData,
  keepForRelay,
  purgeOrphanedIngested,
  sourceRecord,
  trustedIssuers,
} from '../../utils/federation/relay';
import { publishedSet } from '../../utils/federation/recordSet';
import { MIN_BOUND } from '../../utils/federation/rbsr';
import { ensureFederationIdentity } from '../../utils/federation/config';

// Carrying somebody else's records.
//
// The property that makes relaying safe is that a relay has no power worth
// abusing: every record proves itself, so a relay can omit or delay and never
// forge or alter. What it CAN do is introduce — and that is the part with
// teeth, because an instance that took in every record that verified would be
// an open index rather than a curated catalogue.
//
// So the tests are about the introduction. Who may make one, what it is worth,
// and how far a record is allowed to travel on the strength of it.

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  return {
    publicKeyPem,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    did: didKeyFromPublicKey(publicKeyPem),
  };
}

let counter = 0;

/** A record signed by whoever is given as its issuer. */
function record(issuer: ReturnType<typeof keypair>) {
  return signRecord(
    {
      '@context': CONTEXT,
      type: 'Torrent',
      'bt:infohash_v1': (counter++).toString(16).padStart(40, 'e'),
      'bt:magnet': null,
      url: 'https://origin.example/torrents/abc',
      name: `Release.${counter}.1080p`,
      content: null,
      published: '2026-05-01T00:00:00.000Z',
      attributedTo: null,
      'trackarr:size': 1000,
      'trackarr:contentSignature': null,
      'trackarr:category': null,
      'trackarr:categoryType': null,
      'trackarr:isAdult': false,
      'trackarr:tags': [],
      'trackarr:imdbId': null,
      'trackarr:tmdbId': null,
      'trackarr:tvdbId': null,
      'trackarr:igdbId': null,
      'trackarr:openlibraryId': null,
      'trackarr:season': null,
      'trackarr:episode': null,
      'trackarr:uploaderName': 'Somebody',
      'trackarr:issuer': issuer.did,
      'trackarr:replaces': null,
    } as never,
    { privateKeyPem: issuer.privateKeyPem, did: issuer.did },
  );
}

async function makePeer(keys: { publicKeyPem: string }, name = 'Partner') {
  const id = randomUUID();
  await db.insert(schema.federationPeers).values({
    id,
    baseUrl: `https://p-${id.slice(0, 8)}.example`,
    instanceId: `tk_${id.slice(0, 12)}`,
    publicKey: keys.publicKeyPem,
    displayName: name,
    status: 'active',
    sharesWithThem: { catalog: true, social: false, accounts: false, swarm: false },
    acceptsFromThem: { catalog: true, social: false, accounts: false, swarm: false },
  });
  return id;
}

beforeEach(async () => {
  counter = 0;
  await ensureFederationIdentity();
});

describe('who we will take a record from', () => {
  it('takes one from a partner, first hand', async () => {
    const partner = keypair();
    await makePeer(partner);

    const r = record(partner);
    const pass = admit(partner.did, r.id, null, await trustedIssuers());

    expect(pass.ok).toBe(true);
    expect(pass.hops).toBe(1);
  });

  it('refuses a stranger, however good the signature', async () => {
    // The one that matters. A valid proof from somebody we do not federate
    // with is a valid proof from somebody we do not federate with, and an
    // instance that could not tell the difference would be an open index.
    const stranger = keypair();
    const r = record(stranger);

    const pass = admit(stranger.did, r.id, null, await trustedIssuers());

    expect(pass.ok).toBe(false);
    expect(pass.reason).toMatch(/not a partner/i);
  });

  it('takes a stranger\'s record when a partner puts its name to it', async () => {
    const partner = keypair();
    const origin = keypair();
    await makePeer(partner);

    const r = record(origin);
    const vouch = countersign(r.id, partner.did, partner.privateKeyPem);
    const pass = admit(origin.did, r.id, vouch, await trustedIssuers());

    expect(pass.ok).toBe(true);
    expect(pass.hops).toBe(2);
    expect(pass.via).toBe(partner.did);
  });

  it('refuses a vouching from somebody we do not federate with either', async () => {
    const stranger = keypair();
    const origin = keypair();

    const r = record(origin);
    const vouch = countersign(r.id, stranger.did, stranger.privateKeyPem);

    expect(admit(origin.did, r.id, vouch, await trustedIssuers()).ok).toBe(false);
  });

  it('gains nothing from a stranger vouching for themselves', async () => {
    // The obvious way round the rule: sign the record, sign an introduction
    // for it, be your own referee. It fails for the same reason the bare
    // record does — the voucher has to be a partner, and this one is not.
    // Worth pinning, because it is the shape somebody will try.
    const stranger = keypair();
    const r = record(stranger);
    const vouch = countersign(r.id, stranger.did, stranger.privateKeyPem);

    const pass = admit(stranger.did, r.id, vouch, await trustedIssuers());
    expect(pass.ok).toBe(false);
  });

  it('refuses a vouching lifted from another record', async () => {
    // The countersignature is checked against the id WE computed, so one made
    // for a different record does not travel with a substituted body.
    const partner = keypair();
    await makePeer(partner);
    const origin = keypair();

    const a = record(origin);
    const b = record(origin);
    const vouchForA = countersign(a.id, partner.did, partner.privateKeyPem);

    expect(countersigner(b.id, vouchForA)).toBeNull();
    expect(admit(origin.did, b.id, vouchForA, await trustedIssuers()).ok).toBe(false);
  });

  it('stops trusting a partner the moment it is suspended', async () => {
    const partner = keypair();
    const peerId = await makePeer(partner);
    expect((await trustedIssuers()).has(partner.did)).toBe(true);

    await db
      .update(schema.federationPeers)
      .set({ status: 'suspended' })
      .where(eq(schema.federationPeers.id, peerId));

    expect((await trustedIssuers()).has(partner.did)).toBe(false);
  });

  it('refuses a blocked instance\u2019s record however it arrives', async () => {
    // The hole a block did not close. Removing X from `trustedIssuers` stops
    // the front door; any still-active partner B that took X's records
    // first-hand countersigns them and they came in at two hops, under B's
    // `peer_id`, with X's DID in `issuer`. `forgetPeerData` purged rows keyed
    // on X's own `peer_id` and never saw those. An operator blocking X over
    // content they must not host watched it return, every tick, forever.
    const partner = keypair();
    const blockedPeer = keypair();
    await makePeer(partner);
    const blockedId = await makePeer(blockedPeer);
    await db
      .update(schema.federationPeers)
      .set({ status: 'blocked' })
      .where(eq(schema.federationPeers.id, blockedId));

    const r = record(blockedPeer);
    const vouch = countersign(r.id, partner.did, partner.privateKeyPem);
    const blocked = await blockedIssuers();
    expect(blocked.has(blockedPeer.did)).toBe(true);

    const pass = admit(blockedPeer.did, r.id, vouch, await trustedIssuers(), {
      blocked,
    });
    expect(pass.ok).toBe(false);
    expect(pass.reason).toMatch(/blocked/i);
  });

  it('keeps a suspended partner out of the blocked set', async () => {
    // Suspension is documented as a reversible pause that keeps everything. It
    // already removes the peer from `trustedIssuers`; it is not a judgement
    // about the content, so it does not reach through a relay.
    const partner = keypair();
    const peerId = await makePeer(partner);
    await db
      .update(schema.federationPeers)
      .set({ status: 'suspended' })
      .where(eq(schema.federationPeers.id, peerId));

    expect((await blockedIssuers()).has(partner.did)).toBe(false);
  });

  it('refuses a vouching that has gone stale', async () => {
    // A countersignature carried no time bound and `checkProof` never reads
    // `created`, so one was good forever — and one that is good forever is one
    // whoever collected it can keep passing around. Our own side mints a fresh
    // one on every serve, so the window costs nothing.
    const partner = keypair();
    await makePeer(partner);
    const origin = keypair();
    const r = record(origin);

    const fresh = countersign(r.id, partner.did, partner.privateKeyPem);
    expect(countersigner(r.id, fresh)).toBe(partner.did);

    for (const created of [
      new Date(Date.now() - 40 * 60 * 60 * 1000), // most of two days old
      new Date(Date.now() + 60 * 60 * 1000), // an hour ahead
    ]) {
      // Re-signed at that date rather than edited: `created` is inside the
      // signature (the proof covers its own config), so an edited one would be
      // rejected for the wrong reason and prove nothing.
      const dated = countersign(r.id, partner.did, partner.privateKeyPem, {
        created,
      });
      expect(countersigner(r.id, dated)).toBeNull();
      expect(admit(origin.did, r.id, dated, await trustedIssuers()).ok).toBe(false);
    }
  });

  describe('a vouching names the instance it was made for', () => {
    const OURS = 'our-instance-id';
    const THEIRS = 'somebody-elses-instance-id';

    it('accepts one bound to us', async () => {
      const partner = keypair();
      await makePeer(partner);
      const origin = keypair();
      const r = record(origin);
      const bound = countersign(r.id, partner.did, partner.privateKeyPem, {
        audience: OURS,
      });

      const pass = admit(origin.did, r.id, null, await trustedIssuers(), {
        boundProof: bound,
        audienceInstanceId: OURS,
      });
      expect(pass.ok).toBe(true);
      expect(pass.hops).toBe(2);
      expect(pass.via).toBe(partner.did);
      expect(pass.audienceBound).toBe(true);
    });

    it('refuses one bound to somebody else — the transfer this closes', async () => {
      // The residue the freshness bound could not reach. B vouches to C; C
      // forwards `{record, B's proof}` to us, and we also trust B — so the
      // record used to be admitted at two hops as though B had handed it to us.
      // A bound proof is a statement about one recipient, so C has nothing to
      // forward.
      const partner = keypair();
      await makePeer(partner);
      const origin = keypair();
      const r = record(origin);
      const boundElsewhere = countersign(
        r.id,
        partner.did,
        partner.privateKeyPem,
        { audience: THEIRS },
      );

      expect(countersigner(r.id, boundElsewhere, OURS)).toBeNull();
      const pass = admit(origin.did, r.id, null, await trustedIssuers(), {
        boundProof: boundElsewhere,
        audienceInstanceId: OURS,
      });
      expect(pass.ok).toBe(false);
    });

    it('does not read the audience out of the proof it is checking', async () => {
      // A proof that names its own audience proves nothing about who it was
      // for. The statement is rebuilt with OUR id, so the only proof that
      // verifies is one made for us.
      const partner = keypair();
      await makePeer(partner);
      const origin = keypair();
      const r = record(origin);
      const boundElsewhere = countersign(
        r.id,
        partner.did,
        partner.privateKeyPem,
        { audience: THEIRS },
      );

      expect(countersigner(r.id, boundElsewhere, THEIRS)).toBe(partner.did);
      expect(countersigner(r.id, boundElsewhere, OURS)).toBeNull();
    });

    it('still takes the bare form, so an older partner keeps working', async () => {
      // The reason the binding is a SECOND proof. Emitting it in place of the
      // first would have stopped relaying toward every partner that rebuilds
      // the statement without it — silently, since a refused record is sourced
      // as rejected and never asked for again.
      const partner = keypair();
      await makePeer(partner);
      const origin = keypair();
      const r = record(origin);
      const bare = countersign(r.id, partner.did, partner.privateKeyPem);

      const pass = admit(origin.did, r.id, bare, await trustedIssuers(), {
        audienceInstanceId: OURS,
      });
      expect(pass.ok).toBe(true);
      expect(pass.audienceBound).toBe(false);
    });

    it('prefers the bound proof when both are present', async () => {
      const partner = keypair();
      const other = keypair();
      await makePeer(partner);
      await makePeer(other, 'Other');
      const origin = keypair();
      const r = record(origin);

      const pass = admit(
        origin.did,
        r.id,
        countersign(r.id, other.did, other.privateKeyPem),
        await trustedIssuers(),
        {
          boundProof: countersign(r.id, partner.did, partner.privateKeyPem, {
            audience: OURS,
          }),
          audienceInstanceId: OURS,
        },
      );
      expect(pass.via).toBe(partner.did);
      expect(pass.audienceBound).toBe(true);
    });

    it('the bare statement is byte-identical to what it always was', async () => {
      // The compatibility guarantee, pinned. If `relayStatement` ever starts
      // emitting the key with a null value instead of omitting it, every
      // existing partner's verification of the bare proof breaks at once.
      expect(relayStatement('sha256:abc', 'did:key:zRelay')).toEqual({
        type: 'Announce',
        object: 'sha256:abc',
        'trackarr:issuer': 'did:key:zRelay',
      });
      expect(
        'trackarr:audience' in relayStatement('sha256:abc', 'did:key:zRelay'),
      ).toBe(false);
    });
  });

  it('never throws on a malformed vouching', async () => {
    const origin = keypair();
    const r = record(origin);
    for (const bad of [null, undefined, 42, 'proof', {}, { verificationMethod: 7 }]) {
      expect(countersigner(r.id, bad)).toBeNull();
      expect(admit(origin.did, r.id, bad, new Set()).ok).toBe(false);
    }
  });
});

describe('what we will hand on', () => {
  async function served(relaying: boolean): Promise<string[]> {
    return publishedSet(relaying).ids(MIN_BOUND, null, 100);
  }

  it('keeps a record we took in, as the bytes that were signed', async () => {
    // Reconstructing one from the mirror row would be a second implementation
    // of the format, and it would eventually disagree with the proof.
    const origin = keypair();
    const r = record(origin);

    await keepForRelay(r as unknown as Record<string, unknown>, origin.did, 1);

    const [stored] = await db
      .select()
      .from(schema.catalogRecords)
      .where(eq(schema.catalogRecords.id, r.id));
    expect(stored!.origin).toBe('ingested');
    expect(stored!.hops).toBe(1);
    expect(stored!.issuer).toBe(origin.did);
    // Not a string comparison: `jsonb` does not keep key order, and it does
    // not need to — canonicalisation sorts before hashing, which is the whole
    // reason a record can survive a database round trip at all. What has to
    // hold is that it still verifies.
    expect(verifyRecord(stored!.body).ok).toBe(true);
    expect((stored!.body as Record<string, unknown>).id).toBe(r.id);
  });

  it('offers nothing of anybody else\'s while relaying is off', async () => {
    const origin = keypair();
    await keepForRelay(record(origin) as unknown as Record<string, unknown>, origin.did, 1);

    expect(await served(false)).toHaveLength(0);
  });

  it('offers what it took first-hand once relaying is on', async () => {
    const origin = keypair();
    const r = record(origin);
    await keepForRelay(r as unknown as Record<string, unknown>, origin.did, 1);

    expect(await served(true)).toEqual([r.id]);
  });

  it('never hands on what was already relayed to it', async () => {
    // Where the two-hop bound is actually enforced. A record that reached us
    // through somebody else stops here — otherwise the introduction chain has
    // no end, and "two hops" is a sentence in a document rather than a rule.
    const origin = keypair();
    const first = record(origin);
    const second = record(origin);
    await keepForRelay(first as unknown as Record<string, unknown>, origin.did, 1);
    await keepForRelay(second as unknown as Record<string, unknown>, origin.did, 2);

    expect(await served(true)).toEqual([first.id]);
  });

  it('stops offering a generation its issuer has replaced', async () => {
    const origin = keypair();
    const first = record(origin);
    await keepForRelay(first as unknown as Record<string, unknown>, origin.did, 1);

    const successor = signRecord(
      {
        ...(JSON.parse(JSON.stringify(first)) as Record<string, unknown>),
        proof: undefined,
        id: undefined,
        name: 'Renamed.1080p',
        'trackarr:replaces': first.id,
      } as never,
      { privateKeyPem: origin.privateKeyPem, did: origin.did },
    );
    await keepForRelay(successor as unknown as Record<string, unknown>, origin.did, 1);

    expect(await served(true)).toEqual([successor.id]);
    const [old] = await db
      .select()
      .from(schema.catalogRecords)
      .where(eq(schema.catalogRecords.id, first.id));
    expect(old!.supersededAt).toBeTruthy();
  });

  it('is idempotent — the same record twice is one row', async () => {
    const origin = keypair();
    const r = record(origin);
    const body = r as unknown as Record<string, unknown>;
    await keepForRelay(body, origin.did, 1);
    await keepForRelay(body, origin.did, 1);

    expect(await db.select().from(schema.catalogRecords)).toHaveLength(1);
  });
});

describe('the store stays ours to sweep', () => {
  it('never lets a withdrawal sweep reach somebody else\'s records', async () => {
    // The sharpest edge in this step. An ingested record has no local torrent
    // behind it — which, from inside the tombstone sweep, is exactly what a
    // deleted release looks like. Without the origin filter this instance
    // would publish tombstones for every partner's catalogue.
    const origin = keypair();
    const r = record(origin);
    await keepForRelay(r as unknown as Record<string, unknown>, origin.did, 1);

    const sweepable = await db
      .select({ id: schema.catalogRecords.id })
      .from(schema.catalogRecords)
      .leftJoin(
        schema.torrents,
        eq(schema.torrents.id, schema.catalogRecords.torrentId),
      )
      .where(
        and(
          isNull(schema.catalogRecords.supersededAt),
          eq(schema.catalogRecords.kind, 'torrent'),
          eq(schema.catalogRecords.origin, 'local'),
          isNull(schema.torrents.id),
        ),
      );

    expect(sweepable).toHaveLength(0);
  });
});

describe('a relayed record cannot retire another issuer\'s work', () => {
  // The sharpest hole the review found: `keepForRelay` set `superseded_at` on
  // whatever id a peer named in `trackarr:replaces`, with no issuer check, and
  // `catalog_records.id` is a global content address — our own local records
  // share the table. One partner (relaying on) could permanently un-publish
  // any record it could name. The fix scopes the supersede to the same issuer.

  it('leaves our own local record published when a stranger names it in replaces', async () => {
    const us = keypair();
    const stranger = keypair();

    // A record we minted and published ourselves.
    const mine = record(us);
    await db.insert(schema.catalogRecords).values({
      id: mine.id,
      torrentId: randomUUID(),
      infoHash: mine['bt:infohash_v1'],
      issuer: us.did,
      kind: 'torrent',
      body: mine as unknown as Record<string, unknown>,
      contentHash: mine.id,
      origin: 'local',
    });

    // The stranger mints a valid record claiming to replace ours.
    const attack = signRecord(
      {
        ...(JSON.parse(JSON.stringify(record(stranger))) as Record<string, unknown>),
        proof: undefined,
        id: undefined,
        'trackarr:replaces': mine.id,
      } as never,
      { privateKeyPem: stranger.privateKeyPem, did: stranger.did },
    );
    await keepForRelay(attack as unknown as Record<string, unknown>, stranger.did, 1);

    const [row] = await db
      .select()
      .from(schema.catalogRecords)
      .where(eq(schema.catalogRecords.id, mine.id));
    expect(row!.supersededAt).toBeNull();
  });

  it('still lets an issuer retire its own earlier generation', async () => {
    // The scope must not break legitimate edits: a record signed by X retiring
    // an earlier record also signed by X.
    const origin = keypair();
    const first = record(origin);
    await keepForRelay(first as unknown as Record<string, unknown>, origin.did, 1);

    const second = signRecord(
      {
        ...(JSON.parse(JSON.stringify(first)) as Record<string, unknown>),
        proof: undefined,
        id: undefined,
        name: 'Renamed.1080p',
        'trackarr:replaces': first.id,
      } as never,
      { privateKeyPem: origin.privateKeyPem, did: origin.did },
    );
    await keepForRelay(second as unknown as Record<string, unknown>, origin.did, 1);

    const [old] = await db
      .select()
      .from(schema.catalogRecords)
      .where(eq(schema.catalogRecords.id, first.id));
    expect(old!.supersededAt).toBeTruthy();
  });
});

describe('tearing a link down actually forgets what it left behind', () => {
  // `catalog_records` has no FK to the peer, so a plain peer delete used to
  // leave its ingested records behind — held and relayed onward forever. The
  // purge is the missing half of cutting a link.

  it('sweeps an ingested record no source references any more', async () => {
    const origin = keypair();
    const peerId = await makePeer(keypair());
    const r = record(origin);
    // Held for relay, sourced from the peer.
    await keepForRelay(r as unknown as Record<string, unknown>, origin.did, 1);
    await sourceRecord(r as unknown as Record<string, unknown>, origin.did, 1, peerId, true);
    // Simulate the peer delete's cascade dropping its sources.
    await db.delete(schema.recordSources).where(eq(schema.recordSources.peerId, peerId));

    const swept = await purgeOrphanedIngested();
    expect(swept).toBeGreaterThanOrEqual(1);
    const [gone] = await db
      .select()
      .from(schema.catalogRecords)
      .where(eq(schema.catalogRecords.id, r.id));
    expect(gone).toBeUndefined();
  });

  it('never sweeps our own local records', async () => {
    const me = keypair();
    const mine = record(me);
    await db.insert(schema.catalogRecords).values({
      id: mine.id,
      torrentId: randomUUID(),
      infoHash: mine['bt:infohash_v1'],
      issuer: me.did,
      kind: 'torrent',
      body: mine as unknown as Record<string, unknown>,
      contentHash: mine.id,
      origin: 'local',
    });
    await purgeOrphanedIngested();
    const [still] = await db
      .select()
      .from(schema.catalogRecords)
      .where(eq(schema.catalogRecords.id, mine.id));
    expect(still).toBeTruthy();
  });

  it('forgets a blocked peer\'s mirror, sources and key', async () => {
    const origin = keypair();
    const peerId = await makePeer(keypair());
    const r = record(origin);
    await keepForRelay(r as unknown as Record<string, unknown>, origin.did, 1);
    await sourceRecord(r as unknown as Record<string, unknown>, origin.did, 1, peerId, true);

    await forgetPeerData(peerId, { forgetKey: true });

    expect(await db.select().from(schema.recordSources).where(eq(schema.recordSources.peerId, peerId))).toHaveLength(0);
    expect(await db.select().from(schema.remoteTorrents).where(eq(schema.remoteTorrents.peerId, peerId))).toHaveLength(0);
    const [peer] = await db
      .select({ publicKey: schema.federationPeers.publicKey })
      .from(schema.federationPeers)
      .where(eq(schema.federationPeers.id, peerId));
    expect(peer!.publicKey).toBeNull();
    // And the ingested record it left is gone with it.
    const [gone] = await db
      .select()
      .from(schema.catalogRecords)
      .where(eq(schema.catalogRecords.id, r.id));
    expect(gone).toBeUndefined();
  });

  describe('who introduced a record, and what cutting them means', () => {
    it('records the voucher, so the introduction is not anonymous', async () => {
      // `admit` computed `via` and threw it away. A column nobody writes is a
      // lever nobody has: with the introduction unrecorded there was no way to
      // find, mask or purge what one partner had vouched for.
      const relayPeer = keypair();
      const origin = keypair();
      const peerId = await makePeer(relayPeer);
      const r = record(origin);

      await sourceRecord(
        r as unknown as Record<string, unknown>,
        origin.did,
        2,
        peerId,
        true,
        db,
        relayPeer.did,
      );

      const [stored] = await db
        .select()
        .from(schema.catalogRecords)
        .where(eq(schema.catalogRecords.id, r.id));
      expect(stored!.via).toBe(relayPeer.did);
      expect(stored!.issuer).toBe(origin.did); // still whoever signed it
      expect(stored!.hops).toBe(2);
    });

    it('leaves `via` null on a record taken first-hand', async () => {
      const origin = keypair();
      const peerId = await makePeer(origin);
      const r = record(origin);
      await sourceRecord(
        r as unknown as Record<string, unknown>,
        origin.did,
        1,
        peerId,
        true,
      );

      const [stored] = await db
        .select()
        .from(schema.catalogRecords)
        .where(eq(schema.catalogRecords.id, r.id));
      expect(stored!.via).toBeNull();
    });

    it('cutting the voucher takes down what it introduced, under any peer id', async () => {
      // The gap `via` exists to close. A record B vouched for arrives under the
      // RELAY's `peer_id` with B's DID only in `via`, so every delete keyed on
      // `peer_id` or on `issuer` walked past it — and the re-fetch loop
      // restored it on the next tick.
      const voucher = keypair();
      const carrier = keypair();
      const origin = keypair();
      const voucherId = await makePeer(voucher, 'Voucher');
      const carrierId = await makePeer(carrier, 'Carrier');
      const r = record(origin);

      // Delivered by the carrier, on the voucher's introduction.
      await sourceRecord(
        r as unknown as Record<string, unknown>,
        origin.did,
        2,
        carrierId,
        true,
        db,
        voucher.did,
      );
      await db.insert(schema.remoteTorrents).values({
        id: randomUUID(),
        peerId: carrierId,
        remoteId: r.id,
        recordId: r.id,
        issuer: origin.did,
        infoHash: r['bt:infohash_v1'],
        name: 'Introduced.By.The.Voucher',
        size: 1000,
        remoteDetailUrl: 'https://origin.example/t/1',
        remoteCreatedAt: new Date(),
      });

      await forgetPeerData(voucherId, { forgetKey: true });

      // Gone: the record, its source row and the mirror row — none of which
      // were keyed on the peer being cut.
      expect(
        await db
          .select()
          .from(schema.catalogRecords)
          .where(eq(schema.catalogRecords.id, r.id)),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(schema.remoteTorrents)
          .where(eq(schema.remoteTorrents.recordId, r.id)),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(schema.recordSources)
          .where(eq(schema.recordSources.recordId, r.id)),
      ).toHaveLength(0);
    });

    it('does not touch what another partner introduced', async () => {
      const cut = keypair();
      const kept = keypair();
      const carrier = keypair();
      const origin = keypair();
      const cutId = await makePeer(cut, 'Cut');
      await makePeer(kept, 'Kept');
      const carrierId = await makePeer(carrier, 'Carrier');
      const mine = record(origin);

      await sourceRecord(
        mine as unknown as Record<string, unknown>,
        origin.did,
        2,
        carrierId,
        true,
        db,
        kept.did,
      );

      await forgetPeerData(cutId, { forgetKey: true });

      const [still] = await db
        .select()
        .from(schema.catalogRecords)
        .where(eq(schema.catalogRecords.id, mine.id));
      expect(still).toBeTruthy();
      expect(still!.via).toBe(kept.did);
    });
  });
});
