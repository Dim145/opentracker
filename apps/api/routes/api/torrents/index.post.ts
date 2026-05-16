import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import parseTorrent from 'parse-torrent';
import { computeContentSignature } from '~~/utils/contentSignature';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { resolveTagsByName, slugifyTag, MAX_TAGS_PER_TORRENT } from '~~/utils/tags';
import { inferReleaseTags } from '~~/utils/releaseTags';
import { normalizeMediaId } from '~~/utils/mediaIds';
import { getUploadRules, evaluateUpload } from '~~/utils/uploadRules';
import { notifyMany, listStaffRecipients } from '~~/utils/notify';

export default defineEventHandler(async (event) => {
  // Require authentication
  const { user } = await requireUserSession(event);

  // Rate limit uploads
  await rateLimit(event, RATE_LIMITS.mutation);

  // Read multipart form data
  const formData = await readMultipartFormData(event);

  if (!formData || formData.length === 0) {
    throw createError({
      statusCode: 400,
      message: 'No file uploaded',
    });
  }

  const file = formData.find(
    (f) => f.name === 'torrent' || f.filename?.endsWith('.torrent')
  );
  const categoryId = formData
    .find((f) => f.name === 'categoryId')
    ?.data.toString();
  // Optional human-readable override for the release name. The form uses
  // it to let the uploader rewrite the parsed `.torrent` name (which is
  // often a scene-style filename) into something more readable. Empty or
  // absent → fall through to the parsed name.
  const customName = formData
    .find((f) => f.name === 'name')
    ?.data.toString()
    ?.trim();
  const description = formData
    .find((f) => f.name === 'description')
    ?.data.toString();
  const tagsRaw = formData.find((f) => f.name === 'tags')?.data.toString();
  // External media-database tags. Each is normalised (URL → bare id);
  // non-matching input is silently dropped to null rather than 400ing
  // since the user can fix the field afterwards via Edit.
  const imdbId = normalizeMediaId(
    'imdb',
    formData.find((f) => f.name === 'imdbId')?.data.toString()
  );
  const tmdbId = normalizeMediaId(
    'tmdb',
    formData.find((f) => f.name === 'tmdbId')?.data.toString()
  );
  const tvdbId = normalizeMediaId(
    'tvdb',
    formData.find((f) => f.name === 'tvdbId')?.data.toString()
  );
  // IGDB accepts URL / slug / id input — slug→id resolves via a
  // single IGDB ping, so we always store the canonical numeric id.
  // Failures (network down, IGDB key missing) drop to null silently
  // rather than blocking the upload — the user can fix it later.
  let igdbId: string | null = null;
  const igdbInput = formData.find((f) => f.name === 'igdbId')?.data.toString();
  if (igdbInput) {
    try {
      const { normalizeSourceId, isSourceEnabled } = await import(
        '~~/utils/metadata'
      );
      if (isSourceEnabled('igdb')) {
        igdbId = await normalizeSourceId('igdb', igdbInput);
      }
    } catch (err) {
      console.warn('[torrents] IGDB normalize failed:', (err as Error).message);
    }
  }
  // Open Library accepts ISBN (10/13) / Open Library work id / URL.
  // The source is always enabled (no auth) so we don't gate on
  // `isSourceEnabled`; only network failures drop to null.
  let openlibraryId: string | null = null;
  const openlibraryInput = formData
    .find((f) => f.name === 'openlibraryId')
    ?.data.toString();
  if (openlibraryInput) {
    try {
      const { normalizeSourceId } = await import('~~/utils/metadata');
      openlibraryId = await normalizeSourceId('openlibrary', openlibraryInput);
    } catch (err) {
      console.warn(
        '[torrents] Open Library normalize failed:',
        (err as Error).message
      );
    }
  }
  // NFO can arrive either as a `.nfo` file part or as a plain `nfo` string
  // (e.g. user pasted the contents into a textarea). Cap at 256KB so we
  // can't be used to dump arbitrary blobs into the row.
  const NFO_MAX_BYTES = 256 * 1024;
  const nfoFile = formData.find(
    (f) => f.name === 'nfoFile' || f.filename?.toLowerCase().endsWith('.nfo')
  );
  const nfoText = formData.find((f) => f.name === 'nfo')?.data.toString();
  let nfo: string | null = null;
  if (nfoFile?.data && nfoFile.data.length > 0) {
    if (nfoFile.data.length > NFO_MAX_BYTES) {
      throw createError({
        statusCode: 413,
        message: `NFO file exceeds ${NFO_MAX_BYTES} bytes`,
      });
    }
    nfo = decodeNfo(nfoFile.data);
  } else if (nfoText && nfoText.length > 0) {
    if (Buffer.byteLength(nfoText, 'utf8') > NFO_MAX_BYTES) {
      throw createError({
        statusCode: 413,
        message: `NFO content exceeds ${NFO_MAX_BYTES} bytes`,
      });
    }
    nfo = nfoText;
  }

  if (!file || !file.data) {
    throw createError({
      statusCode: 400,
      message: 'No .torrent file found in request',
    });
  }

  // Parse the torrent file
  let parsed: Awaited<ReturnType<typeof parseTorrent>>;
  try {
    parsed = await parseTorrent(file.data);
  } catch (_err) {
    throw createError({
      statusCode: 400,
      message: 'Invalid torrent file',
    });
  }

  if (!parsed.infoHash) {
    throw createError({
      statusCode: 400,
      message: 'Could not extract info hash from torrent',
    });
  }

  const infoHash = parsed.infoHash.toLowerCase();
  // 256 chars matches typical scene name lengths and gives a sane
  // upper bound without truncating real-world torrents.
  const name = (customName?.slice(0, 256) || parsed.name || file.filename || 'Unknown');

  // Calculate total size
  let totalSize = 0;
  if (parsed.length) {
    totalSize = parsed.length;
  } else if (parsed.files && Array.isArray(parsed.files)) {
    totalSize = parsed.files.reduce((sum, f) => sum + (f.length || 0), 0);
  }

  // ── Server-side upload-rule enforcement ───────────────────────
  //
  // Runs *after* we've parsed the .torrent (we need the title and
  // size) but *before* the duplicate check, so a rejected payload
  // never even gets compared against the existing index. Defaults
  // are all-off so a fresh install behaves exactly as before; the
  // admin opts in to each rule from /admin/upload-rules.
  //
  // `categoryId` may be undefined here (the upload form normally
  // sends one, but defensive code paths exist); the per-category
  // pattern rule short-circuits cleanly in that case via `null`.
  const rules = await getUploadRules();
  const ruleOutcome = evaluateUpload(rules, {
    title: customName?.slice(0, 256) || parsed.name || file.filename || '',
    description: description ?? null,
    nfo,
    tmdbId,
    categoryId: categoryId ?? null,
    sizeBytes: totalSize,
    isStaff: !!(user.isAdmin || user.isModerator),
  });
  if (!ruleOutcome.ok) {
    // The `reason` is a stable machine-readable key the client
    // already knows how to localise. We pass it through both the
    // statusMessage (for clients that read only that) and the
    // `data.reason` field (for the rich rejection toast).
    throw createError({
      statusCode: 422,
      statusMessage: ruleOutcome.reason,
      message: ruleOutcome.reason ?? 'Upload rejected by tracker rules',
      data: { reason: ruleOutcome.reason, detail: ruleOutcome.detail },
    });
  }

  // Check if torrent already exists. We branch on its moderation
  // status so a previously-rejected upload can never be silently
  // re-introduced — that's the whole reason rejected rows are kept
  // in the table instead of being deleted.
  const existing = await db.query.torrents.findFirst({
    where: (t, { eq }) => eq(t.infoHash, infoHash),
  });

  if (existing) {
    if (existing.moderationStatus === 'rejected') {
      throw createError({
        statusCode: 403,
        statusMessage: 'Forbidden',
        message:
          'This torrent has previously been rejected by moderation. Re-uploading it is not allowed.',
      });
    }
    // Otherwise (pending / changes_requested / accepted) just hand
    // the existing row back. The uploader can find it on /me, and a
    // moderator can act on it via the queue.
    return {
      success: true,
      message: 'Torrent already exists',
      data: {
        ...existing,
        magnetLink: generateMagnetLink(infoHash, name),
      },
    };
  }

  // Insert new torrent
  const id = randomUUID();
  const now = new Date();

  // Check if user can bypass moderation. The legacy "one role per user"
  // relation was replaced by a many-to-many junction (`userRoles`) earlier
  // in this branch, so we walk every attached role and pass if *any* of
  // them carries the `canUploadWithoutModeration` flag. Staff still get
  // the bypass straight from their `is_admin` / `is_moderator` columns.
  const canBypassModeration =
    user.isAdmin ||
    user.isModerator ||
    (await userHasUploadBypass(user.id));

  // Content signature — same content under a different info_hash (different
  // piece size, different `private` flag, different announce list, …)
  // shares this fingerprint. Used for cross-seed discovery and metrics.
  const contentSignature = computeContentSignature({
    name: parsed.name,
    length: parsed.length,
    files: parsed.files?.map((f) => ({ path: f.path, length: f.length })),
  });

  await db.insert(schema.torrents).values({
    id,
    infoHash,
    name,
    size: totalSize,
    description: description || null,
    nfo,
    torrentData: Buffer.from(file.data),
    uploaderId: user.id, // Set uploader from authenticated user
    categoryId: categoryId || null,
    imdbId,
    tmdbId,
    tvdbId,
    igdbId,
    openlibraryId,
    contentSignature,
    isActive: true,
    moderationStatus: canBypassModeration ? 'accepted' : 'pending',
    moderatedById: canBypassModeration ? user.id : null,
    moderatedAt: canBypassModeration ? now : null,
    createdAt: now,
  });

  // Initialize stats
  await db.insert(schema.torrentStats).values({
    infoHash,
    seeders: 0,
    leechers: 0,
    completed: 0,
    updatedAt: now,
  });

  // ── Tag attachment ─────────────────────────────────────────────
  //
  // Two sources feed the final tag set:
  //
  //   1. **User-declared tags** from the form (`tags` / `tagIds`) —
  //      free-form names and/or pre-resolved UUIDs. Always honoured.
  //
  //   2. **Auto-inferred tags** from `inferReleaseTags(name, nfo)` —
  //      facets the parser extracted from the filename and NFO body
  //      (resolution, codec, source, audio, language, HDR, extras).
  //      Title is authoritative; NFO only fills the facets the title
  //      was silent about ("ajout de tags si pas parser par le
  //      titre"). User-declared slugs win on collision — never
  //      overwriting what the operator typed by hand.
  //
  // Everything funnels through the same `resolveTagsByName()` call so
  // the per-torrent cap, slug normalisation, and on-conflict-do-
  // nothing race protection are applied uniformly.
  const userIds: string[] = [];
  const userNames: string[] = [];

  if (tagsRaw) {
    try {
      const parsedTags = JSON.parse(tagsRaw) as unknown;
      if (
        Array.isArray(parsedTags) &&
        parsedTags.every((v) => typeof v === 'string')
      ) {
        // Heuristic: a UUIDv4 has 36 chars with hyphens at fixed
        // offsets. Anything that doesn't look like a UUID is treated
        // as a free-form tag name — lets old callers (admin tag
        // picker → ids) and new ones (upload modal → names) share
        // the same form field.
        const looksLikeUuid = (s: string) =>
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
        for (const v of parsedTags as string[]) {
          if (looksLikeUuid(v)) userIds.push(v);
          else userNames.push(v);
        }
      }
    } catch {
      // Invalid tags JSON: just skip the user-declared side; we'll
      // still attach the auto-inferred facets below.
    }
  }

  // Auto-inferred names from the release name + NFO body. Skip any
  // whose canonical slug collides with one the user already typed,
  // so user intent always wins.
  const userSlugs = new Set(userNames.map(slugifyTag));
  const inferredNames = inferReleaseTags(name, nfo).filter(
    (n) => !userSlugs.has(slugifyTag(n))
  );

  let resolvedIds: string[] = [];
  if (userNames.length > 0 || inferredNames.length > 0) {
    try {
      // User-declared names come first so they survive the per-call
      // truncation if the combined list exceeds MAX_TAGS_PER_TORRENT.
      const r = await resolveTagsByName([...userNames, ...inferredNames]);
      resolvedIds = r.ids;
    } catch (err) {
      // `resolveTagsByName` throws createError on bad input (over
      // length, too many tags, etc.) — don't fail the whole upload
      // because of a tag issue; surface a warning instead.
      console.warn('[torrents] auto-tag resolution failed:', err);
    }
  }

  const allTagIds = Array.from(new Set([...userIds, ...resolvedIds])).slice(
    0,
    MAX_TAGS_PER_TORRENT
  );
  if (allTagIds.length > 0) {
    await db
      .insert(schema.torrentTags)
      .values(allTagIds.map((tagId) => ({ torrentId: id, tagId })))
      .onConflictDoNothing();
  }

  const torrent = {
    id,
    infoHash,
    name,
    size: totalSize,
    isActive: true,
    moderationStatus: canBypassModeration ? 'accepted' : 'pending',
    createdAt: now.toISOString(),
    magnetLink: generateMagnetLink(infoHash, name),
  };

  // Tell every staff member when a new torrent lands in the
  // pending queue. Skipped on bypass paths (the row never enters
  // moderation in that case so there's nothing to review).
  if (!canBypassModeration) {
    void (async () => {
      try {
        const staff = await listStaffRecipients();
        // Exclude the uploader if they're also staff — they
        // already know they just uploaded.
        const recipients = staff.filter((sid) => sid !== user.id);
        await notifyMany(
          recipients,
          'new_pending_upload',
          {
            torrentName: name,
            uploaderUsername: user.username,
          },
          `/torrents/${infoHash}`,
        );
      } catch (err) {
        console.warn(
          '[Upload] mod notify fan-out failed:',
          (err as Error).message,
        );
      }
    })();
  }

  return {
    success: true,
    message: canBypassModeration
      ? 'Torrent created successfully'
      : 'Torrent uploaded and pending moderation approval',
    data: torrent,
  };
});

