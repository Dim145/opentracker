/**
 * POST /api/mod/reports/:id/assign — « je prends ce signalement ».
 *
 * Les tickets avaient l'assignation depuis toujours (`tickets.assigned_to_id`).
 * Les signalements, non : même file, même équipe, même problème de deux
 * personnes sur le même dossier — mais la moitié du produit l'avait résolu et
 * l'autre pas.
 *
 * Corps vide = je prends. `{ "release": true }` = je rends.
 */
import { db, schema } from '@trackarr/db';
import { and, eq, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';

const bodySchema = z.object({ release: z.boolean().optional() });

export default defineEventHandler(async (event) => {
  const { user } = await requireModeratorSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);

  const id = getRouterParam(event, 'id');
  if (!id) {
    throw createError({ statusCode: 400, message: 'Report id is required' });
  }
  const body = await validateBody(event, bodySchema);

  if (body.release) {
    const rows = await db
      .update(schema.reports)
      .set({ assignedToId: null, assignedAt: null })
      .where(
        and(
          eq(schema.reports.id, id),
          // Un administrateur peut reprendre l'assignation d'un autre ; un
          // modérateur ne rend que la sienne.
          user.isAdmin
            ? undefined
            : eq(schema.reports.assignedToId, user.id)
        )
      )
      .returning({ id: schema.reports.id });
    if (rows.length === 0) {
      throw createError({
        statusCode: 409,
        message: 'This report is assigned to another moderator',
      });
    }
    return { ok: true, assigned: false };
  }

  // La vérification et l'écriture dans la même instruction : deux modérateurs
  // qui cliquent à la même seconde ne peuvent pas gagner tous les deux.
  const rows = await db
    .update(schema.reports)
    .set({ assignedToId: user.id, assignedAt: new Date() })
    .where(
      and(
        eq(schema.reports.id, id),
        eq(schema.reports.status, 'pending'),
        or(
          isNull(schema.reports.assignedToId),
          eq(schema.reports.assignedToId, user.id)
        )
      )
    )
    .returning({ id: schema.reports.id });

  if (rows.length === 0) {
    throw createError({
      statusCode: 409,
      message: 'This report is already assigned, or already resolved',
    });
  }
  return { ok: true, assigned: true };
});
