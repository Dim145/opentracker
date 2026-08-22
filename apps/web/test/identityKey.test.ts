import { describe, it, expect } from 'vitest';
import {
  fromExport,
  generate,
  readExportFile,
  toPem,
  signDocument,
} from '../app/utils/identityKey';

// Getting the key back.
//
// The gap this closes was worse than it first looked. Under member custody the
// server holds no private key by definition, so the exported file — the one
// thing described as a backup — contained everything about the identity EXCEPT
// the identity. The key existed in one browser's local storage and nowhere
// else: one cleared cache from being gone, with the catalogue signed under it
// left unreachable and no way to prove the claim again.
//
// So the property under test is a round trip, not a function: export, come
// back in a different browser, and still be able to sign as the same DID.

/** What the export writes for a member who holds their own key. */
async function exportedFile() {
  const key = await generate();
  return {
    identity: {
      did: key.did,
      privateKeyPem: toPem(key.privateKeyB64),
      publicKeyPem: key.publicKeyPem,
    },
    original: key,
  };
}

describe('carrying an identity to another browser', () => {
  it('comes back as the same identity', async () => {
    const { identity, original } = await exportedFile();

    const restored = await fromExport(identity);

    expect(restored).not.toBeNull();
    expect(restored!.did).toBe(original.did);
    expect(restored!.publicKeyPem).toBe(original.publicKeyPem);
  });

  it('comes back able to sign, which is the only thing that matters', async () => {
    // A restored key that cannot produce a proof is a restored key in name
    // only. This signs a document with it and checks the proof is there and
    // attributed to the same DID the member started with.
    const { identity, original } = await exportedFile();
    const restored = (await fromExport(identity))!;

    const signed = await signDocument(
      { '@context': 'https://www.w3.org/ns/activitystreams', type: 'Person', id: original.did },
      restored,
    );

    const proof = (signed as Record<string, unknown>).proof as Record<string, unknown>;
    expect(proof).toBeTruthy();
    expect(proof.verificationMethod).toContain(original.did);
    expect(typeof proof.proofValue).toBe('string');
  });

  it('reads the file as downloaded, wrapper and all', async () => {
    // The download nests the identity under `identity`. Reading the wrapper is
    // what the member's file actually needs, so it is read here rather than
    // unwrapped in the component where nothing would check it.
    const { identity, original } = await exportedFile();
    const restored = await readExportFile({ identity, exportedAt: 'whenever' });
    expect(restored!.did).toBe(original.did);
  });

  it('reads it bare too, for a file that lost its wrapper', async () => {
    const { identity, original } = await exportedFile();
    const restored = await readExportFile(identity);
    expect(restored!.did).toBe(original.did);
  });

  it('refuses a file whose two halves do not belong together', async () => {
    // The failure that would otherwise be discovered on the far side of a
    // move: a member signing claims that verify against nobody. Checked here
    // by signing a probe with the private half and verifying it against the
    // identifier — which IS the public half.
    const a = await exportedFile();
    const b = await exportedFile();

    const mismatched = await fromExport({
      did: b.identity.did,
      privateKeyPem: a.identity.privateKeyPem,
      publicKeyPem: b.identity.publicKeyPem,
    });

    expect(mismatched).toBeNull();
  });

  it('refuses a file with no key in it at all', async () => {
    // Exactly what the old export produced. Restoring from it would have
    // looked like it worked and left the member unable to sign anything.
    const { identity } = await exportedFile();
    expect(
      await fromExport({ did: identity.did, publicKeyPem: identity.publicKeyPem }),
    ).toBeNull();
  });

  it('never throws on a file that is not one of ours', async () => {
    for (const bad of [
      {},
      { did: 'did:key:zNotAKey', privateKeyPem: 'nope', publicKeyPem: 'nope' },
      { did: 42, privateKeyPem: null, publicKeyPem: [] } as never,
    ]) {
      await expect(fromExport(bad as Record<string, unknown>)).resolves.toBeNull();
    }
  });
});

describe('the PEM the file carries', () => {
  it('is a PKCS#8 block a human or another tool can read', async () => {
    const { original } = await exportedFile();
    const pem = toPem(original.privateKeyB64);

    expect(pem.startsWith('-----BEGIN PRIVATE KEY-----\n')).toBe(true);
    expect(pem.trimEnd().endsWith('-----END PRIVATE KEY-----')).toBe(true);
    // Wrapped at 64 columns, like every other PEM. A single 1 700-character
    // line is still valid base64 and still trips half the tools that read it.
    const body = pem.split('\n').slice(1, -2);
    expect(body.every((line) => line.length <= 64)).toBe(true);
  });
});
