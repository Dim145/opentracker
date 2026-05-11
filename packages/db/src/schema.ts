import {
  pgTable,
  text,
  timestamp,
  integer,
  bigint,
  boolean,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
  customType,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

// Custom type for bytea (binary data)
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

// ============================================================================
// Users
// ============================================================================
export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(), // UUID
    username: text('username').notNull().unique(),
    // ZKE fields - server never sees password
    authSalt: text('auth_salt').notNull(), // Client-generated salt (base64)
    authVerifier: text('auth_verifier').notNull(), // Derived verifier (base64)
    passkey: text('passkey').notNull().unique(), // For private tracker auth
    isAdmin: boolean('is_admin').default(false).notNull(),
    isModerator: boolean('is_moderator').default(false).notNull(),
    isBanned: boolean('is_banned').default(false).notNull(),
    // userId of the staffer who issued the most recent ban. Null when
    // the user has never been banned, or after an unban.
    bannedById: text('banned_by_id'),
    // Admin/moderator level of the staffer at ban time. Frozen at ban
    // time so a later promotion/demotion of the issuer doesn't mess
    // with the unban hierarchy check.
    bannedByRole: text('banned_by_role'), // 'admin' | 'moderator'
    // Role assignment moved to the `user_roles` junction table so a
    // user can carry multiple badges (e.g. "Certified" + "Donator").
    // The legacy `roleId` / `roleAssignedManually` columns were
    // retired with this migration — see user_roles below.
    lastIp: text('last_ip'),
    uploaded: bigint('uploaded', { mode: 'number' }).default(0).notNull(),
    // Subset of `uploaded` whose bytes came from a shop purchase
    // (`upload_credit` items) rather than from real seeding. The
    // `purchaseItem` apply path increments BOTH `uploaded` and
    // `bonus_uploaded` in the same transaction so the breakdown stays
    // consistent at row-level granularity.
    //
    // Display: the /me Uploaded KPI shows
    //   `total — (of which X bonus)`
    // when this is > 0, so the user can tell ratio relief from real
    // contribution at a glance. Existing announce-flow logic only
    // touches `uploaded` — never `bonus_uploaded` — so the
    // tracker-bumped bytes don't accidentally count as bonus.
    bonusUploaded: bigint('bonus_uploaded', { mode: 'number' })
      .default(0)
      .notNull(),
    downloaded: bigint('downloaded', { mode: 'number' }).default(0).notNull(),
    invitesRemaining: integer('invites_remaining').default(0).notNull(),
    // Seed-bonus running balance (whole points). Earned through the
    // hourly accumulation cron (rate × active-seed count) and spent in
    // the shop (`/shop` user surface, `/admin/shop` operator console).
    // Atomic increments / decrements only — never assigned wholesale
    // from outside the cron + purchase paths.
    bonusPoints: integer('bonus_points').default(0).notNull(),
    panicPasswordHash: text('panic_password_hash'), // Only set for first admin
    // User-editable profile preferences (settings page).
    // displayName overrides `username` on profile pages when set; the
    // canonical `username` is still used for moderation traceability,
    // mentions, and the announce URL.
    displayName: text('display_name'),
    bio: text('bio'),
    // Privacy toggle that hides "last seen" info from public-facing
    // surfaces. Mod/admin views still see the real value.
    showLastSeen: boolean('show_last_seen').default(true).notNull(),
    // Opt-in toggle for adult-tagged categories. Defaults false so a
    // newly-registered user never sees the XXX tree until they
    // explicitly turn it on in their profile settings.
    showAdultContent: boolean('show_adult_content').default(false).notNull(),
    // 'light' | 'dark'. Persisted server-side so the chosen theme
    // follows the user across devices instead of being trapped in a
    // single browser's localStorage.
    theme: text('theme').default('dark').notNull(),
    // BCP-47-ish language code matching one of the `@nuxtjs/i18n`
    // bundle codes (`en`, `fr`, …). Server-persisted so the choice
    // follows the user across devices and survives the cookie flush
    // that comes with a `clearUserSession`. The default mirrors the
    // module's `defaultLocale`; missing keys in any locale fall back
    // to English at render time.
    language: text('language').default('en').notNull(),
    // ── Two-factor authentication ────────────────────────────
    // TOTP secret stored as base32 (the `otpauth://` URI form).
    // Encryption-at-rest is left to the operator's Postgres setup;
    // the secret is useless without an active session anyway since
    // the SRP handshake gates access to the account.
    totpSecret: text('totp_secret'),
    totpEnabled: boolean('totp_enabled').default(false).notNull(),
    // User-controlled toggle: when on, completing a 2FA challenge
    // also issues a long-lived `trusted_device` cookie that lets
    // future logins from the same browser skip the 2FA step. Off
    // by default to keep the high-security stance for users who
    // don't explicitly opt in.
    trustDevicesEnabled: boolean('trust_devices_enabled').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    lastSeen: timestamp('last_seen').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('users_passkey_idx').on(table.passkey)]
);

// ============================================================================
// 2FA — TOTP recovery codes, WebAuthn passkeys, trusted devices
// ============================================================================
//
// `recovery_codes` is the printable fallback for TOTP. We hash each code
// (sha256 hex) before storage so the DB compromise never yields plaintext;
// the user receives the cleartext exactly once at generation time. Codes
// are single-use, so we mark a row consumed by setting `usedAt` rather
// than deleting it (audit trail of which code was burned).
export const recoveryCodes = pgTable(
  'recovery_codes',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    usedAt: timestamp('used_at'),
  },
  (table) => [index('recovery_codes_user_idx').on(table.userId)]
);

