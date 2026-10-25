import { describe, it, expect } from 'vitest';
import { rateLimitSubject } from '../utils/rateLimit';

// What an address-based limit — and the blacklist built on it — counts. An IPv6
// host routinely holds a whole /64 and can use a fresh address per request, so
// keying on the full address limited nobody who rotated inside their prefix.

describe('rateLimitSubject', () => {
  it('keeps an IPv4 address whole, IPv4-mapped included', () => {
    expect(rateLimitSubject('203.0.113.7')).toBe('203.0.113.7');
    expect(rateLimitSubject('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('folds every address of an IPv6 /64 onto one subject', () => {
    const a = rateLimitSubject('2001:db8:aa:bb:1:2:3:4');
    const b = rateLimitSubject('2001:0db8:00aa:00bb:ffff:ffff:ffff:ffff');
    const c = rateLimitSubject('2001:db8:aa:bb::1');
    expect(a).toBe('2001:db8:aa:bb::/64');
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('keeps two /64s apart', () => {
    expect(rateLimitSubject('2001:db8:aa:bb::1')).not.toBe(rateLimitSubject('2001:db8:aa:bc::1'));
  });

  it('reads compressed, zoned and IPv4-tailed spellings', () => {
    expect(rateLimitSubject('::1')).toBe('0:0:0:0::/64');
    expect(rateLimitSubject('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    expect(rateLimitSubject('64:ff9b::192.0.2.1')).toBe('64:ff9b:0:0::/64');
  });

  it('passes anything else through untouched', () => {
    expect(rateLimitSubject('unknown')).toBe('unknown');
    expect(rateLimitSubject('')).toBe('');
  });
});
