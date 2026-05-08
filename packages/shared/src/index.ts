/**
 * Shared types between the web and api apps.
 * Keep this module pure (no DB, no h3, no Nuxt) — it's bundled both server- and client-side.
 */

export type ThemePreference = 'light' | 'dark';

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
  theme: ThemePreference;
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
  theme: ThemePreference;
}

export interface UserSession {
  user: User;
  loggedInAt: number;
}
