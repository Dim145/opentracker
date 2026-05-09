/**
 * GET /api/admin/invites
 *
 * Paginated list of every invitation row in the registry.
 *
 * Privacy note — the full `code` value is intentionally **never**
 * returned by this endpoint. An admin could otherwise copy a member's
 * pending code and either redeem it themselves or hand it to someone
 * else, silently bypassing the inviter's intent. We expose a non-
 * reversible `codePreview` (`<first 8>…<last 4>`) which is enough to
 * cross-reference visually with what a member sees on `/invites` if
 * they need help, but cannot be used to register.
 */
import { db, schema } from '@trackarr/db';
import { requireAdminSession } from '~~/utils/adminAuth';
import { desc, sql } from 'drizzle-orm';

function previewCode(code: string): string {
  // 32-char hex codes shorten to 8 + ellipsis + 4 = 13 visible chars.
  // The middle 20 chars (≈80 bits of entropy) stay opaque, so even
  // collected previews can't be used to brute-force a redemption.
  if (code.length <= 12) return code;
  return `${code.slice(0, 8)}…${code.slice(-4)}`;
}

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);

  const query = getQuery(event);
  const page = parseInt(query.page as string) || 1;
  const limit = Math.min(parseInt(query.limit as string) || 20, 50);
  const offset = (page - 1) * limit;

  const [invites, countResult] = await Promise.all([
    db.query.invitations.findMany({
      with: {
        creator: {
          columns: { id: true, username: true },
        },
        usedByUser: {
          columns: { id: true, username: true },
        },
      },
      orderBy: [desc(schema.invitations.createdAt)],
      limit,
      offset,
    }),
    db.select({ count: sql<number>`count(*)::int` }).from(schema.invitations),
  ]);

  // Strip the full `code`; expose only the masked preview. Keep
  // every other column (timestamps, status flags, joined user
  // records) untouched so the admin UI loses no operational value.
  const sanitised = invites.map(({ code, ...rest }) => ({
    ...rest,
    codePreview: previewCode(code),
  }));

  return {
    data: sanitised,
    pagination: {
      page,
      limit,
      total: countResult[0]?.count || 0,
      pages: Math.ceil((countResult[0]?.count || 0) / limit),
    },
  };
});
