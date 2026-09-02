/**
 * Zod Validation Schemas
 * Centralized request validation schemas for all API endpoints
 */

import { TORRENT_SORT_KEYS } from '@trackarr/shared';
import { z } from 'zod/v4';

// ============================================================================
// Base Schemas
// ============================================================================

export const uuidSchema = z
  .uuid('Invalid UUID format')
  .transform((val) => val.toLowerCase());

export const infoHashSchema = z
  .string()
  .regex(
    /^[a-fA-F0-9]{40}$/,
    'Invalid info hash format. Expected 40 hex characters'
  )
  .transform((val) => val.toLowerCase());

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const passkeySchema = z
  .string()
  .length(40, 'Passkey must be exactly 40 characters')
  .regex(/^[a-f0-9]{40}$/, 'Invalid passkey format');

// Hex colour with optional shorthand (`#abc` → `#aabbcc`). The actual storage
// is the raw value; the FE expands shorthand at render time. Pinning the shape
// is what keeps an admin-supplied colour from carrying CSS syntax anywhere it
// is interpolated — a `:style` binding rejects a malformed value wholesale, a
// generated stylesheet would not.
export const hexColourSchema = z
  .string()
  .regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i, 'Color must be a hex value');

// ============================================================================
// Auth Schemas (Zero Knowledge Encryption)
// ============================================================================

export const loginSchema = z.object({
  username: z.string().min(1, 'Username is required').max(100),
  challenge: z.string().length(64, 'Invalid challenge'),
  proof: z.string().length(64, 'Invalid proof'),
});

export const registerSchema = z.object({
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(20, 'Username must be at most 20 characters')
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      'Username can only contain letters, numbers, underscores, and hyphens'
    ),
  // ZKE fields - server never sees password
  // Bornées en haut aussi. Les deux atterrissent dans des colonnes `text` non
  // bornées, par un appelant NON authentifié (`POST /api/auth/register`), et
  // un client honnête envoie 44 caractères de base64 pour 32 octets. Sans
  // plafond, chaque inscription pouvait y planter la taille maximale d'un corps
  // Nitro — puis `encryptSecretRequired` chiffrait tout cela à chaque écriture,
  // et `login.post.ts` concaténait le vérificateur dans un SHA-256 à chaque
  // tentative.
  authSalt: z.string().min(40, 'Invalid salt').max(64, 'Invalid salt'),
  authVerifier: z.string().min(40, 'Invalid verifier').max(64, 'Invalid verifier'),
  // Proof of Work
  powChallenge: z.string().length(64, 'Invalid PoW challenge'),
  powNonce: z.string().min(1, 'Invalid PoW nonce'),
  powHash: z.string().length(64, 'Invalid PoW hash'),
  // Optional
  inviteCode: z
    .string()
    .transform((val) => (val === '' ? undefined : val))
    .pipe(z.string().length(32).optional())
    .optional(),
  panicPassword: z
    .string()
    .min(12, 'Panic password must be at least 12 characters')
    .max(128)
    .optional(),
});

// ============================================================================
// Torrent Schemas
// ============================================================================

export const torrentUploadSchema = z.object({
  categoryId: z.uuid('Invalid category ID').optional(),
  description: z.string().max(10000, 'Description too long').optional(),
});

