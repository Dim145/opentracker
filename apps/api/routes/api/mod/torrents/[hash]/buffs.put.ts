/**
 * PUT /api/mod/torrents/:hash/buffs
 *
 * Per-torrent bonus multipliers and the pinned flag — the buffs an operator
 * applies to one release rather than to the whole site.
 *
 * ## Two powers, two gates
 *
 * `requireModeratorSession` covers the route, and the multipliers then require
 * `isAdmin` on top. That split is not bureaucracy: pinning a release moves it
 * up a page and changes nothing about what it costs, while setting its download
 * multiplier to 0 mints upload credit out of nothing. One is editorial, the
 * other is economic, and the existing ban route already draws a line in the
 * same place (a moderator bans, an admin bans a moderator).
 *
 * Whichever gate applies, the request lands in the staff audit log — it is a
 * mutating call under `/api/mod/`, so the hook records it without this route
 * asking. `auditDetail` below only sharpens what it says.
 *
 * ## Units
 *
 * Basis points ×100, the same convention `bonus_events` uses: `0` freeleech,
 * `50` silverleech, `100` normal, `200` double upload. Bounds come from
 * `utils/bonusEvents` rather than being restated, so a torrent buff can never
 * exceed what a site-wide event may do.
 *
 * ## `until`
 *
 * `null` means "until an operator changes it". A timestamp means the buff
 * lapses on its own — and it lapses in SQL, on the announce path's own read,
 * so there is no sweep to schedule and nothing to forget. Setting a time in
 * the past is refused rather than silently accepted as "already over": it
 * reads as a mistake, and the way to end a buff is to reset it.
 *
 * ## No notification
 *
 * A freeleech on somebody's upload is good news, and it is deliberately not
 * announced to them. It would need a 51st notification type across six files,
 * it would fire on every adjustment including the ones that take a buff away,
 * and the badge on the torrent page already says what is true. The audit log
 * says who did it.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod/v4';
import { db, schema } from '@trackarr/db';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { auditDetail } from '~~/utils/audit';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';
import {
  DOWNLOAD_MULTIPLIER_MAX,
  DOWNLOAD_MULTIPLIER_MIN,
  UPLOAD_MULTIPLIER_MAX,
  UPLOAD_MULTIPLIER_MIN,
} from '~~/utils/bonusEvents';

const bodySchema = z.object({
  downloadMultiplier: z
    .number()
    .int()
    .min(DOWNLOAD_MULTIPLIER_MIN)
    .max(DOWNLOAD_MULTIPLIER_MAX)
    .optional(),
  uploadMultiplier: z
    .number()
    .int()
    .min(UPLOAD_MULTIPLIER_MIN)
    .max(UPLOAD_MULTIPLIER_MAX)
    .optional(),
  /** ISO timestamp, or null for "no end date". */
  until: z.union([z.iso.datetime(), z.null()]).optional(),
  isSticky: z.boolean().optional(),
});

export default defineEventHandler(async (event) => {
  const { user: actor } = await requireModeratorSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);

  const hash = getRouterParam(event, 'hash');
  if (!hash) {
    throw createError({ statusCode: 400, message: 'Torrent hash is required' });
  }
  const infoHash = hash.toLowerCase();

  const body = await validateBody(event, bodySchema);

  const touchesEconomy =
    body.downloadMultiplier !== undefined ||
    body.uploadMultiplier !== undefined ||
    body.until !== undefined;

  if (touchesEconomy && !actor.isAdmin) {
    throw createError({
      statusCode: 403,
      message: 'Only an admin can change a torrent’s bonus multipliers.',
    });
  }

  const existing = await db.query.torrents.findFirst({
    where: eq(schema.torrents.infoHash, infoHash),
    columns: {
      id: true,
      name: true,
      downloadMultiplier: true,
      uploadMultiplier: true,
      multipliersUntil: true,
      isSticky: true,
    },
  });
  if (!existing) {
    throw createError({ statusCode: 404, message: 'Torrent not found' });
  }

  // A past timestamp is a mistake, not a way to end a buff. Reset the
  // multipliers to 100 for that.
  if (typeof body.until === 'string' && new Date(body.until) <= new Date()) {
    throw createError({
      statusCode: 400,
      message: 'The end date must be in the future. Reset the multipliers to end a buff now.',
    });
  }

  const next = {
    downloadMultiplier: body.downloadMultiplier ?? existing.downloadMultiplier,
    uploadMultiplier: body.uploadMultiplier ?? existing.uploadMultiplier,
    multipliersUntil:
      body.until === undefined
        ? existing.multipliersUntil
        : body.until === null
          ? null
          : new Date(body.until),
    isSticky: body.isSticky ?? existing.isSticky,
  };

  // An end date on a torrent carrying no buff describes nothing, and it would
  // sit in the row waiting to "expire" values that are already neutral. Drop it
  // rather than store a fact about nothing.
  if (
    next.downloadMultiplier === 100 &&
    next.uploadMultiplier === 100 &&
    next.multipliersUntil !== null
  ) {
    next.multipliersUntil = null;
  }

  auditDetail(event, {
    action: 'torrent.buffs',
    targetType: 'torrent',
    targetId: existing.id,
    targetLabel: existing.name,
    changes: {
      ...(next.downloadMultiplier !== existing.downloadMultiplier
        ? {
            downloadMultiplier: {
              from: existing.downloadMultiplier,
              to: next.downloadMultiplier,
            },
          }
        : {}),
      ...(next.uploadMultiplier !== existing.uploadMultiplier
        ? {
            uploadMultiplier: {
              from: existing.uploadMultiplier,
              to: next.uploadMultiplier,
            },
          }
        : {}),
      ...(next.multipliersUntil?.getTime() !== existing.multipliersUntil?.getTime()
        ? {
            until: {
              from: existing.multipliersUntil?.toISOString() ?? null,
              to: next.multipliersUntil?.toISOString() ?? null,
            },
          }
        : {}),
      ...(next.isSticky !== existing.isSticky
        ? { isSticky: { from: existing.isSticky, to: next.isSticky } }
        : {}),
    },
  });

  await db
    .update(schema.torrents)
    .set(next)
    .where(eq(schema.torrents.id, existing.id));

  // The announce path reads the row directly and the SQL neutralises a lapsed
  // buff, so there is no cache to bust here — a change takes effect on the
  // next announce, not on the next cache TTL.
  return {
    success: true,
    downloadMultiplier: next.downloadMultiplier,
    uploadMultiplier: next.uploadMultiplier,
    until: next.multipliersUntil?.toISOString() ?? null,
    isSticky: next.isSticky,
  };
});
