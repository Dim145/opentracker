import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import {
  base58btcDecode,
  base58btcEncode,
  didKeyFromPublicKey,
  publicKeyFromDidKey,
  DidError,
} from '../utils/federation/did';
import {
  CONTEXT,
  recordId,
  signRecord,
  verifyRecord,
  type UnsignedRecord,
} from '../utils/federation/record';

// The signed catalogue record.
//
// Everything the decentralisation plan rests on is the claim that a record can
// be verified BY ANYBODY, HAVING ARRIVED BY ANY ROUTE. If that claim is false
// the whole thing collapses back to today's design, where trust lives in the
// connection and a record can therefore never be relayed.
//
// So these tests are not really about cryptography. They are about that one
// property and the ways it can quietly stop being true: a signature that still
// verifies after the record was edited, an id that does not match its content,
// a verifier that needs state, a verifier that throws on a stranger's bytes.

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString(),
  };
}

function draft(over: Partial<UnsignedRecord> = {}): UnsignedRecord {
  return {
    '@context': CONTEXT,
    type: 'Torrent',
    'bt:infohash_v1': 'a'.repeat(40),
    name: 'Show.S03E07.2160p.WEB-DL.DV.HDR.H.265-NTb',
    content: null,
    published: '2026-08-21T10:00:00.000Z',
    attributedTo: null,
    'trackarr:size': 7_230_000_000,
    'trackarr:contentSignature': 'sig-1',
    'trackarr:category': 'tv-uhd',
    'trackarr:categoryType': 'tv',
    'trackarr:isAdult': false,
    'trackarr:tags': ['MULTI', '2160p'],
    'trackarr:tmdbId': 'tv/82856',
    'trackarr:season': 3,
    'trackarr:episode': 7,
    'trackarr:issuer': 'did:key:zPlaceholder',
    ...over,
  };
}

describe('did:key', () => {
  it('round-trips an Ed25519 key through the identifier', () => {
    // The key IS the identifier. That is what lets a verifier check a record
    // without asking anybody where the signer's key lives — no directory, no
    // availability requirement, which is precisely what makes relaying safe.
    const { publicKeyPem } = keypair();
    const did = didKeyFromPublicKey(publicKeyPem);
    expect(did.startsWith('did:key:z')).toBe(true);

    const recovered = publicKeyFromDidKey(did);
    expect(recovered.export({ type: 'spki', format: 'pem' }).toString()).toBe(
      publicKeyPem,
    );
  });

  it('gives the same identifier for the same key, always', () => {
    const { publicKeyPem } = keypair();
    expect(didKeyFromPublicKey(publicKeyPem)).toBe(
      didKeyFromPublicKey(publicKeyPem),
    );
  });

  it('refuses an identifier that does not encode an Ed25519 key', () => {
    for (const bad of [
      'did:web:example.com',
      'did:key:xNotBase58btc',
      `did:key:z${base58btcEncode(Uint8Array.from([1, 2, 3]))}`,
      'did:key:z' + 'l'.repeat(50), // 'l' is not in the base58 alphabet
    ]) {
      expect(() => publicKeyFromDidKey(bad), bad).toThrow(DidError);
    }
  });

  it('preserves leading zero bytes through base58', () => {
    // The arithmetic loses them; the encoding restores them as leading '1's.
    // Get this wrong and one key in 256 produces a shorter identifier that
    // decodes to a different key.
    const withZeros = Uint8Array.from([0, 0, 5, 9]);
    expect(base58btcEncode(withZeros).startsWith('11')).toBe(true);
    expect([...base58btcDecode(base58btcEncode(withZeros))]).toEqual([0, 0, 5, 9]);
    expect(base58btcEncode(new Uint8Array())).toBe('');
  });
});

describe('recordId', () => {
  it('is the same whatever order the record was built in', () => {
    // Content addressing only deduplicates if the address depends on what a
    // record MEANS, not on how it happened to be assembled.
    const a = draft();
    const b: UnsignedRecord = { ...draft() };
    // Rebuild with the keys in a different insertion order.
    const shuffled = Object.fromEntries(
      Object.entries(b).reverse(),
    ) as unknown as UnsignedRecord;
    expect(recordId(shuffled)).toBe(recordId(a));
  });

  it('changes when any fact changes', () => {
    const base = recordId(draft());
    expect(recordId(draft({ name: 'Other.Name-A' }))).not.toBe(base);
    expect(recordId(draft({ 'trackarr:size': 1 }))).not.toBe(base);
    expect(recordId(draft({ 'trackarr:season': 4 }))).not.toBe(base);
    expect(recordId(draft({ 'trackarr:tags': ['2160p', 'MULTI'] }))).not.toBe(
      base,
    );
  });

  it('ignores the proof, so re-signing does not move the address', () => {
    const k1 = keypair();
    const k2 = keypair();
    const r = draft();
    const a = signRecord(r, { privateKeyPem: k1.privateKeyPem, did: didKeyFromPublicKey(k1.publicKeyPem) });
    const b = signRecord(r, { privateKeyPem: k2.privateKeyPem, did: didKeyFromPublicKey(k2.publicKeyPem) });
    expect(a.id).toBe(b.id);
    expect(a.proof.proofValue).not.toBe(b.proof.proofValue);
  });
});

