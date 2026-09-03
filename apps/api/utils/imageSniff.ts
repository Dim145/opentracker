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

  // SVG is XML: no signature to match, so the head of the text has to be
  // parsed instead. Only the first kilobyte is inspected — enough to reach
  // `<svg` in any real file, and bounded so a hostile upload cannot make us
  // scan a multi-megabyte blob.
  if (looksLikeSvg(buf.subarray(0, 1024).toString('utf8'))) {
    return 'image/svg+xml';
  }

  return null;
}

/**
 * Does this text open an SVG document?
 *
 * Deliberately a hand-rolled scan and not a regular expression. The obvious
 * pattern for "optional declaration, then any number of comments, then an
 * optional doctype, then `<svg`" nests a lazy `[\s\S]*?` inside a `*` group,
 * which backtracks exponentially: a file starting `<!--` followed by repeated
 * `--><!--` and never reaching `<svg` took 136 ms at 24 repetitions and doubles
 * with each one after — so the 1 KB cap above bounds the input without bounding
 * the work, and the request thread simply never comes back.
 *
 * This walks forward with `indexOf` and never revisits a character, so the cost
 * is linear in the input whatever it contains. An unterminated construct means
 * "not an SVG", which is the right answer anyway.
 */
function looksLikeSvg(text: string): boolean {
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; // strip a BOM

  const skipTo = (marker: string): boolean => {
    const end = text.indexOf(marker, i);
    if (end === -1) return false;
    i = end + marker.length;
    return true;
  };

  // A malformed file could in principle chain a lot of tiny constructs; cap the
  // number of hops so the loop is bounded by construction rather than by
  // reasoning about the input.
  for (let hops = 0; hops < 64; hops++) {
    while (i < text.length && /\s/.test(text[i]!)) i++;
    if (i >= text.length) return false;

    if (text.startsWith('<?xml', i)) {
      if (!skipTo('?>')) return false;
      continue;
    }
    if (text.startsWith('<!--', i)) {
      if (!skipTo('-->')) return false;
      continue;
    }
    if (text.slice(i, i + 9).toUpperCase() === '<!DOCTYPE') {
      if (!skipTo('>')) return false;
      continue;
    }
    // Anything else has to be the root element.
    if (text.slice(i, i + 4).toLowerCase() !== '<svg') return false;
    const after = text[i + 4];
    return after === undefined || after === '>' || /\s/.test(after);
  }
  return false;
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

/**
 * How big the image actually is, read from its own header.
 *
 * The web app manifest has to state a `sizes` for each icon, and a browser
 * takes that statement at face value: Chrome will only offer to install a site
 * whose manifest declares an icon of at least 512×512, and it reads the
 * declaration, not the file. So the number has to be true — declaring
 * `512x512` over a 64-pixel logo produces an install prompt followed by a
 * blurry icon, which is worse than no prompt.
 *
 * Measured at upload time, where the bytes are already in hand, rather than at
 * manifest-render time: the file lives behind a storage backend that may be S3,
 * and re-fetching it on a route the browser polls would be a network round trip
 * per request for a number that cannot change after the upload.
 *
 * Returns null for a format whose header we do not walk, and for an SVG — which
 * has no intrinsic pixel size at all, and whose honest `sizes` value is `any`.
 * Callers treat null as "unknown", never as a failure: an operator whose logo
 * we cannot measure still gets their logo, it just cannot claim a pixel size.
 */
export interface ImageDimensions {
  width: number;
  height: number;
}

export function imageDimensions(buf: Buffer): ImageDimensions | null {
  if (!buf || buf.length < 16) return null;

  // PNG — IHDR is always the first chunk, and its width/height are the two
  // big-endian uint32s right after the chunk type. Fixed offsets, so no walk.
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    if (buf.length < 24) return null;
    if (buf.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }

  // GIF — logical screen descriptor, little-endian, right after the signature.
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38])) {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }

  // WEBP — three sub-formats under the same RIFF wrapper, each storing the
  // size differently. VP8X (the extended form an animated or alpha file uses)
  // carries canvas size minus one, in 24-bit little-endian.
  if (
    startsWith(buf, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    const fourcc = buf.subarray(12, 16).toString('latin1');
    if (fourcc === 'VP8X' && buf.length >= 30) {
      const w = buf[24]! | (buf[25]! << 8) | (buf[26]! << 16);
      const h = buf[27]! | (buf[28]! << 8) | (buf[29]! << 16);
      return { width: w + 1, height: h + 1 };
    }
    if (fourcc === 'VP8 ' && buf.length >= 30) {
      // Lossy: the keyframe header's 14-bit dimensions, masked out of two
      // little-endian uint16s.
      return {
        width: buf.readUInt16LE(26) & 0x3fff,
        height: buf.readUInt16LE(28) & 0x3fff,
      };
    }
    if (fourcc === 'VP8L' && buf.length >= 25) {
      // Lossless: 14 bits each, packed across four bytes after the 0x2f
      // signature byte, both stored minus one.
      const bits =
        buf[21]! | (buf[22]! << 8) | (buf[23]! << 16) | (buf[24]! << 24);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }
    return null;
  }

  // JPEG — the only one that needs a walk: the size lives in a start-of-frame
  // marker whose position depends on how much metadata precedes it.
  if (startsWith(buf, [0xff, 0xd8, 0xff])) {
    let i = 2;
    // Bounded by the buffer, and every step advances by at least two bytes, so
    // this terminates on any input including a truncated or hostile one.
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1]!;
      // Padding fill bytes, and the standalone markers that carry no length.
      if (marker === 0xff) {
        i++;
        continue;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      // SOF0..SOF15, minus the four that are not frame headers (DHT 0xc4,
      // JPG 0xc8, DAC 0xcc).
      const isSof =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc;
      if (isSof) {
        // height then width, both big-endian uint16, after the 2-byte segment
        // length and the 1-byte sample precision.
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      // Start of scan — the entropy-coded data begins and there is no frame
      // header left to find.
      if (marker === 0xda) return null;
      const len = buf.readUInt16BE(i + 2);
      if (len < 2) return null;
      i += 2 + len;
    }
    return null;
  }

  return null;
}

/**
 * The `sizes` value for a manifest icon: the measured pixel square, or `any`.
 *
 * `any` is the honest answer for an SVG (it has no intrinsic size), for a
 * format we do not walk, and for a file uploaded before this measurement
 * existed. It is also the honest answer for a non-square image: `sizes` names
 * squares, and a 800×200 banner is not a 800×800 icon.
 */
export function manifestIconSizes(
  dimensions: ImageDimensions | null
): string {
  if (!dimensions) return 'any';
  const { width, height } = dimensions;
  if (width < 1 || height < 1 || width !== height) return 'any';
  return `${width}x${height}`;
}
