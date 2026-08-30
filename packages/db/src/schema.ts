import {
  pgTable,
  text,
  timestamp,
  integer,
  smallint,
  bigint,
  boolean,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
  customType,
  check,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { ftsVector } from './search';

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
    /**
     * The one account that owns this instance. At most one row may carry it.
     *
     * Not a third rank above admin, and not a permission bundle: it names the
     * person whose instance this is, for the handful of decisions that are
     * theirs alone rather than the staff's. It exists because several parts of
     * this codebase already assumed it did — the federation console is
     * described as "owner-controlled" in the schema comments, the guide and the
     * governance docstrings, while the code behind it only ever checked
     * `is_admin`. So an admin appointed to moderate uploads could also
     * handshake with another instance on the operator's behalf.
     *
     * Set on the first registration (the account that already receives
     * `is_admin` and ten invitations), backfilled to the oldest admin on
     * migration, and transferable — an owner can hand it to another admin,
     * because an instance whose owner lost their password must not be
     * permanently undecidable.
     *
     * It also moves on its own. `relinquishOwnership` hands it to the oldest
     * eligible admin when the holder is erased, banned, or loses `is_admin`,
     * because each of those leaves an owner who cannot act — and an instance
     * with a paralysed owner is worse than one with a different owner.
     */
    isOwner: boolean('is_owner').default(false).notNull(),
    isBanned: boolean('is_banned').default(false).notNull(),
    // userId of the staffer who issued the most recent ban. Null when
    // the user has never been banned, or after an unban.
    bannedById: text('banned_by_id'),
    // Admin/moderator level of the staffer at ban time. Frozen at ban
    // time so a later promotion/demotion of the issuer doesn't mess
    // with the unban hierarchy check.
    bannedByRole: text('banned_by_role'), // 'admin' | 'moderator'
    // When set, the ban auto-expires at this timestamp. Null = permanent
    // ban (the historical behaviour). The expiry is enforced two ways:
    //   1) a 5-minute `ban-expiry` cron that clears flags + fires the
    //      `account_unbanned` notification, and
    //   2) lazy checks at login + torznab + tracker that let an expired
    //      user back in even if the cron is delayed.
    bannedUntil: timestamp('banned_until'),
    // Free-text justification displayed to the banned user on their
    // bounce screen. Sourced from the resolving moderator's input or
    // from the report's `reason` as a fallback.
    banReason: text('ban_reason'),
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
    /**
     * Read receipts, and they are reciprocal.
     *
     * Turning them off stops sending them AND stops seeing them. The
     * asymmetric version — see when others read, never tell them when you
     * did — is an information advantage the setting would be handing out,
     * and on a private tracker plenty of members would rather not
     * broadcast that they have read something at all.
     */
    messagingReadReceipts: boolean('messaging_read_receipts')
      .default(true)
      .notNull(),
    // Detaches the uploader's name from their releases, retroactively:
    // the flag lives on the account, not on the row, so flipping it
    // covers everything already uploaded. Read paths that face other
    // members drop the name (detail page, cross-seed list, RSS, the
    // federated catalogue we publish to peers) and the per-user upload
    // listing stops answering for this account. The uploader and staff
    // always see the real name — moderation has to stay able to tie a
    // release to whoever posted it, so this is concealment from peers,
    // never from the operator.
    anonymousUploads: boolean('anonymous_uploads').default(false).notNull(),
    // Hides the member's own snatch list from `/downloads`.
    //
    // Deliberately a *display* preference: the underlying rows are
    // `hnr_tracking`, which the hit-and-run job, the bonus accrual and
    // the auto-role rules all read, so the tracker cannot stop writing
    // them without letting a member evade HnR by ticking a box. What
    // this buys is that a session someone else got hold of cannot
    // enumerate what was downloaded, and the settings copy says exactly
    // that rather than implying the history is gone.
    hideDownloadHistory: boolean('hide_download_history')
      .default(false)
      .notNull(),
    // Requires a minimum account age before someone may comment on
    // this member's uploads — the answer to a fresh throwaway account
    // being used to harass an uploader. The uploader themselves and
    // staff are never held to it, so a thread stays answerable and
    // moderatable. Threshold: utils/commentPolicy.ts.
    restrictComments: boolean('restrict_comments').default(false).notNull(),
    // Opt-in: may a federated partner read this member's reputation
    // (ratio, upload/download, member-since) over the `accounts` scope?
    // Off by default and required by the member concerned, not just the
    // owner — the federation proposal is explicit that the `accounts`
    // scope needs the consent of the user whose data it exposes.
    // `/api/federation/user-reputation` answers only for members who set
    // this. See utils/federation and routes/api/federation/user-reputation.
    shareReputationFederated: boolean('share_reputation_federated')
      .default(false)
      .notNull(),
    // `'system'`, a built-in, an admin theme's slug — or NULL.
    //
    // NULL is the interesting value: it means the member has never chosen, so
    // they follow whatever the owner sets as the site default, and they keep
    // following it when the owner changes it. A stored `'dark'` is a CHOICE and
    // is left alone by a change of default. That distinction is the whole reason
    // the column is nullable rather than defaulted: a default of `'dark'` cannot
    // tell "I picked dark" apart from "I never looked", so the site-default
    // setting had nobody to apply to and did nothing at all.
    //
    // Deliberately free-form text with no foreign key: a member's preference
    // should survive a theme they never asked to lose, so the routes are what
    // notice a dangling slug rather than the database.
    //
    // Persisted server-side so the choice follows the member across devices
    // instead of being trapped in one browser's localStorage.
    theme: text('theme'),
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
    /**
     * Set when the account is erased (GDPR right to erasure — see
     * `utils/account/eraseAccount`). The row survives so the catalogue,
     * moderation log and economy it touched stay intact, but every personal
     * field on it is scrubbed and the account is refused at the door: the cached
     * auth gate reads this alongside `is_banned` and treats a set value as
     * `gone`, so a stale session cookie is dead on its next request. Not the
     * same as a ban — a ban is reversible and keeps the person; this does not.
     */
    deletedAt: timestamp('deleted_at'),
  },
  // Exactly one index, and it is a constraint rather than a lookup.
  //
  // `passkey` deliberately has none: it already carries `.unique()` on the
  // column above, which drizzle renders as `users_passkey_unique`, and the
  // explicit `uniqueIndex('users_passkey_idx')` that used to sit here produced
  // a SECOND, identical unique index on the same column — double the
  // maintenance on every write touching it, answering no query the other could
  // not.
  //
  // The partial unique index below is the opposite case: nothing else can say
  // "at most one owner". A boolean column cannot, a check constraint cannot see
  // other rows, and application code that reads-then-writes races with itself.
  // `WHERE is_owner` is what makes two owners unrepresentable rather than
  // merely unlikely.
  (table) => [
    uniqueIndex('users_owner_unique')
      .on(table.isOwner)
      .where(sql`${table.isOwner}`),
  ],
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
    // popup ("Global silverleech until the points system lands." in
    // the design). Optional.
    description: text('description'),
    // Long description for the "What is … ?" explainer block.
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
    // Where the event originated. `manual` is an admin-created window
    // (the historical default). `freeleech_pool` is created by the
    // contributory pool when its target is reached — the icon/modal
    // surface the difference with a dedicated copy.
    source: text('source').default('manual').notNull(),
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
    // Partial unique index — only one `first_seeder` grant per
    // torrent is ever allowed. The collector's gate already checks
    // existence per torrent before inserting (see
    // `applyFirstSeederRule`), but a race between two Nitro
    // replicas that both held a stale cross-replica lock view
    // would still let two inserts slip through; the DB-level
    // constraint catches that path as well. `WHERE` keeps the
    // index narrow — it doesn't apply to seeding / milestone /
    // account_age_monthly rows where multiple grants per torrent
    // are the whole point.
    uniqueIndex('bonus_grants_first_seeder_unique_idx')
      .on(table.torrentId)
      .where(sql`source = 'first_seeder' AND torrent_id IS NOT NULL`),
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
// Freeleech pool — contributory site-wide freeleech
// ============================================================================
//
// Users pool their bonus points into a shared pot; when the target is
// reached the system spawns a `bonus_events` row whose `source` column
// flags it as `freeleech_pool`, runs the freeleech for a configured
// number of days, then drains the pool and reopens a new cycle.
//
// The configuration is a singleton (`id = 1`, enforced by a CHECK
// constraint) because the pool is global by design: at most one pool
// can be filling at any moment, and the admin tunes one set of knobs
// for the whole site.
//
// Three sibling tables drive the runtime state:
//   - `freeleech_pool_cycles`        the lifecycle ledger — every
//                                     fill→trigger→end is a row, with
//                                     a `status` enum that the cron
//                                     advances.
//   - `freeleech_pool_contributions` append-only audit of who
//                                     contributed how many points to
//                                     which cycle.
//   - `freeleech_pool_windows`       optional open/closed windows
//                                     (admin-configurable). When at
//                                     least one window exists, the
//                                     pool only accepts contributions
//                                     when *now* falls inside one.
//
// Per design: when the pool fires while a non-freeleech bonus event is
// already in flight, the original event is closed immediately and its
// remaining duration is stashed on the cycle row (`paused_event_*`).
// When the pool's own event ends, the cron re-creates the original
// event for the remaining time so the operator's intent isn't lost.

