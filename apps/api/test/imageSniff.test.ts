import { describe, it, expect } from 'vitest';
import { sniffImage, assertImageType } from '../utils/imageSniff';

// Identifying an uploaded image from its bytes rather than its declared type.
//
// The SVG branch is the one worth testing hard. Every other format has a
// signature to match; SVG is XML, so it has to be parsed — and the obvious
// regular expression for "optional declaration, then any number of comments,
// then an optional doctype, then <svg>" backtracks exponentially. CodeQL
// flagged it (js/redos) and it reproduced: 136 ms at 24 repetitions of
// `--><!--`, doubling with each one after. The 1 KB read cap bounded the input
// without bounding the work.

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const gif = Buffer.from('GIF89a....', 'latin1');
const ico = Buffer.from([0x00, 0x00, 0x01, 0x00, 1, 0]);
const webp = Buffer.concat([
  Buffer.from('RIFF', 'latin1'),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from('WEBP', 'latin1'),
]);

describe('binary signatures', () => {
  it('identifies each accepted format', () => {
    expect(sniffImage(png)).toBe('image/png');
    expect(sniffImage(jpeg)).toBe('image/jpeg');
    expect(sniffImage(gif)).toBe('image/gif');
    expect(sniffImage(ico)).toBe('image/x-icon');
    expect(sniffImage(webp)).toBe('image/webp');
  });

  it('returns null on anything else', () => {
    expect(sniffImage(Buffer.from('<html><body>hi</body></html>'))).toBeNull();
    expect(sniffImage(Buffer.from('%PDF-1.7'))).toBeNull();
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
    expect(sniffImage(Buffer.from([0x00]))).toBeNull();
  });

  it('does not mistake a RIFF container for WebP', () => {
    // RIFF also carries WAV and AVI; the form type at offset 8 is what decides.
    const wav = Buffer.concat([
      Buffer.from('RIFF', 'latin1'),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('WAVE', 'latin1'),
    ]);
    expect(sniffImage(wav)).toBeNull();
  });
});

describe('SVG detection', () => {
  it('accepts the shapes a real file takes', () => {
    for (const svg of [
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      '  \n\t<svg>',
      '<?xml version="1.0"?><svg>',
      '<?xml version="1.0"?>\n<!-- a comment -->\n<svg width="1">',
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd"><svg>',
      '﻿<svg>', // BOM
      '<!-- one --><!-- two --><svg>',
    ]) {
      expect(sniffImage(Buffer.from(svg))).toBe('image/svg+xml');
    }
  });

  it('rejects XML that is not an SVG', () => {
    for (const notSvg of [
      '<?xml version="1.0"?><rss><channel/></rss>',
      '<!-- comment --><html>',
      '<svgx>',
      '<!DOCTYPE html><html>',
    ]) {
      expect(sniffImage(Buffer.from(notSvg))).toBeNull();
    }
  });

  it('rejects an unterminated construct instead of hanging', () => {
    expect(sniffImage(Buffer.from('<!-- never closed'))).toBeNull();
    expect(sniffImage(Buffer.from('<?xml never closed'))).toBeNull();
  });

  it('stays linear on the ReDoS payload', () => {
    // The exact shape CodeQL called out. Under the old regex this never
    // returned; the assertion is on wall-clock because that IS the property.
    const payload = Buffer.from('<!--' + '--><!--'.repeat(200));
    const started = Date.now();
    expect(sniffImage(payload)).toBeNull();
    expect(Date.now() - started).toBeLessThan(50);
  });

  it('stays linear on a kilobyte of comment openers', () => {
    const payload = Buffer.from('<!--'.repeat(256));
    const started = Date.now();
    expect(sniffImage(payload)).toBeNull();
    expect(Date.now() - started).toBeLessThan(50);
  });
});

describe('assertImageType', () => {
  it('returns the type the bytes actually are', () => {
    expect(assertImageType(png, ['image/png', 'image/webp'])).toBe('image/png');
  });

  it('refuses content outside the allow-list', () => {
    // The point of the whole module: a part declared `image/png` carrying a
    // GIF must not be stored under a `.png` extension.
    expect(() => assertImageType(gif, ['image/png', 'image/webp'])).toThrow();
    expect(() => assertImageType(Buffer.from('<html>'), ['image/png'])).toThrow();
  });
});
