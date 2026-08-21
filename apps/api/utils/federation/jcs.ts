/**
 * JSON Canonicalization Scheme — RFC 8785.
 *
 * One JSON value, one byte sequence. Without that, a signature over JSON is
 * meaningless: two servers that agree on the *value* would disagree on the
 * *bytes*, so a record signed by one would fail verification on the other for
 * no reason anybody could see. Key order, whitespace and number formatting are
 * all free choices in JSON, and all three change the hash.
 *
 * Written here rather than pulled in: the whole scheme is three rules, the
 * repository holds a deliberately conservative dependency policy (pnpm
 * `minimumReleaseAge` / `trustPolicy`), and a canonicaliser is exactly the kind
 * of thing that must be readable by whoever debugs a signature mismatch at
 * three in the morning.
 *
 * The three rules:
 *
 * 1. **Object keys sort by UTF-16 code unit.** Which is what JavaScript's
 *    default string comparison already does — the one place the language's
 *    odd default is the correct one.
 * 2. **Arrays keep their order.** They are values, not sets.
 * 3. **Numbers serialise as ECMAScript does**, which `JSON.stringify` gives us
 *    for free. Non-finite numbers are not JSON and are refused rather than
 *    silently turned into `null`, which is what `JSON.stringify` would do.
 *
 * Strings need no special handling: `JSON.stringify`'s escaping is already what
 * RFC 8785 mandates — minimal escapes, `\u` only for control characters, lone
 * surrogates preserved.
 *
 * This is the canonicalisation `eddsa-jcs-2022` names, so aligning here is what
 * keeps the door open to signing records the wider fediverse can verify
 * (FEP-8b32) without a second format later.
 */

/** Anything that survives a JSON round trip. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export class CanonicalisationError extends Error {}

/**
 * The canonical form of a JSON value, as a string.
 *
 * Throws rather than coercing. A record carrying `undefined`, a function or a
 * `NaN` is a bug upstream, and quietly dropping the field would produce a
 * signature over something other than what the caller thought they signed —
 * the worst possible failure for a signing primitive.
 */
export function canonicalise(value: unknown): string {
  return write(value, 0);
}

/** Canonical form as bytes, which is what actually gets hashed and signed. */
export function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(canonicalise(value), 'utf8');
}

/**
 * Deeply nested input is refused rather than allowed to blow the stack. A
 * catalogue record is three levels deep at most; anything approaching this is
 * either a bug or a hostile payload from a partner.
 */
const MAX_DEPTH = 64;

function write(value: unknown, depth: number): string {
  if (depth > MAX_DEPTH) {
    throw new CanonicalisationError('value nested too deeply');
  }

  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';

    case 'number':
      if (!Number.isFinite(value)) {
        // `JSON.stringify` turns these into `null`, which would mean a
        // signature over a value the caller never had.
        throw new CanonicalisationError(`${value} is not representable in JSON`);
      }
      // ECMAScript number-to-string is exactly what RFC 8785 requires, down to
      // `-0` serialising as `0` and `5e-324` keeping its exponent.
      return JSON.stringify(value);

    case 'string':
      // RFC 8785 defers to ECMAScript's `JSON.stringify` for string escaping.
      return JSON.stringify(value);

    case 'object':
      break;

    default:
      throw new CanonicalisationError(`cannot canonicalise ${typeof value}`);
  }

  if (Array.isArray(value)) {
    return `[${value.map((v) => write(v, depth + 1)).join(',')}]`;
  }

  const obj = value as Record<string, unknown>;
  // `sort()` with no comparator compares UTF-16 code units, which is the
  // ordering RFC 8785 specifies. Spelled out because it reads like an
  // oversight otherwise — and because a "helpful" `localeCompare` here would
  // break every signature on a differently-configured host.
  const keys = Object.keys(obj).sort();

  const parts: string[] = [];
  for (const key of keys) {
    const v = obj[key];
    if (v === undefined) {
      throw new CanonicalisationError(
        `property "${key}" is undefined — drop it or make it null`,
      );
    }
    parts.push(`${JSON.stringify(key)}:${write(v, depth + 1)}`);
  }
  return `{${parts.join(',')}}`;
}
