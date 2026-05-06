import { db } from '@trackarr/db';
import { roles } from '@trackarr/db/schema';
import { requireAdminSession } from '~~/utils/adminAuth';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);

  const allRoles = await db.query.roles.findMany({
    orderBy: (r, { asc }) => [asc(r.name)],
  });

  return allRoles;
});
