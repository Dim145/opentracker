/**
 * Owner-uploaded font faces.
 *
 * The curated list in `packages/shared/src/theme.ts` exists because a font has
 * to BE there: faces are downloaded when the image is built, so a theme can only
 * pick what the build shipped. This is the escape hatch, and it is owner-only for
 * the same reason raw CSS is — it adds bytes every visitor downloads, and a face
 * nobody has reviewed.
 *
 * ## What is validated, and what is not
 *
 * woff2 only. Not conservatism: it is 2026, every browser that can run this
 * application supports it, and one accepted format means one magic number to
 * check rather than four. A `.ttf` renamed to `.woff2` fails the first four
 * bytes.
 *
 * What is NOT validated is the font's internal structure, and the plan asked for
 * `ots-sanitize` here. Two findings moved that decision rather than one opinion:
 *
 *   - **There is no such npm package.** `ots-sanitize`, `ots-wasm` and
 *     `@jsquash/ots` are all unpublished. OTS is Chromium's C++ library, so
 *     using it means a native build in the image and a C++ parser on untrusted
 *     input in the request path — which is the exact shape the plan warns
 *     against two bullets later ("jamais une toolchain de polices en synchrone
 *     sur une requête", citing an RCE in fontTools).
 *   - **The browsers already run it.** OTS is integrated into Chromium and
 *     Firefox precisely so a system rasteriser never sees an unvalidated font.
 *     A face OTS would reject is therefore rejected on the visitor's machine
 *     before it reaches the engine the plan is worried about (FreeType,
 *     zero-click, 2025). Doing it server-side is defence in depth over a check
 *     that already happens, not the only line.
 *
 * So the gate stays: only the owner can put a face here, it must begin `wOF2`,
 * it is served with a fixed `Content-Type` and `nosniff` so it can never be
 * read as anything else, and the family name reaching CSS is generated rather
 * than supplied. If a JS font parser is ever added for another reason — reading
 * `fsType`, computing fallback metrics — the structural check comes free with
 * it and should be turned on then.
 *
 * The licence question the plan also raised is not a parsing problem: a desktop
 * licence does not permit webfont embedding, and no bit in the file settles
 * whether the owner holds the right one. It is asked at the point of action
 * instead, in the upload panel.
 *
 * ## Addressed by content
 *
 * The storage key and the dedup key are both the file's SHA-256. Uploading the
 * same file twice returns the existing row, and the served URL can be cached for
 * a year because the bytes behind an id can never change.
 *
 * ## The name that reaches CSS is not the name the owner typed
 *
 * A theme's token holds `upload:<uuid>`, and the emitted `font-family` is
 * `ot-font-<uuid>` — a string this application generated. The family name the
 * owner types is a label for the picker and never becomes part of a stylesheet,
 * so it cannot carry a quote, a semicolon, or anything else.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { db, schema } from '@trackarr/db';
import { uploadedFontFamily } from '@trackarr/shared/theme';
import { getStorage } from './storage';
import { resolveObjectKey } from './storage/keys';

/**
 * 2 MB. A subset woff2 of a text face is 20-80 kB; a full CJK face is megabytes
 * and has no business being loaded by every visitor of a tracker.
 */
export const MAX_FONT_BYTES = 2 * 1024 * 1024;

/** `wOF2`. woff is `wOFF`, TrueType is `\0\1\0\0`, OpenType is `OTTO`. */
const WOFF2_MAGIC = Buffer.from([0x77, 0x4f, 0x46, 0x32]);

export const FONT_ROLES = ['sans', 'mono', 'display'] as const;
export type FontRole = (typeof FONT_ROLES)[number];

/** The token key a role's faces may be selected for. */
export const TOKEN_FOR_ROLE: Record<FontRole, string> = {
  sans: 'font-sans',
  mono: 'font-mono',
  display: 'font-display',
};

export interface StoredFont {
  id: string;
  family: string;
  role: string;
  bytes: number;
  createdAt: Date;
}

