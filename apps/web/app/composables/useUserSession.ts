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
  }

  return { user, loggedIn, fetch, clear };
}
