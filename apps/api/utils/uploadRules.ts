/**
 * Upload-rule loader, cache and enforcer.
 *
 * The admin can configure server-enforced gates on every upload from
 * `/admin/upload-rules` (NFO required, description required, per-
 * category title regex, …). Storing them on disk is one round-trip
 * cheaper per upload than touching Postgres on the hot path, so we
 * cache the snapshot in-process with the usual cross-instance Redis
 * pub/sub invalidation pattern that powers `utils/settings.ts`.
 *
 * Public API:
 *   - `getUploadRules()` — returns the snapshot with patterns merged.
 *   - `setUploadRules(...)` — admin endpoint writes through; busts the
 *     cache on every Nitro replica.
 *   - `evaluateUpload(...)` — pure function, takes a snapshot + the
 *     parsed upload payload and returns either `{ ok: true }` or
 *     `{ ok: false, reason: 'Translatable error key' }`.
 */
import { eq } from 'drizzle-orm';
import { db } from '@trackarr/db';
import {
  uploadRules,
  uploadRuleCategoryPatterns,
  categories as categoriesTable,
} from '@trackarr/db/schema';
import { redis } from '../redis/client';

/** Cache TTL — same 60 s window as `utils/settings.ts` so cross-
 *  instance staleness is bounded even if pub/sub goes silent. */
const CACHE_TTL_MS = 60_000;
const CACHE_KEY = 'upload-rules:snapshot';

/** Redis pub/sub channel for cross-instance invalidation. The
 *  payload doesn't matter — receiving any message busts the cache. */
const INVALIDATE_CHANNEL = 'upload-rules:invalidate';

export interface UploadRulesSnapshot {
  nfoRequired: boolean;
  descriptionRequired: boolean;
  descriptionMinLength: number;
  titlePatternEnforced: boolean;
  titleBlocklist: string | null;
  tmdbIdRequired: boolean;
  maxTorrentSize: number | null;
  staffBypass: boolean;
  /**
   * Raw patterns — categories where an admin explicitly typed a
   * regex. Used by the admin form to render "own pattern" inputs
   * (distinct from inherited values). Already anchored with ^…$.
   */
  categoryPatterns: Record<string, string>;
  /**
   * Resolved patterns after the inheritance walk. For any category
   * that either carries its own pattern OR descends from one, this
   * map holds the regex that should actually be enforced.
   *
   * Inheritance: if a child has no own pattern, it inherits from
   * the nearest ancestor that does; a child's own pattern overrides
   * every ancestor. Resolved once at cache-miss time so the runtime
   * enforcer and the client form just do a single lookup.
   */
  effectiveCategoryPatterns: Record<string, string>;
}

interface CacheEntry {
  value: UploadRulesSnapshot;
  expiresAt: number;
}

let cached: CacheEntry | null = null;
let subscriberReady = false;

/** Idempotent — first call across the process opens the SUBSCRIBE
 *  socket. Failure is non-fatal: the TTL still bounds staleness. */
function ensureSubscriber(): void {
  if (subscriberReady) return;
  subscriberReady = true;
  try {
    const sub = redis.duplicate({ lazyConnect: false });
    sub.on('error', (err) => {
      console.warn('[UploadRules] subscriber error:', err.message);
    });
    sub.subscribe(INVALIDATE_CHANNEL).catch((err: Error) => {
      console.warn('[UploadRules] subscribe failed:', err.message);
    });
    sub.on('message', (channel) => {
      if (channel === INVALIDATE_CHANNEL) {
        cached = null;
      }
    });
  } catch (err: any) {
    console.warn('[UploadRules] could not start subscriber:', err.message);
  }
}

/** Defaults that ship a brand-new tracker: everything off, staff
 *  bypass on, no caps. The first admin who visits the page can
 *  flip things on as policy evolves. */
const DEFAULTS: UploadRulesSnapshot = {
  nfoRequired: false,
  descriptionRequired: false,
  descriptionMinLength: 0,
  titlePatternEnforced: false,
  titleBlocklist: null,
  tmdbIdRequired: false,
  maxTorrentSize: null,
  staffBypass: true,
  categoryPatterns: {},
  effectiveCategoryPatterns: {},
};

