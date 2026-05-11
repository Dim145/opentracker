/**
 * GET /api/admin/invites
 *
 * Paginated, filterable list of every invitation row in the
 * registry. Supports a `search` substring filter (matches against the
 * code prefix/suffix the admin can see + creator/recipient usernames
 * via a subquery on users) and a `status` filter (active / used /
 * expired / all).
 *
 * Filtering must happen server-side because the page only ships ~20
 * rows at a time; a purely client-side filter only sees the current
 * page and silently hides matches on every other page.
 *
 * Privacy note — the full `code` value is intentionally **never**
 * returned by this endpoint. An admin could otherwise copy a member's
 * pending code and either redeem it themselves or hand it to someone
 * else, silently bypassing the inviter's intent. We expose a non-
 * reversible `codePreview` (`<first 8>…<last 4>`) which is enough to
 * cross-reference visually with what a member sees on `/invites` if
 * they need help, but cannot be used to register.
 *
 * Search matches against the *internal* code (substring, case-
 * insensitive) so an admin who typed the visible preview "abc12345…
 * x9z2" can find the row — they're matching characters they could
 * have seen on the page anyway. We never echo the matched code back.
 */
import { db, schema } from '@trackarr/db';
import { requireAdminSession } from '~~/utils/adminAuth';
import {
  and,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';

function previewCode(code: string): string {
  // 32-char hex codes shorten to 8 + ellipsis + 4 = 13 visible chars.
  // The middle 20 chars (≈80 bits of entropy) stay opaque, so even
  // collected previews can't be used to brute-force a redemption.
  if (code.length <= 12) return code;
  return `${code.slice(0, 8)}…${code.slice(-4)}`;
}

/** Escape `%` and `_` so user-supplied input is matched literally
 *  rather than as ILIKE wildcards. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);

  const query = getQuery(event);
  const page = parseInt(query.page as string) || 1;
  const limit = Math.min(parseInt(query.limit as string) || 20, 50);
  const offset = (page - 1) * limit;
  const search = typeof query.search === 'string' ? query.search.trim() : '';
  const status = String(query.status ?? 'all') as
    | 'all'
    | 'active'
    | 'used'
    | 'expired';

  // ── Compose the WHERE clause ──────────────────────────────────
  const conditions: SQL[] = [];
  const now = new Date();

  if (status === 'active') {
    conditions.push(isNull(schema.invitations.usedBy));
    conditions.push(
      or(
        isNull(schema.invitations.expiresAt),
        gt(schema.invitations.expiresAt, now),
      )!,
    );
  } else if (status === 'used') {
    conditions.push(isNotNull(schema.invitations.usedBy));
  } else if (status === 'expired') {
    conditions.push(isNull(schema.invitations.usedBy));
    conditions.push(isNotNull(schema.invitations.expiresAt));
    conditions.push(lte(schema.invitations.expiresAt, now));
  }

  if (search) {
    const term = `%${escapeLike(search)}%`;
    // Subquery for users matching the search term — we then match
    // invitations whose creator or recipient is in that id set.
    // Two simple joins would also work but the subquery keeps the
    // main query free of join multiplication.
    const matchingUserIds = db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(ilike(schema.users.username, term));

    conditions.push(
      or(
        ilike(schema.invitations.code, term),
        inArray(schema.invitations.createdBy, matchingUserIds),
        inArray(schema.invitations.usedBy, matchingUserIds),
      )!,
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // Counts ignore the status filter so the snapshot strip + segment
  // tab badges stay informative when the operator switches between
  // statuses (they want to see "I have 12 active, 3 used" regardless
  // of which filter is currently armed). They still respect the
  // search term so the badges reflect what's matchable right now.
  const searchOnlyConditions: SQL[] = [];
  if (search) {
    const term = `%${escapeLike(search)}%`;
    const matchingUserIds = db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(ilike(schema.users.username, term));
    searchOnlyConditions.push(
      or(
        ilike(schema.invitations.code, term),
        inArray(schema.invitations.createdBy, matchingUserIds),
        inArray(schema.invitations.usedBy, matchingUserIds),
      )!,
    );
  }
  const searchOnlyWhere =
    searchOnlyConditions.length > 0 ? and(...searchOnlyConditions) : undefined;

  const [invites, paginationCount, counts] = await Promise.all([
    db.query.invitations.findMany({
      where,
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
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.invitations)
      .where(where ?? sql`true`),
    db
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${schema.invitations.usedBy} is null and (${schema.invitations.expiresAt} is null or ${schema.invitations.expiresAt} > now()))::int`,
        used: sql<number>`count(*) filter (where ${schema.invitations.usedBy} is not null)::int`,
        expired: sql<number>`count(*) filter (where ${schema.invitations.usedBy} is null and ${schema.invitations.expiresAt} is not null and ${schema.invitations.expiresAt} <= now())::int`,
      })
      .from(schema.invitations)
      .where(searchOnlyWhere ?? sql`true`),
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
      total: paginationCount[0]?.count || 0,
      pages: Math.ceil((paginationCount[0]?.count || 0) / limit),
    },
    counts: counts[0] ?? { total: 0, active: 0, used: 0, expired: 0 },
  };
});
