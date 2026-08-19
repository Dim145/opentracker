/**
 * Identify an uploaded image from its bytes rather than from what the client
 * says it is.
 *
 * The branding upload routes validated `file.type` — the `Content-Type` of the
 * multipart part, which the uploader writes. Nothing checked that a part
 * labelled `image/png` actually contained a PNG. The blast radius was small
 * (admin-only, server-generated filename, extension taken from a table, SVGs
 * served under a `sandbox` CSP), but the check cost nothing and its absence
 * meant the stored extension could disagree with the stored bytes — which is
 * exactly the mismatch content-sniffing attacks are built on.
 *
 * Returns the MIME type the bytes actually are, or null when they match none
 * of the formats we accept.
 */

export type SniffedImage =
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp'
  | 'image/gif'
  | 'image/svg+xml'
  | 'image/x-icon';

function startsWith(buf: Buffer, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
}

export function sniffImage(buf: Buffer): SniffedImage | null {
  if (!buf || buf.length < 4) return null;

  // PNG — the 8-byte signature includes CRLF/EOF bytes precisely so that a
  // text-mode transfer corrupts it detectably.
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }
  // JPEG — SOI marker.
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  // GIF87a / GIF89a.
  if (
    startsWith(buf, [0x47, 0x49, 0x46, 0x38]) &&
    (buf[4] === 0x37 || buf[4] === 0x39) &&
    buf[5] === 0x61
  ) {
    return 'image/gif';
  }
  // WEBP — a RIFF container whose form type is "WEBP" at offset 8.
  if (
    startsWith(buf, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return 'image/webp';
  }
  // ICO — reserved 0x0000 then image type 1.
  if (startsWith(buf, [0x00, 0x00, 0x01, 0x00])) return 'image/x-icon';

  // SVG is XML: no signature to match, so look at the head of the text. A BOM
  // and leading whitespace, comments or a doctype are all legal before the
  // root element. We only inspect the first kilobyte — enough to reach `<svg`
  // in any real file, and bounded so a hostile upload cannot make us scan a
  // multi-megabyte blob.
  const head = buf.subarray(0, 1024).toString('utf8').replace(/^﻿/, '');
  if (/^\s*(<\?xml[\s\S]*?\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE\s+svg[\s\S]*?>\s*)?<svg[\s>]/i.test(head)) {
    return 'image/svg+xml';
  }

  return null;
}

/**
 * Assert that the bytes are one of `allowed`, and return the type the bytes
 * actually are. Throws a 400 otherwise — the caller should use the RETURNED
 * type to pick the stored extension, never the declared one.
 */
export function assertImageType(
  buf: Buffer,
  allowed: readonly SniffedImage[],
): SniffedImage {
  const actual = sniffImage(buf);
  if (!actual || !allowed.includes(actual)) {
    throw createError({
      statusCode: 400,
      statusMessage: `The file content is not one of the accepted image formats (${allowed.join(', ')}).`,
    });
  }
  return actual;
}
