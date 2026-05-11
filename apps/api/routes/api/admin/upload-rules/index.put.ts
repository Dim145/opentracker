/**
 * PUT /api/admin/upload-rules
 *
 * Admin-only — replace the singleton row + the per-category pattern
 * table in one transaction. Every category pattern is validated +
 * anchored before being persisted, so a malformed regex never lands
 * in the table — that way the runtime enforcer can compile blindly.
 *
 * The cache is invalidated cross-instance via the Redis pub/sub
 * channel `upload-rules:invalidate`, so every Nitro replica reloads
 * the new snapshot on its next access (no per-replica restart
 * required).
 */
import { z } from 'zod';
import { notInArray } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireAdminSession } from '~~/utils/adminAuth';
import { validateBody } from '~~/utils/schemas';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import {
  invalidateUploadRulesCache,
  validateAndAnchor,
} from '~~/utils/uploadRules';

const bodySchema = z
  .object({
    nfoRequired: z.boolean(),
    descriptionRequired: z.boolean(),
    // 0–10_000 — generous upper bound; in practice an operator who
    // demands a 10_000-char description isn't going to find many
    // uploaders willing to oblige, but we don't artificially clamp.
    descriptionMinLength: z.number().int().min(0).max(10_000),
    titlePatternEnforced: z.boolean(),
    /** Free-form regex source for the global blocklist, or null. */
    titleBlocklist: z.string().trim().max(500).nullable(),
    tmdbIdRequired: z.boolean(),
    /** Bytes; null = no cap. Bounded at 1 PiB to keep the int safe. */
    maxTorrentSize: z
      .number()
      .int()
      .min(0)
      .max(1024 ** 5)
      .nullable(),
    staffBypass: z.boolean(),
    /** Per-leaf-category regex map. Empty strings = "remove this
     *  category's pattern"; the API filters them out before write. */
    categoryPatterns: z.record(z.string(), z.string().trim().max(500)),
  })
  .strict();

export default defineEventHandler(async (event) => {
  await rateLimit(event, RATE_LIMITS.admin);
  await requireAdminSession(event);
  const body = await validateBody(event, bodySchema);

  // ── Regex validation before any DB write ──────────────────────
  //
  // Three sources of regex on this endpoint: the global title
  // blocklist + every per-category pattern. Each one is wrapped
  // with ^…$ and compiled in a try/catch; any failure aborts the
  // request with a 400 listing every offending field. The client
  // mirrors the same validation locally for live red-borders, but
  // this server-side pass is the one that keeps the runtime
  // enforcer's `new RegExp(pattern)` from ever throwing.
  const invalidFields: string[] = [];
  let anchoredBlocklist: string | null = null;
  if (body.titleBlocklist) {
    const v = validateAndAnchor(body.titleBlocklist);
    if (!v) invalidFields.push('titleBlocklist');
    else anchoredBlocklist = v;
  }

  const anchoredPatterns: Record<string, string> = {};
  for (const [categoryId, raw] of Object.entries(body.categoryPatterns)) {
    if (!raw) continue; // empty string = "remove this row"
    const v = validateAndAnchor(raw);
    if (!v) invalidFields.push(`categoryPatterns.${categoryId}`);
    else anchoredPatterns[categoryId] = v;
  }

  if (invalidFields.length > 0) {
    throw createError({
      statusCode: 400,
      data: { invalidFields },
      message: `Invalid regex on: ${invalidFields.join(', ')}`,
    });
  }

  // ── Write everything atomically ──────────────────────────────
  await db.transaction(async (tx) => {
    await tx
      .insert(schema.uploadRules)
      .values({
        id: 'singleton',
        nfoRequired: body.nfoRequired,
        descriptionRequired: body.descriptionRequired,
        descriptionMinLength: body.descriptionMinLength,
        titlePatternEnforced: body.titlePatternEnforced,
        titleBlocklist: anchoredBlocklist,
        tmdbIdRequired: body.tmdbIdRequired,
        maxTorrentSize: body.maxTorrentSize,
        staffBypass: body.staffBypass,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.uploadRules.id,
        set: {
          nfoRequired: body.nfoRequired,
          descriptionRequired: body.descriptionRequired,
          descriptionMinLength: body.descriptionMinLength,
          titlePatternEnforced: body.titlePatternEnforced,
          titleBlocklist: anchoredBlocklist,
          tmdbIdRequired: body.tmdbIdRequired,
          maxTorrentSize: body.maxTorrentSize,
          staffBypass: body.staffBypass,
          updatedAt: new Date(),
        },
      });

    // Pattern table: full-replace semantics. Anything not in the
    // payload is dropped; anything new is upserted. We delete the
    // disjoint set with `notInArray` rather than truncate-then-
    // insert so a category whose pattern didn't change doesn't get
    // its `updatedAt` bumped pointlessly.
    const keepIds = Object.keys(anchoredPatterns);
    if (keepIds.length > 0) {
      await tx
        .delete(schema.uploadRuleCategoryPatterns)
        .where(
          notInArray(schema.uploadRuleCategoryPatterns.categoryId, keepIds),
        );
      for (const [categoryId, pattern] of Object.entries(anchoredPatterns)) {
        await tx
          .insert(schema.uploadRuleCategoryPatterns)
          .values({ categoryId, pattern, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: schema.uploadRuleCategoryPatterns.categoryId,
            set: { pattern, updatedAt: new Date() },
          });
      }
    } else {
      await tx.delete(schema.uploadRuleCategoryPatterns);
    }
  });

  await invalidateUploadRulesCache();

  return { success: true };
});
