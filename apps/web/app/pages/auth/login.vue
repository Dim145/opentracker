<template>
  <div class="min-h-screen bg-bg-primary flex items-center justify-center px-4">
    <div class="w-full max-w-md">
      <!-- Logo -->
      <div class="text-center mb-8">
        <div
          class="w-16 h-16 bg-accent rounded-lg flex items-center justify-center mx-auto mb-4 overflow-hidden"
        >
          <img
            v-if="branding?.siteLogoImage"
            :src="branding.siteLogoImage"
            alt="Logo"
            class="w-full h-full object-contain"
          />
          <Icon
            v-else
            :name="branding?.siteLogo || 'ph:broadcast-bold'"
            class="text-accent-fg text-4xl"
          />
        </div>
        <h1
          class="text-2xl font-bold tracking-tighter"
          v-html="sanitizeHtml(branding?.authTitle || branding?.siteName || 'TRACKARR')"
        ></h1>
        <div
          class="text-text-muted text-sm mt-1 [&>p]:m-0"
          v-html="sanitizeHtml(branding?.authSubtitle || 'Private BitTorrent Tracker')"
        ></div>
      </div>

      <!-- Registration mode banner. Three explicit states:
             - closed       → no sign-up path at all
             - invite-only  → sign-up requires a code (link still shown)
             - open         → no banner, just the link below
           The fourth combination (open + inviteEnabled) is treated
           as "open" since the code is optional in that case. -->
      <div
        v-if="registrationMode === 'closed' && !status?.needsSetup"
        class="mb-6 p-3 bg-blue-500/10 border border-blue-500/20 rounded flex items-start gap-3"
      >
        <Icon name="ph:lock-simple" class="text-blue-400 text-lg mt-0.5 shrink-0" />
        <p class="text-blue-400 text-xs leading-relaxed">
          {{ $t('auth.login.registrationsClosed') }}
        </p>
      </div>
      <div
        v-else-if="registrationMode === 'invite-only' && !status?.needsSetup"
        class="mb-6 p-3 bg-accent/10 border border-accent/20 rounded flex items-start gap-3"
      >
        <Icon name="ph:envelope-simple" class="text-accent text-lg mt-0.5 shrink-0" />
        <p class="text-accent text-xs leading-relaxed">
          {{ $t('auth.login.registrationsInviteOnly') }}
        </p>
      </div>

      <!-- Step 1 — username + password (SRP) -->
      <form
        v-if="!twoFactor"
        @submit.prevent="handleLogin"
        class="space-y-4"
      >
        <div>
          <label
            for="username"
            class="block text-xs font-medium text-text-muted uppercase tracking-wider mb-2"
          >
            {{ $t('auth.login.username') }}
          </label>
          <input
            id="username"
            v-model="form.username"
            type="text"
            required
            autocomplete="username"
            class="w-full bg-bg-tertiary border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-text-strong transition-colors"
            :placeholder="$t('auth.login.usernamePlaceholder')"
          />
        </div>

        <div>
          <label
            for="password"
            class="block text-xs font-medium text-text-muted uppercase tracking-wider mb-2"
          >
            {{ $t('auth.login.password') }}
          </label>
          <input
            id="password"
            v-model="form.password"
            type="password"
            required
            autocomplete="current-password"
            class="w-full bg-bg-tertiary border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-text-strong transition-colors"
            :placeholder="$t('auth.login.passwordPlaceholder')"
          />
        </div>

        <div v-if="error" class="text-red-400 text-sm">
          {{ error }}
        </div>

        <!-- Status indicator for ZKE challenge processing -->
        <div
          v-if="authStatus"
          class="text-text-muted text-xs flex items-center gap-2"
        >
          <Icon name="ph:spinner" class="animate-spin" />
          {{ authStatus }}
        </div>

        <button
          type="submit"
          :disabled="loading"
          class="w-full bg-accent text-accent-fg font-medium py-2.5 rounded hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span v-if="loading">{{ $t('auth.login.submitting') }}</span>
          <span v-else>{{ $t('auth.login.submit') }}</span>
        </button>
      </form>

      <!-- Step 2 — second factor (when the SRP response asked for it) -->
      <TwoFactorLoginStep
        v-else
        :challenge-token="twoFactor.token"
        :methods="twoFactor.methods"
        @verified="onTwoFactorVerified"
        @cancel="cancelTwoFactor"
      />

      <!-- The "create one" link is hidden only when registration is
           fully closed; in invite-only mode the user still needs the
           register page to redeem their code. -->
      <div
        v-if="registrationMode !== 'closed'"
        class="mt-6 pt-6 border-t border-border text-center"
      >
        <p class="text-text-muted text-sm">
          {{
            registrationMode === 'invite-only'
              ? $t('auth.login.haveInvite')
              : $t('auth.login.needAccount')
          }}
          <NuxtLink
            to="/auth/register"
            class="text-text-strong hover:underline font-medium ml-1"
          >
            {{
              registrationMode === 'invite-only'
                ? $t('auth.login.redeemInvite')
                : $t('auth.login.createAccount')
            }}
          </NuxtLink>
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { generateLoginProof } from '~/utils/crypto';
import TwoFactorLoginStep from '~/components/security/TwoFactorLoginStep.vue';

