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

/**
 * Canonicalisation lives in `@trackarr/shared` now, because a member holding
 * their own key signs in a browser and the two sides have to produce the same
 * bytes. Re-exported here so every existing caller — and this file's tests —
 * keep pointing at one implementation rather than two that agree today.
 */
export {
  CanonicalisationError,
  canonicalise,
} from '@trackarr/shared/didProof';

import { canonicalUtf8 } from '@trackarr/shared/didProof';

/** Canonical form as bytes, which is what actually gets hashed and signed. */
export function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(canonicalUtf8(value));
}