export const torrentQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  // The categories table's primary key is `text` — drizzle defaults
  // generate UUIDs but operators can seed/import with any string. We
  // therefore accept any short identifier and let the DB lookup decide
  // whether it matches; an unknown id naturally yields zero torrents.
  categoryId: z.string().min(1).max(128).optional(),
  search: z.string().max(255).optional(),
  // Comma-separated tag slugs/names — matches torrents that carry ALL.
  tag: z.string().max(255).optional(),
  // External media-database filters. Same semantic as the Torznab
  // endpoint's params (Sonarr / Radarr already use those server-side);
  // exposing them here is what makes the smart search bar work for
  // human users. Each one accepts a bare id, a `tt`-prefixed IMDb id,
  // or a full URL — `normalizeMediaId` collapses all forms.
  imdbid: z.string().max(255).optional(),
  tmdbid: z.string().max(255).optional(),
  tvdbid: z.string().max(255).optional(),
  // Sort keys map to the columns the catalogue table shows, so every header
  // the user can click has one. `age` is the default and means the same thing
  // the listing has always been ordered by: COALESCE(moderated_at, created_at),
  // i.e. when the torrent became available rather than when it was uploaded.
  //
  // `seeders`, `leechers` and `completed` order off the `torrent_stats`
  // snapshot the stats collector maintains, not off Redis: a listing cannot
  // fan out one Redis read per candidate row before it knows which page it is
  // serving. Displayed counts stay live — only the ordering is as of the last
  // collection pass.
  sortBy: z.enum(TORRENT_SORT_KEYS).default('age'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const torrentCommentSchema = z.object({
  content: z
    .string()
    .min(1, 'Comment cannot be empty')
    .max(5000, 'Comment too long'),
});

// ============================================================================
// Admin Schemas
// ============================================================================

export const adminUserRoleSchema = z.object({
  role: z.enum(['user', 'moderator', 'admin']),
});

export const adminBanSchema = z.object({
  reason: z.string().min(1, 'Ban reason is required').max(500),
  duration: z.coerce.number().int().positive().optional(),
  /**
   * Bannir aussi la dernière adresse IP du compte.
   *
   * C'était un effet de bord inconditionnel. Sur une sortie CGNAT ou VPN
   * partagée — l'usage quasi universel sur un tracker privé — bannir un membre
   * bannissait ses voisins, et le blocage précède l'authentification : y compris
   * le personnel, y compris la route qui lèverait le blocage. C'est désormais
   * une décision, et son défaut est de ne pas le faire.
   */
  banIp: z.coerce.boolean().optional().default(false),
});

export const adminCategorySchema = z.object({
  name: z.string().min(1, 'Category name is required').max(100),
  slug: z
    .string()
    .max(100)
    .regex(
      /^[a-z0-9-]+$/,
      'Slug can only contain lowercase letters, numbers, and hyphens'
    )
    .optional(),
  parentId: z.uuid('Invalid parent category ID').nullable().optional(),
  // 1000–199_999 covers both the standard Newznab ranges (1000–8999)
  // and the Prowlarr/Jackett "custom" range (100_000–199_999). Real
  // tracker definitions in Prowlarr use ids like 105070 / 106060 for
  // tracker-specific anime / movie categories — capping at 9999 used
  // to lock those out of the manual mapping field.
  newznabId: z.coerce
    .number()
    .int()
    .min(1000)
    .max(199_999)
    .nullable()
    .optional(),
  description: z.string().max(500).optional(),
  // Optional Phosphor icon name override; accepts null so the admin
  // form can clear a previously-set glyph and fall back to the
  // type-derived default.
  icon: z.string().max(50).nullable().optional(),
  // Marks the row as part of the gated XXX subtree.
  isAdult: z.boolean().optional(),
  // Canonical media type. 'movie' / 'tv' route to TMDb; 'game'
  // routes to IGDB; 'book' routes to Open Library (with optional
  // Google Books fallback). Null clears any earlier choice and
  // falls back to the heuristics in apps/web/app/utils/categories.ts.
  type: z.enum(['movie', 'tv', 'game', 'book']).nullable().optional(),
});

export const adminSettingsSchema = z.object({
  // Fields scanned by free-text search. The empty array is accepted: it is the
  // explicit "no text search" choice, distinct from an absent key which leaves
  // the setting unchanged.
  searchFields: z
    .array(z.enum(['name', 'description', 'nfo', 'tags']))
    .max(4)
    .optional(),
  searchFuzzy: z.boolean().optional(),
  registrationOpen: z.boolean().optional(),
  inviteEnabled: z.boolean().optional(),
  defaultInvites: z.coerce.number().int().min(0).max(100).optional(),
  announceInterval: z.coerce.number().int().positive().max(3600).optional(),
  minAnnounceInterval: z.coerce.number().int().positive().max(1800).optional(),
  maxPeersPerTorrent: z.coerce.number().int().positive().max(1000).optional(),
  peerTTL: z.coerce.number().int().positive().max(86400).optional(),
  minRatio: z.coerce.number().min(0).max(10).optional(),
  starterUpload: z.coerce.number().int().min(0).optional(),
  siteName: z.string().min(1).max(500).optional(),
  siteLogo: z.string().min(1).max(100).optional(),
  siteLogoImage: z.string().max(500).optional().nullable(),
  siteSubtitle: z.string().max(500).optional().nullable(),
  // Hex-only: this one is served publicly by GET /api/branding and bound into
  // a style on every page, so it must never be able to hold CSS syntax. Both
  // '' and null are kept as accepted inputs because settings.put.ts maps
  // either to the empty stored value that getSiteNameColor() reads as null.
  siteNameColor: hexColourSchema.or(z.literal('')).optional().nullable(),
  siteNameBold: z.boolean().optional(),
  // Extended branding
  authTitle: z.string().max(500).optional().nullable(),
  authSubtitle: z.string().max(1000).optional().nullable(),
  footerText: z.string().max(1000).optional().nullable(),
  pageTitleSuffix: z.string().max(100).optional().nullable(),
  welcomeMessage: z.string().max(5000).optional().nullable(),
  siteRules: z.string().max(50000).optional().nullable(),
  announcementEnabled: z.boolean().optional(),
  announcementMessage: z.string().max(500).optional(),
  announcementType: z.enum(['info', 'warning', 'error']).optional(),
  // Homepage content (rich text HTML)
  heroTitle: z.string().max(2000).optional(),
  heroSubtitle: z.string().max(5000).optional(),
  statusBadgeText: z.string().max(100).optional(),
  feature1Title: z.string().max(500).optional(),
  feature1Desc: z.string().max(2000).optional(),
  feature2Title: z.string().max(500).optional(),
  feature2Desc: z.string().max(2000).optional(),
  feature3Title: z.string().max(500).optional(),
  feature3Desc: z.string().max(2000).optional(),
  // Enforce 2FA at one of three scopes. `off` keeps the per-user
  // toggle. `staff` forces admins + moderators. `all` forces every
  // logged-in user. The middleware redirects to /settings/security
  // until they comply.
  require2FAScope: z.enum(['off', 'staff', 'all']).optional(),
  // Messaging. Two independent surfaces, three states each — a boolean
  // could not express "staff only", which is what a rollout needs and
  // what the room falls back to if it turns sour.
  messagingDmScope: z.enum(['off', 'staff', 'all']).optional(),
  messagingRoomScope: z.enum(['off', 'staff', 'all']).optional(),
  // Clamped in the handler rather than rejected here: a sloppy value in a
  // multi-section save should not fail the whole request. The floor of one
  // day is enforced there too.
  messagingRoomRetentionDays: z.number().int().min(0).max(3650).optional(),
  messagingDmRetentionDays: z.number().int().min(0).max(3650).optional(),
  ticketsMode: z.enum(['off', 'suspended', 'on']).optional(),
  messagingRoomSlowModeSeconds: z.number().int().min(0).max(3600).optional(),
  // Notification retention TTLs in days. Both default to 90 in the
  // settings getter. Bounded 1–3650 here; the PUT handler also
  // clamps before writing as a defence-in-depth.
  notificationsRetentionReadDays: z
    .number()
    .int()
    .min(1)
    .max(3650)
    .optional(),
  /**
   * Staff audit retention, in days. `0` is legitimate here and means "keep
   * indefinitely" — unlike the notification periods above, which have no such
   * reading and start at 1. An audit log an operator can only shorten is an
   * audit log with a built-in expiry nobody chose.
   */
  auditRetentionDays: z.number().int().min(0).max(3650).optional(),
  // Both of these had a getter, a default and a documented meaning, and no
  // writer anywhere — so the retention period an operator reads about in the
  // privacy notice, and the ceiling the saved-search fan-out logs advice about
  // ("consider lowering saved_search_max_per_user"), could only be changed with
  // a SQL prompt.
  loginEventRetentionDays: z.number().int().min(0).max(3650).optional(),
  savedSearchMaxPerUser: z.number().int().min(1).max(200).optional(),
  notificationsRetentionUnreadDays: z
    .number()
    .int()
    .min(1)
    .max(3650)
    .optional(),
  // Upload-request bounty board tunables. Bounds match the
  // settings.ts getters' clamp; out-of-range values are dropped
  // silently by the PUT handler to match the section's existing
  // tolerance.
  requestAutoValidateHours: z
    .number()
    .int()
    .min(1)
    .max(8760)
    .optional(),
  requestMaxFillsPerUser: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional(),
  // How many presentation templates one user may own. Bounds mirror
  // TEMPLATE_QUOTA_MIN/MAX in utils/templatePolicy — kept as literals
  // here because this schema is serialised into openapi.json, where an
  // imported constant would render as an opaque number anyway.
  templateQuotaPerUser: z.number().int().min(1).max(100).optional(),
});

// ============================================================================
// Forum Schemas
// ============================================================================

export const forumCategorySchema = z.object({
  name: z.string().min(1, 'Category name is required').max(100),
  description: z.string().max(500).optional().nullable(),
  // The newsroom redesign lets admins paint each category with a hex
  // accent and a Phosphor icon id. Both are optional — if absent the UI
  // falls back to the neutral chrome (`fg-muted` border, list icon).
  color: hexColourSchema.optional().nullable(),
  icon: z.string().max(64).optional().nullable(),
  order: z.coerce.number().int().min(0).default(0),
});

export const forumTopicSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  content: z.string().min(1, 'Content is required').max(50000),
  categoryId: z.uuid('Invalid category ID'),
});

