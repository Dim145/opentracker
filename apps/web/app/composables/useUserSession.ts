import type { PublicUser } from '@trackarr/shared';

interface SessionState {
  user: PublicUser | null;
}

interface AuthStatus {
  needsSetup: boolean;
  user: PublicUser | null;
  registrationOpen: boolean;
  inviteEnabled: boolean;
}

/**
 * Drop-in replacement for `nuxt-auth-utils`' `useUserSession()`.
 * Backed by our own /api/auth/status endpoint instead of a Nuxt server route.
 */
export function useUserSession() {
  const session = useState<SessionState>('user-session', () => ({
    user: null,
  }));

  const user = computed(() => session.value.user);
  const loggedIn = computed(() => session.value.user !== null);

  async function fetch() {
    try {
      const data = await $fetch<AuthStatus>('/api/auth/status');
      session.value = { user: data?.user ?? null };
    } catch {
      session.value = { user: null };
    }
  }

  async function clear() {
    session.value = { user: null };
    // La clé privée de l'identité portable et les brouillons partent avec la
    // session. `identityKey.forget()` existait et n'était appelé de nulle part :
    // sur un profil de navigateur partagé, la personne suivante héritait de la
    // clé qui signe les documents fédérés du membre précédent. Voir
    // `utils/localSecrets.ts` pour ce qui est purgé et pourquoi c'est ici.
    purgeLocalSecrets();
  }

  return { user, loggedIn, fetch, clear };
}
