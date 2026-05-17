/**
 * GET /api/admin/freeleech-pool/cycles — cycle history.
 *
 * Most recent first, capped to the last 50 rows. Each cycle ships
 * with a top-5 contributors slice so the admin doesn't need a
 * second round-trip to see who funded a given run.
 */
import { desc } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireAdminSession } from '~~/utils/adminAuth';
import { getTopContributors } from '~~/utils/freeleechPool';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  const cycles = await db
    .select()
    .from(schema.freeleechPoolCycles)
    .orderBy(desc(schema.freeleechPoolCycles.createdAt))
    .limit(50);

  // Best-effort top-5 per cycle. A tiny N×N here is fine — admin
  // dashboards don't carry a hot-path budget and the contributions
  // table is index-covered.
  const enriched = await Promise.all(
    cycles.map(async (c) => {
      const top = await getTopContributors(c.id, 5).catch(() => []);
      return { ...c, top };
    })
  );
  return { cycles: enriched };
});