function generateMagnetLink(infoHash: string, name: string): string {
  const trackerUrl = useRuntimeConfig().public.trackerHttpUrl as string;
  const encodedName = encodeURIComponent(name);
  return `magnet:?xt=urn:btih:${infoHash}&dn=${encodedName}&tr=${encodeURIComponent(trackerUrl)}`;
}

/**
 * Returns true when any of the user's attached roles carries the
 * `canUploadWithoutModeration` permission. We do the join through the
 * `user_roles` junction table since the legacy `users.role_id` column
 * has been dropped.
 */
async function userHasUploadBypass(userId: string): Promise<boolean> {
  const rows = await db
    .select({ canBypass: schema.roles.canUploadWithoutModeration })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
    .where(eq(schema.userRoles.userId, userId));
  return rows.some((r) => r.canBypass === true);
}

/**
 * NFO files traditionally use CP437 for the ASCII-art borders (▓░█▌etc.).
 * If the bytes parse cleanly as UTF-8 (no replacement chars) we keep that;
 * otherwise we fall back to CP437→UTF-8 so the box drawing renders.
 */
function decodeNfo(buf: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  // U+FFFD = decode error. A handful is OK (some scene NFOs mix encodings),
  // but if more than ~1% of chars are replacement we treat the whole thing
  // as legacy CP437.
  const errs = (utf8.match(/�/g) || []).length;
  if (errs <= Math.max(2, Math.floor(utf8.length / 100))) return utf8;
  try {
    return new TextDecoder('cp437' as any).decode(buf);
  } catch {
    // Node before 22 / non-ICU builds may not have cp437; fall back to
    // latin-1 which at least preserves the byte→char mapping.
    return new TextDecoder('iso-8859-1').decode(buf);
  }
}