describe('signRecord / verifyRecord', () => {
  it('verifies with nothing but the record itself', () => {
    // No peer table, no network, no configuration. This is the property the
    // whole plan is built on.
    const { publicKeyPem, privateKeyPem } = keypair();
    const did = didKeyFromPublicKey(publicKeyPem);
    const signed = signRecord(draft({ 'trackarr:issuer': did }), {
      privateKeyPem,
      did,
    });

    const result = verifyRecord(JSON.parse(JSON.stringify(signed)));
    expect(result.ok).toBe(true);
    expect(result.signer).toBe(did);
  });

  it('survives a JSON round trip through a relay', () => {
    // A record that only verifies in the process that made it is useless. It
    // has to survive being serialised, stored, re-serialised and forwarded —
    // which is exactly what canonicalisation buys.
    const { publicKeyPem, privateKeyPem } = keypair();
    const did = didKeyFromPublicKey(publicKeyPem);
    const signed = signRecord(draft(), { privateKeyPem, did });

    let hop: unknown = signed;
    for (let i = 0; i < 3; i++) hop = JSON.parse(JSON.stringify(hop));
    expect(verifyRecord(hop).ok).toBe(true);
  });

  it('rejects a record edited in flight', () => {
    const { publicKeyPem, privateKeyPem } = keypair();
    const did = didKeyFromPublicKey(publicKeyPem);
    const signed = signRecord(draft(), { privateKeyPem, did });

    for (const tamper of [
      (r: Record<string, unknown>) => (r.name = 'Something.Else-A'),
      (r: Record<string, unknown>) => (r['trackarr:size'] = 1),
      (r: Record<string, unknown>) => (r['bt:infohash_v1'] = 'b'.repeat(40)),
      (r: Record<string, unknown>) => (r['trackarr:isAdult'] = true),
    ]) {
      const copy = JSON.parse(JSON.stringify(signed));
      tamper(copy);
      const res = verifyRecord(copy);
      expect(res.ok).toBe(false);
    }
  });

  it('rejects a proof whose own metadata was edited', () => {
    // The proof covers its own configuration, so back-dating a record or
    // pointing it at somebody else's key breaks it just as surely as editing
    // the name.
    const { publicKeyPem, privateKeyPem } = keypair();
    const did = didKeyFromPublicKey(publicKeyPem);
    const signed = signRecord(draft(), { privateKeyPem, did });

    const backdated = JSON.parse(JSON.stringify(signed));
    backdated.proof.created = '2020-01-01T00:00:00.000Z';
    expect(verifyRecord(backdated).ok).toBe(false);

    const other = keypair();
    const reattributed = JSON.parse(JSON.stringify(signed));
    reattributed.proof.verificationMethod = `${didKeyFromPublicKey(other.publicKeyPem)}#x`;
    expect(verifyRecord(reattributed).ok).toBe(false);
  });

  it('rejects a record whose id does not match its content', () => {
    // Caches key on the id. A record allowed to claim somebody else's address
    // would overwrite it everywhere it was stored.
    const { publicKeyPem, privateKeyPem } = keypair();
    const did = didKeyFromPublicKey(publicKeyPem);
    const signed = signRecord(draft(), { privateKeyPem, did });

    const spoofed = JSON.parse(JSON.stringify(signed));
    spoofed.id = 'sha256:' + '0'.repeat(64);
    const res = verifyRecord(spoofed);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('id');
  });

  it('rejects a signature that belongs to a different record', () => {
    const { publicKeyPem, privateKeyPem } = keypair();
    const did = didKeyFromPublicKey(publicKeyPem);
    const a = signRecord(draft({ name: 'A-A' }), { privateKeyPem, did });
    const b = signRecord(draft({ name: 'B-B' }), { privateKeyPem, did });

    const frankenstein = JSON.parse(JSON.stringify(a));
    frankenstein.proof = b.proof;
    expect(verifyRecord(frankenstein).ok).toBe(false);
  });

  it('is total — a stranger cannot make it throw', () => {
    // It runs on bytes somebody else chose, inside a loop over a page of them.
    // An exception here would take the whole ingestion down.
    const { publicKeyPem, privateKeyPem } = keypair();
    const did = didKeyFromPublicKey(publicKeyPem);
    const signed = signRecord(draft(), { privateKeyPem, did });

    const hostile: unknown[] = [
      null,
      undefined,
      42,
      'a string',
      [],
      {},
      { proof: null },
      { proof: 'not an object' },
      { proof: { type: 'DataIntegrityProof' } },
      { ...signed, proof: { ...signed.proof, proofValue: 'not-multibase' } },
      { ...signed, proof: { ...signed.proof, cryptosuite: 'made-up-2099' } },
      { ...signed, proof: { ...signed.proof, proofPurpose: 'authentication' } },
      { ...signed, proof: { ...signed.proof, verificationMethod: 42 } },
      { ...signed, proof: { ...signed.proof, verificationMethod: 'did:key:zzz' } },
      { ...signed, 'trackarr:size': Number.NaN },
      { ...signed, 'trackarr:tags': undefined },
    ];

    for (const h of hostile) {
      const res = verifyRecord(h);
      expect(res.ok, JSON.stringify(h)?.slice(0, 60)).toBe(false);
      expect(typeof res.reason).toBe('string');
    }
  });

  it('does not accept a record signed by a key that is not the one it names', () => {
    // The attack the whole scheme exists to stop: relaying somebody else's
    // record with your own signature on it, or your record under their name.
    const mine = keypair();
    const theirs = keypair();
    const signed = signRecord(draft(), {
      privateKeyPem: mine.privateKeyPem,
      did: didKeyFromPublicKey(theirs.publicKeyPem),
    });
    expect(verifyRecord(signed).ok).toBe(false);
  });
});
