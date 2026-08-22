/**
 * The wire contract for stored listing templates — one place, so the list
 * page, the editor modal and the fiche wizard's picker cannot drift apart.
 *
 * `ficheTemplate.ts` owns the *format* of a template; this file owns how one
 * travels to and from the server. It deliberately holds no logic: the moment
 * it grows a helper that decides anything, that decision belongs to whichever
 * surface asked for it.
 *
 * Mirrored from apps/api/routes/api/me/templates/*. Every shape here is what
 * those handlers actually return — including the field names that do not read
 * the way you would guess (`data` not `items`, `isMine` not `isOwn`,
 * `visibility` rather than a boolean).
 *
 *   GET    /api/me/templates?scope=all|mine|published&category=&page=&limit=
 *          -> FicheTemplateListResponse   (limit caps at 50, default 24)
 *   POST   /api/me/templates              body FicheTemplateWriteBody
 *          -> { id, isDefault }           (the FIRST template a user creates
 *                                          is made their default server-side)
 *   PATCH  /api/me/templates/:id          body: any subset of the same
 *          -> { success: true }
 *   DELETE /api/me/templates/:id          -> { success: true }
 *   PUT    /api/me/templates/:id/default  body { isDefault?: boolean }
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

/** `published` is staff-only, enforced server-side against the live role. */
export type FicheTemplateVisibility = 'private' | 'published';

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
  /** The caller's own default pick. Always false on somebody else's row. */
  isDefault: boolean;
  /** Computed server-side. The UI only hides buttons with it — the route decides. */
  isMine: boolean;
  canEdit: boolean;
  owner: { id: string; username: string | null };
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

export interface FicheTemplateWriteBody {
  name: string;
  description: string | null;
  category: FicheTemplateCategory;
  content: string;
}
