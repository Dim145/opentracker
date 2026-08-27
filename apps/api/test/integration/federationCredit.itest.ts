import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { makeUser } from './helpers';
import { generateInstanceKeypair } from '../../utils/federation/keys';
import { didKeyFromPublicKey } from '../../utils/federation/did';
import { CONTEXT, signRecord } from '../../utils/federation/record';
import {
  applyContributionAttestation,
  projectContributionAttestation,
  CONTRIBUTION_TYPE,
} from '../../utils/federation/credit';
import { ensureFederationIdentity } from '../../utils/federation/config';
import { setSetting, SETTINGS_KEYS } from '../../utils/settings';

interface PeerCtx {
  id: string;
  kp: ReturnType<typeof generateInstanceKeypair>;
  did: string;
}

const HOUR = 60 * 60 * 1000;

/** Our own instanceId — every attestation has to be addressed to it. */
let audience: string;

async function peerWithKey(): Promise<PeerCtx> {
  const kp = generateInstanceKeypair();
  const id = randomUUID();
  await db.insert(schema.federationPeers).values({
    id,
    baseUrl: `https://p-${id.slice(0, 8)}.example`,
    instanceId: kp.instanceId,
    publicKey: kp.publicKeyPem,
    status: 'active',
    sharesWithThem: { catalog: false, social: false, accounts: true, swarm: false },
    acceptsFromThem: { catalog: false, social: false, accounts: true, swarm: false },
  });
  return { id, kp, did: didKeyFromPublicKey(kp.publicKeyPem) };
}

/** A member with a live signing key. No relationship to any peer. */
async function memberWithDid(
  did: string,
  over: Parameters<typeof makeUser>[0] = {},
): Promise<string> {
  const uid = await makeUser(over);
  await db.insert(schema.userSigningKeys).values({ did, userId: uid, publicKey: 'PK' });
  return uid;
}

/** …and the proven account on that peer, which is what makes them creditable. */
async function linkTo(peer: PeerCtx, uid: string, subjectDid: string) {
  await db.insert(schema.federatedIdentities).values({
    id: randomUUID(),
    localUserId: uid,
    peerId: peer.id,
    remoteUsername: `remote_${uid.slice(0, 6)}`,
    status: 'verified',
    method: 'key',
    subjectDid,
    verifiedAt: new Date(),
  });
}

