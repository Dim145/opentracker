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
import { relations } from 'drizzle-orm';

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
    downloaded: bigint('downloaded', { mode: 'number' }).default(0).notNull(),
    invitesRemaining: integer('invites_remaining').default(0).notNull(),
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
    isApproved: boolean('is_approved').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('torrents_info_hash_idx').on(table.infoHash),
    index('torrents_uploader_idx').on(table.uploaderId),
    index('torrents_category_idx').on(table.categoryId),
    index('torrents_imdb_idx').on(table.imdbId),
    index('torrents_tmdb_idx').on(table.tmdbId),
    index('torrents_tvdb_idx').on(table.tvdbId),
    index('torrents_name_trgm_idx').using(
      'gist',
      table.name.op('gist_trgm_ops')
    ),
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

export const forumTopics = pgTable('forum_topics', {
  id: text('id').primaryKey(),
  categoryId: text('category_id')
    .notNull()
    .references(() => forumCategories.id, { onDelete: 'cascade' }),
  authorId: text('author_id')
    .notNull()
    .references(() => users.id),
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
  authorId: text('author_id')
    .notNull()
    .references(() => users.id),
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
  authorId: text('author_id')
    .notNull()
    .references(() => users.id),
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
  torrents: many(torrents),
  forumTopics: many(forumTopics),
  forumPosts: many(forumPosts),
  torrentComments: many(torrentComments),
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
}));

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
