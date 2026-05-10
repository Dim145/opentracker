/**
 * Shared types between the web and api apps.
 * Keep this module pure (no DB, no h3, no Nuxt) — it's bundled both server- and client-side.
 */

export type ThemePreference = 'light' | 'dark';

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