/** A member of ours with a proven account on `peer` — the creditable case. */
async function creditableMember(peer: PeerCtx): Promise<{ uid: string; did: string }> {
  const did = `did:key:z${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const uid = await memberWithDid(did);
  await linkTo(peer, uid, did);
  return { uid, did };
}

/** A settlement window ending `endedHoursAgo` ago and `spanMs` long. */
function period(endedHoursAgo = 1, spanMs = HOUR) {
  const periodEnd = new Date(Date.now() - endedHoursAgo * HOUR);
  return { periodStart: new Date(periodEnd.getTime() - spanMs), periodEnd };
}

function attestation(
  kp: ReturnType<typeof generateInstanceKeypair>,
  issuerDid: string,
  subjectDid: string,
  bytes: number,
  over: {
    periodStart?: Date;
    periodEnd?: Date;
    audienceInstanceId?: string;
  } = {},
) {
  const rec = projectContributionAttestation({
    subjectDid,
    bytes,
    issuerDid,
    reason: 'cross-seed',
    audienceInstanceId: over.audienceInstanceId ?? audience,
    ...period(),
    ...over,
  });
  return signRecord(rec, { privateKeyPem: kp.privateKeyPem, did: issuerDid });
}

async function bonus(uid: string): Promise<number> {
  const [u] = await db
    .select({ b: schema.users.bonusUploaded })
    .from(schema.users)
    .where(eq(schema.users.id, uid));
  return u!.b;
}

describe('inter-instance credit model', () => {
  beforeEach(async () => {
    const config = await ensureFederationIdentity();
    audience = config.instanceId!;
    await setSetting(SETTINGS_KEYS.FEDERATION_CREDIT_ENABLED, 'true');
    await setSetting(
      SETTINGS_KEYS.FEDERATION_CREDIT_DAILY_CAP_BYTES,
      String(50 * 1024 ** 3),
    );
    await setSetting(SETTINGS_KEYS.FEDERATION_CREDIT_PEER_DAILY_CAP_BYTES, '0');
    await setSetting(
      SETTINGS_KEYS.FEDERATION_CREDIT_INSTANCE_DAILY_CAP_BYTES,
      '0',
    );
  });

  it('credits bonus upload once and dedups a replay', async () => {
    const peer = await peerWithKey();
    const { uid, did } = await creditableMember(peer);
    const signed = attestation(peer.kp, peer.did, did, 1_000_000);
    const asPeer = { id: peer.id, publicKey: peer.kp.publicKeyPem };

    const r1 = await applyContributionAttestation({ record: signed, peer: asPeer });
    expect(r1.applied).toBe(true);
    expect(r1.bytes).toBe(1_000_000);
    expect(await bonus(uid)).toBe(1_000_000);

    const r2 = await applyContributionAttestation({ record: signed, peer: asPeer });
    expect(r2.applied).toBe(false);
    expect(r2.reason).toBe('duplicate');
    expect(await bonus(uid)).toBe(1_000_000); // not doubled
  });

  it('clamps to the daily cap', async () => {
    await setSetting(SETTINGS_KEYS.FEDERATION_CREDIT_DAILY_CAP_BYTES, '1000');
    const peer = await peerWithKey();
    const { uid, did } = await creditableMember(peer);
    const signed = attestation(peer.kp, peer.did, did, 5000);

    const r = await applyContributionAttestation({
      record: signed,
      peer: { id: peer.id, publicKey: peer.kp.publicKeyPem },
    });
    expect(r.bytes).toBe(1000);
    expect(await bonus(uid)).toBe(1000);
  });

  it('rejects an attestation not signed by the sending peer', async () => {
    const peer = await peerWithKey();
    const other = generateInstanceKeypair();
    const otherDid = didKeyFromPublicKey(other.publicKeyPem);
    const { did } = await creditableMember(peer);
    const signed = attestation(other, otherDid, did, 1000);

    const r = await applyContributionAttestation({
      record: signed,
      peer: { id: peer.id, publicKey: peer.kp.publicKeyPem },
    });
    expect(r.applied).toBe(false);
    expect(r.reason).toBe('issuer is not the sending peer');
  });

  it('skips a subject that is not a local member', async () => {
    const peer = await peerWithKey();
    const signed = attestation(peer.kp, peer.did, 'did:key:zNobody', 1000);
    const r = await applyContributionAttestation({
      record: signed,
      peer: { id: peer.id, publicKey: peer.kp.publicKeyPem },
    });
    expect(r.applied).toBe(false);
    expect(r.reason).toBe('subject not a creditable local member');
  });

  it('does nothing when crediting is disabled', async () => {
    await setSetting(SETTINGS_KEYS.FEDERATION_CREDIT_ENABLED, 'false');
    const peer = await peerWithKey();
    const { uid, did } = await creditableMember(peer);
    const signed = attestation(peer.kp, peer.did, did, 1000);

    const r = await applyContributionAttestation({
      record: signed,
      peer: { id: peer.id, publicKey: peer.kp.publicKeyPem },
    });
    expect(r.applied).toBe(false);
    expect(r.reason).toBe('disabled');
    expect(await bonus(uid)).toBe(0);
  });

  describe('the peer may only credit members it actually has', () => {
    it('refuses a member with no proven identity on the sending peer', async () => {
      // The hole that made one accounts-accepted partner able to mint for the
      // whole instance. Member DIDs are published in our own catalogue records,
      // so a partner harvests the list from the mirror it already syncs, then
      // names every member up to the per-member cap.
      const peer = await peerWithKey();
      const did = `did:key:z${randomUUID().replace(/-/g, '').slice(0, 20)}`;
      const uid = await memberWithDid(did); // no link
      const signed = attestation(peer.kp, peer.did, did, 1_000_000);

      const r = await applyContributionAttestation({
        record: signed,
        peer: { id: peer.id, publicKey: peer.kp.publicKeyPem },
      });
      expect(r.applied).toBe(false);
      expect(r.reason).toBe(
        'no proven identity for this member on the sending peer',
      );
      expect(await bonus(uid)).toBe(0);
    });

    it('refuses a link that is still pending verification', async () => {
      const peer = await peerWithKey();
      const did = `did:key:z${randomUUID().replace(/-/g, '').slice(0, 20)}`;
      const uid = await memberWithDid(did);
      await db.insert(schema.federatedIdentities).values({
        id: randomUUID(),
        localUserId: uid,
        peerId: peer.id,
        remoteUsername: 'claimed_but_unproven',
        status: 'pending',
        method: 'key',
        subjectDid: did,
      });
      const signed = attestation(peer.kp, peer.did, did, 1_000_000);

      const r = await applyContributionAttestation({
        record: signed,
        peer: { id: peer.id, publicKey: peer.kp.publicKeyPem },
      });
      expect(r.applied).toBe(false);
      expect(await bonus(uid)).toBe(0);
    });

    it('refuses a link proven on a DIFFERENT peer', async () => {
      // Two partners, one member with an account on the first only. The second
      // must not be able to borrow the first one's relationship.
      const known = await peerWithKey();
      const stranger = await peerWithKey();
      const { uid, did } = await creditableMember(known);
      const signed = attestation(stranger.kp, stranger.did, did, 1_000_000);

      const r = await applyContributionAttestation({
        record: signed,
        peer: { id: stranger.id, publicKey: stranger.kp.publicKeyPem },
      });
      expect(r.applied).toBe(false);
      expect(await bonus(uid)).toBe(0);
    });
  });

  describe('ban and erasure', () => {
    it('does not credit a banned member', async () => {
      // Bonus upload accrued behind a ban is ratio waiting to materialise on
      // unban. The minting side already refuses to publish a banned member's
      // work (`PUBLISHABLE`); this is the same rule on the way in.
      const peer = await peerWithKey();
      const did = `did:key:z${randomUUID().replace(/-/g, '').slice(0, 20)}`;
      const uid = await memberWithDid(did, { isBanned: true });
      await linkTo(peer, uid, did);
      const signed = attestation(peer.kp, peer.did, did, 1_000_000);

      const r = await applyContributionAttestation({
        record: signed,
        peer: { id: peer.id, publicKey: peer.kp.publicKeyPem },
      });
      expect(r.applied).toBe(false);
      expect(r.reason).toBe('subject not a creditable local member');
      expect(await bonus(uid)).toBe(0);
    });

    it('does not credit an erased account', async () => {
      const peer = await peerWithKey();
      const did = `did:key:z${randomUUID().replace(/-/g, '').slice(0, 20)}`;
      const uid = await memberWithDid(did, { deletedAt: new Date() });
      await linkTo(peer, uid, did);
      const signed = attestation(peer.kp, peer.did, did, 1_000_000);

      const r = await applyContributionAttestation({
        record: signed,
        peer: { id: peer.id, publicKey: peer.kp.publicKeyPem },
      });
      expect(r.applied).toBe(false);
      expect(await bonus(uid)).toBe(0);
    });
  });

  describe('the attestation is addressed to one instance', () => {
    it('refuses one addressed elsewhere', async () => {
      // A member may hold the same key on two instances — that is what portable
      // identity means. Without an audience the same signed attestation credits
      // the same bytes on both, and neither can tell.
      const peer = await peerWithKey();
      const { uid, did } = await creditableMember(peer);
      const signed = attestation(peer.kp, peer.did, did, 1_000_000, {
        audienceInstanceId: randomUUID(),
      });

      const r = await applyContributionAttestation({
        record: signed,
        peer: { id: peer.id, publicKey: peer.kp.publicKeyPem },
      });
      expect(r.applied).toBe(false);
      expect(r.reason).toBe('attestation is not addressed to this instance');
      expect(await bonus(uid)).toBe(0);
    });

    it('refuses a validly signed attestation carrying no audience', async () => {
      // The pre-audience document shape, signed properly so the content address
      // and the proof both check out. It still credits nothing: the binding is
      // required, not preferred. Safe to require outright because nothing has
      // ever issued one — `issueContributions` has no caller yet.
      const peer = await peerWithKey();
      const { uid, did } = await creditableMember(peer);
      const { periodStart, periodEnd } = period();
      const signed = signRecord(
        {
          '@context': CONTEXT,
          type: CONTRIBUTION_TYPE,
          'trackarr:subject': did,
          'trackarr:bytes': 1000,
          'trackarr:reason': 'cross-seed',
          'trackarr:periodStart': periodStart.toISOString(),
          'trackarr:periodEnd': periodEnd.toISOString(),
          published: periodEnd.toISOString(),
          'trackarr:issuer': peer.did,
          'trackarr:replaces': null,
        } as never,
        { privateKeyPem: peer.kp.privateKeyPem, did: peer.did },
      );

      const r = await applyContributionAttestation({
        record: signed,
        peer: { id: peer.id, publicKey: peer.kp.publicKeyPem },
      });
      expect(r.applied).toBe(false);
      expect(r.reason).toBe('attestation is not addressed to this instance');
      expect(await bonus(uid)).toBe(0);
    });
  });

  describe('the settlement window', () => {
    it('clamps a claim to what the window could physically carry', async () => {
      // 80 MiB/s, the same rate the announce anti-cheat clamps a delta to. A
      // one-second window claiming 200 MiB is not a fast peer, it is a wrong
      // number — and before this, 5 TiB over one second was honoured.
      const peer = await peerWithKey();
      const { uid, did } = await creditableMember(peer);
      const end = new Date(Date.now() - HOUR);
      const signed = attestation(peer.kp, peer.did, did, 200 * 1024 ** 2, {
        periodStart: new Date(end.getTime() - 1000),
        periodEnd: end,
      });

      const r = await applyContributionAttestation({
        record: signed,
        peer: { id: peer.id, publicKey: peer.kp.publicKeyPem },
      });
      expect(r.applied).toBe(true);
      expect(r.bytes).toBe(80 * 1024 ** 2);
      expect(await bonus(uid)).toBe(80 * 1024 ** 2);
    });

    it('refuses a window that ends in the future', async () => {
      const peer = await peerWithKey();
      const { did } = await creditableMember(peer);
      const end = new Date(Date.now() + 24 * HOUR);
      const signed = attestation(peer.kp, peer.did, did, 1000, {
        periodStart: new Date(end.getTime() - HOUR),
        periodEnd: end,
      });

      const r = await applyContributionAttestation({
        record: signed,
        peer: { id: peer.id, publicKey: peer.kp.publicKeyPem },
      });
      expect(r.reason).toBe('period ends in the future');
    });

    it('refuses a window nobody could still be settling', async () => {
      const peer = await peerWithKey();
      const { did } = await creditableMember(peer);
      const end = new Date(Date.now() - 200 * 24 * HOUR);
      const signed = attestation(peer.kp, peer.did, did, 1000, {
        periodStart: new Date(end.getTime() - HOUR),
        periodEnd: end,
      });

      const r = await applyContributionAttestation({
        record: signed,
        peer: { id: peer.id, publicKey: peer.kp.publicKeyPem },
      });
      expect(r.reason).toBe('period too old');
    });

    it('refuses a window that does not advance', async () => {
      const peer = await peerWithKey();
      const { did } = await creditableMember(peer);
      const at = new Date(Date.now() - HOUR);
      const signed = attestation(peer.kp, peer.did, did, 1000, {
        periodStart: at,
        periodEnd: at,
      });

      const r = await applyContributionAttestation({
        record: signed,
        peer: { id: peer.id, publicKey: peer.kp.publicKeyPem },
      });
      expect(r.reason).toBe('period does not advance');
    });

    it('refuses a window overlapping one already settled', async () => {
      // The replay content-address dedup could not see: the same real transfer,
      // re-issued with `periodEnd` moved a millisecond, addresses to a new id
      // and so was a new row and a second credit.
      const peer = await peerWithKey();
      const { uid, did } = await creditableMember(peer);
      const asPeer = { id: peer.id, publicKey: peer.kp.publicKeyPem };
      const end = new Date(Date.now() - HOUR);
      const start = new Date(end.getTime() - HOUR);

      const first = attestation(peer.kp, peer.did, did, 1_000_000, {
        periodStart: start,
        periodEnd: end,
      });
      expect((await applyContributionAttestation({ record: first, peer: asPeer })).applied)
        .toBe(true);

      const nudged = attestation(peer.kp, peer.did, did, 1_000_000, {
        periodStart: start,
        periodEnd: new Date(end.getTime() + 1),
      });
      expect(nudged.id).not.toBe(first.id); // a genuinely different record…
      const r = await applyContributionAttestation({ record: nudged, peer: asPeer });
      expect(r.applied).toBe(false); // …that credits nothing
      expect(r.reason).toBe('period overlaps one already settled');
      expect(await bonus(uid)).toBe(1_000_000);
    });

    it('accepts the next window, starting where the last ended', async () => {
      // The bound must not stop an honest settlement stream.
      const peer = await peerWithKey();
      const { uid, did } = await creditableMember(peer);
      const asPeer = { id: peer.id, publicKey: peer.kp.publicKeyPem };
      const mid = new Date(Date.now() - 2 * HOUR);

      await applyContributionAttestation({
        record: attestation(peer.kp, peer.did, did, 1_000_000, {
          periodStart: new Date(mid.getTime() - HOUR),
          periodEnd: mid,
        }),
        peer: asPeer,
      });
      const r = await applyContributionAttestation({
        record: attestation(peer.kp, peer.did, did, 2_000_000, {
          periodStart: mid,
          periodEnd: new Date(mid.getTime() + HOUR),
        }),
        peer: asPeer,
      });

      expect(r.applied).toBe(true);
      expect(await bonus(uid)).toBe(3_000_000);
    });

    it('keeps one peer’s high-water mark out of another’s way', async () => {
      // The mark is per (peer, member): two partners settle the same member
      // independently, and neither may block the other.
      const a = await peerWithKey();
      const b = await peerWithKey();
      const did = `did:key:z${randomUUID().replace(/-/g, '').slice(0, 20)}`;
      const uid = await memberWithDid(did);
      await linkTo(a, uid, did);
      await linkTo(b, uid, did);
      const end = new Date(Date.now() - HOUR);
      const start = new Date(end.getTime() - HOUR);

      for (const p of [a, b]) {
        const r = await applyContributionAttestation({
          record: attestation(p.kp, p.did, did, 1_000_000, {
            periodStart: start,
            periodEnd: end,
          }),
          peer: { id: p.id, publicKey: p.kp.publicKeyPem },
        });
        expect(r.applied).toBe(true);
      }
      expect(await bonus(uid)).toBe(2_000_000);
    });
  });

  describe('the ceilings above the per-member one', () => {
    it('bounds what one partner can mint across all members', async () => {
      // The lever for trusting partner A more than partner B. The per-member cap
      // alone gives a partner a reach of "cap x every member it can name".
      await setSetting(
        SETTINGS_KEYS.FEDERATION_CREDIT_PEER_DAILY_CAP_BYTES,
        '1500',
      );
      const peer = await peerWithKey();
      const one = await creditableMember(peer);
      const two = await creditableMember(peer);
      const asPeer = { id: peer.id, publicKey: peer.kp.publicKeyPem };

      const r1 = await applyContributionAttestation({
        record: attestation(peer.kp, peer.did, one.did, 1000),
        peer: asPeer,
      });
      const r2 = await applyContributionAttestation({
        record: attestation(peer.kp, peer.did, two.did, 1000),
        peer: asPeer,
      });

      expect(r1.bytes).toBe(1000);
      expect(r2.bytes).toBe(500); // 1500 - 1000
      expect(await bonus(two.uid)).toBe(500);
    });

    it('leaves another partner its own budget', async () => {
      await setSetting(
        SETTINGS_KEYS.FEDERATION_CREDIT_PEER_DAILY_CAP_BYTES,
        '1000',
      );
      const a = await peerWithKey();
      const b = await peerWithKey();
      const ma = await creditableMember(a);
      const mb = await creditableMember(b);

      await applyContributionAttestation({
        record: attestation(a.kp, a.did, ma.did, 1000),
        peer: { id: a.id, publicKey: a.kp.publicKeyPem },
      });
      const r = await applyContributionAttestation({
        record: attestation(b.kp, b.did, mb.did, 1000),
        peer: { id: b.id, publicKey: b.kp.publicKeyPem },
      });

      expect(r.bytes).toBe(1000);
    });

    it('bounds total daily minting across the whole mesh', async () => {
      await setSetting(
        SETTINGS_KEYS.FEDERATION_CREDIT_INSTANCE_DAILY_CAP_BYTES,
        '1200',
      );
      const a = await peerWithKey();
      const b = await peerWithKey();
      const ma = await creditableMember(a);
      const mb = await creditableMember(b);

      const r1 = await applyContributionAttestation({
        record: attestation(a.kp, a.did, ma.did, 1000),
        peer: { id: a.id, publicKey: a.kp.publicKeyPem },
      });
      const r2 = await applyContributionAttestation({
        record: attestation(b.kp, b.did, mb.did, 1000),
        peer: { id: b.id, publicKey: b.kp.publicKeyPem },
      });

      expect(r1.bytes).toBe(1000);
      expect(r2.bytes).toBe(200); // 1200 - 1000, a different member and peer
    });
  });
});
