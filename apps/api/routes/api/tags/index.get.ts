import { db } from '@trackarr/db';
import { escapeLike } from '~~/utils/sql';
import { z } from 'zod';

const querySchema = z.object({
  q: z.string().trim().max(50).optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export default defineEventHandler(async (event) => {
  // Public endpoint — tags are visible to all authenticated users.
  // The `q` param drives the upload/edit-modal autocomplete; without it
  // we still serve the full sorted list so the admin UI keeps working.
  await requireUserSession(event);

  const { q, limit } = querySchema.parse(getQuery(event));
  const pattern = q ? `%${escapeLike(q)}%` : null;

  const tags = await db.query.tags.findMany({
    where: pattern
      ? (t, { ilike, or }) => or(ilike(t.name, pattern), ilike(t.slug, pattern))
      : undefined,
    orderBy: (t, { asc }) => [asc(t.name)],
    limit,
  });

  return tags;
});
