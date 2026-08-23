/**
 * GET /api/me/templates
 *
 * The caller's own presentation templates, plus the site templates an admin
 * curated for everybody. Query params:
 *   - scope: 'mine' | 'site' | 'all' (default 'all')
 *   - category: 'universal' | 'video'
 *   - page, limit
 *
 * `content` is included in the page slice on purpose: there is no
 * per-template GET, and the fiche wizard needs the source to render a
 * preview the moment the picker changes. That is also why `limit` is
 * capped lower than the usual 100 — a page here is up to 50 × 15 000
 * characters of template source, and why the route is rate limited despite
 * being a read: `?scope=all&limit=50` is ~750 kB of answer.
 *
 * The response carries the caller's quota alongside the rows so the UI
 * can render "3 / 5" without a second round-trip, and so the number it
 * shows is the number index.post.ts will enforce. `defaultTemplateId` is
 * reported separately from the rows for the same reason: the caller's
 * default may sit on a page they are not currently looking at.
 */
import { db, schema } from '@trackarr/db';
import { and, asc, desc, eq, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { getTemplateQuotaPerUser } from '~~/utils/settings';

const querySchema = z.object({
  scope: z.enum(['mine', 'site', 'all']).default('all'),
  category: z.enum(['universal', 'video']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(24),
});

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  // A read, but an expensive one — see the header. The generous `public`
  // bucket (100/min) rather than `mutation` (10/min): the list page and the
  // wizard both refetch after every write, and throttling those alongside
  // the writes themselves would make the UI stall on ordinary use.
  await rateLimit(event, RATE_LIMITS.public);
  const query = querySchema.parse(getQuery(event));
  const offset = (query.page - 1) * query.limit;

  const mine = eq(schema.presentationTemplates.ownerId, user.id);
  const site = eq(schema.presentationTemplates.visibility, 'site');

  const conditions: SQL[] = [];
  if (query.scope === 'mine') {
    conditions.push(mine);
  } else if (query.scope === 'site') {
    conditions.push(site);
  } else {
    // THIS is where read access is decided: a template is visible to its
    // owner, or to everybody once an admin has made it a site template, and
    // to nobody else. The rule used to be restated as a `canReadTemplate()`
    // helper in utils/templatePolicy.ts — exported, unit-tested, and called
    // by no route. That is worse than no helper: an auditor reads a one-line
    // answer to "can a stranger read a private draft" and believes it is
    // enforced, while the enforcement is here and free to drift away from
    // it. The rule lives with its implementation instead.
    //
    // A site row has no owner, so the two branches cannot both match and no
    // dedupe is needed — but OR is still what keeps the pagination count
    // honest against the alternative of two concatenated queries.
    conditions.push(or(mine, site) as SQL);
  }
  if (query.category) {
    conditions.push(eq(schema.presentationTemplates.category, query.category));
  }
  const where = and(...conditions);

  const [
    rows,
    [{ value: total } = { value: 0 }],
    [{ value: owned } = { value: 0 }],
    [defaultRow],
    quota,
  ] = await Promise.all([
    db
      .select({
        id: schema.presentationTemplates.id,
        name: schema.presentationTemplates.name,
        description: schema.presentationTemplates.description,
        category: schema.presentationTemplates.category,
        content: schema.presentationTemplates.content,
        visibility: schema.presentationTemplates.visibility,
        isDefault: schema.presentationTemplates.isDefault,
        createdAt: schema.presentationTemplates.createdAt,
        updatedAt: schema.presentationTemplates.updatedAt,
        ownerId: schema.presentationTemplates.ownerId,
        ownerUsername: schema.users.username,
      })
      .from(schema.presentationTemplates)
      // LEFT, not INNER: a site template has no owner at all, and an inner
      // join would silently drop the whole site catalogue.
      .leftJoin(
        schema.users,
        eq(schema.presentationTemplates.ownerId, schema.users.id),
      )
      .where(where)
      // `id` breaks the tie. Two rows created in the same microsecond would
      // otherwise have no defined order, and a row can appear on two pages
      // or on none when the sort is unstable.
      .orderBy(desc(schema.presentationTemplates.createdAt), asc(schema.presentationTemplates.id))
      .limit(query.limit)
      .offset(offset),
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(schema.presentationTemplates)
      .where(where),
    // The quota counts the caller's own rows only. Site templates have no
    // owner, so they cannot land in this count — an admin curating the site
    // catalogue does not spend their personal allowance on it.
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(schema.presentationTemplates)
      .where(mine),
    // The caller's default, looked up independently of the page slice:
    // it may well not be on the page being rendered, and the picker
    // still has to know which row is pre-selected. The partial unique
    // index guarantees there is at most one.
    db
      .select({ id: schema.presentationTemplates.id })
      .from(schema.presentationTemplates)
      .where(and(mine, eq(schema.presentationTemplates.isDefault, true)))
      .limit(1),
    getTemplateQuotaPerUser(),
  ]);

  const data = rows.map((r) => {
    const isMine = r.ownerId !== null && r.ownerId === user.id;
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      category: r.category,
      content: r.content,
      visibility: r.visibility,
      isDefault: r.isDefault,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      isMine,
      // Computed server-side so the UI never re-derives the rule, and it is
      // now the same rule the write routes enforce: a member may write to
      // their own template and to nothing else. A site template is read-only
      // here whoever is asking — admins edit it on the admin screen, which
      // is a different route with a different guard.
      canEdit: isMine,
      // A site template has no owner to attribute. `null` rather than an
      // empty object so the UI cannot render "by " with nothing after it.
      owner: r.ownerId === null ? null : { id: r.ownerId, username: r.ownerUsername },
    };
  });

  return {
    data,
    // `max`, not `limit` — `pagination.limit` is right below it and means
    // something entirely different.
    quota: {
      used: owned,
      max: quota,
      remaining: Math.max(0, quota - owned),
    },
    // null means "the built-in default template", which is a code
    // constant and has no row to point at.
    defaultTemplateId: defaultRow?.id ?? null,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      pages: Math.ceil(total / query.limit),
    },
  };
});