export const forumPostSchema = z.object({
  content: z.string().min(1, 'Content is required').max(50000),
  topicId: z.uuid('Invalid topic ID'),
});

export const forumTopicUpdateSchema = z.object({
  isPinned: z.boolean().optional(),
  isLocked: z.boolean().optional(),
});

// Edit a single post body. Only the content can change; ownership /
// staff-bypass is enforced in the route handler. Same 50 000-char ceiling
// as the create endpoint so the UI doesn't have to know two limits.
export const forumPostUpdateSchema = z.object({
  content: z.string().min(1, 'Content is required').max(50000),
});

// Partial category update — every field is optional so the admin can patch
// just the icon, just the colour, etc. without re-sending the whole row.
export const forumCategoryUpdateSchema = forumCategorySchema.partial();

// ============================================================================
// Tracker Schemas (for announce/scrape validation)
// ============================================================================

/**
 * Le contrat d'annonce, publié dans l'OpenAPI et servi par personne.
 *
 * Ce schéma et `scrapeQuerySchema` n'ont aucun appelant : l'annonce et le
 * scrape sont servis par le tracker Go, qui a sa propre validation
 * (`apps/tracker/internal/announce`). Ils restent parce que
 * `scripts/generate-openapi.mjs` les publie comme documentation du protocole.
 *
 * Deux bornes ajoutées pour que le contrat publié dise la vérité : les trois
 * compteurs d'octets étaient `min(0)` sans MAXIMUM, et `ip` était une chaîne
 * libre. Ce que le tracker applique réellement, lui, est plus strict — un
 * `peer_id` de 20 octets, un port hors plage privilégiée, `left` borné — donc
 * une documentation plus permissive que l'implémentation est une invitation à
 * signaler un faux bug.
 */