// One row per registered passkey. A user can register many — phone +
// laptop + hardware key — and pick whichever is convenient at login.
// `credentialId` is base64url-encoded (matches what @simplewebauthn
// expects round-tripping through the browser's PublicKeyCredential).
export const webauthnCredentials = pgTable(
  'webauthn_credentials',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // 64-char base64url string max (RP-issued credential id).
    credentialId: text('credential_id').notNull().unique(),
    // CBOR-encoded COSE public key. Stored as base64 to keep the
    // schema portable — bytea round-trips a little awkwardly across
    // pgbouncer with prepared-statement pooling.
    publicKey: text('public_key').notNull(),
    // Replay-attack counter the authenticator increments on every
    // assertion. Server enforces strict-monotonic increase.
    counter: bigint('counter', { mode: 'number' }).default(0).notNull(),
    // Comma-separated list of transport hints from the browser
    // (`usb,nfc,ble,internal,hybrid`). Helps the browser pick the
    // right device at sign-in.
    transports: text('transports'),
    // Human-friendly label so the settings page list reads as
    // "iPhone 15", "YubiKey 5C" etc. instead of an opaque hash.
    name: text('name').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at'),
  },
  (table) => [
    index('webauthn_credentials_user_idx').on(table.userId),
  ]
);

// Long-lived "this browser is trusted" cookie. The actual cookie
// holds a random token; we store its sha256 hash here. A trusted
// device row that matches the incoming cookie skips the 2FA step
// during login. Revoked from the settings page or by global
// security events (password change, 2FA reset).
export const trustedDevices = pgTable(
  'trusted_devices',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    // Best-effort labelling so the user can recognise the row later
    // ("Firefox · macOS · Paris" or similar). Derived from User-Agent
    // + best-effort geolocation by the operator's Caddy config.
    label: text('label'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    lastUsedAt: timestamp('last_used_at'),
  },
  (table) => [
    index('trusted_devices_user_idx').on(table.userId),
    index('trusted_devices_expires_idx').on(table.expiresAt),
  ]
);

// ============================================================================
// Bonus events (Freeleech / Silverleech / custom multipliers)
// ============================================================================
//
// A bonus event is a time-bounded window during which the announce
// pipeline scales the {uploaded, downloaded} byte deltas before they
// land in `users.uploaded`/`users.downloaded`. Two presets cover the
// common cases:
//   - Freeleech    → download multiplier 0   (no leech is counted)
//   - Silverleech  → download multiplier 50  (half leech is counted)
// …but the admin can pick any combination in the allowed range.
//
// Multipliers are stored as integer basis points (×100) so the tracker
// (Go) can apply them with a plain `delta * mul / 100` and we never pay
// the cost of parsing pg `numeric` on the announce hot path. UI layers
// divide by 100 to render `0.5x`, `2x`, etc.
//
// Allowed ranges (enforced by app layer + CHECK below):
//   - download_multiplier ∈ [0, 200]   → 0.00x to 2.00x
//   - upload_multiplier   ∈ [0, 1000]  → 0.00x to 10.00x
//
// We forbid time-overlap with any other `enabled = true` row on insert
// and update, so at most one window is ever active at a given instant.
export const bonusEvents = pgTable(
  'bonus_events',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    // Short description shown under the title in the user-facing
    // popup ("Silverleech global jusqu'à la mise en place du système
    // de points." in the design). Optional.
    description: text('description'),
    // Long description for the "Qu'est-ce que … ?" explainer block.
    // Optional — falls back to a generated sentence when null.
    longDescription: text('long_description'),
    // basis points × 100 — see header comment.
    downloadMultiplier: integer('download_multiplier').notNull(),
    uploadMultiplier: integer('upload_multiplier').notNull(),
    startsAt: timestamp('starts_at').notNull(),
    endsAt: timestamp('ends_at').notNull(),
    // Soft toggle. An admin can pause an in-progress window without
    // deleting it; flipping it back on resumes the window if `now`
    // is still inside [startsAt, endsAt]. Disabled rows are ignored
    // by the active-window resolver and skipped by overlap checks.
    enabled: boolean('enabled').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    createdById: text('created_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    updatedAt: timestamp('updated_at'),
  },
  (table) => [
    // Resolver for "what's active now?" filters by enabled + startsAt
    // <= now <= endsAt. Indexing the time bounds keeps the lookup
    // cheap even when we accumulate years of historical rows.
    index('bonus_events_window_idx').on(table.startsAt, table.endsAt),
    index('bonus_events_enabled_idx').on(table.enabled),
  ]
);

