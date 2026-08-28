/**
 * POST /api/admin/fonts — upload a woff2 the owner wants a theme to be able to use.
 *
 * Owner-gated and fresh-auth gated, for the same reasons as raw CSS: the file
 * becomes bytes every visitor downloads, and a stolen admin session should not be
 * able to add one. Reading the list is open to administrators, because an
 * administrator authoring a theme has to be able to SELECT an uploaded face even
 * though only the owner may add one.
 *
 * The role is chosen here, not at selection time. A theme picks a family per
 * role, and a proportional face offered for the mono role produces a broken
 * table rather than a restyled one — so the role travels with the file and the
 * token validation checks it matches.
 */
import { z } from 'zod';
import { requireOwnerSession, requireFreshAuth } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import {
  FONT_ROLES,
  MAX_FONT_BYTES,
  isWoff2,
  storeFont,
  type FontRole,
} from '~~/utils/fonts';

const familySchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  // A label for the picker, never part of a stylesheet — the emitted family name
  // is `ot-font-<uuid>`. Kept to plain text anyway so the admin list cannot
  // carry markup.
  .regex(/^[\p{L}\p{N} ._'-]+$/u, 'Letters, digits, spaces and . _ \' - only');

export default defineEventHandler(async (event) => {
  const { user } = await requireOwnerSession(event);
  await requireFreshAuth(event);
  await rateLimit(event, RATE_LIMITS.mutation);

  const form = await readMultipartFormData(event);
  if (!form?.length) {
    throw createError({ statusCode: 400, message: 'No file uploaded' });
  }

  const file = form.find((f) => f.name === 'font' && f.data?.length);
  if (!file) {
    throw createError({ statusCode: 400, message: 'No file in the `font` field' });
  }
  if (file.data.length > MAX_FONT_BYTES) {
    throw createError({
      statusCode: 413,
      message: `That file is ${Math.round(file.data.length / 1024)} kB. The limit is ${
        MAX_FONT_BYTES / 1024
      } kB, because an uploaded face is downloaded by every visitor using the theme.`,
    });
  }
  if (!isWoff2(file.data)) {
    // The check is the first four bytes, not the filename: a `.ttf` renamed to
    // `.woff2` fails here and a correct file with no extension passes.
    throw createError({
      statusCode: 400,
      message:
        'Only woff2 is accepted, and this file does not start with `wOF2`. Convert the face to woff2 first — every browser this application supports reads it.',
    });
  }

  const role = z.enum(FONT_ROLES).parse(
    form.find((f) => f.name === 'role')?.data.toString() ?? '',
  ) as FontRole;
  const family = familySchema.parse(
    form.find((f) => f.name === 'family')?.data.toString() ?? '',
  );

  const { font, created } = await storeFont(file.data, family, role, user.id);
  // 200 rather than 201 when the bytes were already here: the same file uploaded
  // twice is one object, and saying "created" would be a lie the client might act
  // on.
  setResponseStatus(event, created ? 201 : 200);
  return { font, created };
});