export const announceQuerySchema = z.object({
  info_hash: infoHashSchema,
  peer_id: z.string().length(20, 'Peer ID must be 20 characters'),
  port: z.coerce.number().int().min(1).max(65535),
  uploaded: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  downloaded: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  left: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  compact: z.coerce.number().int().optional(),
  no_peer_id: z.coerce.number().int().optional(),
  event: z.enum(['started', 'stopped', 'completed', '']).optional(),
  // Fourni par le client et DÉLIBÉRÉMENT ignoré par le tracker : l'accepter
  // ferait de lui un réflecteur (BEP 7 a fini par décourager ce champ).
  ip: z.union([z.ipv4(), z.ipv6()]).optional(),
  numwant: z.coerce.number().int().min(0).max(200).optional(),
  key: z.string().optional(),
  trackerid: z.string().optional(),
});

export const scrapeQuerySchema = z.object({
  info_hash: z.union([infoHashSchema, z.array(infoHashSchema)]).optional(),
});

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Render a single Zod issue into an operator-readable line. Strict
 * schemas (`.strict()`) emit `unrecognized_keys` with an empty path,
 * which used to surface as `": Unrecognized keys: …"` — meaningless.
 * We special-case it so the message names the offending fields without
 * the punctuation noise.
 */
function describeZodIssue(e: z.ZodIssue): string {
  if (e.code === 'unrecognized_keys') {
    const keys = (e as z.ZodIssue & { keys?: string[] }).keys ?? [];
    return `Unexpected field${keys.length === 1 ? '' : 's'} in request body: ${keys.join(', ')}`;
  }
  const path = e.path.join('.');
  return path ? `${path}: ${e.message}` : e.message;
}