export function isWoff2(data: Buffer): boolean {
  return data.length > 4 && data.subarray(0, 4).equals(WOFF2_MAGIC);
}

/** Everything the picker needs, newest last so the list is stable. */
export async function listFonts(): Promise<StoredFont[]> {
  return db
    .select({
      id: schema.uploadedFonts.id,
      family: schema.uploadedFonts.family,
      role: schema.uploadedFonts.role,
      bytes: schema.uploadedFonts.bytes,
      createdAt: schema.uploadedFonts.createdAt,
    })
    .from(schema.uploadedFonts)
    .orderBy(schema.uploadedFonts.createdAt);
}

/**
 * Store a face, or return the row that already holds these bytes.
 *
 * Idempotent by content hash. An owner who uploads the same file under two
 * names gets one object and the first name — which is a better outcome than two
 * rows pointing at the same bytes, since deleting one would break the other.
 */
export async function storeFont(
  data: Buffer,
  family: string,
  role: FontRole,
  uploadedBy: string,
): Promise<{ font: StoredFont; created: boolean }> {
  const sha256 = createHash('sha256').update(data).digest('hex');

  const [existing] = await db
    .select({
      id: schema.uploadedFonts.id,
      family: schema.uploadedFonts.family,
      role: schema.uploadedFonts.role,
      bytes: schema.uploadedFonts.bytes,
      createdAt: schema.uploadedFonts.createdAt,
    })
    .from(schema.uploadedFonts)
    .where(eq(schema.uploadedFonts.sha256, sha256))
    .limit(1);
  if (existing) return { font: existing, created: false };

  const key = resolveObjectKey(`fonts/${sha256}.woff2`);
  if (!key) {
    // Unreachable — the key is built from a hex digest — but the storage layer
    // requires every key to have been through this function, and asserting that
    // here is cheaper than trusting it.
    throw new Error('could not derive a storage key for the font');
  }
  await getStorage().put(key, data, 'font/woff2');

  const id = randomUUID();
  await db.insert(schema.uploadedFonts).values({
    id,
    family,
    role,
    storageKey: key,
    bytes: data.length,
    sha256,
    uploadedBy,
  });
  return {
    font: { id, family, role, bytes: data.length, createdAt: new Date() },
    created: true,
  };
}

/** The storage key for one id, or null when there is no such row. */
export async function fontKey(id: string): Promise<string | null> {
  const [row] = await db
    .select({ key: schema.uploadedFonts.storageKey })
    .from(schema.uploadedFonts)
    .where(eq(schema.uploadedFonts.id, id))
    .limit(1);
  return row?.key ?? null;
}

/**
 * Which of these `upload:<id>` tokens name a real face for the right ROLE.
 *
 * Two checks in one query, because they fail for the same reason from an admin's
 * point of view — "that is not a font you can use here" — and separating them
 * would tell a caller which of the two it got wrong.
 */
export async function validUploadTokens(
  wanted: Array<{ token: string; role: FontRole }>,
): Promise<Set<string>> {
  if (!wanted.length) return new Set();
  const ids = wanted.map((w) => w.token.slice('upload:'.length));
  const rows = await db
    .select({ id: schema.uploadedFonts.id, role: schema.uploadedFonts.role })
    .from(schema.uploadedFonts)
    .where(inArray(schema.uploadedFonts.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r.role]));
  const ok = new Set<string>();
  for (const w of wanted) {
    const id = w.token.slice('upload:'.length);
    if (byId.get(id) === w.role) ok.add(w.token);
  }
  return ok;
}

/**
 * Every theme whose tokens still name a font that is about to be deleted.
 *
 * There is no foreign key — a token is a string, deliberately, for the same
 * reason `users.theme` has none. So this is what notices.
 */
export async function themesUsingFont(id: string): Promise<string[]> {
  const token = `upload:${id}`;
  const rows = await db
    .select({ name: schema.themes.name, tokens: schema.themes.tokens })
    .from(schema.themes);
  return rows
    .filter((r) =>
      Object.values(TOKEN_FOR_ROLE).some(
        (k) => (r.tokens as Record<string, string>)?.[k] === token,
      ),
    )
    .map((r) => r.name);
}

