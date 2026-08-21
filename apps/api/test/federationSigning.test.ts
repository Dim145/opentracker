import { describe, it, expect } from 'vitest';
import { generateInstanceKeypair } from '../utils/federation/keys';
import { buildSignedHeaders, verifySignedRequest } from '../utils/federation/signing';

// Server-to-server request signing, and specifically the audience binding.
//
// v1 signed the method, the path, the clock and the body — but not WHO the
// request was addressed to. A signed request received by peer B could
// therefore be replayed verbatim to peer C, as long as C also trusts the
// sender: the anti-replay nonce store is local to each instance, so C has
// never seen that signature before. Binding the recipient's instanceId into
// the signing string closes that, and RFC 9421 names the same component.
//
// The rollout carries a downgrade risk that these tests pin explicitly: the
// sender emits both signatures so nothing breaks mid-upgrade, which means an
// attacker can strip the v2 header until `FEDERATION_REQUIRE_AUDIENCE` is on.

const alice = generateInstanceKeypair();
const bob = generateInstanceKeypair();

function sign(over: Record<string, unknown> = {}) {
  return buildSignedHeaders({
    method: 'GET',
    pathname: '/api/federation/records?limit=50',
    body: '',
    instanceId: alice.instanceId,
    privateKeyPem: alice.privateKeyPem,
    audienceInstanceId: bob.instanceId,
    ...over,
  });
}

function verify(headers: Record<string, string | undefined>, audience?: string) {
  return verifySignedRequest({
    method: 'GET',
    pathname: '/api/federation/records?limit=50',
    rawBody: '',
    headers,
    publicKeyPem: alice.publicKeyPem,
    expectedAudience: audience,
  });
}

describe('audience binding', () => {
  it('emits both signatures so an un-upgraded peer still verifies', () => {
    const h = sign();
    expect(h['x-trackarr-signature']).toBeTruthy();
    expect(h['x-trackarr-signature-v2']).toBeTruthy();
    expect(h['x-trackarr-signature-v2']).not.toBe(h['x-trackarr-signature']);
  });

  it('accepts a request addressed to us', () => {
    expect(verify(sign(), bob.instanceId).ok).toBe(true);
  });

  it('REFUSES the same request relayed to a different instance', () => {
    // The whole point. Byte-for-byte the request peer B received, replayed to
    // peer C which also trusts Alice. Under v1 this verified.
    const carol = generateInstanceKeypair();
    const verdict = verify(sign(), carol.instanceId);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/audience/);
  });

  it('never falls back to v1 when a v2 signature fails', () => {
    // The fallback would BE the downgrade: an attacker relaying to another
    // instance would simply let the v2 check fail and ride the v1 one.
    const h = sign();
    const carol = generateInstanceKeypair();
    expect(verify(h, carol.instanceId).ok).toBe(false);
    // ...even though the v1 signature in those very headers is valid.
    expect(verify({ ...h, 'x-trackarr-signature-v2': undefined }, carol.instanceId).ok).toBe(
      true,
    );
  });

  it('still verifies a v1-only sender while the flag is off', () => {
    // Mid-upgrade compatibility: a partner on the previous version sends no
    // v2 header at all.
    const h = buildSignedHeaders({
      method: 'GET',
      pathname: '/api/federation/records?limit=50',
      body: '',
      instanceId: alice.instanceId,
      privateKeyPem: alice.privateKeyPem,
    });
    expect(h['x-trackarr-signature-v2']).toBeUndefined();
    expect(verify(h, bob.instanceId).ok).toBe(true);
  });
});

describe('what v1 already covered, and must keep covering', () => {
  it('rejects a tampered path', () => {
    const verdict = verifySignedRequest({
      method: 'GET',
      pathname: '/api/federation/records?limit=5000',
      rawBody: '',
      headers: sign(),
      publicKeyPem: alice.publicKeyPem,
      expectedAudience: bob.instanceId,
    });
    expect(verdict.ok).toBe(false);
  });

  it('rejects another instance’s key', () => {
    const verdict = verifySignedRequest({
      method: 'GET',
      pathname: '/api/federation/records?limit=50',
      rawBody: '',
      headers: sign(),
      publicKeyPem: bob.publicKeyPem,
      expectedAudience: bob.instanceId,
    });
    expect(verdict.ok).toBe(false);
  });

  it('rejects a body that does not match the digest', () => {
    const h = buildSignedHeaders({
      method: 'POST',
      pathname: '/api/federation/handshake',
      body: JSON.stringify({ a: 1 }),
      instanceId: alice.instanceId,
      privateKeyPem: alice.privateKeyPem,
      audienceInstanceId: bob.instanceId,
    });
    const verdict = verifySignedRequest({
      method: 'POST',
      pathname: '/api/federation/handshake',
      rawBody: JSON.stringify({ a: 2 }),
      headers: h,
      publicKeyPem: alice.publicKeyPem,
      expectedAudience: bob.instanceId,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/digest/);
  });

  it('rejects a stale timestamp', () => {
    const h = sign();
    h['x-trackarr-date'] = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    expect(verify(h, bob.instanceId).ok).toBe(false);
  });
});