export const freeleechPoolConfig = pgTable(
  'freeleech_pool_config',
  {
    // Singleton: id = 1, enforced by the CHECK below. The unique row
    // is upserted on first read; admins PATCH it without thinking
    // about its existence.
    id: integer('id').primaryKey(),
    enabled: boolean('enabled').default(false).notNull(),
    // Total bonus points needed to trigger the freeleech. Must be > 0
    // when `enabled = true` — the contribute endpoint refuses to run
    // with a zero target so a misconfig can't auto-trigger on the
    // first 1-point contribution.
    pointsTarget: integer('points_target').default(0).notNull(),
    // Length of the freeleech once triggered, in whole days. Cap at
    // 30 to avoid an operator typo that would lock the site into
    // permanent freeleech.
    freeleechDurationDays: integer('freeleech_duration_days').default(1).notNull(),
    // Lower bound on a single contribution. 1 is the natural floor —
    // a 0-point contribution would be a no-op that bloats the
    // contributions table.
    contributionMin: integer('contribution_min').default(1).notNull(),
    // Per-user cap as a basis-points fraction of the target
    // (10000 = 100%). 0 disables the cap entirely. Computed as
    // `floor(target * pct / 10000)` at contribute time so a target
    // change doesn't retroactively invalidate already-applied
    // contributions.
    maxPerUserBp: integer('max_per_user_bp').default(0).notNull(),
    // Quick-select buttons rendered next to the free-amount field.
    // jsonb array of positive integers; the UI ignores zero / negative
    // entries.
    presetAmounts: jsonb('preset_amounts')
      .$type<number[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    // Title / description applied to the spawned `bonus_events` row.
    // Falls back to a hard-coded i18n key when null.
    eventTitleTemplate: text('event_title_template'),
    eventDescriptionTemplate: text('event_description_template'),
    eventLongDescriptionTemplate: text('event_long_description_template'),
    updatedAt: timestamp('updated_at'),
  },
  (table) => [
    // The singleton constraint: only id = 1 is allowed to exist.
    // Belt-and-braces because the admin route also upserts on 1.
    uniqueIndex('freeleech_pool_config_singleton')
      .on(table.id)
      .where(sql`id = 1`),
  ]
);

// Optional contribution windows. When the table is empty the pool is
// always open (subject to `enabled`); otherwise we accept contributions
// only when *now* falls inside at least one row.
//
// Four flavours, distinguished by `kind`:
//   - 'oneoff'    concrete [startsAt, endsAt) range
//   - 'weekly'    weekday + time-of-day bounds, repeated every week
//   - 'monthly'   list of days-of-month + time-of-day bounds, repeated
//                 every month
//   - 'yearly'    month/day for both ends of a yearly anniversary range
//
// The columnar layout below stays sparse (each row uses one block of
// columns and leaves the others null) on purpose: it keeps the
// per-kind queries simple and lets the FE submit/edit each kind with
// its own form without a polymorphic `config` jsonb to validate.
export const freeleechPoolWindows = pgTable(
  'freeleech_pool_windows',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(), // 'oneoff' | 'weekly' | 'monthly' | 'yearly'
    enabled: boolean('enabled').default(true).notNull(),
    // One-off fields. Null on recurring rows.
    startsAt: timestamp('starts_at'),
    endsAt: timestamp('ends_at'),
    // Weekly fields. Weekday is 0-6, 0 = Sunday (matches JS
    // `Date.getUTCDay`). Minute bounds are minutes since UTC
    // midnight (0–1440). The time-of-day bounds are *also* used by
    // `monthly` rows so the same form widget can drive both.
    weekdayStart: integer('weekday_start'),
    weekdayEnd: integer('weekday_end'),
    minuteStart: integer('minute_start'),
    minuteEnd: integer('minute_end'),
    // Monthly fields. `monthly_days` is a jsonb int array of days
    // (1-31). The pool is open on those days, between
    // `minute_start` and `minute_end`.
    monthlyDays: jsonb('monthly_days').$type<number[]>(),
    // Yearly fields. Annual anniversary range — month is 1-12, day
    // is 1-31. The range can cross a year boundary (e.g. Dec 20 →
    // Jan 5) and the service handles the wraparound. Whole-day
    // windows for simplicity.
    yearMonthStart: integer('year_month_start'),
    yearDayStart: integer('year_day_start'),
    yearMonthEnd: integer('year_month_end'),
    yearDayEnd: integer('year_day_end'),
    label: text('label'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('freeleech_pool_windows_kind_idx').on(table.kind, table.enabled),
    index('freeleech_pool_windows_oneoff_idx').on(
      table.startsAt,
      table.endsAt,
    ),
  ]
);

// One row per cycle. The cron advances `status`:
//   filling      → contributions accepted; total < target
//   full_queued  → target reached but a freeleech event was already
//                  active; the cron will start us when that event ends
//   active       → our bonus_event is running (started_at filled)
//   ended        → the bonus event terminated naturally (cron sweep)
//   cancelled    → admin reset/drained the pool mid-cycle
//
// Only one row at a time should be in `filling | full_queued | active`.
// The contribute endpoint serialises via a Postgres advisory lock so
// concurrent inserts can't fork the cycle.
export const freeleechPoolCycles = pgTable(
  'freeleech_pool_cycles',
  {
    id: text('id').primaryKey(),
    status: text('status').default('filling').notNull(),
    // Snapshot of the config at cycle creation so a mid-cycle config
    // change can't move the goalposts on contributors.
    targetSnapshot: integer('target_snapshot').notNull(),
    durationDaysSnapshot: integer('duration_days_snapshot').notNull(),
    totalContributed: integer('total_contributed').default(0).notNull(),
    // Filled when status → active.
    startedAt: timestamp('started_at'),
    endsAt: timestamp('ends_at'),
    // FK to the bonus_events row created on trigger.
    triggeredEventId: text('triggered_event_id').references(
      () => bonusEvents.id,
      { onDelete: 'set null' }
    ),
    // Preserved overlay state — when we displaced a non-freeleech
    // event to run the pool, these capture its params + remaining
    // duration so the cron can spawn a replacement at pool end.
    pausedEventTitle: text('paused_event_title'),
    pausedEventDescription: text('paused_event_description'),
    pausedEventLongDescription: text('paused_event_long_description'),
    pausedEventDownloadMultiplier: integer('paused_event_download_multiplier'),
    pausedEventUploadMultiplier: integer('paused_event_upload_multiplier'),
    pausedEventRemainingMs: bigint('paused_event_remaining_ms', { mode: 'number' }),
    pausedEventCreatedById: text('paused_event_created_by_id').references(
      () => users.id,
      { onDelete: 'set null' }
    ),
    // When we're full_queued, this is the event we're waiting on so
    // the cron can short-circuit the start check.
    waitingOnEventId: text('waiting_on_event_id').references(
      () => bonusEvents.id,
      { onDelete: 'set null' }
    ),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    closedAt: timestamp('closed_at'),
  },
  (table) => [
    index('freeleech_pool_cycles_status_idx').on(table.status, table.createdAt),
    // The cron picks pending cycles by status; the partial unique
    // index forbids two simultaneously-open cycles. A historical
    // `ended`/`cancelled` row can sit next to a fresh `filling` one
    // without conflict.
    uniqueIndex('freeleech_pool_cycles_open_unique')
      .on(table.status)
      .where(sql`status IN ('filling', 'full_queued', 'active')`),
  ]
);

// Append-only contribution ledger. A user can contribute many times
// to the same cycle — we don't merge rows so the audit stays honest.
// The corresponding `bonus_grants` row (source = 'freeleech_pool',
// amount < 0) carries the user's per-user history view.
export const freeleechPoolContributions = pgTable(
  'freeleech_pool_contributions',
  {
    id: text('id').primaryKey(),
    cycleId: text('cycle_id')
      .notNull()
      .references(() => freeleechPoolCycles.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    amount: integer('amount').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('freeleech_pool_contributions_cycle_idx').on(
      table.cycleId,
      table.createdAt
    ),
    // Aggregation index for "top contributors" + per-user cap check.
    index('freeleech_pool_contributions_cycle_user_idx').on(
      table.cycleId,
      table.userId
    ),
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
    // Drives which external metadata source the upload/edit form
    // hints at — 'movie' / 'tv' route to TMDb, 'game' routes to
    // IGDB. So a category like XXX/Hentai can opt into the TV
    // path even though its newznab id sits in the 6000-range.
    // Stored as text to leave room for future buckets ('music',
    // 'book', …) without a schema migration. Null = use the
    // existing newznab / slug heuristic.
    type: text('type'), // 'movie' | 'tv' | 'game' | 'book' | null
    // Optional Phosphor icon name (e.g. "ph:film-strip-bold") that
    // overrides the type-derived default when an operator wants a
    // category-specific glyph in torrent rows. Stored as the bare
    // icon-set name string; the frontend renders it via <Icon>.
    // Null falls back to the `type`-based mapping (movie → film,
    // tv → television, …) and finally to a generic file glyph.
    icon: text('icon'),
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
    // `set null` rather than the default `no action`: a torrent has to outlive
    // its uploader (the whole catalogue would otherwise be undeletable while a
    // single member holds one release), and an erased account keeps its row but
    // may one day be hard-purged. A null uploader reads as "anonymous / former
    // member", which every surface already tolerates.
    uploaderId: text('uploader_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    categoryId: text('category_id').references(() => categories.id),
    // External media-database tags (issue #47). Stored as canonical
    // ids — `imdb_id` keeps the `tt` prefix; `tmdb_id`, `tvdb_id`
    // and `igdb_id` are pure digits. `openlibrary_id` stores either
    // a 13-digit ISBN, a 10-digit ISBN, or an Open Library work id
    // (`OL\d+W`) — whichever the upload form resolved. *Arr clients
    // use these to match torrents against their library; the upload
    // form normalises raw URLs / slugs into these.
    imdbId: text('imdb_id'),
    tmdbId: text('tmdb_id'),
    tvdbId: text('tvdb_id'),
    igdbId: text('igdb_id'),
    openlibraryId: text('openlibrary_id'),
    // ── Series position ──────────────────────────────────────
    // A `tmdb_id` for television identifies the SERIES, not a season, so a
    // catalogue grouped on it alone collapses every episode of every season
    // into a single entry. These two carry the position parsed from the
    // release name at upload (and backfilled over the existing catalogue), so
    // the grouping key can be `tmdb:tv/1396:s03`.
    //
    // Both stay nullable: a film has no season, and a name the parser cannot
    // read falls back to the series-level group rather than being dropped.
    // `season` with a null `episode` is the legitimate season-pack case.
    season: smallint('season'),
    episode: smallint('episode'),
    // Content signature — SHA-256 of the canonical file list
    // `[{path, length}]` (sorted by path). Two torrents that contain
    // the same files (same paths, same sizes) share the same signature,
    // even when their `info_hash` differs (different piece size,
    // different `private` flag, different announce URL, …). Used to
    // surface cross-seeds in the UI and to compute the share of the
    // swarm's exchange volume coming from peers that also seed a
    // different `.torrent` of the same content.
    //
    // Nullable so older rows uploaded before this column existed can
    // be backfilled lazily by `plugins/backfill-content-signatures.ts`.
    contentSignature: text('content_signature'),
    // BitTorrent v2 (BEP 52) content addressing — see utils/bittorrentV2.
    // `infoHashV2` is the SHA-256 of the v2 `info` dict (hybrid announce, M3);
    // `contentRootV2` is the cross-tracker content key over the per-file Merkle
    // roots — the cryptographic upgrade of `content_signature`, preferred over it
    // when present. Both null for a v1-only torrent; backfilled from the stored
    // `.torrent` by `plugins/backfill-content-roots.ts`.
    infoHashV2: text('info_hash_v2'),
    contentRootV2: text('content_root_v2'),
    isActive: boolean('is_active').default(true).notNull(),
    // Per-torrent opt-in for swarm federation (Phase 4). When true AND the
    // owner has a swarm-scoped peer link, this torrent's peers may be shared
    // with / mixed from partner instances. Off by default — it re-opens the
    // private swarm isolation, so it stays an explicit per-torrent choice.
    federateSwarm: boolean('federate_swarm').default(false).notNull(),
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
    // Bumped on every drizzle update of the row (via $onUpdate) — metadata
    // edits, moderation transitions, etc. NULL until first edited, so the
    // federation "catalog-refresh" feed (cursor on updated_at) carries only
    // CHANGED rows; brand-new torrents stay on the create-cursor catalogue
    // feed. This is what lets edits / re-approvals propagate to partner
    // mirrors (the append-forward catalogue cursor never re-reads old rows).
    updatedAt: timestamp('updated_at').$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('torrents_info_hash_idx').on(table.infoHash),
    index('torrents_updated_at_idx').on(table.updatedAt),
    index('torrents_uploader_idx').on(table.uploaderId),
    index('torrents_category_idx').on(table.categoryId),
    index('torrents_imdb_idx').on(table.imdbId),
    index('torrents_tmdb_idx').on(table.tmdbId),
    // Serves the grouped listing: television groups on (tmdb_id, season) and
    // the query groups on exactly that pair.
    index('torrents_tmdb_season_idx').on(table.tmdbId, table.season),
    // ── Grouped listing ──────────────────────────────────────
    // Two partial indexes, one per branch of the grouped query, both keyed on
    // the same ordering expression the listing uses.
    //
    // The naive form — GROUP BY over the whole table — costs a sequential scan
    // plus a hash aggregate on every page: 180 ms over 200 000 rows, growing
    // linearly and never able to stop early, because ordering groups by recency
    // needs every group before it can pick 25. Splitting the query in two makes
    // both halves index-driven and brings the same page to 0.8 ms.
    //
    // A torrent WITHOUT an external id is a group of one, so it needs no
    // aggregation at all — it streams straight off `torrents_ungrouped_idx`
    // and stops at the limit. Only tagged rows reach the aggregate, which is
    // the set that genuinely has to be folded.
    index('torrents_grouped_idx')
      .on(sql`coalesce(${table.moderatedAt}, ${table.createdAt}) DESC`)
      .where(
        sql`${table.moderationStatus} = 'accepted' AND ${table.isActive} AND (${table.tmdbId} IS NOT NULL OR ${table.igdbId} IS NOT NULL OR ${table.openlibraryId} IS NOT NULL)`,
      ),
    index('torrents_ungrouped_idx')
      .on(sql`coalesce(${table.moderatedAt}, ${table.createdAt}) DESC`)
      .where(
        sql`${table.moderationStatus} = 'accepted' AND ${table.isActive} AND ${table.tmdbId} IS NULL AND ${table.igdbId} IS NULL AND ${table.openlibraryId} IS NULL`,
      ),
    index('torrents_tvdb_idx').on(table.tvdbId),
    index('torrents_igdb_idx').on(table.igdbId),
    index('torrents_content_signature_idx').on(table.contentSignature),
    // The cross-tracker content key drives cross-seed / fill matching joins.
    index('torrents_content_root_v2_idx').on(table.contentRootV2),
    index('torrents_openlibrary_idx').on(table.openlibraryId),
    index('torrents_moderation_status_idx').on(table.moderationStatus),
    // GIN rather than GiST: it is the recommended opclass for LIKE/ILIKE and,
    // measured over 200,000 rows, returns in 20 ms against 26 ms while building
    // three times faster. This index no longer serves the main search — which
    // moved to full text — but the typo fallback (`word_similarity`), which
    // depends on it.
    index('torrents_name_trgm_idx').using(
      'gin',
      table.name.op('gin_trgm_ops')
    ),
    // Full text: one index per field, not a single weighted vector. That is
    // what makes the admin setting actually effective — the query ORs together
    // only the enabled fields, each served by its own index. A single vector
    // would force reading everything and filtering afterwards.
    index('torrents_fts_name_idx').using('gin', ftsVector(table.name)),
    index('torrents_fts_description_idx').using(
      'gin',
      ftsVector(table.description)
    ),
    index('torrents_fts_nfo_idx').using('gin', ftsVector(table.nfo)),
    // The federation mint cursor walks and sorts on `coalesce(updated_at,
    // created_at)` every tick. `torrents_updated_at_idx` is on `updated_at`
    // alone and does not serve the coalesce, so the walk was a sequential scan
    // of the whole table on every pass — 5-minutely in steady state, and once
    // per 3-second tick during a backfill. This expression index is what the
    // cursor actually orders by.
    index('torrents_mint_cursor_idx').on(
      sql`coalesce(${table.updatedAt}, ${table.createdAt})`,
      table.id
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
// Catalogue Records (signed, content-addressed, immutable)
// ============================================================================
/**
 * The federated catalogue as a set of signed artefacts rather than a query
 * over `torrents`.
 *
 * Trust used to come from the CHANNEL — an Ed25519 signature over the HTTP
 * request — which is enough to know who you are talking to and nothing more.
 * It cannot answer "did C really say this?" about something B handed you, so
 * every instance had to fetch from every other instance itself. Signing the
 * RECORD moves trust into the data: it verifies in anybody's hands, having
 * arrived by any route, which is what makes relaying, caching and gossip
 * possible at all.
 *
 * **A record is immutable.** Editing a torrent mints a NEW record that
 * supersedes the old one; hiding or deleting it mints a `tombstone`. That is
 * why the body is stored rather than re-projected on read: re-projecting a
 * record after its torrent changed would produce a different one, and the
 * signature would no longer match the id anybody cached it under.
 *
 * Cost, stated plainly: the body duplicates the description, so a catalogue of
 * long descriptions pays for them twice. That is the price of immutability and
 * it is the right trade — a record nobody can re-derive is a record nobody can
 * verify.
 */
export const catalogRecords = pgTable(
  'catalog_records',
  {
    /** Content address — `sha256:<hex>` over the canonical body. */
    id: text('id').primaryKey(),
    /**
     * The torrent this record describes. Deliberately NOT a foreign key.
     *
     * A record is a published artefact and has to outlive its subject: that is
     * the whole point of a tombstone. An `ON DELETE SET NULL` would sever the
     * link at exactly the moment it is needed, leaving nothing to say WHICH
     * release was withdrawn, and no way for the sweep to notice the deletion
     * at all. A dangling id here is not a broken reference — it is the record
     * doing its job.
     */
    torrentId: text('torrent_id'),
    /**
     * The release this record is about. Null for a record that is not about a
     * release at all — an identity assertion has a subject, not an infohash.
     */
    infoHash: text('info_hash'),
    /** `did:key:…` of the instance that signed it. */
    issuer: text('issuer').notNull(),
    /** `torrent` | `tombstone` | `identity` | `revocation` */
    kind: text('kind').notNull().default('torrent'),
    /**
     * Who made this record: `local` if we minted it, `ingested` if we took it
     * in from somebody else.
     *
     * The table stopped being "what we published" the moment relaying arrived
     * and became "records we hold" — which is the right model, and a sharp
     * edge. Every sweep that decides what to WITHDRAW has to say `local`, or
     * it will happily mint tombstones for other people's catalogues: an
     * ingested record has no local torrent behind it, which is exactly what
     * "this release is gone" looks like from the inside.
     */
    origin: text('origin').notNull().default('local'),
    /**
     * How far this record travelled to reach us. 0 = we minted it, 1 = we took
     * it from the instance that did, 2 = a partner relayed it to us.
     *
     * It is what bounds the network at two hops: we relay what we got at one
     * hop and never what was already relayed to us. Enforced here rather than
     * by asking a partner how far it came, because a partner that lies about
     * that is precisely the case the bound exists for.
     */
    hops: integer('hops').notNull().default(0),
    /**
     * The instance that vouched for this copy — the countersigner's `did:key`.
     *
     * Null for our own records and for one we took first-hand: nobody had to
     * introduce it. Set only on a relayed copy, where it is the answer to "on
     * whose word did we take this in".
     *
     * `admit` computed this and threw it away, and the absence had a cost.
     * Cutting a peer purged the rows under ITS `peer_id`, but a record it
     * vouched for arrives under the RELAY's `peer_id` — so the introduction
     * survived the instance that made it, with nothing left to find it by.
     * Same shape as the `issuer` gap: a column nobody wrote is a lever nobody
     * has.
     */
    via: text('via'),
    /** The signed object, exactly as it goes on the wire. */
    body: jsonb('body').$type<Record<string, unknown>>().notNull(),
    /**
     * Hash of the projection WITHOUT its lineage — what the torrent says,
     * ignoring what it replaces.
     *
     * The id cannot serve as the idempotency key: it covers `replaces`, which
     * differs for every generation, so an unchanged torrent would look changed
     * on every sweep and re-mint forever. Splitting the two also keeps the
     * rename-and-rename-back case honest — same content, different lineage,
     * different address, no collision.
     */
    contentHash: text('content_hash').notNull(),
    /** The record this one replaces, when it is an edit. */
    supersedes: text('supersedes'),
    /** Set when a newer record for the same torrent was minted. */
    supersededAt: timestamp('superseded_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('catalog_records_info_hash_idx').on(table.infoHash),
    /** Newest first, for the live-search answer. */
    index('catalog_records_created_idx').on(table.createdAt),
    /** What we are willing to hand on: ours, and what we got first-hand. */
    index('catalog_records_relayable_idx').on(table.origin, table.hops),
    /**
     * The set reconciliation reads: ordered ranges of `id` over the records
     * that still stand. The primary key alone would have to visit the heap for
     * every row to check `superseded_at`, which on a reconciliation that
     * fingerprints the whole catalogue is the difference between an index-only
     * scan and reading the table.
     */
    index('catalog_records_live_idx')
      .on(table.id)
      .where(sql`superseded_at IS NULL`),
    // The current record for a torrent — the only one the minting sweep needs
    // to compare against, and the only one a fresh reader wants.
    index('catalog_records_current_idx')
      .on(table.torrentId)
      .where(sql`superseded_at IS NULL`),
  ]
);

export type CatalogRecord = typeof catalogRecords.$inferSelect;

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
  // Key-derivation scheme used for the current ciphertext:
  //   1 (legacy) = key derived from the stored panic_password_hash. UNSAFE
  //                against a DB dump (both KDF inputs live in the dump), kept
  //                only so a database panicked before the fix can still be
  //                restored.
  //   2          = key derived from the raw panic password supplied at
  //                encrypt time + a random salt. A dump then yields only the
  //                scrypt verifier + salt + ciphertext, forcing an offline
  //                password brute-force instead of instant decryption.
  // New panics always write 2; restore branches on this value.
  kdfVersion: integer('kdf_version').default(1).notNull(),
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
// External notification channels
// ============================================================================
//
// Three tables capture the full state of "external delivery":
//
//   `notificationChannels` — singleton per channel TYPE. Admin enables
//      the type and stores any server-side credentials (SMTP host,
//      Telegram bot token, Apprise API URL…). `lastTestStatus = 'ok'`
//      is the gate that lets users see the channel. A re-test is
//      required after any server-side config change.
//
//   `userNotificationChannels` — per-user opt-in. Stores the user-side
//      portion of the credential (their email "to", their Telegram
//      chat_id, their Apprise URL). Server-side fields never leak into
//      this row — the dispatcher merges them at send time.
//
//   `userNotificationRouting` — explicit routing of (user, type) →
//      channelType. Default behaviour when a user enables their first
//      channel: a full set of rows pointing every notif type at that
//      channel (opt-out semantics, matches the user's spec). The row
//      is deleted when the user unticks the type → no external send.
//
// Both `serverConfig` and `userConfig` are JSON strings encrypted at
// rest with the same AES-GCM helper used for panic data, keyed by
// `NUXT_SESSION_SECRET` (or a dedicated env var when set). Field
// shapes are channel-specific and validated by the adapter's Zod
// schema before encryption.
export const notificationChannels = pgTable(
  'notification_channels',
  {
    /** Channel type id — `smtp` / `discord` / `telegram` / …
     *  Acts as the natural PK; we never have two rows of the same
     *  type. The list is closed (controlled by the adapter registry). */
    type: text('type').primaryKey(),
    enabled: boolean('enabled').default(false).notNull(),
    /** Encrypted JSON of the channel-specific server-side fields.
     *  Empty string for channels that have no server-side config
     *  (Discord/Slack/Mattermost webhooks). */
    serverConfig: text('server_config').default('').notNull(),
    /** `ok` = last admin test passed → users can see the channel.
     *  `error` or null = hidden from /settings until re-test. */
    lastTestStatus: text('last_test_status'),
    lastTestError: text('last_test_error'),
    lastTestedAt: timestamp('last_tested_at'),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    /** Admin who last touched the row. Null only for the initial seed. */
    updatedBy: text('updated_by').references(() => users.id, {
      onDelete: 'set null',
    }),
  }
);

export type NotificationChannel = typeof notificationChannels.$inferSelect;

export const userNotificationChannels = pgTable(
  'user_notification_channels',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Mirrors `notificationChannels.type`. Not declared as a real FK
     *  to allow lazy admin disable/re-enable without orphaning rows. */
    channelType: text('channel_type').notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    /** Encrypted JSON of the user-side fields (e.g. SMTP `to` email,
     *  Telegram `chat_id`, full Apprise URL). */
    userConfig: text('user_config').default('').notNull(),
    lastTestStatus: text('last_test_status'),
    lastTestError: text('last_test_error'),
    lastTestedAt: timestamp('last_tested_at'),
    /** Circuit-breaker counter — incremented on each delivery failure,
     *  reset on success. At 5 consecutive failures the row is forced
     *  to `enabled = false` and the user is notified in-app to retest. */
    consecutiveFailures: integer('consecutive_failures').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('user_notification_channels_user_type_unique').on(
      table.userId,
      table.channelType
    ),
  ]
);

export type UserNotificationChannel =
  typeof userNotificationChannels.$inferSelect;

export const userNotificationRouting = pgTable(
  'user_notification_routing',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Notification type key — same string the in-app notifs use. */
    type: text('type').notNull(),
    /** Channel type the notif is routed to. The row's existence means
     *  "send this notif externally"; absence means in-app only. */
    channelType: text('channel_type').notNull(),
  },
  (table) => [
    uniqueIndex('user_notification_routing_pk').on(table.userId, table.type),
    index('user_notification_routing_user_idx').on(table.userId),
  ]
);

export type UserNotificationRouting =
  typeof userNotificationRouting.$inferSelect;

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
export const tags = pgTable(
  'tags',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull().unique(),
    slug: text('slug').notNull().unique(),
    color: text('color').default('#6b7280').notNull(), // Tailwind gray-500 default
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    // Serves the "tags" branch of text search. The table is small, but the
    // predicate is a correlated EXISTS evaluated per candidate row: without an
    // index it becomes a scan of `tags` every time.
    index('tags_fts_name_idx').using('gin', ftsVector(table.name)),
  ]
);

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
    // No standalone (user_id) index: it is a leading prefix of BOTH
    // `hnr_user_torrent_idx` and `hnr_user_is_hnr_idx` below, so Postgres can
    // serve a user_id-only lookup from either. It was pure write amplification
    // on a table the announce path updates once per announce.
    index('hnr_torrent_idx').on(table.torrentId),
    // Partial. `is_hnr` is a boolean and the interesting side is the rare one:
    // a full index spends most of its pages describing the rows nobody
    // queries, and every announce that updates a tracking row maintains them.
    index('hnr_status_idx').on(table.isHnr).where(sql`${table.isHnr}`),
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
    // pending | resolved | dismissed | withdrawn
    status: text('status').default('pending').notNull(),
    // Withdrawal by the reporter. The row is no longer deleted: it disappears
    // from the reporter's list — they asked to be forgotten — but stays counted
    // on the moderation side, where a user who files then withdraws in series is
    // exactly the signal we are after. The tombstone therefore does not exist
    // for the user, it exists for the staff.
    withdrawnAt: timestamp('withdrawn_at'),
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
    // Cumulative `SUM(users.uploaded)` at snapshot time. Lets the
    // public stats endpoint compute "last 24 h / 7 d traffic"
    // without a per-row scan by diffing two snapshots. Same `number`
    // mode as `users.uploaded` for arithmetic-friendliness — both
    // round once the value crosses ~9 PiB. A long-running tracker
    // that drifts past that should switch both columns to bigint
    // mode + string transport in one go.
    totalUploadedBytes: bigint('total_uploaded_bytes', {
      mode: 'number',
    }).default(0).notNull(),
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

// ============================================================================
// Upload requests
// ============================================================================
// A user-driven bounty board: "I want this torrent uploaded, here's a
// reward". The flow:
//   1. requester picks a category, writes a title + description, optionally
//      stakes a reward (deducted from `bonusPoints` on creation, refunded
//      on cancel, transferred to filler on validate).
//   2. another user (NOT the requester — self-fill is rejected at the
//      endpoint) submits the infoHash of an upload they claim satisfies
//      the request → status `filled`.
//   3. the requester either validates (filler receives reward) or rejects
//      (status → `requested`, filler's attempt counter increments — once
//      the per-user cap is reached they can no longer re-propose on the
//      same request).
//   4. if the requester sits on a `filled` request past the operator-
//      configured timeout, a cron auto-validates and pays the filler.
//
// Comments live in a sibling table — they're a discussion thread, not a
// timeline of state changes (state changes don't generate a comment row).
export const uploadRequests = pgTable(
  'upload_requests',
  {
    id: text('id').primaryKey(),
    requesterId: text('requester_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    description: text('description').notNull(),
    // Snapshot at creation. Deducted from requester immediately and held
    // (the user can't double-spend by editing this down). Bumps are
    // allowed (delta deducted on the spot) — drops are not.
    rewardPoints: integer('reward_points').default(0).notNull(),
    // requested | filled | cancelled | validated
    status: text('status').default('requested').notNull(),
    // When `status = filled` or `validated`, the user who matched the
    // request. Cleared on reject so the row goes back to "looking for a
    // filler".
    filledById: text('filled_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    filledTorrentId: text('filled_torrent_id').references(() => torrents.id, {
      onDelete: 'set null',
    }),
    filledAt: timestamp('filled_at'),
    validatedAt: timestamp('validated_at'),
    cancelledAt: timestamp('cancelled_at'),
    // Federated origin (M1 request→fill bridge). Set when a request was raised
    // from a mirrored release a member saw on a partner but could not pull: the
    // request lives entirely on this tracker (a local member fills it by
    // uploading here), and these only remember where it came from and how to
    // prove a fill is the same content.
    //   - `federatedPeerId`  — which partner the release was seen on (for
    //     targeting the members who also have an account there).
    //   - `federatedInfoHash` — the origin's v1 infohash, for dedup + display.
    //   - `federatedContentRootV2` — the origin's cross-tracker content key
    //     (§1). A fill whose own root EQUALS this is the same content (shown as
    //     "content-verified"); an unequal root is NOT proof of difference —
    //     content_root_v2 spans aux files (.nfo/subs), so it is advisory only,
    //     never a gate on the fill.
    federatedPeerId: text('federated_peer_id').references(() => federationPeers.id, {
      onDelete: 'set null',
    }),
    federatedInfoHash: text('federated_info_hash'),
    federatedContentRootV2: text('federated_content_root_v2'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    // Listing index: open requests, newest first.
    index('upload_requests_status_idx').on(table.status, table.createdAt),
    // Dedup: "is this federated release already requested here?"
    index('upload_requests_federated_info_hash_idx').on(table.federatedInfoHash),
    // "Show me my own requests" + chronological order.
    index('upload_requests_requester_idx').on(
      table.requesterId,
      table.createdAt,
    ),
    // Auto-validate cron scans this — partial-index would be ideal but
    // drizzle can't express it inline; the migration ships a partial.
    index('upload_requests_filled_at_idx').on(table.filledAt),
  ],
);

// One row per (request, user) fill attempt — used to enforce the
// per-user proposal cap (an uploader rejected too many times can't
// keep flooding the same request). `proposed` rows are the active
// pending fill; `rejected` rows are the audit trail counter.
export const uploadRequestFillAttempts = pgTable(
  'upload_request_fill_attempts',
  {
    id: text('id').primaryKey(),
    requestId: text('request_id')
      .notNull()
      .references(() => uploadRequests.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    torrentId: text('torrent_id')
      .notNull()
      .references(() => torrents.id, { onDelete: 'cascade' }),
    // 'proposed' (live, awaiting validation) | 'rejected' (the user's
    // attempt was bounced) | 'validated' (the user won the bounty).
    status: text('status').default('proposed').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    rejectedAt: timestamp('rejected_at'),
  },
  (table) => [
    // Counter query: "how many rejected fills has user X already piled
    // up on request Y" runs on every fill attempt.
    index('upload_request_fill_attempts_request_user_idx').on(
      table.requestId,
      table.userId,
    ),
    // Authoritative "one active proposal at a time per (request,
    // user)" guard. The fill endpoint already locks-and-counts
    // inside a transaction, but this partial unique index makes
    // the constraint structural — any future codepath that
    // forgets to lock can't insert a duplicate `proposed` row.
    uniqueIndex('upload_request_fill_attempts_active_unique')
      .on(table.requestId, table.userId)
      .where(sql`status = 'proposed'`),
  ],
);

// Discussion thread attached to a request. Separate from the status
// changes (those are derived from the parent row's timestamps + status).
export const uploadRequestComments = pgTable(
  'upload_request_comments',
  {
    id: text('id').primaryKey(),
    requestId: text('request_id')
      .notNull()
      .references(() => uploadRequests.id, { onDelete: 'cascade' }),
    authorId: text('author_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    // Stamped when the author edits within the 15-minute grace window.
    // After that the row is frozen (the endpoint refuses further PATCH).
    editedAt: timestamp('edited_at'),
    // Soft-delete by staff. The row stays so the thread numbering
    // doesn't shift, but `body` is hidden from non-staff viewers.
    deletedAt: timestamp('deleted_at'),
    deletedById: text('deleted_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    // Listing index for the detail page (chronological).
    index('upload_request_comments_request_idx').on(
      table.requestId,
      table.createdAt,
    ),
  ],
);

export type UploadRequest = typeof uploadRequests.$inferSelect;
export type NewUploadRequest = typeof uploadRequests.$inferInsert;
export type UploadRequestFillAttempt =
  typeof uploadRequestFillAttempts.$inferSelect;
export type NewUploadRequestFillAttempt =
  typeof uploadRequestFillAttempts.$inferInsert;
export type UploadRequestComment =
  typeof uploadRequestComments.$inferSelect;
export type NewUploadRequestComment =
  typeof uploadRequestComments.$inferInsert;

// ============================================================================
// User follows
// ============================================================================
// Asymmetric follow graph: one row per (follower, followed) pair.
// The follower's identity is private to the follower — the /users/:id
// page shows a public *count* but never the names. The follower's
// own /following surface is the only place that reveals the list.
//
// Composite PK doubles as the "follow once" guard so the POST
// endpoint can ON CONFLICT DO NOTHING without a separate unique
// index. ON DELETE CASCADE on both FKs keeps the graph clean when
// either side is deleted (account purge propagates to all their
// outgoing AND incoming edges).
export const userFollows = pgTable(
  'user_follows',
  {
    followerId: text('follower_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    followingId: text('following_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.followerId, table.followingId] }),
    // Drives the upload fan-out: "every follower of user X" is the
    // hot path when X uploads a torrent. Also serves the public
    // followers count via COUNT(*) WHERE following_id = ?.
    index('user_follows_following_idx').on(table.followingId),
  ],
);

export type UserFollow = typeof userFollows.$inferSelect;
export type NewUserFollow = typeof userFollows.$inferInsert;

// ============================================================================
// Torrent favorites
// ============================================================================
// One row per (user, torrent) pin. Purely user-private — no public
// "X people favorited this" count, no notification to the uploader.
// Composite PK doubles as the "can't favorite twice" guard: the
// POST endpoint can ON CONFLICT DO NOTHING without an extra unique
// index. A user deletion drops their favorites; a torrent deletion
// drops every favorite that referenced it (cleaner than leaving
// dangling rows for the /me/favorites page to filter out).
export const torrentFavorites = pgTable(
  'torrent_favorites',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    torrentId: text('torrent_id')
      .notNull()
      .references(() => torrents.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.torrentId] }),
    // Drives the /me/favorites listing (newest first). Composite
    // PK already covers "is X favorited by user Y" lookups.
    index('torrent_favorites_user_created_idx').on(
      table.userId,
      table.createdAt,
    ),
  ],
);

export type TorrentFavorite = typeof torrentFavorites.$inferSelect;
export type NewTorrentFavorite = typeof torrentFavorites.$inferInsert;

// ============================================================================
// Anti-cheat — flagged announces
// ============================================================================
// Every time the Go tracker spots a statistical / signature anomaly on an
// announce (impossible upload velocity, claimed upload to an empty swarm,
// unknown peer_id prefix, `completed` event without a prior `started`, …)
// it records a row here. The moderation team triages from /mod/anti-cheat:
// nothing is ever auto-banned, the table is just the audit trail + queue.
// Stored as raw events (one per detection) so the same user with 200
// suspicious announces shows up 200 times — easier to spot patterns than
// a single counter would be.
export const anticheatFlags = pgTable(
  'anticheat_flags',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Torrent the flag fired on, when the row references one of ours.
    // Null when the flag is purely user-level (e.g. peer_id churn
    // across multiple infohashes), or when the announce hit an
    // unknown infohash that the tracker rejected upstream.
    torrentId: text('torrent_id').references(() => torrents.id, {
      onDelete: 'set null',
    }),
    // Raw infohash from the announce — kept even when the torrent
    // row goes away so audit trails survive deletion.
    infoHash: text('info_hash').notNull(),
    // Detection kind. Strings (not an enum) so the tracker can grow
    // new heuristics without a coordinated schema migration.
    //   'velocity'       — impossible upload bytes/sec
    //   'no_leecher'     — claimed upload to an empty swarm
    //   'unknown_client' — peer_id prefix not in the known whitelist
    //   'event_skip'     — `completed` / paid bytes without a prior `started`
    kind: text('kind').notNull(),
    severity: text('severity').notNull().default('medium'), // low | medium | high
    // Free-form context dropped by the detector (numbers used, swarm
    // counts, headers seen, …). Inspected from the mod UI.
    details: jsonb('details').notNull().default({}),
    // Peer_id (hex), client IP, User-Agent — captured because the
    // detector almost always wants them all available to triage.
    peerId: text('peer_id'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    // Review state — null until a moderator has looked. Verdict is
    // free text so the team can record whatever convention they want
    // ('clean' / 'warned' / 'banned' / 'monitoring' …); the page
    // only enforces the three primary actions but stores whichever
    // label was applied.
    reviewedAt: timestamp('reviewed_at'),
    reviewedById: text('reviewed_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    reviewVerdict: text('review_verdict'),
    reviewNote: text('review_note'),
  },
  (table) => [
    index('anticheat_flags_user_idx').on(table.userId, table.createdAt),
    index('anticheat_flags_unreviewed_idx').on(table.reviewedAt),
    index('anticheat_flags_kind_idx').on(table.kind),
    // `no_leecher` flags collapse to a single row per (user, torrent)
    // while the case is still open — the tracker upserts and adds
    // `deltaUp` into the existing row's `details` instead of
    // cluttering the moderation queue with one flag per announce.
    // Restricted to non-null torrent_id because two flags against
    // an unknown infohash should still produce distinct rows for
    // audit (we can't merge them — they may target different
    // torrents that just happen to be missing from our DB).
    uniqueIndex('anticheat_flags_no_leecher_open_unique')
      .on(table.userId, table.torrentId)
      .where(
        sql`kind = 'no_leecher' AND reviewed_at IS NULL AND torrent_id IS NOT NULL`
      ),
  ]
);

export type AnticheatFlag = typeof anticheatFlags.$inferSelect;
export type NewAnticheatFlag = typeof anticheatFlags.$inferInsert;

// ============================================================================
// Federation (inter-instance, opt-in, owner-controlled — Phase 0 socle)
// ============================================================================
//
// Two tables back the federation trust layer:
//
//   `federationConfig` — singleton. Holds this instance's verifiable
//      identity (an Ed25519 keypair generated on first enable; the
//      private key is encrypted at rest with the same AES-GCM helper as
//      notification-channel secrets) plus the owner's master switch and
//      the default sharing scopes proposed to new partners.
//
//   `federationPeers` — the allow-list. One row per partner instance the
//      owner has handshaked with. `status` drives the double opt-in
//      lifecycle; `sharesWithThem` / `acceptsFromThem` are the granular,
//      asymmetric scope grants. A peer's `publicKey` is the ONLY thing
//      that authenticates its signed S2S requests — revoking a peer
//      forgets the key and its requests stop verifying.
//
// Nothing here touches the Go tracker or the announce hot path.
// See doc/federation/PROPOSAL.md.

/** Granular federation scopes, asymmetric per peer.
 *  `swarm` is the risky one (re-opens private swarm isolation) — off by
 *  default everywhere; see PROPOSAL §7.4. */
export type FederationScopes = {
  catalog: boolean;
  social: boolean;
  accounts: boolean;
  swarm: boolean;
};

const EMPTY_SCOPES: FederationScopes = {
  catalog: false,
  social: false,
  accounts: false,
  swarm: false,
};

export const federationConfig = pgTable('federation_config', {
  id: text('id').primaryKey().default('singleton'), // always one row
  /** Owner master switch. When false the instance is unreachable for
   *  handshakes and the (future) catalogue sync does not run. */
  enabled: boolean('enabled').default(false).notNull(),
  /**
   * Carry other instances' records, and hand them on.
   *
   * Off by default: relaying means storing somebody else's catalogue and
   * serving it, which costs disk and puts this instance's name on records it
   * did not make. It is also what turns a mesh where everybody polls everybody
   * into a star — so it is a real choice, and an operator's to make.
   *
   * A relay is not trusted by anyone: every record carries its own proof, so a
   * relay can omit or delay, never forge or alter. That is why relaying can be
   * offered at all without asking partners to extend it any trust.
   */
  relayEnabled: boolean('relay_enabled').default(false).notNull(),
  /**
   * Serve a public, unauthenticated ActivityStreams view of what this instance
   * publishes: an actor document and an outbox anyone can read.
   *
   * Off by default, and the one switch here that changes who can see the
   * catalogue rather than who can talk to it. Everything else in federation is
   * a signed conversation between instances that agreed to know each other;
   * this is the door for somebody who has not. It carries metadata only — no
   * `.torrent` bytes, no passkey, no member behind a name — but a private
   * tracker's catalogue is itself the thing some operators keep private, so
   * the choice is theirs and it is made explicitly.
   */
  discoverable: boolean('discoverable').default(false).notNull(),
  /** Human-facing name advertised to partners during the handshake. */
  instanceName: text('instance_name'),
  /** This instance's public base URL (e.g. https://tracker.example.fr),
   *  baked into outbound handshakes so partners know where to call back. */
  publicUrl: text('public_url'),
  /** Verifiable identity, generated lazily on first enable.
   *   - instanceId: base64url fingerprint of the SPKI public key; the
   *     keyId partners use to look this instance up.
   *   - publicKey: SPKI PEM, shared in the clear.
   *   - privateKeyEnc: PKCS8 PEM, encrypted at rest via encryptJson(). */
  instanceId: text('instance_id'),
  publicKey: text('public_key'),
  privateKeyEnc: text('private_key_enc'),
  /** Default scopes proposed to NEW partners; each link is tuned
   *  individually afterwards on federationPeers. */
  defaultScopes: jsonb('default_scopes')
    .$type<FederationScopes>()
    .default(EMPTY_SCOPES)
    .notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type FederationConfig = typeof federationConfig.$inferSelect;

export const federationPeers = pgTable(
  'federation_peers',
  {
    id: text('id').primaryKey(), // UUID
    /** Partner public base URL. Natural unique key — one link per host. */
    baseUrl: text('base_url').notNull().unique(),
    /** Partner identity, learned during the handshake. Null only in the
     *  brief window between creating a pending_out row and the ACK. */
    instanceId: text('instance_id'),
    publicKey: text('public_key'),
    displayName: text('display_name'),
    /** Double opt-in lifecycle:
     *   pending_out — we sent a handshake, awaiting THEIR owner.
     *   pending_in  — they sent us a handshake, awaiting OUR owner.
     *   active      — both sides approved; signed S2S allowed.
     *   suspended   — temporarily paused by our owner (key kept).
     *   blocked     — hard-blocked; their requests rejected.
     *   revoked     — link torn down; cached remote data purged. */
    status: text('status').notNull().default('pending_out'),
    /** What WE send THEM. */
    sharesWithThem: jsonb('shares_with_them')
      .$type<FederationScopes>()
      .default(EMPTY_SCOPES)
      .notNull(),
    /** What we ACCEPT FROM them. */
    acceptsFromThem: jsonb('accepts_from_them')
      .$type<FederationScopes>()
      .default(EMPTY_SCOPES)
      .notNull(),
    lastHandshakeAt: timestamp('last_handshake_at'),
    lastSeenAt: timestamp('last_seen_at'),
    lastError: text('last_error'),
    /** The partner's advertised federation protocol version, learned at
     *  handshake/callback. Lets an operator tell "peer is on an old build" from
     *  "peer is down", and know when it is safe to require audience-bound
     *  signatures. Null for a link formed before versions were exchanged. */
    protocolVersion: integer('protocol_version'),
    /** Owner who created / approved the link. */
    createdBy: text('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('federation_peers_status_idx').on(table.status),
    // Identity is unique once known; partial so multiple pending_out
    // rows (instance_id still null) don't collide.
    uniqueIndex('federation_peers_instance_id_unique')
      .on(table.instanceId)
      .where(sql`instance_id IS NOT NULL`),
  ]
);

export type FederationPeer = typeof federationPeers.$inferSelect;
export type NewFederationPeer = typeof federationPeers.$inferInsert;

// ============================================================================
// Federation — Phase 1: federated catalogue (read-only local cache)
// ============================================================================
//
// `remoteTorrents` mirrors the metadata of partner-instance torrents we've
// pulled via the catalogue sync. It is NEVER merged into `torrents`: the
// local economy (ratio, HnR, moderation) stays sealed. Download links point
// back to the origin instance — we never serve a partner's `.torrent` with
// our own passkey (that's the swarm-merge question, deferred to Phase 4).
//
// `federationSyncState` is the per-peer × resource cursor the sync cron
// advances so each run only pulls what changed since last time.

export const remoteTorrents = pgTable(
  'remote_torrents',
  {
    id: text('id').primaryKey(), // local mirror UUID
    peerId: text('peer_id')
      .notNull()
      .references(() => federationPeers.id, { onDelete: 'cascade' }),
    /** Torrent UUID on the partner instance. */
    remoteId: text('remote_id').notNull(),
    infoHash: text('info_hash').notNull(),
    contentSignature: text('content_signature'),
    // v2 content addressing carried over from the partner's record (BEP 52).
    // `contentRootV2` is the cross-tracker key that lets a mirrored release match
    // a local one by content; null when the origin record predates v2.
    infoHashV2: text('info_hash_v2'),
    contentRootV2: text('content_root_v2'),
    name: text('name').notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    description: text('description'),
    /** Raw remote category slug (partner's namespace — NOT resolved to a local
     *  `categories` row). Displayed as-is; never used for a local FK. */
    categorySlug: text('category_slug'),
    categoryType: text('category_type'), // movie | tv | game | book | null
    /** Adult flag mirrored from the origin's category. Lets the consumer apply
     *  its own `showAdultContent` gate to federated rows (the origin's
     *  `categories.isAdult` has no local equivalent here). */
    isAdult: boolean('is_adult').default(false).notNull(),
    tags: jsonb('tags').$type<string[]>(),
    imdbId: text('imdb_id'),
    tmdbId: text('tmdb_id'),
    tvdbId: text('tvdb_id'),
    igdbId: text('igdb_id'),
    openlibraryId: text('openlibrary_id'),
    /**
     * Series position, mirrored from the partner. Sent by instances from
     * 0.28.0 on; older partners omit the fields entirely, in which case the
     * sync re-parses them out of the name so a mirrored season still knows
     * which season it is. Null for anything that is not television, and for a
     * name nothing could read.
     */
    season: smallint('season'),
    episode: smallint('episode'),
    /** Swarm stats from the partner — best-effort, short-lived. */
    seeders: integer('seeders').default(0).notNull(),
    leechers: integer('leechers').default(0).notNull(),
    completed: integer('completed').default(0).notNull(),
    /**
     * The signed record this row was ingested from — its content address.
     *
     * Present for anything that arrived through `/api/federation/records`.
     * It is what makes an ingestion idempotent across relays: the same
     * statement offered twice is the same id, whoever handed it over. Null on
     * rows that predate signed records.
     */
    recordId: text('record_id'),
    /** `did:key:…` of whoever SIGNED it, which need not be who relayed it. */
    issuer: text('issuer'),
    /**
     * `did:key:…` of whoever UPLOADED it, which need not be who signed it.
     *
     * The two differ, and the difference is the point of having both: the
     * issuer is the instance vouching for the record, the author is the person
     * the instance says wrote it. Keeping the author as a DID rather than as a
     * display name is what lets "everything this person published" mean
     * something across partners — and keep meaning it once the instance that
     * knows their account is out of the picture.
     *
     * As trustworthy as the issuer, and no more: the author's key is held by
     * their own instance, so this is that instance's word. Null on a record
     * minted before uploaders had DIDs.
     */
    authorDid: text('author_did'),
    /**
     * Whether the proof was checked and held.
     *
     * A column rather than an assumption: it is the difference between "a peer
     * we trust told us this" and "this is signed by someone and we checked".
     * Only the second survives being relayed.
     */
    verified: boolean('verified').default(false).notNull(),
    /** Remote display name only — never a local user id. */
    uploaderName: text('uploader_name'),
    remoteCreatedAt: timestamp('remote_created_at'),
    remoteDetailUrl: text('remote_detail_url'),
    remoteDownloadUrl: text('remote_download_url'),
    fetchedAt: timestamp('fetched_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('remote_torrents_peer_remote_unique').on(
      table.peerId,
      table.remoteId
    ),
    index('remote_torrents_info_hash_idx').on(table.infoHash),
    // Match a mirrored release to a local one by cross-tracker content key.
    index('remote_torrents_content_root_v2_idx').on(table.contentRootV2),
    index('remote_torrents_content_sig_idx').on(table.contentSignature),
    index('remote_torrents_imdb_idx').on(table.imdbId),
    index('remote_torrents_tmdb_idx').on(table.tmdbId),
    // The grouped catalogue matches a local group against the mirror one id
    // namespace at a time — `tmdb_id = ANY(...) OR igdb_id = ANY(...) OR …` —
    // so each namespace needs its own index or the badge query degrades into a
    // scan of every partner's catalogue on every page.
    index('remote_torrents_igdb_idx').on(table.igdbId),
    index('remote_torrents_openlibrary_idx').on(table.openlibraryId),
    index('remote_torrents_record_idx').on(table.recordId),
    /** Everything one remote uploader published, across partners. */
    index('remote_torrents_author_idx').on(table.authorDid),
    index('remote_torrents_name_idx').on(table.name),
  ]
);

export type RemoteTorrent = typeof remoteTorrents.$inferSelect;
export type NewRemoteTorrent = typeof remoteTorrents.$inferInsert;

export const federationSyncState = pgTable(
  'federation_sync_state',
  {
    peerId: text('peer_id')
      .notNull()
      .references(() => federationPeers.id, { onDelete: 'cascade' }),
    /** Resource being synced — `catalog` today; `social` etc. later. */
    resource: text('resource').notNull(),
    /** Opaque cursor returned by the peer (ISO timestamp for catalogue). */
    cursor: text('cursor'),
    lastRunAt: timestamp('last_run_at'),
    lastStatus: text('last_status'), // ok | error | partial
    itemsSynced: integer('items_synced').default(0).notNull(),
    lastError: text('last_error'),
  },
  (table) => [primaryKey({ columns: [table.peerId, table.resource] })]
);

export type FederationSyncState = typeof federationSyncState.$inferSelect;

// ============================================================================
// Federation — catalogue removals (tombstones)

// ============================================================================
// Federation — Phase 2a: federated follows (social)
// ============================================================================
//
// A local user can follow an uploader on a partner instance. This is a
// LOCAL subscription (no S2S Follow protocol): the catalogue sync already
// pulls partner torrents with their `uploaderName`, so when a NEW remote
// torrent from a followed uploader lands, we notify the local followers.
// Latency = the sync interval; nothing is pushed cross-instance.

export const federatedFollows = pgTable(
  'federated_follows',
  {
    id: text('id').primaryKey(),
    localUserId: text('local_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    peerId: text('peer_id')
      .notNull()
      .references(() => federationPeers.id, { onDelete: 'cascade' }),
    /** Remote uploader's display name on the partner instance. */
    remoteUsername: text('remote_username').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('federated_follows_unique').on(
      table.localUserId,
      table.peerId,
      table.remoteUsername,
    ),
    // Hot path: "who follows (peer, uploaderName)?" during sync fan-out.
    index('federated_follows_target_idx').on(
      table.peerId,
      table.remoteUsername,
    ),
  ],
);

export type FederatedFollow = typeof federatedFollows.$inferSelect;

// ============================================================================
// Federation — Phase 3: linked identities + remote reputation
// ============================================================================
//
// A local user proves they also own an account on a partner instance by
// placing a one-time code in their remote profile bio; we verify it over
// signed S2S. Once `verified`, the partner's reputation (ratio, age, uploads)
// can be shown read-only next to the link — never merged into local economy.

/**
 * An Ed25519 key per uploader, held by this instance.
 *
 * What it is for: attribution that survives the instance. A record says who
 * uploaded it, and until now it said so with a display name — which means
 * nothing once the record has been relayed twice and the instance that minted
 * it is gone. A `did:key` is a name nobody else can mint and that stays the
 * same wherever the record travels.
 *
 * What it is NOT, and this matters: proof. The private key is held here, so
 * anything signed with it says exactly as much as this instance already
 * asserts — a signature made with a key the server holds proves only what the
 * server was already claiming. The DID is a stable NAME at this stage. It
 * becomes a proof when the member holds the key themselves, which is a later
 * step and a different threat model.
 *
 * That is also why the key is exportable but never re-imported: a key this
 * server has seen cannot become a member's private property afterwards.
 */
export const userSigningKeys = pgTable(
  'user_signing_keys',
  {
    /**
     * The key IS the identifier, so it is the primary key. A member has one
     * current key and as many retired ones as they have rotated — a retired
     * key has to stay on file, because "this identifier is no longer that
     * person" is a statement we have to keep making.
     */
    did: text('did').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    publicKey: text('public_key').notNull(),
    /**
     * Encrypted at rest with the instance credential key — or NULL, when the
     * member holds the key themselves.
     *
     * That null is the whole of custody. A key this server never generated and
     * cannot sign with is one the server cannot use to speak as the member,
     * and the difference between "we would not" and "we could not" is the only
     * one that survives the server being compromised.
     */
    privateKeyEnc: text('private_key_enc'),
    /**
     * Set when the member rotated away from it.
     *
     * A rotation is not housekeeping: it says the old key can no longer speak
     * for them, which is the only recourse a member has if their exported file
     * gets out. Every link anybody proved with it has to fall.
     */
    revokedAt: timestamp('revoked_at'),
    /** The key that took over, so a member's history survives the rotation. */
    succeededBy: text('succeeded_by'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    /**
     * One current key per member. A partial unique index rather than a plain
     * one: retired keys pile up and must not compete for the slot, while two
     * live keys for one member would make "who is this?" ambiguous in a way
     * nothing downstream could resolve.
     */
    uniqueIndex('user_signing_keys_current')
      .on(table.userId)
      .where(sql`revoked_at IS NULL`),
    index('user_signing_keys_user_idx').on(table.userId),
  ],
);

export type UserSigningKey = typeof userSigningKeys.$inferSelect;

export const federatedIdentities = pgTable(
  'federated_identities',
  {
    id: text('id').primaryKey(),
    localUserId: text('local_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    peerId: text('peer_id')
      .notNull()
      .references(() => federationPeers.id, { onDelete: 'cascade' }),
    /** Claimed username on the partner instance. */
    remoteUsername: text('remote_username').notNull(),
    /** pending — awaiting verification; verified — proven. */
    status: text('status').notNull().default('pending'),
    /**
     * How the link was proven.
     *
     * `key` — the member presented an identity document signed by their own
     * key and endorsed by the partner. Proven here, offline, with no help
     * from the partner and no assumption that it is still running.
     *
     * `bio` — the older path: we asked the partner whether a one-time code
     * was in the member's remote profile. It works against a partner that
     * does not issue member keys yet, and only for as long as that partner is
     * reachable. Kept as a fallback rather than deleted, because "the origin
     * is gone" is exactly the case the key path exists for and exactly the
     * case the bio path cannot serve.
     */
    method: text('method').notNull().default('bio'),
    /** `did:key:…` the claim was proven against. Null on a bio-proven link. */
    subjectDid: text('subject_did'),
    /**
     * The document that proved it, verbatim.
     *
     * Kept rather than discarded once checked, because it is what makes the
     * link re-checkable by somebody else: publishing "our member is also X"
     * without the evidence asks every reader to take our word for it.
     */
    evidence: jsonb('evidence').$type<Record<string, unknown>>(),
    /** One-time code the user must place in their remote bio. Cleared
     *  once verified. */
    verifyCode: text('verify_code'),
    verifiedAt: timestamp('verified_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('federated_identities_unique').on(
      table.localUserId,
      table.peerId,
      table.remoteUsername,
    ),
  ],
);

export type FederatedIdentity = typeof federatedIdentities.$inferSelect;

/**
 * "Our member is also this person elsewhere", as asserted by a partner.
 *
 * One row per (issuer, subject, alias). An instance publishes these for its
 * own members once they have proven a past account, and every partner mirrors
 * them — which is what lets one person's work be gathered across instances
 * without any instance being the authority on who they are.
 *
 * The evidence travels with the assertion and is kept: a partner's word that
 * two identifiers are one person is worth exactly as much as the document it
 * saw, and keeping the document means anybody downstream can check rather than
 * take our word for taking theirs.
 */
export const remoteIdentityLinks = pgTable(
  'remote_identity_links',
  {
    id: text('id').primaryKey(),
    peerId: text('peer_id')
      .notNull()
      .references(() => federationPeers.id, { onDelete: 'cascade' }),
    /** `did:key:…` of the instance that asserted the link. */
    issuer: text('issuer').notNull(),
    /** The member on the asserting instance. */
    subjectDid: text('subject_did').notNull(),
    /** Who they also are, somewhere else. */
    aliasDid: text('alias_did').notNull(),
    /** The identity document that proved it, verbatim. */
    evidence: jsonb('evidence').$type<Record<string, unknown>>(),
    /** Content address of the record that carried this assertion. */
    recordId: text('record_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('remote_identity_links_unique').on(
      table.peerId,
      table.subjectDid,
      table.aliasDid,
    ),
    index('remote_identity_links_subject_idx').on(table.subjectDid),
    index('remote_identity_links_alias_idx').on(table.aliasDid),
  ],
);

export type RemoteIdentityLink = typeof remoteIdentityLinks.$inferSelect;

/**
 * Which partner serves which record.
 *
 * This is the set reconciliation actually compares, and getting that wrong is
 * the most expensive mistake this subsystem has made. It used to compare the
 * MIRROR — `remote_torrents` — against what a partner served. The mirror only
 * holds torrents, so every tombstone, identity assertion and revocation was
 * permanently "missing": fetched again on every tick, ingested to no effect,
 * still missing. Silently, because nothing about it moved a counter.
 *
 * A record is content-addressed, so what a partner offers is a set of ids and
 * nothing more. This table is the same kind of thing on our side, which is why
 * the two can be compared at all.
 *
 * It also answers the question relaying needs — where can this record be got —
 * and it is what says a record is still wanted: when the last partner stops
 * serving one, nothing sources it any more.
 */
export const recordSources = pgTable(
  'record_sources',
  {
    /** Content address. Deliberately not a foreign key: see `catalogRecords`. */
    recordId: text('record_id').notNull(),
    peerId: text('peer_id')
      .notNull()
      .references(() => federationPeers.id, { onDelete: 'cascade' }),
    /**
     * `torrent` | `tombstone` | `identity` | `revocation`.
     *
     * Kept here so a lost mirror row can be found again. The mirror is a view
     * of torrents derived from records; if one goes missing — a bug, a manual
     * delete, a half-applied write — nothing else would notice, because the
     * set we reconcile is this table and it would still say we hold the
     * record. Knowing which sources OUGHT to have a mirror row is what lets
     * that be checked, and the repair is to forget the source so the next
     * reconciliation fetches it again.
     */
    kind: text('kind').notNull().default('torrent'),
    firstSeenAt: timestamp('first_seen_at').defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.peerId, table.recordId] }),
    /** Everyone who serves one record — the question a relay asks. */
    index('record_sources_record_idx').on(table.recordId),
  ],
);

export type RecordSource = typeof recordSources.$inferSelect;

/**
 * Locally-hidden federated content.
 *
 * The moderation gap the review found: the only lever over a partner's
 * catalogue was suspend/block/delete the WHOLE peer, which throws away
 * everything good it carries to hide one bad release. This is the surface
 * below that — a mask hides a mirrored release from every local read path
 * without touching the peer or the record itself.
 *
 * A mask matches by ONE of three keys, chosen by `scope`:
 *   - `record`   — one specific record (its content address). The sharpest.
 *   - `infohash` — a release by its v1 infohash, whoever serves it. Catches
 *                  the same bad content mirrored from several partners.
 *   - `author`   — every release attributed to one uploader DID (a mute).
 *
 * It is local and reversible: nothing is deleted, nothing is signalled to the
 * partner (that is a separate, optional step), and lifting the mask makes the
 * content reappear on the next read. It is the tracker's own editorial line
 * over what it re-exposes, which the design has always said stays sovereign.
 */
export const remoteMasks = pgTable(
  'remote_masks',
  {
    id: text('id').primaryKey(),
    /** `record` | `infohash` | `author` — which column of the mirror to match. */
    scope: text('scope').notNull(),
    /** The value to match: a record id, an infohash, or an author DID. */
    value: text('value').notNull(),
    /** Free-text note for the mod log. */
    reason: text('reason'),
    createdBy: text('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    // One mask per (scope, value) — re-masking the same thing is a no-op.
    uniqueIndex('remote_masks_scope_value_idx').on(table.scope, table.value),
    // The read-path predicate looks masks up by value, so index it.
    index('remote_masks_value_idx').on(table.value),
  ],
);

export type RemoteMask = typeof remoteMasks.$inferSelect;

/**
 * Taxonomy bridge: a partner's category slug → one of our local categories.
 *
 * A mirrored release carries the slug its origin filed it under (`category_slug`
 * on {@link remoteTorrents}), drawn from that instance's own vocabulary. When
 * both sides share the conventional slug the browse filter already matches by
 * equality; when a partner names the same shelf differently ("films" vs
 * "movies", "series-vf" vs "tv"), the release silently falls out of every local
 * category. This table lets an operator declare the equivalence once, after
 * which the grouped browse filter treats the foreign slug as if it were ours and
 * the read paths can show a real category name instead of the raw foreign token.
 *
 * Global by design — a slug maps the same way whoever sent it. Two partners that
 * genuinely mean different things by one slug are rare; the honest recourse there
 * is a per-author mask, not a per-peer taxonomy fork. `remote_slug` is therefore
 * the natural key.
 */
export const remoteCategoryMap = pgTable(
  'remote_category_map',
  {
    id: text('id').primaryKey(),
    /** The partner's category slug, exactly as it arrives on the mirror. */
    remoteSlug: text('remote_slug').notNull(),
    /** The local category it resolves to. */
    localCategoryId: text('local_category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    createdBy: text('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    // One mapping per foreign slug — re-declaring it updates in place.
    uniqueIndex('remote_category_map_slug_idx').on(table.remoteSlug),
    // The reverse lookup ("which foreign slugs land in this category") drives
    // both the filter expansion and the admin screen.
    index('remote_category_map_category_idx').on(table.localCategoryId),
  ],
);

export type RemoteCategoryMap = typeof remoteCategoryMap.$inferSelect;

/**
 * Inter-instance credit ledger — the record of contribution attestations we have
 * honoured (the foundation the webseed relay, M4, is built on).
 *
 * A partner that a member served bytes to can sign an attestation — "your member
 * DID X contributed N bytes" — and send it over the accounts channel. We verify
 * it is signed by that partner, resolve the DID to a local member, and credit
 * their bonus upload, capped per day and applied at most once. Every honoured
 * attestation lands here so the credit is idempotent (the row id IS the
 * attestation's content address) and auditable.
 *
 * Off by default: an operator chooses whether to trust a partner's word about
 * what its users pulled — see `federation_credit_enabled`.
 */
export const federationCreditGrants = pgTable(
  'federation_credit_grants',
  {
    /** The attestation's content-address id — dedup key, so each credits once. */
    id: text('id').primaryKey(),
    peerId: text('peer_id').references(() => federationPeers.id, {
      onDelete: 'set null',
    }),
    /** The `did:key:…` the attestation credited. */
    subjectDid: text('subject_did').notNull(),
    /** The local member it resolved to, credited. */
    localUserId: text('local_user_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
    /** Bytes actually credited (after the daily cap clamp). */
    bytes: bigint('bytes', { mode: 'number' }).notNull(),
    reason: text('reason'),
    /**
     * The settlement window the attestation claimed, recorded so the NEXT one
     * can be required to start where this ended.
     *
     * Without it the ledger deduplicated on content address alone, which an
     * honest replay satisfies and a dishonest one walks straight past: move
     * `periodEnd` by a millisecond and the same real transfer addresses to a
     * new id, so it is a new row and a second credit. Bounding the period
     * makes the ledger monotone per (peer, subject) — the same property the
     * announce path gets from only ever crediting the difference between two
     * announces, rather than trusting a standalone cumulative total.
     *
     * Nullable because rows written before 0043 have no period to record.
     */
    periodStart: timestamp('period_start'),
    periodEnd: timestamp('period_end'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    // Sum a member's credits over a window for the daily cap.
    index('federation_credit_grants_user_idx').on(
      table.localUserId,
      table.createdAt,
    ),
    // The high-water mark for one (peer, subject) settlement stream, and — on
    // its leading column — the per-peer daily sum.
    index('federation_credit_grants_period_idx').on(
      table.peerId,
      table.subjectDid,
      table.periodEnd,
    ),
    // Instance-wide daily minting, across every peer and member.
    index('federation_credit_grants_created_idx').on(table.createdAt),
  ],
);

export type FederationCreditGrant = typeof federationCreditGrants.$inferSelect;

/**
 * Identifiers a partner has withdrawn.
 *
 * The recourse a member has when their exported identity file gets out. Their
 * instance retires the key and publishes it; every instance that hears drops
 * whatever was proven with it and refuses to accept it again.
 *
 * Kept as its own table rather than as a flag on the link, because a
 * revocation can arrive BEFORE anybody tries to use the key — and that is the
 * case worth being ready for: a leaked file is used by whoever finds it,
 * whenever they find it.
 */
export const revokedIdentities = pgTable(
  'revoked_identities',
  {
    id: text('id').primaryKey(),
    /**
     * The retired identifier, and WHO retired it.
     *
     * Keyed on the pair, never on the identifier alone. A withdrawal is only
     * worth anything from the instance that issued the identifier in the first
     * place — otherwise any partner could unpick any link in the federation by
     * announcing withdrawals for keys it never issued. Since a claim is only
     * ever accepted on a known partner's endorsement, checking that THAT
     * partner withdrew it is both sufficient and exact.
     */
    did: text('did').notNull(),
    /** `did:key:…` of the instance that withdrew it. */
    issuer: text('issuer').notNull(),
    /** The key that took over, when the member rotated rather than left. */
    succeededBy: text('succeeded_by'),
    /** Content address of the record that carried it. */
    recordId: text('record_id'),
    revokedAt: timestamp('revoked_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('revoked_identities_unique').on(table.issuer, table.did),
    index('revoked_identities_did_idx').on(table.did),
  ],
);

export type RevokedIdentity = typeof revokedIdentities.$inferSelect;
// ============================================================================
// Presentation templates (the BBCode listing produced by /torrents/fiche)
// ============================================================================
//
// The fiche wizard renders its listing from a template. The built-in
// default is a CODE constant in the web app, deliberately not a row here:
// seeding it would make the one template everybody depends on deletable,
// and every instance would silently fork away from later improvements to
// it. This table therefore only ever holds templates a human wrote.
//
// Two ownership flavours share the table, discriminated by `visibility`:
//   private   — the owner alone can see it (the common case)
//   published — staff-published; readable by everyone, copyable by
//               anyone, still owned and edited by the staffer
// There is no moderation queue because only staff may set `published`,
// so a published row is vetted by construction.

export const presentationTemplates = pgTable(
  'presentation_templates',
  {
    id: text('id').primaryKey(), // UUID
    // NULL for a site template, which belongs to the site rather than to a
    // person: an admin adds it, and it has to outlive whoever that was.
    // Members' own templates keep an owner and still cascade away with the
    // account, so a deleted user leaves no orphan drafts behind.
    ownerId: text('owner_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
    // Attribution only, and only meaningful on a site template — "who put
    // this in front of the whole site". SET NULL rather than cascade: losing
    // the name of the admin who added it must not take the template with it.
    // This is the closest thing the app has to an audit trail; there is no
    // staff action log anywhere in the schema.
    createdBy: text('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    description: text('description'),
    // universal | video — what the template's variables assume about the
    // work being described. Text + this comment rather than a pgEnum (the
    // file has none) so adding music/ebook/game later is a zod edit, not
    // a migration.
    category: text('category').default('universal').notNull(),
    /** Raw BBCode template source, stored verbatim. A template is
     *  whitespace-sensitive — leading spaces, blank lines and a missing
     *  final newline all change the rendered listing — so nothing here is
     *  trimmed or normalised. The 15 000-character cap lives in zod: the
     *  schema has no varchar and no CHECK constraint anywhere. */
    content: text('content').notNull(),
    // private | site
    //
    // `private` is a member's own template. `site` is one an admin added for
    // everybody, alongside the built-in default — the word is deliberately
    // not "published": nobody publishes anything here any more, members
    // cannot make a template site-wide at all, and only the admin screen
    // writes this value.
    visibility: text('visibility').default('private').notNull(),
    // The owner's own pick, pre-selected by the wizard. Not a site-wide
    // default — that one is the code constant and cannot be overridden.
    isDefault: boolean('is_default').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    // "my templates, newest first" — the only listing an owner ever sees.
    index('presentation_templates_owner_idx').on(
      table.ownerId,
      table.createdAt,
    ),
    // Partial, because the site catalogue is a handful of rows inside a
    // table that is otherwise all private drafts: a plain index on
    // `visibility` would be mostly dead weight and would still have to
    // filter. Category leads the key since the picker scopes by it.
    index('presentation_templates_site_idx')
      .on(table.category, table.createdAt)
      .where(sql`${table.visibility} = 'site'`),
    // One default per owner, enforced structurally. The endpoint that
    // moves the flag clears the previous holder in the same transaction;
    // this index makes a codepath that forgets impossible rather than
    // merely unlikely (same reasoning as
    // upload_request_fill_attempts_active_unique).
    uniqueIndex('presentation_templates_default_unique')
      .on(table.ownerId)
      .where(sql`${table.isDefault}`),
    // The two shapes a row is allowed to have, so no codepath can invent a
    // third. A member's template has an owner; a site template has none and
    // is nobody's personal default — which also keeps the partial unique
    // index above meaningful, since NULL owners would otherwise let any
    // number of site rows claim `is_default`.
    check(
      'presentation_templates_scope_ck',
      sql`(${table.visibility} = 'private' AND ${table.ownerId} IS NOT NULL)
          OR (${table.visibility} = 'site' AND ${table.ownerId} IS NULL AND ${table.isDefault} = false)`,
    ),
  ],
);

export type PresentationTemplate = typeof presentationTemplates.$inferSelect;
export type NewPresentationTemplate =
  typeof presentationTemplates.$inferInsert;

// ============================================================================
// Themes (admin-defined appearance)
// ============================================================================
//
// `light` and `dark` are NOT rows. They are code constants in
// `apps/web/app/assets/css/main.css`, mirrored in `packages/shared/src/theme.ts`
// with a test that keeps the two in step — the same shape as
// `presentationTemplates`, whose site default is "the code constant and cannot
// be overridden". So nothing here can edit or delete them, and an instance
// always has a working appearance to fall back to. This table holds only what
// an admin created.
//
// What a row carries is VALUES, never names. The token schema is versioned with
// the code because Tailwind freezes utility names at build time and compiles
// them to `var(--token)`; a row cannot invent a utility. The practical upside is
// that adding a token category later needs no migration.
export const themes = pgTable(
  'themes',
  {
    id: text('id').primaryKey(), // UUID
    /**
     * What `data-theme` is set to, and what `users.theme` stores.
     *
     * `[a-z0-9-]+`, derived from the name and validated at the route. It reaches
     * a CSS selector, so it is the one field here whose shape is load-bearing:
     * anything else would let a theme name close the attribute selector.
     * `light`, `dark` and `system` are refused as slugs — they already mean
     * something.
     */
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    description: text('description'),
    /** `light` | `dark` — the built-in whose tokens this one starts from. */
    base: text('base').notNull().default('dark'),
    /**
     * Only what DIVERGES from the base.
     *
     * Storing the resolved set instead would fork the theme from the base
     * permanently: a later correction to a built-in token would never reach it.
     * That is the WordPress style-variation failure — the variation is copied
     * into the row and "the user will not receive those changes if they have
     * already saved". A key absent here is an inheritance, not a value.
     */
    tokens: jsonb('tokens').$type<Record<string, string>>().notNull().default({}),
    /**
     * Raw CSS, owner-only, null by default.
     *
     * Reserved for wave 3 and deliberately present from the first migration:
     * the column costs nothing empty, and adding it later would mean a second
     * migration for a feature already decided. The gate is not the column, it is
     * `requireOwnerSession` plus a value-level deny-list — see THEMES-PLAN §6.
     */
    customCss: text('custom_css'),
    /**
     * Whether members may choose it. Also whether it is emitted at all.
     *
     * A disabled theme is not served, so its tokens do not sit in every
     * visitor's stylesheet — which is the only reason the "all themes in one
     * cacheable sheet" decision stays affordable.
     */
    enabled: boolean('enabled').default(true).notNull(),
    position: integer('position').default(0).notNull(),
    /**
     * `site` — anyone may pick it. `roles` — only holders of `requiredRoles`.
     *
     * **Not an access control**, and the admin console says so in as many
     * words. Every enabled theme is in the one stylesheet every visitor gets,
     * so somebody can set `data-theme` by hand in devtools and see it for the
     * duration of their session. What IS enforced is persistence: `PATCH
     * /api/me` refuses to store a theme the member is not entitled to, so
     * nobody keeps it and nobody else ever sees it.
     *
     * Filtering the stylesheet per role would make it vary by viewer, and cache
     * a variant per combination of roles. For decoration that is the wrong
     * trade.
     */
    visibility: text('visibility').notNull().default('site'),
    requiredRoles: jsonb('required_roles').$type<string[]>(),
    createdBy: text('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    // The emitter's read: enabled themes, in display order.
    index('themes_enabled_idx').on(table.enabled, table.position),
    // The two shapes a row may have, so no codepath can invent a third — a
    // role-gated theme with no roles would be invisible to everyone including
    // its author, which reads as a bug rather than as a setting.
    check(
      'themes_visibility_ck',
      sql`(${table.visibility} = 'site' AND ${table.requiredRoles} IS NULL)
          OR (${table.visibility} = 'roles' AND jsonb_array_length(${table.requiredRoles}) > 0)`,
    ),
    check('themes_base_ck', sql`${table.base} IN ('light', 'dark')`),
  ],
);

export type Theme = typeof themes.$inferSelect;
export type NewTheme = typeof themes.$inferInsert;

// =============================================================================
// Uploaded fonts (owner-supplied faces a theme may select)
// =============================================================================

/**
 * A woff2 the owner uploaded, so a theme can use a face the build never shipped.
 *
 * The curated list in `packages/shared/src/theme.ts` exists because a font has
 * to BE there — the faces are downloaded when the image is built. This is the
 * escape hatch from that constraint, and it is owner-only for the same reason
 * raw CSS is: it adds bytes every visitor downloads and a face nobody has
 * reviewed.
 *
 * Addressed by content. `sha256` is unique, so uploading the same file twice
 * returns the existing row rather than storing it again, and the served URL can
 * be cached immutably — the bytes behind an id can never change.
 *
 * `role` matters as much as the file: a theme picks a family per role, and a
 * proportional face offered for the mono role is a broken table rather than a
 * restyled one. The role is chosen at upload and the token validation checks it.
 *
 * Deliberately NOT referenced by `themes.tokens`. A token holds `upload:<id>` as
 * a string, and there is no foreign key — the same reason `users.theme` has
 * none: a theme's preference has to survive the thing it points at going away,
 * and the delete route is what notices rather than the database.
 */
export const uploadedFonts = pgTable(
  'uploaded_fonts',
  {
    id: text('id').primaryKey(),
    /** What an admin sees in the picker. Not what CSS uses — see `fonts.ts`. */
    family: text('family').notNull(),
    role: text('role').notNull(),
    storageKey: text('storage_key').notNull(),
    bytes: integer('bytes').notNull(),
    /** Hex. Unique, so the same file uploaded twice is one object. */
    sha256: text('sha256').notNull().unique(),
    uploadedBy: text('uploaded_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    // The picker's read: everything for one role.
    index('uploaded_fonts_role_idx').on(table.role),
    check('uploaded_fonts_role_ck', sql`${table.role} IN ('sans', 'mono', 'display')`),
  ],
);

export type UploadedFont = typeof uploadedFonts.$inferSelect;
export type NewUploadedFont = typeof uploadedFonts.$inferInsert;

// ─────────────────────────────────────────────────────────────────────
// Messaging
//
// Two surfaces over one shape: private conversations between two members,
// and the public room. What separates them is their growth regime, not
// their form — which is why the rows live in two tables while the
// conversation they hang off is one.
//
// `messages` grows slowly and is never purged: members believe they keep
// what they wrote. `room_messages` grows at the rate people talk, is
// partitioned by day and purged by dropping partitions, because a DELETE
// over millions of rows holds a lock, inflates the WAL and leaves work to
// autovacuum.
//
// Authorship follows the rule the forum tables already set: `authorId` is
// nullable with `set null`, so deleting an account never fails on a
// foreign key and the content survives without attribution. For messaging
// that is also the erasure story — a frozen username would be personal
// data retained after a deletion request, so the UI renders a null author
// as "deleted member" rather than a remembered name.
// ─────────────────────────────────────────────────────────────────────

export const conversations = pgTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    /**
     * The room's pinned announcement, if any.
     *
     * On the conversation rather than a flag on the message: "the pinned
     * one" is a property of the room, and a boolean per message would
     * allow two of them — which is the state every pin feature ends up
     * having to clean up. No foreign key, because the room's messages are
     * in a partitioned table whose key is composite; a pin whose day has
     * been dropped resolves to nothing, which is correct.
     */
    pinnedMessageId: text('pinned_message_id'),
    pinnedAt: timestamp('pinned_at'),
    pinnedById: text('pinned_by_id'),
    /** 'dm' — exactly two participants. 'room' — the public shoutbox. */
    kind: text('kind').notNull(),
    /** Rooms only, and unique: the URL segment. Null for a DM. */
    slug: text('slug'),
    title: text('title'),
    /**
     * Set once, at creation, and never after. A conversation half of which
     * is encrypted is unreadable to render, to export, to report on, and
     * to explain — so the flag is immutable by design rather than by
     * convention.
     */
    encrypted: boolean('encrypted').default(false).notNull(),
    createdById: text('created_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    /**
     * Denormalised. The conversation list is the most-hit view in the
     * feature; recomputing it as an aggregate over `messages` on every
     * render is the first bottleneck a messaging system meets.
     */
    lastMessageAt: timestamp('last_message_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('conversations_slug_idx').on(table.slug),
    index('conversations_last_message_idx').on(table.lastMessageAt),
    check('conversations_kind_ck', sql`${table.kind} IN ('dm', 'room')`),
    // A room has a slug and a DM does not — one rule, both directions.
    check(
      'conversations_room_slug_ck',
      sql`(${table.kind} = 'room') = (${table.slug} IS NOT NULL)`
    ),
    // A room cannot be encrypted: the key is derived per pair of members,
    // so there is nobody to derive it with.
    check(
      'conversations_room_plain_ck',
      sql`NOT (${table.kind} = 'room' AND ${table.encrypted})`
    ),
  ]
);

export const conversationParticipants = pgTable(
  'conversation_participants',
  {
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at').defaultNow().notNull(),
    lastReadAt: timestamp('last_read_at'),
    /**
     * Denormalised too, and for the same reason as `lastMessageAt`:
     * `COUNT(*) WHERE createdAt > lastReadAt` per conversation per render
     * is the second bottleneck. Incremented on publish, zeroed on read.
     */
    unreadCount: integer('unread_count').default(0).notNull(),
    mutedUntil: timestamp('muted_until'),
    archivedAt: timestamp('archived_at'),
    /**
     * 'pending' is the first-contact queue: a message from someone you
     * have never exchanged with lands there rather than in the inbox.
     * Without it, at this membership size a known uploader's inbox is
     * unusable within weeks.
     */
    state: text('state').default('active').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.userId] }),
    index('conversation_participants_inbox_idx').on(
      table.userId,
      table.state,
      table.archivedAt
    ),
    check(
      'conversation_participants_state_ck',
      sql`${table.state} IN ('active', 'pending', 'blocked')`
    ),
    check(
      'conversation_participants_unread_ck',
      sql`${table.unreadCount} >= 0`
    ),
  ]
);

export const messages = pgTable(
  'messages',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    authorId: text('author_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /**
     * The message this one answers, in the same conversation.
     *
     * `set null` rather than cascade: deleting a quoted message must not
     * take the replies with it — the thread would lose answers nobody
     * asked to remove. The reply survives and simply stops quoting.
     */
    replyToId: text('reply_to_id').references((): AnyPgColumn => messages.id, {
      onDelete: 'set null',
    }),
    /** Plaintext. Null when the conversation is encrypted. */
    body: text('body'),
    /** AES-GCM payload. Null when it is not. */
    cipher: bytea('cipher'),
    iv: bytea('iv'),
    isSystem: boolean('is_system').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    editedAt: timestamp('edited_at'),
    deletedAt: timestamp('deleted_at'),
    /** Who removed it. A deletion without an author is indefensible. */
    deletedById: text('deleted_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    index('messages_conversation_idx').on(
      table.conversationId,
      table.createdAt
    ),
    // Exactly one payload, enforced rather than assumed: a plaintext row
    // in an encrypted conversation is the kind of bug that never shows.
    // A deleted row is allowed to carry neither.
    check(
      'messages_payload_ck',
      sql`${table.deletedAt} IS NOT NULL OR ((${table.body} IS NOT NULL) <> (${table.cipher} IS NOT NULL))`
    ),
    check(
      'messages_cipher_iv_ck',
      sql`(${table.cipher} IS NULL) = (${table.iv} IS NULL)`
    ),
  ]
);

/**
 * The room's messages, partitioned by day.
 *
 * Drizzle has no notion of declarative partitioning, so the generated
 * migration is hand-extended with `PARTITION BY RANGE (created_at)` and
 * the initial partitions. Two consequences show up here:
 *
 *   - the primary key has to contain the partition key, hence `(id,
 *     created_at)` rather than `id` alone;
 *   - nothing writes to this table until the room ships, and the
 *     migration pre-creates a window of partitions so the gap is covered
 *     without a maintenance job existing yet.
 *
 * It carries no `encrypted` payload columns: a room is never encrypted.
 */
export const roomMessages = pgTable(
  'room_messages',
  {
    id: text('id').notNull(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    authorId: text('author_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    body: text('body').notNull(),
    isSystem: boolean('is_system').default(false).notNull(),
    /**
     * Carries no foreign key, unlike its private-message counterpart: the
     * primary key here is `(id, created_at)` because the table is
     * partitioned, and a reference would have to carry both halves. The
     * quoted message is resolved by the read query instead, and a dangling
     * id renders as a quote whose target is gone — which is also what
     * happens when retention drops the day it lived in.
     */
    replyToId: text('reply_to_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    editedAt: timestamp('edited_at'),
    deletedAt: timestamp('deleted_at'),
    deletedById: text('deleted_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    primaryKey({ columns: [table.id, table.createdAt] }),
    index('room_messages_conversation_idx').on(
      table.conversationId,
      table.createdAt
    ),
  ]
);

/**
 * A staff broadcast: one message, written once, delivered to a cohort.
 *
 * A row rather than a fire-and-forget loop, for one reason: at this
 * membership a broadcast is thousands of inserts, and a process that
 * restarts halfway through a loop leaves no record of how far it got. The
 * row is what lets it resume, and what lets somebody answer "did that
 * announcement actually go out?".
 *
 * Deliberately NOT a way to message all 352k members. The audiences are
 * bounded cohorts — a role, the inactive, hit-and-run violators — because
 * a private message to everybody is not a private message: it is an
 * announcement, and the site already has a banner and a notification feed
 * for that. Sending it as 352k conversations would cost a million rows to
 * say something nobody can usefully reply to.
 */
export const messagingBroadcasts = pgTable(
  'messaging_broadcasts',
  {
    id: text('id').primaryKey(),
    createdById: text('created_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** `role:<id>` | `inactive:<days>` | `hnr` | `staff` */
    audience: text('audience').notNull(),
    body: text('body').notNull(),
    /** Recipients resolved when the job started. */
    total: integer('total').default(0).notNull(),
    /** Moves as batches land, so progress survives a restart. */
    sent: integer('sent').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    finishedAt: timestamp('finished_at'),
    error: text('error'),
  },
  (table) => [index('messaging_broadcasts_created_idx').on(table.createdAt)]
);

/**
 * The fixed set of reactions, as KEYS rather than emoji.
 *
 * Storing the character would make `❤️` (U+2764 U+FE0F) and `❤`
 * (U+2764) two different reactions to the same message, and a client that
 * normalises differently from another would silently split every count.
 * A key cannot do that, is a third the size, and lets the rendered glyph
 * change without a migration.
 *
 * Six, and fixed: an open picker makes the distinct-key space per message
 * unbounded, which is what turns a reaction row into a scan.
 */
export const REACTION_KEYS = [
  'up',
  'heart',
  'haha',
  'wow',
  'thanks',
  'done',
] as const;
export type ReactionKey = (typeof REACTION_KEYS)[number];

const reactionKeyCheck = (column: AnyPgColumn) =>
  sql`${column} IN ('up', 'heart', 'haha', 'wow', 'thanks', 'done')`;

/**
 * Reactions on a private message.
 *
 * The primary key is the uniqueness rule: one member, one key, one
 * message. Reacting twice with the same key is the same row, so the
 * route can upsert and the client can be careless without double
 * counting.
 */
export const messageReactions = pgTable(
  'message_reactions',
  {
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.messageId, table.userId, table.key] }),
    // Rendering a page means fetching the reactions for the ids on it.
    index('message_reactions_message_idx').on(table.messageId),
    check('message_reactions_key_ck', reactionKeyCheck(table.key)),
  ]
);

/**
 * Reactions on a room message.
 *
 * Partitioned by the MESSAGE's day, not its own, so the retention sweep
 * drops a day's reactions with the day's messages in the same operation.
 * A separate unpartitioned table would either block the DROP behind a
 * foreign key or leave rows pointing at messages that no longer exist,
 * growing forever behind a feature that is supposed to forget.
 *
 * No foreign key for the same reason the reply column has none: the
 * parent's key is composite because it is partitioned.
 */
export const roomMessageReactions = pgTable(
  'room_message_reactions',
  {
    messageId: text('message_id').notNull(),
    messageCreatedAt: timestamp('message_created_at').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.messageId,
        table.messageCreatedAt,
        table.userId,
        table.key,
      ],
    }),
    index('room_message_reactions_message_idx').on(
      table.messageId,
      table.messageCreatedAt
    ),
    check('room_message_reactions_key_ck', reactionKeyCheck(table.key)),
  ]
);

export const conversationsRelations = relations(
  conversations,
  ({ one, many }) => ({
    createdBy: one(users, {
      fields: [conversations.createdById],
      references: [users.id],
    }),
    participants: many(conversationParticipants),
    messages: many(messages),
  })
);

export const conversationParticipantsRelations = relations(
  conversationParticipants,
  ({ one }) => ({
    conversation: one(conversations, {
      fields: [conversationParticipants.conversationId],
      references: [conversations.id],
    }),
    user: one(users, {
      fields: [conversationParticipants.userId],
      references: [users.id],
    }),
  })
);

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  author: one(users, {
    fields: [messages.authorId],
    references: [users.id],
  }),
}));

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type ConversationParticipant =
  typeof conversationParticipants.$inferSelect;
export type NewConversationParticipant =
  typeof conversationParticipants.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type RoomMessage = typeof roomMessages.$inferSelect;
export type NewRoomMessage = typeof roomMessages.$inferInsert;

/**
 * One member refusing another.
 *
 * Global rather than per-conversation, because that is what a block means
 * to the person setting it: not "stop this thread" but "this person does
 * not reach me". Per-conversation state exists too — `state = 'blocked'`
 * on a participant row — and the two are different things: this table is
 * the standing refusal, that column is one conversation's disposition.
 *
 * Without it the only escape from harassment is the staff, and at this
 * membership size the staff becomes the bottleneck. A member has to be
 * able to end it themselves, immediately, without asking anyone.
 */
export const messagingBlocks = pgTable(
  'messaging_blocks',
  {
    // Who is refusing.
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Who is refused.
    blockedId: text('blocked_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.blockedId] }),
    // The question asked on every send is "has the recipient blocked the
    // sender", so the index has to lead with the blocked party.
    index('messaging_blocks_blocked_idx').on(table.blockedId),
    check('messaging_blocks_self_ck', sql`${table.userId} <> ${table.blockedId}`),
  ]
);

export type MessagingBlock = typeof messagingBlocks.$inferSelect;
export type NewMessagingBlock = typeof messagingBlocks.$inferInsert;

/**
 * Every time a staff member reads a reported private message.
 *
 * The one place in this application where somebody can read another
 * member's private correspondence, and until now it left no trace: the
 * route opened, the message was returned, and nothing recorded that it
 * had happened. That is the gap the schema itself named — "this is the
 * closest thing the app has to an audit trail; there is no staff action
 * log anywhere" — and it is the wrong gap to have precisely here.
 *
 * Written on the READ, not on the report. A report is somebody asking;
 * this table is somebody looking. The two are different acts, they are
 * days apart, and only the second one is an access to private data.
 *
 * Kept when the reader's account is erased (`SET NULL`, not cascade).
 * Losing who looked would make the log useless in the one case where it
 * matters most — the reader themselves. The report id is kept for the
 * same reason and by the same means: a dismissed report must not erase
 * the record that its message was read under it.
 *
 * Never deleted on a timer. It is small — one row per read, not per
 * message — and a retention that outlives its subject is the point of an
 * audit trail.
 */
export const messageReadLog = pgTable(
  'message_read_log',
  {
    id: text('id').primaryKey(),
    /** Who looked. Null once that account is erased; the row survives. */
    readerId: text('reader_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** Kept as text: the username at the time, so an erasure does not
     *  turn a year of entries into a column of nulls nobody can read. */
    readerName: text('reader_name').notNull(),
    /** The message. Not a foreign key — retention or a withdrawal can
     *  remove it, and the record of it having been read must not go with
     *  it. That is exactly the case an audit trail exists for. */
    messageId: text('message_id').notNull(),
    conversationId: text('conversation_id').notNull(),
    /** The report that opened the window. Survives the report's deletion. */
    reportId: text('report_id'),
    /**
     * Whether anything was actually legible.
     *
     * An encrypted conversation yields nothing whatever the role, and the
     * route says so rather than erroring. The attempt is still logged —
     * "a moderator tried to read this and could not" is a fact about the
     * moderator, not about the message.
     */
    disclosed: boolean('disclosed').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    // "Who read what, most recent first" is the whole read pattern.
    index('message_read_log_created_idx').on(table.createdAt),
    index('message_read_log_reader_idx').on(table.readerId, table.createdAt),
    index('message_read_log_message_idx').on(table.messageId),
  ]
);

export type MessageReadLog = typeof messageReadLog.$inferSelect;
export type NewMessageReadLog = typeof messageReadLog.$inferInsert;

/**
 * A member silenced in the room.
 *
 * A table rather than a column on `conversation_participants`, because
 * the room has no participants: a shoutbox is ambient, nobody joins it,
 * and giving three hundred and fifty thousand members a row each to carry
 * an unread count nobody reads would be the wrong shape entirely.
 *
 * So the only per-member state the room has is this one, and it exists
 * only while somebody is actually muted.
 */
export const roomMutes = pgTable(
  'room_mutes',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    until: timestamp('until').notNull(),
    /** Who silenced them. A moderation act with no author is indefensible. */
    byId: text('by_id').references(() => users.id, { onDelete: 'set null' }),
    reason: text('reason'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('room_mutes_until_idx').on(table.until)]
);

export type RoomMute = typeof roomMutes.$inferSelect;
export type NewRoomMute = typeof roomMutes.$inferInsert;

/**
 * One member's public key for encrypted conversations.
 *
 * One key per account, not per device, and that is the whole design: the
 * private half never leaves the browser that made it, so a member who
 * generates a key elsewhere replaces this row and loses the ability to
 * read what the previous key sealed. That is the promise the interface
 * makes — "not even you, on another device" — and a table shaped for
 * multiple devices would quietly be promising something else.
 *
 * `alg` is here so the curve is never inferred. X25519 was measured
 * working in a current browser, and P-256 was chosen anyway: a single
 * curve everybody supports avoids the failure where two members cannot
 * talk because their browsers picked different ones — which is hard to
 * explain and resolves itself only as the slower half of the fleet
 * updates. Recording it means a later move to X25519 is a migration
 * rather than a guess.
 */
export const userMessageKeys = pgTable('user_message_keys', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** SPKI, base64url. */
  publicKey: text('public_key').notNull(),
  alg: text('alg').notNull().default('ECDH-P256'),
  /** Purely indicative, shown in settings so a member recognises which
   *  machine holds the key. Never used for anything. */
  deviceLabel: text('device_label'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type UserMessageKey = typeof userMessageKeys.$inferSelect;
export type NewUserMessageKey = typeof userMessageKeys.$inferInsert;
