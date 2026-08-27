import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { makeUser } from './helpers';
import { generateInstanceKeypair } from '../../utils/federation/keys';
import { didKeyFromPublicKey } from '../../utils/federation/did';
import { signRecord } from '../../utils/federation/record';
import {
  applyContributionAttestation,
  projectContributionAttestation,
} from '../../utils/federation/credit';
import { setSetting, SETTINGS_KEYS } from '../../utils/settings';

interface PeerCtx {
  id: string;
  kp: ReturnType<typeof generateInstanceKeypair>;
  did: string;
}

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

async function memberWithDid(did: string): Promise<string> {
  const uid = await makeUser();
  await db.insert(schema.userSigningKeys).values({ did, userId: uid, publicKey: 'PK' });
  return uid;
}

function attestation(
  kp: ReturnType<typeof generateInstanceKeypair>,
  issuerDid: string,
  subjectDid: string,
  bytes: number,
) {
  const rec = projectContributionAttestation({
    subjectDid,
    bytes,
    reason: 'cross-seed',
    periodStart: new Date('2026-01-01T00:00:00Z'),
    periodEnd: new Date('2026-01-02T00:00:00Z'),
    issuerDid,
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
    await setSetting(SETTINGS_KEYS.FEDERATION_CREDIT_ENABLED, 'true');
    await setSetting(
      SETTINGS_KEYS.FEDERATION_CREDIT_DAILY_CAP_BYTES,
      String(50 * 1024 ** 3),
    );
  });

  it('credits bonus upload once and dedups a replay', async () => {
    const peer = await peerWithKey();
    const subjectDid = `did:key:zM${randomUUID().slice(0, 8)}`;
    const uid = await memberWithDid(subjectDid);
    const signed = attestation(peer.kp, peer.did, subjectDid, 1_000_000);
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
    const subjectDid = `did:key:zC${randomUUID().slice(0, 8)}`;
    const uid = await memberWithDid(subjectDid);
    const signed = attestation(peer.kp, peer.did, subjectDid, 5000);

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
    const subjectDid = `did:key:zX${randomUUID().slice(0, 8)}`;
    await memberWithDid(subjectDid);
    const signed = attestation(other, otherDid, subjectDid, 1000);

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
    expect(r.reason).toBe('subject not a local member');
  });

  it('does nothing when crediting is disabled', async () => {
    await setSetting(SETTINGS_KEYS.FEDERATION_CREDIT_ENABLED, 'false');
    const peer = await peerWithKey();
    const subjectDid = `did:key:zO${randomUUID().slice(0, 8)}`;
    const uid = await memberWithDid(subjectDid);
    const signed = attestation(peer.kp, peer.did, subjectDid, 1000);

    const r = await applyContributionAttestation({
      record: signed,
      peer: { id: peer.id, publicKey: peer.kp.publicKeyPem },
    });
    expect(r.applied).toBe(false);
    expect(r.reason).toBe('disabled');
    expect(await bonus(uid)).toBe(0);
  });
});