// ============================================================================
// Banned IPs
// ============================================================================
export const bannedIps = pgTable('banned_ips', {
  ip: text('ip').primaryKey(),
  reason: text('reason'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ============================================================================
// Seed-bonus shop
// ============================================================================
//
// `shop_items` is the operator-defined catalogue of things a user can
// trade their `users.bonus_points` balance for. The cron at
// `plugins/bonus-collector.ts` credits points hourly based on each
// user's active-seed count; a purchase at `POST /api/shop/buy`
// deducts points and applies the item's effect atomically.
//
// `type` is a small enum so the API can switch on it to apply effects
// without trusting arbitrary code from the operator. New types are
// added in tandem with their handler in `apps/api/utils/shop.ts`.
//
//   - 'upload_credit'    payload: { bytes: number }
//                        adds `bytes` to users.uploaded — pure ratio
//                        relief, no torrent-level FL.
//   - 'invite'           payload: { count: number }
//                        bumps users.invites_remaining by `count`
//                        slots.
//
// `stock` is nullable for unlimited; when set, decrements on every
// purchase and the item is hidden from the user catalogue once it
// hits 0. `enabled` lets an admin pause an item without losing its
// configuration. `cost` is in whole points (matches the credit unit
// of bonus_points).
export const shopItems = pgTable(
  'shop_items',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    icon: text('icon'), // ph: name (e.g. 'ph:gift-bold')
    type: text('type').notNull(), // 'upload_credit' | 'invite'
    payload: jsonb('payload').notNull(), // shape depends on `type`
    cost: integer('cost').notNull(),
    stock: integer('stock'), // null = unlimited
    enabled: boolean('enabled').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at'),
  },
  (table) => [
    index('shop_items_enabled_idx').on(table.enabled),
  ]
);

// ============================================================================
// Bonus earning rules + tiered multipliers + grant ledger
// ============================================================================
//
// Five operator-configurable mechanisms credit `users.bonus_points`:
//
//   - `seeding`            base rate × seed-count tier × age tier, applied
//                          per cron tick to every active seeder
//   - `first_seeder`       one-time reward when the user becomes the unique
//                          seeder of a torrent (idempotent via the grants
//                          ledger)
//   - `seeding_milestone`  per-torrent cumulative seed-time thresholds
//                          (24 h / 1 week / 30 d, …) — each crossing emits
//                          a single grant, also idempotent via the ledger
//   - `daily_login`        once per UTC day on the user's first auth-status
//                          poll (Redis SETNX gates the credit, the grant
//                          row is the audit copy)
//   - `account_age_monthly` monthly loyalty bonus — credited when the
//                          user's last `account_age_monthly` grant is
//                          more than 30 days old
//
// Each rule's per-kind config lives in `bonus_rules.config` (jsonb). The
// API validates the shape against a Zod schema in `utils/bonusEarning.ts`
// before applying — a malformed config disables the rule rather than
// risking a runaway credit.
//
// Multipliers are always stored as basis points × 100 (matching the
// `bonus_events` convention): 100 = 1×, 200 = 2×, 50 = 0.5×.
export const bonusRules = pgTable(
  'bonus_rules',
  {
    id: text('id').primaryKey(),
    // Single row per kind. UNIQUE so the operator can't end up with two
    // active "seeding" rules fighting each other.
    kind: text('kind').notNull().unique(),
    enabled: boolean('enabled').default(true).notNull(),
    config: jsonb('config').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at'),
  },
  (table) => [index('bonus_rules_kind_idx').on(table.kind)]
);

// Seeder-count tiers — fewer concurrent seeders ⇒ higher multiplier so
// rare torrents reward their seeders more. Tiers are evaluated in
// ascending `max_seeders` order; the first row whose `max_seeders`
// is ≥ the current seed count wins. A row with `max_seeders` = a
// very high number acts as the catch-all tail.
//
// Disabled rows are skipped during evaluation but kept around so the
// admin can re-enable a previously-tuned curve without re-typing it.
export const bonusSeedCountTiers = pgTable(
  'bonus_seed_count_tiers',
  {
    id: text('id').primaryKey(),
    maxSeeders: integer('max_seeders').notNull(),
    multiplier: integer('multiplier').notNull(), // basis points × 100
    enabled: boolean('enabled').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('bonus_seed_count_tiers_threshold_idx').on(table.maxSeeders),
    index('bonus_seed_count_tiers_enabled_idx').on(table.enabled),
  ]
);

// Age tiers — older torrents reward seeding more, to keep the
// archive alive. Evaluated in descending `min_age_days` order; the
// first row whose `min_age_days` ≤ the torrent's age wins.
export const bonusAgeTiers = pgTable(
  'bonus_age_tiers',
  {
    id: text('id').primaryKey(),
    minAgeDays: integer('min_age_days').notNull(),
    multiplier: integer('multiplier').notNull(), // basis points × 100
    enabled: boolean('enabled').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('bonus_age_tiers_threshold_idx').on(table.minAgeDays),
    index('bonus_age_tiers_enabled_idx').on(table.enabled),
  ]
);

// Grant ledger — every credit applied to `users.bonus_points` writes
// a row here. Two jobs:
//   1. Audit / "where did my points come from?" (per-user history page).
//   2. Idempotency for one-time rewards (first_seeder, milestones,
//      monthly account-age) — the rule's applicator queries this
//      table before crediting.
//
// `metadata` is freeform jsonb so each rule kind can stash whatever
// helps debugging — e.g. the seeder count and age multiplier used for
// a `seeding` grant, or the milestone hours threshold reached.
export const bonusGrants = pgTable(
  'bonus_grants',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    source: text('source').notNull(), // matches bonusRules.kind
    // Nullable: global grants (daily_login, account_age_monthly) leave it.
    torrentId: text('torrent_id').references(() => torrents.id, {
      onDelete: 'set null',
    }),
    amount: integer('amount').notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('bonus_grants_user_idx').on(table.userId, table.createdAt),
    index('bonus_grants_source_user_torrent_idx').on(
      table.source,
      table.userId,
      table.torrentId
    ),
  ]
);

// Audit ledger of every purchase. `cost_paid` is a snapshot of the
// item's cost at the time of purchase — even if the operator later
// re-prices the item, the record of what each user spent stays
// honest.
export const shopPurchases = pgTable(
  'shop_purchases',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    itemId: text('item_id')
      .notNull()
      .references(() => shopItems.id, { onDelete: 'restrict' }),
    // Snapshot fields — kept even when the item / user row is later
    // mutated. The `restrict` cascade above prevents accidental item
    // deletion while purchases reference it; admins must explicitly
    // disable instead.
    itemNameSnapshot: text('item_name_snapshot').notNull(),
    itemTypeSnapshot: text('item_type_snapshot').notNull(),
    costPaid: integer('cost_paid').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('shop_purchases_user_idx').on(table.userId, table.createdAt),
    index('shop_purchases_item_idx').on(table.itemId),
  ]
);

