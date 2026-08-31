import { describe, it, expect } from 'vitest';
import {
  sniffImage,
  assertImageType,
  imageDimensions,
  manifestIconSizes,
} from '../utils/imageSniff';

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

// Measuring the image, which the web app manifest turns into a claim a browser
// acts on: Chrome installs a site only when an icon declares ≥ 512×512, and it
// reads the declaration rather than the file. A wrong number buys an install
// prompt and a blurry icon.
describe('imageDimensions', () => {
  /** A PNG header with a real IHDR — the only chunk the reader looks at. */
  function pngOf(width: number, height: number): Buffer {
    const buf = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
    buf.writeUInt32BE(13, 8); // IHDR length
    buf.write('IHDR', 12, 'latin1');
    buf.writeUInt32BE(width, 16);
    buf.writeUInt32BE(height, 20);
    return buf;
  }

  it('reads a PNG IHDR', () => {
    expect(imageDimensions(pngOf(512, 512))).toEqual({
      width: 512,
      height: 512,
    });
  });

  it('reads a GIF logical screen descriptor (little-endian)', () => {
    const buf = Buffer.alloc(16);
    buf.write('GIF89a', 0, 'latin1');
    buf.writeUInt16LE(300, 6);
    buf.writeUInt16LE(200, 8);
    expect(imageDimensions(buf)).toEqual({ width: 300, height: 200 });
  });

  it('reads a WEBP VP8X canvas (24-bit, stored minus one)', () => {
    const buf = Buffer.alloc(32);
    buf.write('RIFF', 0, 'latin1');
    buf.write('WEBP', 8, 'latin1');
    buf.write('VP8X', 12, 'latin1');
    // 192 and 96, each written as value-1 over three little-endian bytes.
    buf[24] = 191;
    buf[27] = 95;
    expect(imageDimensions(buf)).toEqual({ width: 192, height: 96 });
  });

  it('walks past a JPEG APP segment to reach the frame header', () => {
    // SOI, then an APP0 of declared length 8, then SOF0 carrying 64×32.
    const buf = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      Buffer.from([0xff, 0xe0, 0x00, 0x08, 1, 2, 3, 4, 5, 6]),
      Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08]),
      (() => {
        const d = Buffer.alloc(4);
        d.writeUInt16BE(32, 0); // height first — JPEG's order
        d.writeUInt16BE(64, 2);
        return d;
      })(),
      Buffer.alloc(8),
    ]);
    expect(imageDimensions(buf)).toEqual({ width: 64, height: 32 });
  });

  it('gives up rather than guessing on a JPEG that reaches its scan data', () => {
    // SOI then SOS: the entropy-coded data starts and no frame header follows.
    const buf = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      Buffer.from([0xff, 0xda, 0x00, 0x08]),
      Buffer.alloc(16),
    ]);
    expect(imageDimensions(buf)).toBeNull();
  });

  it('returns null for an SVG, which has no intrinsic pixel size', () => {
    expect(imageDimensions(Buffer.from('<svg width="10"></svg>'))).toBeNull();
  });

  it('returns null on a truncated header instead of reading past the end', () => {
    expect(imageDimensions(pngOf(512, 512).subarray(0, 18))).toBeNull();
    expect(imageDimensions(Buffer.alloc(4))).toBeNull();
  });
});

describe('manifestIconSizes', () => {
  it('states the square when there is one', () => {
    expect(manifestIconSizes({ width: 512, height: 512 })).toBe('512x512');
  });

  it('falls back to `any` when the measurement is missing', () => {
    // An SVG, an unwalked format, or an image uploaded before the measurement
    // existed. Never a fabricated square.
    expect(manifestIconSizes(null)).toBe('any');
  });

  it('refuses to call a non-square image an icon size', () => {
    // `sizes` names squares. A banner is not an 800-pixel icon.
    expect(manifestIconSizes({ width: 800, height: 200 })).toBe('any');
  });

  it('rejects degenerate dimensions', () => {
    expect(manifestIconSizes({ width: 0, height: 0 })).toBe('any');
  });
});
