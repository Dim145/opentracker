import { describe, it, expect } from 'vitest';
import {
  CanonicalisationError,
  canonicalBytes,
  canonicalise,
} from '../utils/federation/jcs';

// RFC 8785, and the reason the whole signed-record layer rests on it.
//
// A signature over JSON is a signature over BYTES. JSON leaves key order,
// whitespace and number formatting free, so two servers that agree completely
// about a record can disagree about its bytes — and the receiver sees an
// invalid signature with nothing to explain it. Every test here is really the
// same test: the same value must always produce the same bytes, on any host,
// in any order it was built.

describe('canonicalise', () => {
  it('sorts object keys by UTF-16 code unit, at every depth', () => {
    expect(canonicalise({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalise({ z: { y: 1, x: 2 }, a: 3 })).toBe(
      '{"a":3,"z":{"x":2,"y":1}}',
    );
  });

  it('orders the RFC 8785 sorting vector as the RFC says', () => {
    // The specification's own example. Ordering by code unit is NOT ordering
    // by code point, and it is not locale ordering either — a `localeCompare`
    // here would put these in a different order and break every signature on a
    // differently-configured host.
    const input: Record<string, string> = {
      '€': 'Euro Sign',
      '\r': 'Carriage Return',
      'דּ': 'Hebrew Letter Dalet With Dagesh',
      '1': 'One',
      '😀': 'Emoji: Grinning Face',
      '': 'Control',
      'ö': 'Latin Small Letter O With Diaeresis',
    };
    const out = canonicalise(input);
    const order = [...out.matchAll(/:"([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual([
      'Carriage Return',
      'One',
      'Control',
      'Latin Small Letter O With Diaeresis',
      'Euro Sign',
      'Emoji: Grinning Face',
      'Hebrew Letter Dalet With Dagesh',
    ]);
  });

  it('keeps array order — an array is a value, not a set', () => {
    expect(canonicalise([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalise({ a: ['z', 'a'] })).toBe('{"a":["z","a"]}');
  });

  it('emits no whitespace', () => {
    expect(canonicalise({ a: 1, b: [1, 2] })).toBe('{"a":1,"b":[1,2]}');
  });

  it('serialises numbers the way ECMAScript does', () => {
    // The RFC defers to ECMAScript here, which is what makes `JSON.stringify`
    // usable for the number case at all.
    expect(canonicalise(0)).toBe('0');
    expect(canonicalise(-0)).toBe('0');
    expect(canonicalise(5e-324)).toBe('5e-324');
    expect(canonicalise(9007199254740992)).toBe('9007199254740992');
    expect(canonicalise(1.5)).toBe('1.5');
    expect(canonicalise(-1)).toBe('-1');
  });

  it('refuses a number JSON cannot hold, instead of writing null', () => {
    // `JSON.stringify(NaN)` is `null`. Signing that would mean signing a value
    // the caller never had — the worst failure a signing primitive can have,
    // because it succeeds.
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(() => canonicalise(bad)).toThrow(CanonicalisationError);
      expect(() => canonicalise({ x: bad })).toThrow(CanonicalisationError);
    }
  });

  it('refuses undefined rather than dropping the property', () => {
    expect(() => canonicalise({ a: 1, b: undefined })).toThrow(
      CanonicalisationError,
    );
  });

  it('refuses what JSON has no word for', () => {
    expect(() => canonicalise(() => 1)).toThrow(CanonicalisationError);
    expect(() => canonicalise(Symbol('x'))).toThrow(CanonicalisationError);
    expect(() => canonicalise(1n)).toThrow(CanonicalisationError);
  });

  it('refuses a value nested past the depth cap', () => {
    // Not a real record shape — a hostile payload, or a bug. Either way it must
    // not take the process down with a stack overflow.
    let deep: unknown = 1;
    for (let i = 0; i < 200; i++) deep = { a: deep };
    expect(() => canonicalise(deep)).toThrow(CanonicalisationError);
  });

  it('handles the empty cases', () => {
    expect(canonicalise({})).toBe('{}');
    expect(canonicalise([])).toBe('[]');
    expect(canonicalise(null)).toBe('null');
    expect(canonicalise('')).toBe('""');
  });

  it('escapes strings the way the RFC requires', () => {
    expect(canonicalise('a"b')).toBe('"a\\"b"');
    expect(canonicalise('\n')).toBe('"\\n"');
    expect(canonicalise('')).toBe('"\\u0001"');
    // Non-ASCII stays literal — escaping it would be legal JSON and the wrong
    // bytes.
    expect(canonicalise('é')).toBe('"é"');
  });

  it('is the same for two objects built in different orders', () => {
    // The property the whole signed-record layer depends on: what a record
    // MEANS decides its bytes, not how it happened to be constructed.
    const a: Record<string, unknown> = {};
    a.name = 'Show.S01E01';
    a.size = 42;
    a.tags = ['MULTI', '1080p'];

    const b: Record<string, unknown> = {};
    b.tags = ['MULTI', '1080p'];
    b.size = 42;
    b.name = 'Show.S01E01';

    expect(canonicalise(a)).toBe(canonicalise(b));
    expect(canonicalBytes(a).equals(canonicalBytes(b))).toBe(true);
  });

  it('is idempotent through a JSON round trip', () => {
    const value = { z: [1, { b: null, a: 'x' }], a: true };
    const once = canonicalise(value);
    expect(canonicalise(JSON.parse(once))).toBe(once);
  });
});

describe('RFC 8785 vectors and the toJSON trap', () => {
  // The RFC 8785 property-ordering example: keys sort by UTF-16 code unit
  // at the top level and at every depth. Written with \u escapes to pin
  // the exact code points the RFC names (U+FB33 = precomposed Dalet+Dagesh).
  it('orders the RFC 8785 key vector by code unit', () => {
    const input: Record<string, string> = {
      '\u20ac': 'Euro Sign',
      '\r': 'Carriage Return',
      '\ufb33': 'Hebrew Letter Dalet With Dagesh',
      '1': 'One',
      '\ud83d\ude00': 'Emoji: Grinning Face',
      '\u007f': 'Control',
      '\u00f6': 'Latin Small Letter O With Diaeresis',
    };
    const out = canonicalise(input);
    const keysInOrder = out
      .slice(1, -1)
      .split(',')
      .map((pair) => JSON.parse(pair.slice(0, pair.indexOf(':'))) as string);
    expect(keysInOrder).toEqual([
      '\r',
      '1',
      '\u007f',
      '\u00f6',
      '\u20ac',
      '\ud83d\ude00',
      '\ufb33',
    ]);
  });

  it('serialises numbers as ECMAScript does', () => {
    expect(canonicalise(1e21)).toBe('1e+21');
    expect(canonicalise(5e-324)).toBe('5e-324');
    expect(canonicalise(-0)).toBe('0');
    expect(canonicalise(9007199254740992)).toBe('9007199254740992');
  });

  it('refuses a Date rather than signing an empty object', () => {
    // A Date has no own enumerable keys, so it used to canonicalise to an
    // empty object — the caller would sign nothing where it meant a timestamp.
    expect(() =>
      canonicalise({ published: new Date('2026-01-01T00:00:00Z') }),
    ).toThrow();
    expect(canonicalise({ published: '2026-01-01T00:00:00.000Z' })).toBe(
      '{"published":"2026-01-01T00:00:00.000Z"}',
    );
  });
});
