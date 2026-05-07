/**
 * Tag resolver for user-supplied tag names.
 *
 * Trackarr's `tags` table predates this helper and ships with an
 * admin-only CRUD UI; the helper here is what makes free-form,
 * user-facing tagging work (issue #45). Given a list of strings the
 * caller doesn't have to know whether they're new or pre-existing —
 * we normalise, look up by slug, and INSERT what's missing.
 *
 * Constraints:
 *   - Trim + collapse whitespace, drop empties.
 *   - Cap individual length at 30 chars (matches the admin form's
 *     50-char ceiling but tighter, since user input is less curated).
 *   - Cap the per-call list at 10 — same as the existing PUT endpoint.
 *   - Slug = lowercased, non-alphanum collapsed to a single hyphen.
 *     Two inputs that produce the same slug ("FHD" and "fhd") resolve
 *     to the same tag.
 */
import { db, schema } from '@trackarr/db';
import { inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';

export const MAX_TAG_NAME_LENGTH = 30;
export const MAX_TAGS_PER_TORRENT = 10;
export const DEFAULT_TAG_COLOR = '#6b7280';

export function slugifyTag(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function normalizeTagName(input: string): string {
  return input.trim().replace(/\s+/g, ' ');
}

interface ResolveResult {
  /** Tag ids in the same logical order as the input (deduped). */
  ids: string[];
  /** How many *new* tags this call had to create. */
  created: number;
}

/**
 * Resolve a list of user-supplied names to tag ids, creating any
 * that don't already exist. Silently ignores blank entries and
 * dedupes by slug. Throws (4xx-style createError) if an input
 * doesn't normalise to anything usable or violates the per-call cap.
 */
export async function resolveTagsByName(
  rawNames: string[]
): Promise<ResolveResult> {
  // Normalise + filter + dedupe by slug.
  const bySlug = new Map<string, string>(); // slug → name (first-seen wins)
  for (const raw of rawNames) {
    if (typeof raw !== 'string') continue;
    const name = normalizeTagName(raw);
    if (!name) continue;
    if (name.length > MAX_TAG_NAME_LENGTH) {
      throw createError({
        statusCode: 400,
        message: `Tag "${name.slice(0, 20)}…" exceeds ${MAX_TAG_NAME_LENGTH} characters`,
      });
    }
    const slug = slugifyTag(name);
    if (!slug) continue;
    if (!bySlug.has(slug)) bySlug.set(slug, name);
  }

  if (bySlug.size > MAX_TAGS_PER_TORRENT) {
    throw createError({
      statusCode: 400,
      message: `Too many tags (max ${MAX_TAGS_PER_TORRENT})`,
    });
  }

  if (bySlug.size === 0) return { ids: [], created: 0 };

  const slugs = Array.from(bySlug.keys());

  const existing = await db.query.tags.findMany({
    where: inArray(schema.tags.slug, slugs),
    columns: { id: true, slug: true },
  });
  const existingBySlug = new Map(existing.map((t) => [t.slug, t.id]));

  // Anything in `slugs` not yet in the DB is created in a single insert.
  const toCreate = slugs
    .filter((s) => !existingBySlug.has(s))
    .map((slug) => ({
      id: randomUUID(),
      name: bySlug.get(slug)!,
      slug,
      color: DEFAULT_TAG_COLOR,
    }));

  if (toCreate.length > 0) {
    // ON CONFLICT DO NOTHING covers the rare race where two requests
    // try to create the same tag simultaneously — a follow-up SELECT
    // picks up whichever insert won.
    try {
      await db
        .insert(schema.tags)
        .values(toCreate)
        .onConflictDoNothing({ target: schema.tags.slug });
    } catch (err) {
      // Name uniqueness constraint can also fire on race — re-resolve.
      console.warn('[tags] insert race, re-resolving:', err);
    }
    const refreshed = await db.query.tags.findMany({
      where: inArray(
        schema.tags.slug,
        toCreate.map((t) => t.slug)
      ),
      columns: { id: true, slug: true },
    });
    for (const r of refreshed) existingBySlug.set(r.slug, r.id);
  }

  return {
    ids: slugs.map((s) => existingBySlug.get(s)!).filter(Boolean),
    created: toCreate.length,
  };
}
