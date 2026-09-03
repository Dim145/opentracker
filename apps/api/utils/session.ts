import type { H3Event } from 'h3';
import { readLiveRoles } from './liveRoles';
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
  /**
   * Declared even though the index signature below would admit it anyway:
   * `requireOwnerSession` reads it, and a field a gate depends on should be
   * visible in the type rather than arriving through the catch-all.
   */
  isOwner: boolean;
  /**
   * La génération de sessions qui avait cours à la connexion.
   *
   * `requireUserSession` la compare à `users.session_epoch`. Absente d'un
   * cookie émis avant cette fonctionnalité : traitée comme `0`, donc les
   * sessions déjà ouvertes restent valides jusqu'à la première révocation —
   * un déploiement ne doit pas déconnecter tout le monde pour installer de
   * quoi déconnecter quelqu'un.
   */
  sessionEpoch?: number;
  uploaded: number;
  downloaded: number;
  [key: string]: unknown;
}

export interface UserSessionData {
  user?: SessionUser;
  /**
   * Login timestamp, written by the passkey and profile-patch paths. Declared
   * here because a sealed cookie only round-trips what the type allows.
   */
  loggedInAt?: number;
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
  if (!s.id) {
    // h3 types the id as optional. It is always set once the session is
    // loaded, but returning `undefined` here would silently key the
    // fresh-auth window on nothing — the exact regression the note above
    // describes — so fail loudly rather than degrade.
    throw createError({
      statusCode: 500,
      message: 'Session has no id; cannot resolve the fresh-auth window',
    });
  }
  return s.id;
}

/**
 * La porte d'authentification, et les deux choses qu'elle doit faire au passage.
 *
 * **Les drapeaux de personnel sont relus dans la base, pas dans le cookie.**
 * Le cookie est un jeton scellé de sept jours : lus depuis lui, `isAdmin` et
 * `isModerator` restaient vrais toute cette durée, si bien qu'un modérateur
 * rétrogradé conservait ses pouvoirs sur douze routes mutantes qui n'élargissent
 * les leurs que sur ces drapeaux — réécrire le message d'un autre membre,
 * supprimer n'importe quel torrent, publier sans passer par la file de revue,
 * désanonymiser un uploadeur. `invalidateRoleCache` était bien appelé à la
 * rétrogradation, et son effet s'arrêtait aux portes `/api/admin/**` et
 * `/api/mod/**` : depuis un client HTTP, le reste tenait.
 *
 * `reconcileStaffRoles` existait, avec ce défaut écrit mot pour mot dans son
 * commentaire, et n'était câblé qu'à la messagerie et aux tickets. Le poser ICI
 * plutôt que dans les douze routes est ce qui garantit qu'une treizième, écrite
 * demain, en hérite : le coût est une lecture Redis mise en cache 60 s, que la
 * chaîne d'authentification faisait déjà pour l'état de bannissement.
 *
 * **L'acteur du journal d'audit est posé ici aussi**, pour la même raison :
 * `requireAuthSession` le posait et `requireUserSession` non, si bien que dix
 * routes que `STAFF_REACH` déclare vouloir tracer n'écrivaient aucune ligne —
 * ni succès, ni refus. Le choix entre les deux gardes, indistinguable vu de la
 * route, décidait de la traçabilité.
 */
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
  const session = data as UserSessionData & { user: SessionUser };

  // Mémoïsé par requête : une route qui enchaîne `requireUserSession` puis
  // `requireAuthSession` ne paie la lecture qu'une fois.
  if (!event.context.rolesReconciled) {
    const live = await readLiveRoles(session.user.id);
    if (!live) {
      throw createError({ statusCode: 403, message: 'Account no longer exists' });
    }

    /*
     * La révocation, au même endroit et pour le même prix que les rôles.
     *
     * Le cookie est scellé et sans état : sans cette comparaison, rien ne
     * pouvait l'invalider avant sept jours. La lecture est celle qui avait
     * déjà lieu — `readLiveRoles` rend l'époque avec les rôles, cache de 60 s
     * compris — donc révoquer ne coûte pas une requête de plus par appel.
     *
     * Un cookie sans époque vaut `0` : les sessions ouvertes au moment du
     * déploiement survivent, et la première révocation les emporte.
     *
     * La fenêtre est celle du cache : jusqu'à 60 s. `revokeAllSessions` vide
     * le cache en incrémentant, donc en pratique l'effet est immédiat pour
     * l'instance qui reçoit l'appel.
     */
    if ((session.user.sessionEpoch ?? 0) !== live.sessionEpoch) {
      await clearUserSession(event);
      throw createError({
        statusCode: 401,
        data: { reason: 'session-revoked' },
        message: 'This session was revoked. Sign in again.',
      });
    }

    session.user.isAdmin = live.isAdmin;
    session.user.isModerator = live.isModerator;
    session.user.isOwner = live.isOwner;
    event.context.rolesReconciled = true;
  }

  event.context.auditActor = session.user;
  return session;
}