/** Delete the row and the object. Order matters — see the comment. */
export async function deleteFont(id: string): Promise<boolean> {
  const [row] = await db
    .select({ key: schema.uploadedFonts.storageKey })
    .from(schema.uploadedFonts)
    .where(eq(schema.uploadedFonts.id, id))
    .limit(1);
  if (!row) return false;

  // Row first, object second. If the object delete fails the row is already
  // gone, which leaves an orphaned file — wasted space. The other order leaves a
  // row pointing at nothing, which is a 404 on a font every visitor requests.
  await db.delete(schema.uploadedFonts).where(eq(schema.uploadedFonts.id, id));
  try {
    await getStorage().delete(row.key);
  } catch {
    // Deliberately swallowed: the row is what the application reads.
  }
  return true;
}

/**
 * `@font-face` rules for every uploaded face an enabled theme names.
 *
 * Derived from the token values alone — no query — because the family name is
 * `ot-font-<id>` and the source is `/api/fonts/<id>`, both computed from the id.
 * A token naming a face that has since been deleted produces a rule pointing at
 * a 404, which degrades to the next entry in the stack; emitting nothing would
 * have been the same outcome for more work.
 */
export function fontFaceCss(tokenMaps: Array<Record<string, string>>): string {
  const tokens = new Set<string>();
  for (const map of tokenMaps) {
    for (const key of Object.values(TOKEN_FOR_ROLE)) {
      const v = map[key];
      if (v?.startsWith('upload:')) tokens.add(v);
    }
  }
  if (!tokens.size) return '';
  return [...tokens]
    .sort()
    .map((t) => {
      const id = t.slice('upload:'.length);
      return [
        '@font-face {',
        `  font-family: '${uploadedFontFamily(t)}';`,
        `  src: url('/api/fonts/${id}') format('woff2');`,
        // `swap` for the same reason the curated faces use it: text has to be
        // readable while the face arrives, and an uploaded face is the most
        // likely one to arrive late or not at all.
        '  font-display: swap;',
        '}',
      ].join('\n');
    })
    .join('\n\n');
}

/**
 * Every problem with a token map's `upload:<id>` values: absent, or present for
 * a different role.
 *
 * The shared validator accepts `upload:<uuid>` on shape alone — it is a pure
 * module and cannot ask the database — so this is the other half, and it lives
 * where both write routes can call it. Exactly the split `choosableFor` uses for
 * theme visibility: syntax in `shared`, existence in the API.
 *
 * Returns messages rather than throwing, and that is deliberate: a util that
 * knows about HTTP status codes is doing the route's job, and `createError` is a
 * Nitro auto-import that does not exist outside a Nitro context — so a throwing
 * version could not be tested without a server. `validateTokens` in `shared`
 * returns issues for the same reason.
 */
export async function uploadTokenProblems(
  // `unknown`-valued, and honestly so: this runs on `body.tokens` straight out
  // of `tokenMapSchema`, which validates values without narrowing their type.
  tokens: Record<string, unknown> | undefined,
): Promise<string[]> {
  if (!tokens) return [];
  const wanted: Array<{ token: string; role: FontRole }> = [];
  for (const role of FONT_ROLES) {
    const value = tokens[TOKEN_FOR_ROLE[role]];
    if (typeof value === 'string' && value.startsWith('upload:')) {
      wanted.push({ token: value, role });
    }
  }
  if (!wanted.length) return [];

  const ok = await validUploadTokens(wanted);
  return wanted
    .filter((w) => !ok.has(w.token))
    .map((w) => `${TOKEN_FOR_ROLE[w.role]}: no uploaded ${w.role} font with that id.`);
}

/** For the delete route's guard. */
export async function fontExists(id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.uploadedFonts.id })
    .from(schema.uploadedFonts)
    .where(and(eq(schema.uploadedFonts.id, id)))
    .limit(1);
  return !!row;
}
