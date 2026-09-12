/**
 * GET /api/mod/warnings?userId= — les avertissements d'un membre.
 *
 * Lu par le bandeau de signaux et par la fiche de modération d'un membre. Les
 * révoqués et les expirés sont renvoyés aussi, marqués : un avertissement
 * périmé reste un fait, il cesse seulement de compter.
 */
import { db, schema } from '@trackarr/db';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { validateQuery } from '~~/utils/schemas';

const querySchema = z.object({ userId: z.string().min(1) });

export default defineEventHandler(async (event) => {
  await requireModeratorSession(event);
  const { userId } = validateQuery(event, querySchema);

  const rows = await db.query.userWarnings.findMany({
    where: eq(schema.userWarnings.userId, userId),
    with: {
      issuedBy: { columns: { id: true, username: true } },
      revokedBy: { columns: { id: true, username: true } },
    },
    orderBy: [desc(schema.userWarnings.createdAt)],
    limit: 50,
  });

  const now = Date.now();
  return rows.map((w) => ({
    ...w,
    active: !w.revokedAt && (!w.expiresAt || w.expiresAt.getTime() > now),
  }));
});