/**
 * Validate and parse request body with Zod schema
 * Throws HTTP 400 error with validation messages on failure
 */
export async function validateBody<T>(
  event: any,
  schema: z.ZodSchema<T>
): Promise<T> {
  try {
    const body = await readBody(event);
    return schema.parse(body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw createError({
        statusCode: 400,
        message: error.issues.map(describeZodIssue).join('; '),
      });
    }
    throw error;
  }
}

/**
 * Validate and parse query parameters with Zod schema
 * Throws HTTP 400 error with validation messages on failure
 */
export function validateQuery<T>(event: any, schema: z.ZodSchema<T>): T {
  try {
    const query = getQuery(event);
    return schema.parse(query);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw createError({
        statusCode: 400,
        message: error.issues.map(describeZodIssue).join('; '),
      });
    }
    throw error;
  }
}

/**
 * Valide TOUS les paramètres de route d'un coup, comme `validateQuery` le fait
 * pour la chaîne de requête.
 *
 * Il manquait, et son absence coûtait cher : vingt-six routes appelaient
 * `paramsSchema.parse(getRouterParams(event))` en direct. Une `ZodError` non
 * rattrapée ne devient pas un 400 — elle remonte comme erreur non gérée et
 * Nitro répond **500 « Server Error »**. Mesuré le 2026-09-02 sur la pile
 * compilée : `/api/tags?limit=abc` renvoyait 500, quand `/api/torrents?limit=abc`,
 * qui passe par `validateQuery`, répondait
 * « 400 limit: Invalid input: expected number, received NaN ».
 *
 * Deux conséquences, au-delà du message illisible : un 500 écrit une trace
 * complète dans le journal à CHAQUE requête malformée — un lecteur de flux mal
 * configuré sur `/api/rss/latest` en produit en continu — et il annonce au
 * client une panne du serveur là où c'est sa propre requête qui est en cause.
 *
 * `validateParam` existait déjà mais ne prend qu'UN paramètre nommé, ce qui ne
 * couvre pas les routes à deux segments (`/requests/[id]/comments/[cid]`).
 */
export function validateRouterParams<T>(event: any, schema: z.ZodSchema<T>): T {
  try {
    return schema.parse(getRouterParams(event));
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw createError({
        statusCode: 400,
        message: error.issues.map(describeZodIssue).join('; '),
      });
    }
    throw error;
  }
}

/**
 * Validate route parameter with Zod schema
 * Throws HTTP 400 error with validation messages on failure
 */
export function validateParam<T>(
  event: any,
  paramName: string,
  schema: z.ZodSchema<T>
): T {
  try {
    const param = getRouterParam(event, paramName);
    return schema.parse(param);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.issues.map((e: z.ZodIssue) => e.message);
      throw createError({
        statusCode: 400,
        message: messages.join('; '),
      });
    }
    throw error;
  }
}
