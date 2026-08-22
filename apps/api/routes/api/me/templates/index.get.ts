/**
 * GET /api/me/templates
 *
 * The caller's presentation templates, plus the staff-published ones
 * everybody can copy from. Query params:
 *   - scope: 'mine' | 'published' | 'all' (default 'all')
 *   - category: 'universal' | 'video'
 *   - page, limit
 *
 * `content` is included in the page slice on purpose: there is no
 * per-template GET, and the fiche wizard needs the source to render a
 * preview the moment the picker changes. That is also why `limit` is
 * capped lower than the usual 100 — a page here is up to 50 × 15 000
 * characters of template source.
 *
 * The response carries the caller's quota alongside the rows so the UI
 * can render "3 / 5" without a second round-trip, and so the number it
 * shows is the number index.post.ts will enforce. `defaultTemplateId` is
 * reported separately from the rows for the same reason: the caller's
 * default may sit on a page they are not currently looking at.
 */
import { db, schema } from '@trackarr/db';
import { and, desc, eq, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { getTemplateQuotaPerUser } from '~~/utils/settings';

const querySchema = z.object({
  scope: z.enum(['mine', 'published', 'all']).default('all'),
  category: z.enum(['universal', 'video']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(24),
});

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  const query = querySchema.parse(getQuery(event));
  const offset = (query.page - 1) * query.limit;

  const mine = eq(schema.presentationTemplates.ownerId, user.id);
  const published = eq(schema.presentationTemplates.visibility, 'published');

  const conditions: SQL[] = [];
  if (query.scope === 'mine') {
    conditions.push(mine);
  } else if (query.scope === 'published') {
    conditions.push(published);
  } else {
    // THIS is where read access is decided: a template is visible to its
    // owner, or to anybody once it is published, and to nobody else. The
    // rule used to be restated as a `canReadTemplate()` helper in
    // utils/templatePolicy.ts — exported, unit-tested, and called by no
    // route. That is worse than no helper: an auditor reads a one-line
    // answer to "can a stranger read a private draft" and believes it is
    // enforced, while the enforcement is here and free to drift away from
    // it. The rule lives with its implementation instead.
    //
    // A row that is both mine and published must appear once, which is
    // what OR gives us — the alternative (two queries, concatenated)
    // would have to dedupe and would break the pagination count.
    conditions.push(or(mine, published) as SQL);
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
      .innerJoin(
        schema.users,
        eq(schema.presentationTemplates.ownerId, schema.users.id),
      )
      .where(where)
      .orderBy(desc(schema.presentationTemplates.createdAt))
      .limit(query.limit)
      .offset(offset),
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(schema.presentationTemplates)
      .where(where),
    // The quota counts the caller's own rows only, published ones
    // included — publishing is a visibility flag, not a hand-off, so
    // the row still belongs to (and is maintained by) its author.
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
    const isMine = r.ownerId === user.id;
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      category: r.category,
      content: r.content,
      visibility: r.visibility,
      // Another user's default pick is their business — reporting it
      // would have the picker highlight a row the caller never chose.
      isDefault: isMine ? r.isDefault : false,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      isMine,
      // Computed server-side so the UI never re-derives the rule (a
      // published template is readable by all, writable by its owner).
      canEdit: isMine,
      owner: {
        id: r.ownerId,
        username: r.ownerUsername,
      },
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