/**
 * Walk the category tree and produce the inheritance-resolved map.
 *
 * For every category, climb the parent chain looking for the
 * nearest pattern. The first match wins — a child's own pattern is
 * always tried first (depth = 0). Cycles are defended against with
 * a `seen` set, which shouldn't be possible given the FK shape but
 * is cheap insurance against a bad migration.
 */
function resolveInheritance(
  rawPatterns: Record<string, string>,
  cats: Array<{ id: string; parentId: string | null }>,
): Record<string, string> {
  const parentOf = new Map<string, string | null>();
  for (const c of cats) parentOf.set(c.id, c.parentId);

  const resolved: Record<string, string> = {};
  for (const c of cats) {
    let cur: string | null = c.id;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      if (rawPatterns[cur]) {
        resolved[c.id] = rawPatterns[cur];
        break;
      }
      cur = parentOf.get(cur) ?? null;
    }
  }
  return resolved;
}

/** Read the snapshot. Cache hit: O(1). Cache miss: three queries
 *  (singleton row + patterns + category tree) and the inheritance
 *  walk, merged into one object. */
export async function getUploadRules(): Promise<UploadRulesSnapshot> {
  ensureSubscriber();
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  // Three reads in parallel — none of them depend on the others.
  // The singleton may not exist yet (fresh install); the defaults
  // kick in below.
  const [rows, patternRows, catRows] = await Promise.all([
    db
      .select()
      .from(uploadRules)
      .where(eq(uploadRules.id, 'singleton'))
      .limit(1),
    db
      .select({
        categoryId: uploadRuleCategoryPatterns.categoryId,
        pattern: uploadRuleCategoryPatterns.pattern,
      })
      .from(uploadRuleCategoryPatterns),
    db
      .select({
        id: categoriesTable.id,
        parentId: categoriesTable.parentId,
      })
      .from(categoriesTable),
  ]);
  const row = rows[0];

  const categoryPatterns: Record<string, string> = {};
  for (const p of patternRows) {
    categoryPatterns[p.categoryId] = p.pattern;
  }

  // Inheritance — a child's own pattern wins over any ancestor;
  // categories with no own pattern inherit from the nearest
  // ancestor that has one. Pre-computed here so the runtime
  // enforcer + client form do a single lookup, not a tree walk.
  const effectiveCategoryPatterns = resolveInheritance(
    categoryPatterns,
    catRows,
  );

  const snapshot: UploadRulesSnapshot = row
    ? {
        nfoRequired: row.nfoRequired,
        descriptionRequired: row.descriptionRequired,
        descriptionMinLength: row.descriptionMinLength,
        titlePatternEnforced: row.titlePatternEnforced,
        titleBlocklist: row.titleBlocklist,
        tmdbIdRequired: row.tmdbIdRequired,
        maxTorrentSize: row.maxTorrentSize,
        staffBypass: row.staffBypass,
        categoryPatterns,
        effectiveCategoryPatterns,
      }
    : { ...DEFAULTS, categoryPatterns, effectiveCategoryPatterns };

  cached = { value: snapshot, expiresAt: now + CACHE_TTL_MS };
  return snapshot;
}

/** Bust the local cache + publish to every other Nitro replica.
 *  Called from the admin PUT endpoint after a successful write. */
export async function invalidateUploadRulesCache(): Promise<void> {
  cached = null;
  try {
    await redis.publish(INVALIDATE_CHANNEL, '1');
  } catch (err: any) {
    console.warn('[UploadRules] invalidate publish error:', err.message);
  }
}

/** Inputs the enforcer sees. Independent of any wire shape so the
 *  client-side validator (which also reuses `evaluateUpload`) can
 *  pass the same payload. */
export interface EvaluateInput {
  title: string;
  description: string | null;
  nfo: string | null;
  tmdbId: string | null;
  /** Resolved category id of the upload, after the form's
   *  parent/leaf disambiguation. Compared against the per-category
   *  pattern map. */
  categoryId: string | null;
  /** Total parsed size in bytes — used by the size cap rule. */
  sizeBytes: number;
  /** True when the uploader is staff (admin or moderator). The
   *  enforcer short-circuits on this flag when `staffBypass = true`. */
  isStaff: boolean;
}

