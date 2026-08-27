import { describe, it, expect, beforeEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { didKeyFromPublicKey } from '../utils/federation/did';
import {
  PORTABILITY_NOTE,
  signIdentity,
  verifyIdentity,
  type IdentityDocument,
} from '../utils/federation/identityDoc';

// "This is me", as a document somebody carries to another instance.
//
// Two signatures, two different claims, and the whole value of the thing is
// that neither can be faked into the other's place:
//
//   the subject's proof  — whoever wrote this holds the key the DID names
//   the endorsement      — that key is a member of this instance, by this name
//
// The failure worth designing against is not forgery of a signature. It is
// somebody taking a genuine document, changing the username or the instance in
// it, and having it still verify — or claiming an identifier they can sign
// nothing for. Both are cheap to get wrong and neither looks like a bug.

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    did: didKeyFromPublicKey(publicKeyPem),
  };
}

let member: ReturnType<typeof keypair>;
let instance: ReturnType<typeof keypair>;

function claim(over: Record<string, unknown> = {}) {
  return signIdentity(
    {
      did: member.did,
      username: 'Nova',
      instanceUrl: 'https://alpha.example',
      instanceDid: instance.did,
      issuedAt: new Date('2026-08-22T10:00:00.000Z'),
      ...over,
    },
    {
      subjectPrivateKeyPem: member.privateKeyPem,
      instancePrivateKeyPem: instance.privateKeyPem,
    },
  );
}

beforeEach(() => {
  member = keypair();
  instance = keypair();
});

describe('a claim that holds', () => {
  it('names the member, their instance and who vouched', () => {
    const v = verifyIdentity(claim());

    expect(v.ok).toBe(true);
    expect(v.subject).toBe(member.did);
    expect(v.username).toBe('Nova');
    expect(v.instanceUrl).toBe('https://alpha.example');
    expect(v.endorsedBy).toBe(instance.did);
  });

  it('carries the sentence about what does not travel', () => {
    // Inside the file, not only in the interface that produced it: the
    // interface will not be in front of them when they arrive somewhere else.
    const doc = claim();
    expect(doc['trackarr:note']).toBe(PORTABILITY_NOTE);
    expect(PORTABILITY_NOTE).toMatch(/ratio/i);
  });

  it('lets the two proofs be checked independently of each other', () => {
    // Both cover the same bytes, so neither depends on the other's presence.
    // An endorsement can be stripped — by a relay, by a member who wants to
    // present the bare claim — without invalidating the subject's proof.
    const doc = claim();
    delete doc['trackarr:endorsement'];

    const v = verifyIdentity(doc);
    expect(v.ok).toBe(true);
    expect(v.subject).toBe(member.did);
    // And the receiver is told the vouching is missing, rather than it
    // quietly reading as present.
    expect(v.endorsedBy).toBeUndefined();
  });

  it('is deterministic for one issuance', () => {
    const a = claim();
    const b = claim();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('a claim that does not', () => {
  it('refuses a renamed member', () => {
    const doc = claim();
    doc.preferredUsername = 'Vega';
    expect(verifyIdentity(doc).ok).toBe(false);
  });

  it('refuses a claim moved to another instance', () => {
    // Otherwise a genuine export from A becomes a genuine-looking claim to
    // have been a member of B, which is the whole game.
    const doc = claim();
    doc['trackarr:instance'] = 'https://elsewhere.example';
    expect(verifyIdentity(doc).ok).toBe(false);
  });

  it('refuses an identifier the signer cannot sign for', () => {
    // Signed by a real key, just not the one the document claims to be. A
    // check on "is this a valid signature" alone would let anybody endorse
    // anybody's identifier.
    const other = keypair();
    const doc = claim();
    doc.id = other.did;

    const v = verifyIdentity(doc);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/does not match|another key|subject proof/i);
  });

  it('refuses a document with no proof at all', () => {
    const doc = claim();
    delete doc.proof;
    expect(verifyIdentity(doc).ok).toBe(false);
  });

  it('reports an endorsement by the wrong instance as no endorsement', () => {
    // A valid signature from an instance other than the one the document
    // names is not a smaller endorsement, it is a different claim. Reporting
    // it as vouching would let any instance endorse a claim about any other.
    const impostor = keypair();
    const doc = signIdentity(
      {
        did: member.did,
        username: 'Nova',
        instanceUrl: 'https://alpha.example',
        instanceDid: instance.did,
        issuedAt: new Date('2026-08-22T10:00:00.000Z'),
      },
      {
        subjectPrivateKeyPem: member.privateKeyPem,
        instancePrivateKeyPem: impostor.privateKeyPem,
      },
    );

    const v = verifyIdentity(doc);
    expect(v.ok).toBe(true); // the subject's own claim still stands
    expect(v.endorsedBy).toBeUndefined(); // nobody entitled vouched for it
  });

  it('never throws on whatever it is handed', () => {
    const hostile: unknown[] = [
      null,
      undefined,
      42,
      'did:key:z6Mk',
      [],
      {},
      { type: 'Person' },
      { type: 'Note', id: 'did:key:z6Mk', proof: {} },
      { type: 'Person', id: 'https://not-a-did', proof: {} },
      { type: 'Person', id: 'did:key:z6Mk', preferredUsername: 'x', proof: 'nope' },
      { type: 'Person', id: 'did:key:z6Mk', preferredUsername: 'x', proof: { type: 'X' } },
      // Values JCS refuses outright, rather than coercing into a signature
      // over something the caller never had.
      { type: 'Person', id: 'did:key:z6Mk', preferredUsername: 'x', bad: NaN },
    ];
    for (const input of hostile) {
      const v = verifyIdentity(input);
      expect(v.ok, JSON.stringify(input)).toBe(false);
      expect(typeof v.reason).toBe('string');
    }
  });

  it('refuses a document whose signature was made over different bytes', () => {
    const a = claim();
    const b = claim({ username: 'Vega' });
    const forged = { ...a, proof: b.proof } as IdentityDocument;
    expect(verifyIdentity(forged).ok).toBe(false);
  });
});
