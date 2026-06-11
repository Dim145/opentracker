import { describe, it, expect } from 'vitest';
import { isBlockedIp, validateHost, SafeFetchError } from '../utils/safeFetch';

// SSRF guard. This is the single choke point behind the web_push channel
// (finding M10) and the federation swarm peer relay (finding L6): if any
// private / loopback / link-local / metadata / CGNAT address slips through
// as "not blocked", an attacker can pivot the server into internal HTTP
// services or poison the swarm with bogus peers. Fail-closed on anything
// that is not a clean public IP literal.

describe('isBlockedIp — IPv4', () => {
  it('blocks loopback, private, CGNAT, link-local/metadata, wildcard, multicast', () => {
    for (const ip of [
      '127.0.0.1',
      '127.10.20.30',
      '10.0.0.1',
      '10.255.255.255',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '100.64.0.1', // CGNAT
      '100.127.255.255', // CGNAT upper bound
      '169.254.169.254', // cloud metadata
      '0.0.0.0',
      '224.0.0.1', // multicast
      '255.255.255.255', // broadcast (>= 224)
      '192.0.2.10', // TEST-NET-1
      '198.51.100.10', // TEST-NET-2
      '203.0.113.10', // TEST-NET-3
      '198.18.0.1', // benchmark
    ]) {
      expect(isBlockedIp(ip), `${ip} must be blocked`).toBe(true);
    }
  });

  it('allows ordinary public IPv4', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1', '100.63.255.255', '100.128.0.1']) {
      expect(isBlockedIp(ip), `${ip} must be allowed`).toBe(false);
    }
  });

  it('fails closed on malformed / out-of-range input', () => {
    for (const bad of ['', 'not-an-ip', '256.1.1.1', '1.2.3', '1.2.3.4.5', '10.0.0.-1', '0x7f.0.0.1']) {
      expect(isBlockedIp(bad), `${bad} must be treated as unsafe`).toBe(true);
    }
  });
});

describe('isBlockedIp — IPv6', () => {
  it('blocks loopback, unspecified, ULA, link-local, multicast, NAT64', () => {
    for (const ip of [
      '::1', // loopback
      '::', // unspecified
      'fc00::1', // unique-local fc00::/7
      'fd12:3456::1', // unique-local
      'fe80::1', // link-local
      'ff02::1', // multicast
      '64:ff9b::7f00:1', // NAT64 wrapping 127.0.0.1
      '::ffff:127.0.0.1', // IPv4-mapped loopback (dotted)
      '::ffff:169.254.169.254', // IPv4-mapped metadata
      '::ffff:7f00:1', // IPv4-mapped loopback (hex form)
    ]) {
      expect(isBlockedIp(ip), `${ip} must be blocked`).toBe(true);
    }
  });

  it('allows ordinary public IPv6', () => {
    for (const ip of ['2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8']) {
      expect(isBlockedIp(ip), `${ip} must be allowed`).toBe(false);
    }
  });

  it('fails closed on malformed IPv6', () => {
    for (const bad of ['fe80::1::2', 'gggg::1', '12345::1', '1:2:3:4:5:6:7']) {
      expect(isBlockedIp(bad), `${bad} must be treated as unsafe`).toBe(true);
    }
  });
});

describe('validateHost', () => {
  it('rejects an IP literal in a blocked range (no DNS round-trip)', async () => {
    await expect(validateHost('169.254.169.254')).rejects.toBeInstanceOf(SafeFetchError);
    await expect(validateHost('127.0.0.1')).rejects.toBeInstanceOf(SafeFetchError);
    await expect(validateHost('::1')).rejects.toBeInstanceOf(SafeFetchError);
  });

  it('accepts a public IP literal', async () => {
    await expect(validateHost('1.1.1.1')).resolves.toBeUndefined();
  });

  it('rejects localhost (resolves to a loopback address)', async () => {
    // `localhost` resolves via /etc/hosts to 127.0.0.1 / ::1 — both blocked.
    await expect(validateHost('localhost')).rejects.toBeInstanceOf(SafeFetchError);
  });
});
