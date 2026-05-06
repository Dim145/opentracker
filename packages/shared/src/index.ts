/**
 * Shared types between the web and api apps.
 * Keep this module pure (no DB, no h3, no Nuxt) — it's bundled both server- and client-side.
 */

export interface User {
  id: string;
  username: string;
  passkey: string;
  isAdmin: boolean;
  isModerator: boolean;
  uploaded: number;
  downloaded: number;
  invitesRemaining: number;
}

/** Subset of `User` safe to expose in public API responses (no passkey). */
export interface PublicUser {
  id: string;
  username: string;
  isAdmin: boolean;
  isModerator: boolean;
  uploaded: number;
  downloaded: number;
}

export interface UserSession {
  user: User;
  loggedInAt: number;
}
