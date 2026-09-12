/**
 * POST /api/mod/warnings — le cran qui manquait entre « rien » et « bannir ».
 *
 * La sanction sur signalement allait de `none` à `permanent` en six crans, et
 * aucun d'eux ne disait simplement « ceci n'était pas correct ». Un membre qui
 * se trompe une fois ne mérite pas d'être coupé, et ne rien faire ne lui
 * apprend rien : il recommence, de bonne foi.
 *
 * Un avertissement est consigné, notifié, et compte dans l'historique que le
 * bandeau de signaux montre au prochain modérateur. Il ne coupe rien.
 */
import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { isValidReasonCode } from '@trackarr/shared/moderation';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';
import { notify } from '~~/utils/notify';

/** Combien de temps un avertissement compte. `never` = indéfiniment. */
const EXPIRY = {
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
  '1y': 365 * 24 * 60 * 60 * 1000,
  never: null,
} as const;

const bodySchema = z.object({
  userId: z.string().min(1),
  reasonCode: z
    .string()
    .refine((c) => isValidReasonCode(c, 'warning'), 'Unknown reason code'),
  // Le message est obligatoire : un avertissement dont le membre ne comprend
  // pas l'objet est une punition, pas une correction.
  message: z.string().trim().min(1).max(2000),
  expiresIn: z.enum(['30d', '90d', '1y', 'never']).default('90d'),
  sourceType: z.enum(['torrent', 'report', 'post', 'comment']).optional(),
  sourceId: z.string().optional(),
});

export default defineEventHandler(async (event) => {
  const { user } = await requireModeratorSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const body = await validateBody(event, bodySchema);

  const target = await db.query.users.findFirst({
    where: eq(schema.users.id, body.userId),
    columns: { id: true, username: true, isAdmin: true, isOwner: true },
  });
  if (!target) {
    throw createError({ statusCode: 404, message: 'User not found' });
  }
  // Un modérateur n'avertit pas un administrateur, et personne n'avertit le
  // propriétaire : ce serait une remontrance sans autorité derrière.
  if (target.isOwner || (target.isAdmin && !user.isAdmin)) {
    throw createError({
      statusCode: 403,
      message: 'You cannot warn this account',
    });
  }
  if (target.id === user.id) {
    throw createError({ statusCode: 400, message: 'You cannot warn yourself' });
  }

  const ms = EXPIRY[body.expiresIn];
  const id = randomUUID();
  await db.insert(schema.userWarnings).values({
    id,
    userId: target.id,
    issuedById: user.id,
    reasonCode: body.reasonCode,
    message: body.message,
    sourceType: body.sourceType ?? null,
    sourceId: body.sourceId ?? null,
    expiresAt: ms === null ? null : new Date(Date.now() + ms),
  });

  // Un avertissement que personne ne lit ne sert à rien : il est notifié comme
  // le reste, et le membre peut l'accuser de réception depuis son profil.
  await notify(
    target.id,
    'moderation_warning',
    { reasonCode: body.reasonCode, message: body.message },
    '/me'
  ).catch(() => {
    // La notification est un plus, pas la sanction. Si le canal est en panne,
    // l'avertissement reste consigné.
  });

  return { ok: true, id };
});
