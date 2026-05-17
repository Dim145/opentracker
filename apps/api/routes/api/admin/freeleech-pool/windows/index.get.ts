/**
 * GET /api/admin/freeleech-pool/windows — list every window.
 *
 * Used by the admin panel to render the table of one-off and
 * recurring contribution windows. Returns both kinds in one
 * payload; the panel splits them client-side.
 */
import { asc } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireAdminSession } from '~~/utils/adminAuth';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  const rows = await db
    .select()
    .from(schema.freeleechPoolWindows)
    .orderBy(
      asc(schema.freeleechPoolWindows.kind),
      asc(schema.freeleechPoolWindows.startsAt),
      asc(schema.freeleechPoolWindows.weekdayStart)
    );
  return { windows: rows };
});