export interface EvaluateOutcome {
  ok: boolean;
  /** Stable machine-readable key — the client maps it to a localised
   *  message; the server's HTTP message echoes the same key. */
  reason?:
    | 'nfo_required'
    | 'description_required'
    | 'description_too_short'
    | 'title_blocklisted'
    | 'title_pattern_mismatch'
    | 'tmdb_required'
    | 'size_too_large';
  /** Free-text context the UI can drop next to `reason`. For
   *  size_too_large that's the cap; for description_too_short the
   *  minimum; for title_pattern_mismatch the pattern. */
  detail?: string;
}

/** Pure function — no DB, no Redis. Takes a snapshot + payload,
 *  returns a single outcome. Order matters: the cheap checks
 *  (presence) run before the regex compilation passes so a missing
 *  NFO surfaces before a malformed regex would throw. */
export function evaluateUpload(
  snapshot: UploadRulesSnapshot,
  input: EvaluateInput,
): EvaluateOutcome {
  if (snapshot.staffBypass && input.isStaff) {
    return { ok: true };
  }

  if (snapshot.nfoRequired && (!input.nfo || input.nfo.trim() === '')) {
    return { ok: false, reason: 'nfo_required' };
  }

  if (snapshot.descriptionRequired) {
    const trimmed = (input.description ?? '').trim();
    if (trimmed === '') {
      return { ok: false, reason: 'description_required' };
    }
    if (
      snapshot.descriptionMinLength > 0 &&
      trimmed.length < snapshot.descriptionMinLength
    ) {
      return {
        ok: false,
        reason: 'description_too_short',
        detail: String(snapshot.descriptionMinLength),
      };
    }
  }

  if (snapshot.tmdbIdRequired && !input.tmdbId) {
    return { ok: false, reason: 'tmdb_required' };
  }

  if (
    snapshot.maxTorrentSize !== null &&
    input.sizeBytes > snapshot.maxTorrentSize
  ) {
    return {
      ok: false,
      reason: 'size_too_large',
      detail: String(snapshot.maxTorrentSize),
    };
  }

  // Title gates run last — they're the most likely to throw on a
  // malformed admin-configured regex, and we'd rather surface that
  // as a 500 to admin than silently accept a torrent that should
  // have been rejected on size/NFO/etc.
  if (snapshot.titleBlocklist) {
    try {
      const re = new RegExp(snapshot.titleBlocklist, 'i');
      if (re.test(input.title)) {
        return {
          ok: false,
          reason: 'title_blocklisted',
          detail: snapshot.titleBlocklist,
        };
      }
    } catch {
      // Defensive — admin save path already validates the regex, so
      // this branch is unreachable in practice. If it fires, we
      // log and fail open (the blocklist is a coarse hygiene check,
      // not a security boundary).
      console.warn(
        '[UploadRules] titleBlocklist regex compile failed, skipping',
      );
    }
  }

  if (snapshot.titlePatternEnforced && input.categoryId) {
    // Lookup the *effective* pattern — child's own value if set,
    // otherwise the nearest ancestor's. The map is pre-resolved at
    // snapshot load time so the inheritance walk doesn't run on
    // the upload hot path.
    const pattern = snapshot.effectiveCategoryPatterns[input.categoryId];
    if (pattern) {
      try {
        const re = new RegExp(pattern, 'i');
        if (!re.test(input.title)) {
          return {
            ok: false,
            reason: 'title_pattern_mismatch',
            detail: pattern,
          };
        }
      } catch {
        console.warn(
          '[UploadRules] category pattern regex compile failed, skipping',
          { categoryId: input.categoryId },
        );
      }
    }
  }

  return { ok: true };
}

/**
 * Wrap a user-supplied regex source with `^…$`. Idempotent (won't
 * double-wrap if the operator already added anchors). Called from
 * the admin PUT path before persisting the pattern.
 */
export function anchorPattern(raw: string): string {
  let out = raw.trim();
  if (!out.startsWith('^')) out = `^${out}`;
  if (!out.endsWith('$')) out = `${out}$`;
  return out;
}

/** Validate that a candidate regex compiles. Returns the anchored
 *  form on success; null on failure. The admin save path uses this
 *  to reject invalid input *before* writing it to the table — that
 *  way the enforcer never has to skip a malformed pattern. */
export function validateAndAnchor(raw: string): string | null {
  const candidate = anchorPattern(raw);
  try {
    new RegExp(candidate, 'i');
    return candidate;
  } catch {
    return null;
  }
}
