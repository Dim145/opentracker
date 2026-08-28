/**
 * Shared types between the web and api apps.
 * Keep this module pure (no DB, no h3, no Nuxt) — it's bundled both server- and client-side.
 */

export type ThemePreference = 'light' | 'dark';

/**
 * Columns the catalogue listing can be ordered by. Every entry corresponds to a
 * column the table renders, so each header the user sees can be clicked.
 *
 * `age` is the default and means "when the torrent became available"
 * (`COALESCE(moderated_at, created_at)`), not when it was uploaded — a release
 * that spent a week in the moderation queue appears where a member expects it.
 *
 * The order of this array is the order of the columns in the table; keep them
 * in step so a reader can map one onto the other.
 */
export const TORRENT_SORT_KEYS = [
  'name',
  'seeders',
  'leechers',
  'completed',
  'size',
  'age',
] as const;

export type TorrentSortKey = (typeof TORRENT_SORT_KEYS)[number];

export type SortDirection = 'asc' | 'desc';

/**
 * Locale codes that the web frontend bundles. Keep this in lock-step
 * with `apps/web/i18n/locales/*.json` and the `locales` array in
 * `apps/web/nuxt.config.ts`. The DB column is a free-form `text` so
 * adding a new locale is purely a frontend + JSON change — no
 * migration required.
 */
export type LanguagePreference = 'en' | 'fr';

export interface User {
  id: string;
  username: string;
  /** Optional override of `username` for display surfaces (navbar,
   * profile pages, comments). Falls back to `username` when null. */
  displayName: string | null;
  passkey: string;
  isAdmin: boolean;
  isModerator: boolean;
  /** The one account that owns this instance. See `apps/api/utils/owner.ts`. */
  isOwner: boolean;
  uploaded: number;
  downloaded: number;
  invitesRemaining: number;
  /** Seed-bonus running balance. Earned through hourly accrual on
   * active seeds, spent in the shop. Whole points only. */
  bonusPoints: number;
  theme: ThemePreference;
  language: LanguagePreference;
}

/** Subset of `User` safe to expose in public API responses (no passkey). */
export interface PublicUser {
  id: string;
  username: string;
  displayName: string | null;
  isAdmin: boolean;
  isModerator: boolean;
  isOwner: boolean;
  uploaded: number;
  downloaded: number;
  bonusPoints: number;
  theme: ThemePreference;
  language: LanguagePreference;
}

export interface UserSession {
  user: User;
  loggedInAt: number;
}
