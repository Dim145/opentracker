import type { H3Event } from 'h3';
import { useSession } from 'h3';
import { touchPresence } from './presence';

/**
 * Replacement for `nuxt-auth-utils` session helpers using h3's built-in
 * `useSession` (sealed cookie via iron-webcrypto). The exports below match
 * the names the rest of the codebase uses, so route handlers don't change.
 */

export interface SessionUser {
  id: string;
  username: string;
  passkey: string;
  isAdmin: boolean;
  isModerator: boolean;
  uploaded: number;
  downloaded: number;
  invitesRemaining: number;
  [key: string]: unknown;
}

export interface UserSessionData {
  user?: SessionUser;
}

const COOKIE_NAME = 'trackarr-session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function getSessionPassword(): string {
  const pw = process.env.NUXT_SESSION_SECRET;
  if (!pw || pw.length < 32) {
    throw new Error(
      'NUXT_SESSION_SECRET must be set and at least 32 characters long'
    );
  }
  return pw;
}

async function session(event: H3Event) {
  return useSession<UserSessionData>(event, {
    password: getSessionPassword(),
    name: COOKIE_NAME,
    maxAge: SESSION_MAX_AGE,
    cookie: {
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      path: '/',
    },
  });
}

export async function getUserSession(
  event: H3Event
): Promise<UserSessionData> {
  const s = await session(event);
  // Refresh `users.last_seen` so the "EN LIGNE" tile reflects active
  // navigation, not just the last login. Fire-and-forget — the
  // helper throttles itself with Redis (max 1 DB write/user/min)
  // and swallows errors, so the request path stays unaffected.
  if (s.data.user?.id) {
    void touchPresence(s.data.user.id);
  }
  return s.data;
}

export async function setUserSession(
  event: H3Event,
  data: UserSessionData
): Promise<UserSessionData> {
  const s = await session(event);
  await s.update(data);
  return s.data;
}

export async function clearUserSession(event: H3Event): Promise<void> {
  const s = await session(event);
  await s.clear();
}

/**
 * The h3 session id (a top-level sibling of `data`, NOT inside it).
 *
 * `getUserSession`/`requireUserSession` deliberately return only
 * `s.data` (the `{ user }` payload), which has no `id` field — so
 * reading `session.id` at a call site is always `undefined`. The
 * fresh-auth window (markFreshAuth/isFreshAuth) keys on this id, so
 * every consumer MUST resolve it through this helper, not off the
 * session-data object. (Finding H1: without this the fresh-auth
 * gate was permanently inert.)
 */
export async function getSessionId(event: H3Event): Promise<string> {
  const s = await session(event);
  return s.id;
}

export async function requireUserSession(
  event: H3Event
): Promise<UserSessionData & { user: SessionUser }> {
  const data = await getUserSession(event);
  if (!data.user) {
    throw createError({
      statusCode: 401,
      message: 'Authentication required',
    });
  }
  return data as UserSessionData & { user: SessionUser };
}