// ============================================================================
// Roles (Flexible permission management + auto-assignment rules)
// ============================================================================
//
// Two assignment modes:
//   - 'manual'  → only an admin can attach this role to a user; the
//                 auto-evaluator never touches it.
//   - 'auto'    → the periodic evaluator (apps/api/utils/roleRules.ts)
//                 computes whether each user matches `rules` and attaches
//                 the highest-priority match. Manual overrides on a user
//                 (users.roleAssignedManually = true) freeze the role
//                 against the engine.
//
// `rules` is a jsonb tree consumed by the evaluator: `{combinator: 'and'|
// 'or', conditions: [{field, comparator, value}]}` (see RuleSet in
// apps/api/utils/roleRules.ts for the full shape). Empty conditions =
// no auto-match — useful as a guard so an unconfigured auto role doesn't
// accidentally win every comparison.
export const roles = pgTable('roles', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  color: text('color').default('#6b7280').notNull(),
  // Phosphor icon name (e.g. 'ph:shield-check'). Optional; the badge
  // / list fall back to a tag-shape glyph when null.
  icon: text('icon'),
  // When true, the role surfaces as a public badge on user profiles.
  // Hidden roles still control permissions but don't decorate the UI.
  showAsBadge: boolean('show_as_badge').default(false).notNull(),
  // Higher priority renders first when a user has multiple badges. Also
  // dictates the resolution order for permission unions (e.g. if any
  // attached role grants `canUploadWithoutModeration` the user gets it).
  priority: integer('priority').default(0).notNull(),
  assignmentMode: text('assignment_mode').default('manual').notNull(),
  rules: jsonb('rules'),
  canUploadWithoutModeration: boolean('can_upload_without_moderation')
    .default(false)
    .notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ============================================================================
// User ↔ Roles junction (many-to-many)
// ============================================================================
//
// A user can carry several roles at once — e.g. "Certified" granted by
// the auto-engine plus "Patron" attached manually by an admin. Each
// row stores when the role was obtained (used by the profile chip
// tooltip + the admin manage-roles dialog) and whether it was an
// admin manual decision (which the engine respects as a freeze).
export const userRoles = pgTable(
  'user_roles',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    // Defaults to NOW() on insert — the auto-engine + the admin
    // manual-attach endpoint both rely on the default rather than
    // computing the value client-side.
    assignedAt: timestamp('assigned_at').defaultNow().notNull(),
    // True for admin-attached rows: the engine never deletes them on
    // the next sweep even if the user no longer matches the role's
    // rules. Auto-attached rows carry false and the engine owns them.
    assignedManually: boolean('assigned_manually')
      .default(false)
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.roleId] }),
    index('user_roles_role_idx').on(table.roleId),
  ]
);

// ============================================================================
// Categories (with subcategories support via parentId)
// ============================================================================
export const categories = pgTable(
  'categories',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    parentId: text('parent_id'),
    newznabId: integer('newznab_id'), // Newznab/Torznab category ID for *arr integration
    // Marks the row as part of the adult tree. We tag both the parent
    // (XXX) and each child explicitly so a row can be classified
    // without a recursive parent walk on every read. The user's
    // `users.showAdultContent` flag gates whether these rows are
    // returned at all in non-admin surfaces.
    isAdult: boolean('is_adult').default(false).notNull(),
    // Drives which TMDb namespace (movies vs series) the upload/edit
    // forms hint, so a category like XXX/Hentai can opt into the TV
    // path even though its newznab id sits in 6000-range. Stored as
    // text to leave room for future buckets ('music', 'book', …)
    // without a schema migration. Null = use the existing newznab
    // / slug heuristic.
    type: text('type'), // 'movie' | 'tv' | null
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('categories_parent_idx').on(table.parentId)]
);

