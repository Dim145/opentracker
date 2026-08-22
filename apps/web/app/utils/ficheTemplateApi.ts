/**
 * The wire contract for stored listing templates — one place, so the list
 * page, the editor modal and the fiche wizard's picker cannot drift apart.
 *
 * `ficheTemplate.ts` owns the *format* of a template; this file owns how one
 * travels to and from the server. It deliberately holds no logic: the moment
 * it grows a helper that decides anything, that decision belongs to whichever
 * surface asked for it.
 *
 * Mirrored from apps/api/routes/api/me/templates/* and, for the site
 * catalogue, apps/api/routes/api/admin/templates/*. Every shape here is what
 * those handlers actually return — including the field names that do not read
 * the way you would guess (`data` not `items`, `isMine` not `isOwn`,
 * `visibility` rather than a boolean).
 *
 *   GET    /api/me/templates?scope=all|mine|site&category=&page=&limit=
 *          -> FicheTemplateListResponse   (limit caps at 50, default 24)
 *   POST   /api/me/templates              body FicheTemplateWriteBody
 *          -> { id, isDefault }           (the FIRST template a user creates
 *                                          is made their default server-side)
 *   PATCH  /api/me/templates/:id          body: any subset of the same
 *          -> { success: true }
 *   DELETE /api/me/templates/:id          -> { success: true }
 *   PUT    /api/me/templates/:id/default  body { isDefault?: boolean }
 *
 * And the admin screen's own four, which are the ONLY way a `site` row comes
 * into being — there is no member path to one:
 *
 *   GET    /api/admin/templates           -> { data: SiteTemplateRow[] }
 *          (unpaginated: a curated catalogue an operator audits, not a feed)
 *   POST   /api/admin/templates           body FicheTemplateWriteBody -> { id }
 *   PATCH  /api/admin/templates/:id       body: any subset -> { success: true }
 *   DELETE /api/admin/templates/:id       -> { success: true }
 *
 * There is no endpoint that selects the built-in default, because the built-in
 * default is `DEFAULT_FICHE_TEMPLATE` — a constant, with no row to point at.
 * Going back to it means clearing the flag on whichever row currently holds
 * it: `PUT /api/me/templates/<current>/default` with `{ isDefault: false }`.
 *
 * Every name here is prefixed. Everything exported from `app/utils` becomes a
 * Nuxt auto-import for the whole application, and `CONTENT_MAX` or
 * `CATEGORIES` are far too common to take over globally.
 */

/**
 * Only two categories are offered. The metadata lookup returns films and
 * series and nothing else, so a template can only ever be written against
 * video fields or against the parts that are true of any release; music,
 * ebook and game categories would be names that never fill.
 */
export const FICHE_TEMPLATE_CATEGORIES = ['universal', 'video'] as const;

export type FicheTemplateCategory = (typeof FICHE_TEMPLATE_CATEGORIES)[number];

/**
 * `private` is a member's own template. `site` is one an admin put in the
 * catalogue every member sees, alongside the built-in default.
 *
 * There is no member-facing way to produce a `site` row: the member write
 * routes have no `visibility` field at all, and the only endpoints that set it
 * are under /api/admin/templates behind `requireAdminSession`. A UI that
 * offered "publish" would be offering something the API refuses to hear.
 */
export type FicheTemplateVisibility = 'private' | 'site';

/**
 * The same 15 000 the create and edit routes cap `content` at in zod. Kept as
 * a constant on this side so the author hits the wall in the counter rather
 * than in a 400.
 */
export const FICHE_TEMPLATE_CONTENT_MAX = 15_000;
/** Matches `z.string().trim().min(1).max(120)` on the routes. */
export const FICHE_TEMPLATE_NAME_MAX = 120;
/** Matches `z.string().trim().max(500).nullable()` on the routes. */
export const FICHE_TEMPLATE_DESCRIPTION_MAX = 500;

export interface FicheTemplateRow {
  id: string;
  name: string;
  description: string | null;
  category: FicheTemplateCategory;
  /** Raw template source, byte-for-byte as the author stored it. */
  content: string;
  visibility: FicheTemplateVisibility;
  /** The caller's own default pick. A site template can never carry one. */
  isDefault: boolean;
  /** Computed server-side. The UI only hides buttons with it — the route decides. */
  isMine: boolean;
  /**
   * The same rule the write routes enforce: a member may edit their own
   * template and nothing else. False on every site template, whoever is
   * looking — an admin edits those on the admin screen, through a different
   * route with a different guard.
   */
  canEdit: boolean;
  /** null on a site template: it belongs to the site, not to a person. */
  owner: { id: string; username: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

export interface FicheTemplateListResponse {
  data: FicheTemplateRow[];
  /** `used` counts the caller's own rows only; `max` is the admin-configured quota. */
  quota: { used: number; max: number; remaining: number };
  /** The caller's chosen default, or null for the built-in layout. */
  defaultTemplateId: string | null;
  pagination: { page: number; limit: number; total: number; pages: number };
}

/**
 * The body every write route takes — member and admin alike. There is
 * deliberately no `visibility` here: whether a row is private or site-wide is
 * decided by WHICH endpoint you reach, never by a field the client sends.
 */
export interface FicheTemplateWriteBody {
  name: string;
  description: string | null;
  category: FicheTemplateCategory;
  content: string;
}

/**
 * A site catalogue row as the admin screen sees it. Same template, one extra
 * fact: who added it — the only trace of a staff action the schema keeps.
 * `createdBy` is null once that account is gone (ON DELETE SET NULL), which is
 * why losing the name cannot lose the row.
 */
export interface SiteTemplateRow {
  id: string;
  name: string;
  description: string | null;
  category: FicheTemplateCategory;
  content: string;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; username: string | null } | null;
}
