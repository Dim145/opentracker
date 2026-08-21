/**
 * GET /api/federation/browse?q=&page=&limit=&peer=  — authenticated.
 *
 * The cache view of the federated catalogue: the local mirror
 * (`remote_torrents`), read as a list of releases with the same release seen on
 * several partners collapsed into one row carrying `sources[]`.
 *
 * The reading itself lives in `utils/federation/browseMirror` because the LIVE
 * search serves the same thing — it refreshes the mirror from the partners
 * first, then reads back through the same function. One store, one dedup, one
 * shape.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireAuthSession } from '~~/utils/adminAuth';
import { browseMirror } from '~~/utils/federation/browseMirror';

export default defineEventHandler(async (event) => {
  const { user } = await requireAuthSession(event);
  const me = await db.query.users.findFirst({
    where: eq(schema.users.id, user.id),
    columns: { showAdultContent: true },
  });

  const q = getQuery(event);
  return browseMirror({
    search: typeof q.q === 'string' ? q.q.trim() : '',
    peerId: typeof q.peer === 'string' && q.peer ? q.peer : null,
    page: Math.max(1, parseInt(String(q.page ?? '1'), 10) || 1),
    limit: Math.min(100, Math.max(1, parseInt(String(q.limit ?? '50'), 10) || 50)),
    showAdult: me?.showAdultContent ?? false,
  });
});
