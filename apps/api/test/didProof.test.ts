import { describe, it, expect } from 'vitest';
import { createHash, generateKeyPairSync, sign as edSign } from 'node:crypto';
import { webcrypto } from 'node:crypto';
import {
  base58btcDecode,
  base58btcEncode,
  canonicalUtf8,
  canonicalise,
  composeSigningInput,
  didKeyFromRaw,
  proofConfigFor,
  rawFromDidKey,
} from '@trackarr/shared/didProof';
import { canonicalBytes } from '../utils/federation/jcs';
import { didKeyFromPublicKey } from '../utils/federation/did';
import { signIdentity, verifyIdentity } from '../utils/federation/identityDoc';

// The seam where a server and a browser have to agree.
//
// A member holding their own key means one document is now signed in two
// places: the instance endorses it in Node, the member signs it in a browser
// tab. Both cover the same bytes, and "the same" has to be literal. A
// canonicalisation differing in one escape, a signing input assembled in the
// other order, an identifier encoded with a different alphabet — any of those
// and the two halves of one document disagree about what was signed.
//
// That failure is silent. The document verifies on one side and not the other,
// and the only symptom is somebody being told their export is invalid. So this
// file plays the browser's half with WebCrypto and checks it against the
// server's, byte for byte.

const subtle = webcrypto.subtle;

function nodeKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  return {
    publicKeyPem,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    did: didKeyFromPublicKey(publicKeyPem),
  };
}

describe('canonicalisation, shared', () => {
  it('is the same function the server already used', () => {
    // `jcs.ts` re-exports rather than reimplements. If that ever became a copy,
    // this is where it would show — and the 13 tests behind it would keep
    // passing on the copy while the browser drifted.
    const value = { b: 1, a: [null, true, 'é'], nested: { z: 0, y: -0 } };
    expect(canonicalBytes(value).toString('utf8')).toBe(canonicalise(value));
  });

  it('sorts by UTF-16 code unit, not by locale', () => {
    // A locale-aware compare here would be a "helpful" change that invalidates
    // every signature on a differently configured host.
    expect(canonicalise({ 'ä': 1, z: 2 })).toBe('{"z":2,"ä":1}');
  });

  it('refuses what it cannot represent instead of coercing it', () => {
    for (const bad of [{ x: NaN }, { x: undefined }, { x: Infinity }]) {
      expect(() => canonicalise(bad)).toThrow();
    }
  });
});

describe('did:key, shared', () => {
  it('agrees with the server derivation from a PEM', () => {
    const { publicKeyPem, did } = nodeKeypair();
    const raw = Buffer.from(
      publicKeyPem
        .replace(/-----[^-]+-----/g, '')
        .replace(/\s+/g, ''),
      'base64',
    ).subarray(-32);

    expect(didKeyFromRaw(raw)).toBe(did);
  });

  it('round-trips', () => {
    const { did } = nodeKeypair();
    expect(didKeyFromRaw(rawFromDidKey(did))).toBe(did);
  });

  it('keeps leading zero bytes, which carry no value but are part of the key', () => {
    const bytes = Uint8Array.from([0, 0, 1, 2, 3]);
    expect(base58btcEncode(bytes).startsWith('11')).toBe(true);
    expect([...base58btcDecode(base58btcEncode(bytes))]).toEqual([...bytes]);
  });
});

describe('a browser signature the server accepts', () => {
  it('verifies a document whose subject proof was made by WebCrypto', async () => {
    // The whole point of the shared module, played out end to end: the
    // instance endorses in Node, the member signs with WebCrypto, and the
    // server's own verifier accepts the result.
    const instance = nodeKeypair();

    const pair = (await subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify',
    ])) as unknown as CryptoKeyPair;
    const rawPublic = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
    const memberDid = didKeyFromRaw(rawPublic);

    // The instance's half.
    const endorsedAt = new Date('2026-08-22T12:00:00.000Z');
    const body = {
      '@context': [
        'https://www.w3.org/ns/activitystreams',
        'https://w3id.org/security/data-integrity/v2',
        { trackarr: 'https://trackarr.org/ns#' },
      ],
      type: 'Person',
      id: memberDid,
      preferredUsername: 'Nova',
      published: endorsedAt.toISOString(),
      'trackarr:instance': 'https://alpha.example',
      'trackarr:instanceDid': instance.did,
      'trackarr:note': 'x',
    };
    const endorsementConfig = proofConfigFor(instance.did, endorsedAt);
    const endorsement = {
      ...endorsementConfig,
      proofValue:
        'u' +
        edSign(
          null,
          Buffer.from(
            composeSigningInput(
              createHash('sha256').update(canonicalUtf8(endorsementConfig)).digest(),
              createHash('sha256').update(canonicalUtf8(body)).digest(),
            ),
          ),
          instance.privateKeyPem,
        ).toString('base64url'),
    };

    // The member's half, in the browser's terms.
    const config = proofConfigFor(memberDid, endorsedAt);
    const digest = async (bytes: Uint8Array) =>
      new Uint8Array(await subtle.digest('SHA-256', bytes));
    const input = composeSigningInput(
      await digest(canonicalUtf8(config)),
      await digest(canonicalUtf8(body)),
    );
    const signature = new Uint8Array(
      await subtle.sign({ name: 'Ed25519' }, pair.privateKey, input),
    );

    const document = {
      ...body,
      proof: {
        ...config,
        proofValue: `u${Buffer.from(signature).toString('base64url')}`,
      },
      'trackarr:endorsement': endorsement,
    };

    const verdict = verifyIdentity(document);
    expect(verdict.ok).toBe(true);
    expect(verdict.subject).toBe(memberDid);
    expect(verdict.endorsedBy).toBe(instance.did);
  });

  it('produces the same signing input on both sides, byte for byte', async () => {
    // Below the signature, where a mismatch would otherwise only show as "your
    // export is invalid" with nothing to look at.
    const doc = { b: 2, a: 1, deep: { list: [1, 'two', null] } };
    const config = proofConfigFor(
      'did:key:z6MkExample',
      new Date('2026-08-22T12:00:00.000Z'),
    );

    const nodeInput = composeSigningInput(
      createHash('sha256').update(canonicalBytes(config)).digest(),
      createHash('sha256').update(canonicalBytes(doc)).digest(),
    );
    const browserDigest = async (bytes: Uint8Array) =>
      new Uint8Array(await subtle.digest('SHA-256', bytes));
    const browserInput = composeSigningInput(
      await browserDigest(canonicalUtf8(config)),
      await browserDigest(canonicalUtf8(doc)),
    );

    expect(Buffer.from(browserInput).toString('hex')).toBe(
      Buffer.from(nodeInput).toString('hex'),
    );
  });

  it('still refuses a browser-signed document that was edited afterwards', async () => {
    const instance = nodeKeypair();
    const member = nodeKeypair();
    const doc = signIdentity(
      {
        did: member.did,
        username: 'Nova',
        instanceUrl: 'https://alpha.example',
        instanceDid: instance.did,
        issuedAt: new Date('2026-08-22T12:00:00.000Z'),
      },
      {
        subjectPrivateKeyPem: member.privateKeyPem,
        instancePrivateKeyPem: instance.privateKeyPem,
      },
    );
    doc.preferredUsername = 'Vega';
    expect(verifyIdentity(doc).ok).toBe(false);
  });
});