// ============================================================================
// Torrents
// ============================================================================
export const torrents = pgTable(
  'torrents',
  {
    id: text('id').primaryKey(), // UUID
    infoHash: text('info_hash').notNull().unique(), // 40-char hex
    name: text('name').notNull(),
    size: bigint('size', { mode: 'number' }).notNull(), // Bytes
    description: text('description'), // Rich text/Markdown description
    nfo: text('nfo'), // Optional plain-text NFO release notes (preserve formatting)
    torrentData: bytea('torrent_data'), // Raw .torrent file for download
    uploaderId: text('uploader_id').references(() => users.id),
    categoryId: text('category_id').references(() => categories.id),
    // External media-database tags (issue #47). Stored as canonical ids
    // — `imdb_id` keeps the `tt` prefix, `tmdb_id` and `tvdb_id` are
    // pure digits. *Arr clients use these to match torrents against
    // their library; the upload form normalises raw URLs into these.
    imdbId: text('imdb_id'),
    tmdbId: text('tmdb_id'),
    tvdbId: text('tvdb_id'),
    isActive: boolean('is_active').default(true).notNull(),
    // Moderation pipeline. Replaces the legacy `is_approved` boolean.
    //   pending             — first state, awaiting a moderator's call
    //   accepted            — public; visible everywhere
    //   changes_requested   — moderator wants edits; uploader can edit
    //                          and re-submit (auto-reverts to pending)
    //   rejected            — refused; row kept so the same info_hash
    //                          can never be silently re-uploaded.
    //                          Only mods/admins can move it elsewhere.
    moderationStatus: text('moderation_status')
      .notNull()
      .default('pending'),
    // Last staffer who acted on the torrent (approved / rejected /
    // requested-changes). Null when nothing has been actioned yet.
    moderatedById: text('moderated_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    moderatedAt: timestamp('moderated_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('torrents_info_hash_idx').on(table.infoHash),
    index('torrents_uploader_idx').on(table.uploaderId),
    index('torrents_category_idx').on(table.categoryId),
    index('torrents_imdb_idx').on(table.imdbId),
    index('torrents_tmdb_idx').on(table.tmdbId),
    index('torrents_tvdb_idx').on(table.tvdbId),
    index('torrents_moderation_status_idx').on(table.moderationStatus),
    index('torrents_name_trgm_idx').using(
      'gist',
      table.name.op('gist_trgm_ops')
    ),
  ]
);

// Discussion thread between the uploader and the moderation team for a
// given torrent. Every status transition emits a row (the moderator's
// note travels with the action), but ad-hoc messages from either side
// are also accepted so the parties can clarify a request without
// changing the status. Visibility:
//   - the uploader (read/write on their own torrent's thread)
//   - any moderator/admin (read/write on every thread)
// `is_system` flags rows the back-end posted on the user's behalf,
// e.g. "Resubmitted for review" when an edit reverts the torrent to
// `pending` automatically.
export const torrentModerationMessages = pgTable(
  'torrent_moderation_messages',
  {
    id: text('id').primaryKey(),
    torrentId: text('torrent_id')
      .notNull()
      .references(() => torrents.id, { onDelete: 'cascade' }),
    authorId: text('author_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    body: text('body').notNull(),
    isSystem: boolean('is_system').default(false).notNull(),
    // If this message accompanied a status change, store the new
    // status here. `null` means the post is a free-form chat message
    // (a clarification request, an FYI, …). Useful so the UI can
    // render "Status changed to X" inline with the same row.
    statusChange: text('status_change'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('torrent_mod_messages_torrent_idx').on(table.torrentId),
    index('torrent_mod_messages_author_idx').on(table.authorId),
  ]
);

// ============================================================================
// Torrent Stats (Aggregated, updated periodically from Redis)
// ============================================================================
export const torrentStats = pgTable('torrent_stats', {
  infoHash: text('info_hash')
    .primaryKey()
    .references(() => torrents.infoHash, { onDelete: 'cascade' }),
  seeders: integer('seeders').default(0).notNull(),
  leechers: integer('leechers').default(0).notNull(),
  completed: integer('completed').default(0).notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================================================
// Announce Log (For tracking/debugging, optional)
// ============================================================================
export const announceLog = pgTable(
  'announce_log',
  {
    id: text('id').primaryKey(),
    infoHash: text('info_hash').notNull(),
    peerId: text('peer_id').notNull(),
    event: text('event'), // started, stopped, completed, or null
    ipHash: text('ip_hash').notNull(), // SHA256 hash of IP (privacy)
    port: integer('port').notNull(),
    uploaded: bigint('uploaded', { mode: 'number' }).default(0).notNull(),
    downloaded: bigint('downloaded', { mode: 'number' }).default(0).notNull(),
    left: bigint('left', { mode: 'number' }).default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('announce_log_info_hash_idx').on(table.infoHash),
    index('announce_log_created_at_idx').on(table.createdAt),
  ]
);

// ============================================================================
// Forum
// ============================================================================
export const forumCategories = pgTable('forum_categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  // Display attributes — used by the newsroom-style forum redesign so each
  // category has its own visual identity (sidebar tile in the index, banner
  // accent on its own page). Both nullable; the UI falls back to a neutral
  // chrome treatment when they're empty.
  color: text('color'), // 7-char hex, e.g. '#9ca3af'
  icon: text('icon'),   // phosphor icon id, e.g. 'ph:megaphone-bold'
  order: integer('order').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// `authorId` is nullable + `onDelete: 'set null'` on the three
// user-content tables below (forumTopics, forumPosts,
// torrentComments). Without that rule the FK refused every user
// deletion, leaving spam accounts permanently un-purgeable. With
// `set null` the contributions stay (community history is rarely
// worth nuking with the author) but lose attribution; the FE
// renders a `null` author as "[deleted]" — same convention already
// used by torrentModerationMessages.
export const forumTopics = pgTable('forum_topics', {
  id: text('id').primaryKey(),
  categoryId: text('category_id')
    .notNull()
    .references(() => forumCategories.id, { onDelete: 'cascade' }),
  authorId: text('author_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  title: text('title').notNull(),
  isPinned: boolean('is_pinned').default(false).notNull(),
  isLocked: boolean('is_locked').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const forumPosts = pgTable('forum_posts', {
  id: text('id').primaryKey(),
  topicId: text('topic_id')
    .notNull()
    .references(() => forumTopics.id, { onDelete: 'cascade' }),
  authorId: text('author_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================================================
// Torrent Comments
// ============================================================================
export const torrentComments = pgTable('torrent_comments', {
  id: text('id').primaryKey(),
  torrentId: text('torrent_id')
    .notNull()
    .references(() => torrents.id, { onDelete: 'cascade' }),
  authorId: text('author_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================================================
// Relations
// ============================================================================
export const usersRelations = relations(users, ({ many }) => ({
  // Multi-role relation via the junction table. Drizzle's `with`
  // helper traverses to the role row through `userRoles`.
  userRoles: many(userRoles),
  // Two distinct relationships from `users` to `torrents`: the rows
  // they uploaded vs. the rows they last moderated. The relationName
  // matches what `torrentsRelations` uses on the other side.
  torrents: many(torrents, { relationName: 'torrent_uploader' }),
  moderatedTorrents: many(torrents, { relationName: 'torrent_moderator' }),
  forumTopics: many(forumTopics),
  forumPosts: many(forumPosts),
  torrentComments: many(torrentComments),
  torrentModerationMessages: many(torrentModerationMessages),
  hnrTracking: many(hnrTracking),
  invitesCreated: many(invitations, { relationName: 'invitesCreated' }),
  reportsCreated: many(reports, { relationName: 'reportsCreated' }),
  // 2FA
  recoveryCodes: many(recoveryCodes),
  webauthnCredentials: many(webauthnCredentials),
  trustedDevices: many(trustedDevices),
}));

export const recoveryCodesRelations = relations(recoveryCodes, ({ one }) => ({
  user: one(users, {
    fields: [recoveryCodes.userId],
    references: [users.id],
  }),
}));

export const webauthnCredentialsRelations = relations(
  webauthnCredentials,
  ({ one }) => ({
    user: one(users, {
      fields: [webauthnCredentials.userId],
      references: [users.id],
    }),
  })
);

export const trustedDevicesRelations = relations(trustedDevices, ({ one }) => ({
  user: one(users, {
    fields: [trustedDevices.userId],
    references: [users.id],
  }),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  userRoles: many(userRoles),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, {
    fields: [userRoles.userId],
    references: [users.id],
  }),
  role: one(roles, {
    fields: [userRoles.roleId],
    references: [roles.id],
  }),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  torrents: many(torrents),
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: 'subcategories',
  }),
  subcategories: many(categories, { relationName: 'subcategories' }),
}));

export const forumCategoriesRelations = relations(
  forumCategories,
  ({ many }) => ({
    topics: many(forumTopics),
  })
);

export const forumTopicsRelations = relations(forumTopics, ({ one, many }) => ({
  category: one(forumCategories, {
    fields: [forumTopics.categoryId],
    references: [forumCategories.id],
  }),
  author: one(users, {
    fields: [forumTopics.authorId],
    references: [users.id],
  }),
  posts: many(forumPosts),
}));

export const forumPostsRelations = relations(forumPosts, ({ one }) => ({
  topic: one(forumTopics, {
    fields: [forumPosts.topicId],
    references: [forumTopics.id],
  }),
  author: one(users, {
    fields: [forumPosts.authorId],
    references: [users.id],
  }),
}));

export const torrentCommentsRelations = relations(
  torrentComments,
  ({ one }) => ({
    torrent: one(torrents, {
      fields: [torrentComments.torrentId],
      references: [torrents.id],
    }),
    author: one(users, {
      fields: [torrentComments.authorId],
      references: [users.id],
    }),
  })
);

export const torrentsRelations = relations(torrents, ({ one, many }) => ({
  uploader: one(users, {
    fields: [torrents.uploaderId],
    references: [users.id],
    relationName: 'torrent_uploader',
  }),
  // Last staffer who acted on the torrent. Distinct from `uploader`
  // even though both reference the `users` table — Drizzle requires
  // an explicit relationName when two relations target the same
  // foreign table.
  moderatedBy: one(users, {
    fields: [torrents.moderatedById],
    references: [users.id],
    relationName: 'torrent_moderator',
  }),
  category: one(categories, {
    fields: [torrents.categoryId],
    references: [categories.id],
  }),
  stats: one(torrentStats, {
    fields: [torrents.infoHash],
    references: [torrentStats.infoHash],
  }),
  comments: many(torrentComments),
  torrentTags: many(torrentTags),
  moderationMessages: many(torrentModerationMessages),
}));

export const torrentModerationMessagesRelations = relations(
  torrentModerationMessages,
  ({ one }) => ({
    torrent: one(torrents, {
      fields: [torrentModerationMessages.torrentId],
      references: [torrents.id],
    }),
    author: one(users, {
      fields: [torrentModerationMessages.authorId],
      references: [users.id],
    }),
  })
);

// ============================================================================
// Settings (Key-Value store for tracker configuration)
// ============================================================================
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================================================
// Panic State (Emergency database encryption status)
// ============================================================================
export const panicState = pgTable('panic_state', {
  id: text('id').primaryKey().default('singleton'), // Always one row
  isEncrypted: boolean('is_encrypted').default(false).notNull(),
  encryptedAt: timestamp('encrypted_at'),
  encryptionSalt: text('encryption_salt'), // For key derivation (base64)
  encryptionIv: text('encryption_iv'), // AES-GCM IV (base64)
});

// ============================================================================
// Notifications (persistent in-app inbox)
// ============================================================================
//
// One polymorphic row per delivered notification. The `type` column
// is a snake_case event key (e.g. `upload_accepted`, `comment_on_my_upload`)
// and `payload` carries the type-specific context (actor name, target
// title, …) used to render the toast / row at display time.
//
// Render contract is shared across every event: icon + actor + target +
// verb + link. The frontend resolves the i18n label from `type` and
// interpolates `payload` fields into it.
//
// Read tracking via `readAt` timestamp (not a boolean) — preserves the
// "marked read at" moment for analytics and lets the bell dropdown
// surface "5 new since your last visit" without an extra column.
//
// Retention is policy-driven (settings keys `notifications_retention_read_days`
// and `notifications_retention_unread_days`, both 90 by default). A
// boot-mounted cron sweeps rows past those thresholds; see
// `apps/api/plugins/notification-retention.ts`.
//
// Indexes:
//   - `(user_id, created_at desc)` powers the dropdown + /notifications page
//   - partial `(user_id) WHERE read_at IS NULL` keeps the bell-badge
//     count query O(1) for the typical "user has a few unread" case
export const notifications = pgTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Snake_case event key. Stable wire identifier; the frontend
     *  maps it to the localised label. */
    type: text('type').notNull(),
    /** Type-specific bag — actor username, target title, ids, etc.
     *  Free-form on purpose; each emitter picks the shape it needs.
     *  Never contains secrets (passkeys, IPs, tokens). */
    payload: jsonb('payload'),
    /** Optional deep link the dropdown row uses. Stored at emission
     *  time so a later route refactor doesn't desync historic rows. */
    link: text('link'),
    /** When the user marked this row read. Null = still unread.
     *  Drives both the badge count and the row tint in the UI. */
    readAt: timestamp('read_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('notifications_user_created_idx').on(
      table.userId,
      table.createdAt.desc()
    ),
    index('notifications_user_unread_idx')
      .on(table.userId)
      .where(sql`read_at IS NULL`),
  ]
);

export type Notification = typeof notifications.$inferSelect;

// ============================================================================
// Upload Rules (singleton — server-enforced gates on every upload)
// ============================================================================
//
// All the toggles + numeric thresholds live on one row, same idiom as
// `panic_state`. Per-category title regex live in a sibling table so
// they get FK-cascaded on category deletion (and so we don't end up
// shoving a freeform jsonb map into the settings KV).
//
// The rules are loaded with a Redis-backed cache by
// `utils/uploadRules.ts` and re-fetched whenever an admin PUTs the
// admin endpoint (cache busted by key).
//
// Boolean fields default to `false` (rule off) except `staffBypass`
// which defaults to `true` — the most common operator expectation is
// "admins/mods aren't subject to the same friction as normal users".
export const uploadRules = pgTable('upload_rules', {
  id: text('id').primaryKey().default('singleton'),
  /** Reject the upload if no NFO was attached (file or pasted text). */
  nfoRequired: boolean('nfo_required').default(false).notNull(),
  /** Reject the upload if the description is empty / whitespace. */
  descriptionRequired: boolean('description_required').default(false).notNull(),
  /** Minimum description length in characters (post-trim).
   *  Ignored when `descriptionRequired = false`. 0 = no minimum. */
  descriptionMinLength: integer('description_min_length')
    .default(0)
    .notNull(),
  /** Enable the per-category title pattern check. The actual
   *  patterns live in `upload_rule_category_patterns`; categories
   *  without a row pass through with no restriction. */
  titlePatternEnforced: boolean('title_pattern_enforced')
    .default(false)
    .notNull(),
  /** Global forbidden-words regex applied to every title — for
   *  banned source qualities ("CAM", "TS", "HDCAM", …) the operator
   *  doesn't want to repeat in every per-category pattern. Stored
   *  pre-anchored ; null = no blocklist. */
  titleBlocklist: text('title_blocklist'),
  /** Require an external TMDb id on every upload, regardless of
   *  category. Useful when the operator wants metadata coverage
   *  across the whole index. */
  tmdbIdRequired: boolean('tmdb_id_required').default(false).notNull(),
  /** Catastrophe cap — bytes. Null = no cap. Computed against the
   *  parsed `.torrent` total size (single file or sum of files). */
  maxTorrentSize: bigint('max_torrent_size', { mode: 'number' }),
  /** When true, users with `isAdmin` or `isModerator` skip every
   *  rule above. Independent of the `canUploadWithoutModeration`
   *  role permission, which only controls whether the upload lands
   *  in the moderation queue. */
  staffBypass: boolean('staff_bypass').default(true).notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Per-leaf-category title regex. The admin UI only exposes leaf
// categories (no children); intermediate / root categories never
// hold a row here. The pattern is already wrapped with ^…$ at save
// time, so the runtime check is a straight `new RegExp(pattern, 'i')
// .test(title)`.
//
// FK cascade so removing a category from /admin/categories
// auto-cleans its rule — no orphaned constraints to GC by hand.
export const uploadRuleCategoryPatterns = pgTable(
  'upload_rule_category_patterns',
  {
    categoryId: text('category_id')
      .primaryKey()
      .references(() => categories.id, { onDelete: 'cascade' }),
    pattern: text('pattern').notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  }
);

// ============================================================================
// Tags (Flexible labels for torrents: resolution, codec, source, etc.)
// ============================================================================
export const tags = pgTable('tags', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  slug: text('slug').notNull().unique(),
  color: text('color').default('#6b7280').notNull(), // Tailwind gray-500 default
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const torrentTags = pgTable(
  'torrent_tags',
  {
    torrentId: text('torrent_id')
      .notNull()
      .references(() => torrents.id, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.torrentId, table.tagId] }),
    index('torrent_tags_tag_idx').on(table.tagId),
  ]
);

// ============================================================================
// Hit and Run Tracking
// ============================================================================
export const hnrTracking = pgTable(
  'hnr_tracking',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    torrentId: text('torrent_id')
      .notNull()
      .references(() => torrents.id, { onDelete: 'cascade' }),
    downloadedAt: timestamp('downloaded_at').defaultNow().notNull(),
    seedTime: integer('seed_time').default(0).notNull(), // Seconds seeded
    requiredSeedTime: integer('required_seed_time').default(86400).notNull(), // 24h default
    isHnr: boolean('is_hnr').default(false).notNull(),
    isExempt: boolean('is_exempt').default(false).notNull(), // Manual exemption
    completedAt: timestamp('completed_at'), // When requirement was met
    // Per (user, torrent) byte accounting. The tracker's announce handler
    // already computes deltaUploaded / deltaDownloaded against the previous
    // peer entry to bump `users.uploaded/downloaded`; we persist the same
    // deltas here so the "Downloads" page can show how much the user has
    // exchanged for *this specific* torrent. Columns default to 0 so old
    // rows surface as "no data" until the user reannounces.
    uploaded: bigint('uploaded', { mode: 'number' }).default(0).notNull(),
    downloaded: bigint('downloaded', { mode: 'number' }).default(0).notNull(),
  },
  (table) => [
    index('hnr_user_idx').on(table.userId),
    index('hnr_torrent_idx').on(table.torrentId),
    index('hnr_status_idx').on(table.isHnr),
    uniqueIndex('hnr_user_torrent_idx').on(table.userId, table.torrentId),
    // Speeds up moderator queries "list HnR violations for user X"
    index('hnr_user_is_hnr_idx').on(table.userId, table.isHnr),
  ]
);

// ============================================================================
// Invitations
// ============================================================================
export const invitations = pgTable(
  'invitations',
  {
    id: text('id').primaryKey(),
    code: text('code').notNull().unique(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    usedBy: text('used_by').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    usedAt: timestamp('used_at'),
    expiresAt: timestamp('expires_at'), // Optional expiration
  },
  (table) => [
    index('invitations_created_by_idx').on(table.createdBy),
    index('invitations_code_idx').on(table.code),
  ]
);

// ============================================================================
// Reports
// ============================================================================
export const reports = pgTable(
  'reports',
  {
    id: text('id').primaryKey(),
    reporterId: text('reporter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetType: text('target_type').notNull(), // 'torrent' | 'user' | 'post' | 'comment'
    targetId: text('target_id').notNull(),
    reason: text('reason').notNull(),
    details: text('details'), // Additional context
    status: text('status').default('pending').notNull(), // pending | resolved | dismissed
    resolvedBy: text('resolved_by').references(() => users.id),
    resolvedAt: timestamp('resolved_at'),
    resolution: text('resolution'), // Action taken
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('reports_reporter_idx').on(table.reporterId),
    index('reports_target_idx').on(table.targetType, table.targetId),
    index('reports_status_idx').on(table.status),
  ]
);

// ============================================================================
// Site Stats (Historical data for charts)
// ============================================================================
export const siteStats = pgTable(
  'site_stats',
  {
    id: text('id').primaryKey(),
    usersCount: integer('users_count').notNull(),
    torrentsCount: integer('torrents_count').notNull(),
    peersCount: integer('peers_count').notNull(),
    seedersCount: integer('seeders_count').notNull(),
    redisMemoryUsage: bigint('redis_memory_usage', {
      mode: 'number',
    }).notNull(),
    dbSize: bigint('db_size', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('site_stats_created_at_idx').on(table.createdAt)]
);

// ============================================================================
// Relations for new tables
// ============================================================================
export const tagsRelations = relations(tags, ({ many }) => ({
  torrentTags: many(torrentTags),
}));

export const torrentTagsRelations = relations(torrentTags, ({ one }) => ({
  torrent: one(torrents, {
    fields: [torrentTags.torrentId],
    references: [torrents.id],
  }),
  tag: one(tags, {
    fields: [torrentTags.tagId],
    references: [tags.id],
  }),
}));

export const hnrTrackingRelations = relations(hnrTracking, ({ one }) => ({
  user: one(users, {
    fields: [hnrTracking.userId],
    references: [users.id],
  }),
  torrent: one(torrents, {
    fields: [hnrTracking.torrentId],
    references: [torrents.id],
  }),
}));

export const invitationsRelations = relations(invitations, ({ one }) => ({
  creator: one(users, {
    fields: [invitations.createdBy],
    references: [users.id],
    relationName: 'invitesCreated',
  }),
  usedByUser: one(users, {
    fields: [invitations.usedBy],
    references: [users.id],
    relationName: 'inviteUsed',
  }),
}));

export const reportsRelations = relations(reports, ({ one }) => ({
  reporter: one(users, {
    fields: [reports.reporterId],
    references: [users.id],
    relationName: 'reportsCreated',
  }),
  resolver: one(users, {
    fields: [reports.resolvedBy],
    references: [users.id],
    relationName: 'reportsResolved',
  }),
}));

// ============================================================================
// Types
// ============================================================================
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;
export type UserRole = typeof userRoles.$inferSelect;
export type NewUserRole = typeof userRoles.$inferInsert;
export type BannedIp = typeof bannedIps.$inferSelect;
export type NewBannedIp = typeof bannedIps.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Torrent = typeof torrents.$inferSelect;
export type NewTorrent = typeof torrents.$inferInsert;
export type TorrentStats = typeof torrentStats.$inferSelect;
export type AnnounceLogEntry = typeof announceLog.$inferSelect;
export type Setting = typeof settings.$inferSelect;

export type ForumCategory = typeof forumCategories.$inferSelect;
export type NewForumCategory = typeof forumCategories.$inferInsert;
export type ForumTopic = typeof forumTopics.$inferSelect;
export type NewForumTopic = typeof forumTopics.$inferInsert;
export type ForumPost = typeof forumPosts.$inferSelect;
export type NewForumPost = typeof forumPosts.$inferInsert;

export type TorrentComment = typeof torrentComments.$inferSelect;
export type NewTorrentComment = typeof torrentComments.$inferInsert;

export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
export type TorrentTag = typeof torrentTags.$inferSelect;
export type NewTorrentTag = typeof torrentTags.$inferInsert;

export type HnrTracking = typeof hnrTracking.$inferSelect;
export type NewHnrTracking = typeof hnrTracking.$inferInsert;

export type Invitation = typeof invitations.$inferSelect;
export type NewInvitation = typeof invitations.$inferInsert;

export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;

export type SiteStats = typeof siteStats.$inferSelect;
export type NewSiteStats = typeof siteStats.$inferInsert;

export type PanicState = typeof panicState.$inferSelect;
export type NewPanicState = typeof panicState.$inferInsert;
