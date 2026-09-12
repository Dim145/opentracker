/**
 * GET /api/mod/my-decisions — ce que J'AI décidé.
 *
 * Le journal d'audit couvre structurellement `/api/mod/**` et `/api/admin/**`
 * (`utils/audit.ts`), mais il se lit avec `requireAdminSession` : un
 * modérateur REMPLIT la table et ne peut pas la lire. Le choix se défend pour
 * un registre d'autorité — il n'appartient pas à celui qu'il surveille.
 *
 * L'effet secondaire, lui, ne se défend pas : un modérateur ne pouvait pas
 * répondre à « qu'est-ce que j'ai décidé la semaine dernière sur ce membre ? »
 * autrement qu'en fouillant page par page. Le tableau de bord compensait par
 * les dix dernières actions de l'équipe, ce qui ne couvre ni la recherche ni
 * l'historique par cible.
 *
 * Cette route n'ouvre pas le registre : elle en renvoie la PROJECTION des
 * lignes dont l'appelant est l'acteur. Un modérateur ne voit pas le travail
 * des autres, et un administrateur qui veut le registre entier a déjà sa page.
 */
import { db, schema } from '@trackarr/db';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { validateQuery } from '~~/utils/schemas';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  /** Fenêtre en jours. Bornée : le registre a une rétention, remonter
   *  au-delà renverrait une page vide qui ressemblerait à un bug. */
  days: z.coerce.number().int().min(1).max(90).default(30),
  /** Filtre optionnel sur le type de cible (torrent, user, report…). */
  targetType: z.string().max(40).optional(),
});

const PAGE_SIZE = 25;

export default defineEventHandler(async (event) => {
  const { user } = await requireModeratorSession(event);
  const q = validateQuery(event, querySchema);

  const since = new Date(Date.now() - q.days * 24 * 60 * 60 * 1000);
  const where = and(
    eq(schema.auditLog.actorId, user.id),
    gte(schema.auditLog.createdAt, since),
    q.targetType ? eq(schema.auditLog.targetType, q.targetType) : undefined,
    // Les refus sont dans le registre — une série de 403 est exactement ce
    // qu'il existe pour montrer — mais « mes décisions » veut dire ce qui a
    // abouti. Les échecs restent lisibles par un administrateur.
    lt(schema.auditLog.statusCode, 400)
  );

  const [rows, countRow] = await Promise.all([
    db
      .select({
        id: schema.auditLog.id,
        action: schema.auditLog.action,
        targetType: schema.auditLog.targetType,
        targetId: schema.auditLog.targetId,
        targetLabel: schema.auditLog.targetLabel,
        statusCode: schema.auditLog.statusCode,
        createdAt: schema.auditLog.createdAt,
      })
      .from(schema.auditLog)
      .where(where)
      .orderBy(desc(schema.auditLog.createdAt))
      .limit(PAGE_SIZE)
      .offset((q.page - 1) * PAGE_SIZE),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.auditLog)
      .where(where),
  ]);

  const total = countRow[0]?.count ?? 0;
  return {
    data: rows,
    pagination: {
      page: q.page,
      pageSize: PAGE_SIZE,
      total,
      pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    },
  };
});