definePageMeta({
  layout: false,
});

const { fetch: fetchSession } = useUserSession();
const router = useRouter();

const { data: status } = await useFetch('/api/auth/status');

/**
 * Derive a single user-facing registration mode from the two
 * back-end flags. Three states matter to the visitor:
 *   - 'open'         registrations are unrestricted
 *   - 'invite-only'  registrations require a code (still has a path)
 *   - 'closed'       no path to /auth/register at all
 *
 * The fourth raw combination (registrationOpen=true + inviteEnabled)
 * collapses into 'open' since the code is optional in that case.
 */
const registrationMode = computed<'open' | 'invite-only' | 'closed'>(() => {
  if (status.value?.registrationOpen) return 'open';
  if (status.value?.inviteEnabled) return 'invite-only';
  return 'closed';
});
// Shared branding payload — see composables/useBranding.ts.
const branding = await useBranding();

// Set dynamic favicon
useHead({
  link: [
    {
      rel: 'icon',
      type: computed(() => {
        const url = branding.value?.siteFavicon;
        if (!url) return 'image/x-icon';
        if (url.endsWith('.svg')) return 'image/svg+xml';
        if (url.endsWith('.png')) return 'image/png';
        if (url.endsWith('.webp')) return 'image/webp';
        return 'image/x-icon';
      }),
      href: computed(() => branding.value?.siteFavicon || '/favicon.ico'),
    },
  ],
});

const form = reactive({
  username: '',
  password: '',
});

const error = ref('');
const loading = ref(false);
const authStatus = ref('');

// Set when the SRP step succeeds but the account has 2FA enabled.
// `<TwoFactorLoginStep>` then takes over and trades the token for a
// session via /api/auth/2fa/verify-totp or /verify-passkey.
const twoFactor = ref<{
  token: string;
  methods: ('totp' | 'recovery' | 'passkey')[];
} | null>(null);

async function handleLogin() {
  error.value = '';
  loading.value = true;
  authStatus.value = '';

  try {
    // Step 1: Get challenge and salt from server
    authStatus.value = 'Fetching challenge...';
    const challengeData = await $fetch<{ salt: string; challenge: string }>(
      '/api/auth/challenge',
      { query: { username: form.username } }
    );

    // Step 2: Generate ZKE proof client-side
    authStatus.value = 'Generating proof...';
    const proof = await generateLoginProof(
      form.password,
      challengeData.salt,
      challengeData.challenge
    );

    // Step 3: Send proof to server (password never leaves client)
    authStatus.value = 'Authenticating...';
    const result = await $fetch<{
      requires2FA: boolean;
      challengeToken?: string;
      methods?: ('totp' | 'recovery' | 'passkey')[];
    }>('/api/auth/login', {
      method: 'POST',
      body: {
        username: form.username,
        challenge: challengeData.challenge,
        proof,
      },
    });

    // 2FA gate: switch to the second-factor step instead of finalising.
    if (result.requires2FA && result.challengeToken && result.methods) {
      twoFactor.value = {
        token: result.challengeToken,
        methods: result.methods,
      };
      // Clear the password from memory — the SRP exchange is done,
      // the user shouldn't be able to land on a 2FA screen with the
      // input still readable in devtools.
      form.password = '';
      return;
    }

    // No 2FA — refresh session and redirect.
    await fetchSession();
    router.push('/');
  } catch (err: any) {
    error.value = err.data?.message || 'Login failed';
  } finally {
    loading.value = false;
    authStatus.value = '';
  }
}

async function onTwoFactorVerified() {
  twoFactor.value = null;
  await fetchSession();
  router.push('/');
}

function cancelTwoFactor() {
  // User aborted at the 2FA step. Reset the state so they can start
  // over from the username/password form. The challenge token in
  // Redis will expire on its own in 5 min.
  twoFactor.value = null;
  error.value = '';
}
</script>
