<template>
  <div class="settings-page">
    <!-- Header -->
    <header class="settings-head">
      <NuxtLink to="/me" class="back-link">
        <Icon name="ph:arrow-left-bold" />
        Back to profile
      </NuxtLink>
      <div class="settings-title-row">
        <div>
          <p class="page-eyebrow">Account preferences</p>
          <h1 class="page-title">
            Settings <span class="page-title-accent">&amp; controls</span>
          </h1>
        </div>
        <div v-if="dirtyCount > 0" class="ready-state partial">
          <Icon name="ph:pencil-line-bold" />
          <span>{{ dirtyCount }} unsaved change{{
            dirtyCount === 1 ? '' : 's'
          }}</span>
        </div>
        <div v-else class="ready-state idle">
          <Icon name="ph:check-bold" />
          <span>All saved</span>
        </div>
      </div>
    </header>

    <div v-if="!loaded" class="settings-loading">
      <Icon name="ph:circle-notch" class="animate-spin" />
    </div>

    <div v-else class="settings-shell">
      <!-- Sidebar: anchor nav -->
      <aside class="settings-nav" aria-label="Settings sections">
        <a
          v-for="s in sections"
          :key="s.key"
          :href="`#${s.key}`"
          class="settings-nav-link"
          :class="{ 'settings-nav-link--active': activeSection === s.key }"
          @click="activeSection = s.key"
        >
          <span class="settings-nav-num">{{ s.num }}</span>
          <span class="settings-nav-label">
            <Icon :name="s.icon" />
            {{ s.label }}
          </span>
        </a>
      </aside>

      <!-- Main column -->
      <div class="settings-main">
        <!-- 01 IDENTITY -->
        <section id="identity" class="form-section">
          <header class="section-head">
            <span class="section-number">01</span>
            <h2 class="section-title">Identity</h2>
            <span class="section-rule" />
          </header>

          <div class="section-body">
            <p class="section-help">
              Your username is locked — it's tied to your announce URL and
              moderation history. Use a display name to change how you appear
              on profile pages without rotating your identity.
            </p>

            <div class="readonly-row">
              <span class="field-label">Username</span>
              <code class="readonly-value">{{ form.username }}</code>
              <span class="readonly-hint">
                <Icon name="ph:lock-key-bold" />
                immutable
              </span>
            </div>

            <label class="field-row">
              <span class="field-label">
                Display name
                <span class="field-hint">optional · ≤ 32 chars</span>
              </span>
              <input
                v-model="form.displayName"
                type="text"
                maxlength="32"
                placeholder="Leave blank to use your username"
                class="input field-input"
              />
              <span class="char-counter" :class="overLimit('displayName', 32)">
                {{ form.displayName.length }} / 32
              </span>
            </label>

            <label class="field-row">
              <span class="field-label">
                Bio
                <span class="field-hint">optional · ≤ 1000 chars · plain text</span>
              </span>
              <textarea
                v-model="form.bio"
                maxlength="1000"
                rows="5"
                placeholder="A short blurb on your seedbox, your taste, or what you're farming this month."
                class="input field-input field-textarea"
              />
              <span class="char-counter" :class="overLimit('bio', 1000)">
                {{ form.bio.length }} / 1000
              </span>
            </label>
          </div>
        </section>

        <!-- 02 PRIVACY -->
        <section id="privacy" class="form-section">
          <header class="section-head">
            <span class="section-number">02</span>
            <h2 class="section-title">Privacy</h2>
            <span class="section-rule" />
          </header>

          <div class="section-body">
            <label
              class="toggle-row"
              :class="{ 'toggle-row--on': form.showLastSeen }"
            >
              <button
                type="button"
                role="switch"
                :aria-checked="form.showLastSeen"
                class="toggle"
                :class="{ 'toggle--on': form.showLastSeen }"
                @click="form.showLastSeen = !form.showLastSeen"
              >
                <span class="toggle-knob" />
              </button>
              <div class="toggle-body">
                <p class="toggle-title">
                  Show last-seen on my public profile
                </p>
                <p class="toggle-sub">
                  When off, members visiting your profile see “Hidden”
                  instead of a timestamp. Mods and admins always see the
                  real value for moderation.
                </p>
              </div>
            </label>

            <label
              id="adult"
              class="toggle-row"
              :class="{
                'toggle-row--on': form.showAdultContent,
                'toggle-row--danger': form.showAdultContent,
              }"
            >
              <button
                type="button"
                role="switch"
                :aria-checked="form.showAdultContent"
                class="toggle"
                :class="{ 'toggle--on': form.showAdultContent }"
                @click="form.showAdultContent = !form.showAdultContent"
              >
                <span class="toggle-knob" />
              </button>
              <div class="toggle-body">
                <p class="toggle-title">Show adult content (XXX)</p>
                <p class="toggle-sub">
                  Hides every torrent in the XXX category tree from
                  listings, searches, RSS and the homepage feed. The
                  individual torrent pages render a “content filtered”
                  notice in place of the actual data when this is off.
                  Default off — flip it on only if that's what you want.
                </p>
              </div>
            </label>
          </div>
        </section>

        <!-- 03 APPEARANCE -->
        <section id="appearance" class="form-section">
          <header class="section-head">
            <span class="section-number">03</span>
            <h2 class="section-title">Appearance</h2>
            <span class="section-rule" />
          </header>

          <div class="section-body">
            <p class="section-help">
              Theme is stored locally on this device. Switching here is the
              same as the toggle in the header.
            </p>
            <div class="theme-row">
              <button
                v-for="t in themes"
                :key="t.value"
                type="button"
                class="theme-btn"
                :class="{ 'theme-btn--active': themeMode === t.value }"
                @click="setTheme(t.value)"
              >
                <span class="theme-btn-dot" :style="{ background: t.dot }" />
                <span class="theme-btn-body">
                  <span class="theme-btn-label">
                    <Icon :name="t.icon" />
                    {{ t.label }}
                  </span>
                  <span class="theme-btn-sub">{{ t.sub }}</span>
                </span>
              </button>
            </div>
          </div>
        </section>

        <!-- 04 SECURITY -->
        <section id="security" class="form-section">
          <header class="section-head">
            <span class="section-number">04</span>
            <h2 class="section-title">Security</h2>
            <span class="section-rule" />
          </header>

          <div class="section-body">
            <!-- Two-factor authentication: extracted into its own
                 component since it owns several modals + a poll
                 against /api/me/2fa/status that we don't want to
                 entangle with the password form below. -->
            <TwoFactorSection />

            <article class="action-card">
              <div class="action-card-body">
                <h3 class="action-card-title">
                  <Icon name="ph:lock-key-bold" />
                  Change password
                </h3>
                <p class="action-card-text">
                  Your password never leaves this device. We re-derive a fresh
                  salt + verifier from the new password and replace the
                  stored pair atomically.
                </p>
              </div>
              <button
                type="button"
                class="btn-ghost"
                @click="passwordOpen = !passwordOpen"
              >
                <Icon
                  :name="passwordOpen ? 'ph:caret-up-bold' : 'ph:caret-down-bold'"
                />
                {{ passwordOpen ? 'Cancel' : 'Change password' }}
              </button>
            </article>

            <Transition name="pwd-fade">
              <div v-if="passwordOpen" class="password-form">
                <label class="field-row">
                  <span class="field-label">Current password</span>
                  <input
                    v-model="pwd.current"
                    type="password"
                    autocomplete="current-password"
                    class="input field-input"
                    placeholder="Enter your current password"
                  />
                </label>
                <label class="field-row">
                  <span class="field-label">New password</span>
                  <input
                    v-model="pwd.next"
                    type="password"
                    autocomplete="new-password"
                    minlength="8"
                    class="input field-input"
                    placeholder="At least 8 characters"
                  />
                </label>
                <label class="field-row">
                  <span class="field-label">Confirm new password</span>
                  <input
                    v-model="pwd.confirm"
                    type="password"
                    autocomplete="new-password"
                    minlength="8"
                    class="input field-input"
                    placeholder="Re-enter the new password"
                  />
                </label>
                <p
                  v-if="pwdError"
                  class="password-error"
                >
                  <Icon name="ph:warning-circle-fill" />
                  {{ pwdError }}
                </p>
                <div class="password-actions">
                  <button
                    type="button"
                    class="btn-ghost"
                    :disabled="pwdSubmitting"
                    @click="closePassword"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    class="btn-primary"
                    :disabled="!canSubmitPassword || pwdSubmitting"
                    @click="submitPassword"
                  >
                    <Icon
                      :name="
                        pwdSubmitting
                          ? 'ph:circle-notch'
                          : 'ph:lock-key-open-bold'
                      "
                      :class="{ 'animate-spin': pwdSubmitting }"
                    />
                    {{ pwdSubmitting ? 'Updating…' : 'Update password' }}
                  </button>
                </div>
                <p class="password-note">
                  <Icon name="ph:info-bold" />
                  Other tabs and devices stay signed in until they log out
                  manually.
                </p>
              </div>
            </Transition>

            <article class="action-card">
              <div class="action-card-body">
                <h3 class="action-card-title">
                  <Icon name="ph:key-bold" />
                  Tracker passkey
                </h3>
                <p class="action-card-text">
                  Reveal, copy or rotate your passkey from the
                  <NuxtLink to="/me" class="inline-link"
                    >tracker credentials section</NuxtLink
                  >
                  on your profile.
                </p>
              </div>
              <NuxtLink to="/me#01" class="btn-ghost">
                <Icon name="ph:arrow-up-right-bold" />
                Open profile
              </NuxtLink>
            </article>

            <article class="action-card">
              <div class="action-card-body">
                <h3 class="action-card-title">
                  <Icon name="ph:sign-out-bold" />
                  Sign out of this device
                </h3>
                <p class="action-card-text">
                  Ends the current session cookie and sends you back to the
                  login page.
                </p>
              </div>
              <button type="button" class="btn-ghost btn-ghost--danger" @click="signOut">
                <Icon name="ph:sign-out-bold" />
                Sign out
              </button>
            </article>
          </div>
        </section>

        <!-- 05 ACCOUNT INFO -->
        <section id="account" class="form-section">
          <header class="section-head">
            <span class="section-number">05</span>
            <h2 class="section-title">Account info</h2>
            <span class="section-rule" />
          </header>

          <div class="section-body">
            <dl class="info-grid">
              <div>
                <dt>User ID</dt>
                <dd><code>{{ profile?.id }}</code></dd>
              </div>
              <div>
                <dt>Member since</dt>
                <dd>{{ memberSince }}</dd>
              </div>
              <div>
                <dt>Role</dt>
                <dd>{{ roleName }}</dd>
              </div>
              <div>
                <dt>Last known IP</dt>
                <dd>
                  <code v-if="profile?.lastIp">{{ profile.lastIp }}</code>
                  <span v-else class="info-dim">—</span>
                </dd>
              </div>
              <div>
                <dt>Invites remaining</dt>
                <dd>{{ profile?.invitesRemaining ?? 0 }}</dd>
              </div>
              <div>
                <dt>Total uploads</dt>
                <dd>{{ profile?.counts.uploads ?? 0 }}</dd>
              </div>
            </dl>
          </div>
        </section>
      </div>
    </div>

    <!-- Sticky action bar -->
    <div v-if="loaded" class="action-bar" :class="{ 'action-bar--idle': dirtyCount === 0 }">
      <div class="action-bar-inner">
        <button
          type="button"
          class="btn-secondary"
          :disabled="dirtyCount === 0 || saving"
          @click="resetForm"
        >
          <Icon name="ph:arrow-counter-clockwise-bold" />
          Discard
        </button>
        <span class="action-bar-status">
          <span v-if="saveError" class="action-error">
            <Icon name="ph:warning-circle-fill" />
            {{ saveError }}
          </span>
          <span v-else-if="dirtyCount === 0" class="action-hint">
            Identity &amp; privacy preferences are up to date.
          </span>
          <span v-else class="action-ready">
            <Icon name="ph:floppy-disk-bold" />
            {{ dirtyCount }} change{{
              dirtyCount === 1 ? '' : 's'
            }}
            ready to save
          </span>
        </span>
        <button
          type="button"
          class="btn-primary"
          :disabled="dirtyCount === 0 || saving || hasOverflow"
          @click="save"
        >
          <Icon
            :name="saving ? 'ph:circle-notch' : 'ph:floppy-disk-bold'"
            :class="{ 'animate-spin': saving }"
          />
          {{ saving ? 'Saving…' : 'Save changes' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { generateLoginProof, generateCredentials } from '~/utils/crypto';
import TwoFactorSection from '~/components/security/TwoFactorSection.vue';

definePageMeta({ title: 'Settings' });
useHead({ title: 'Settings' });

interface MeProfile {
  id: string;
  username: string;
  displayName: string | null;
  bio: string | null;
  showLastSeen: boolean;
  showAdultContent: boolean;
  isAdmin: boolean;
  isModerator: boolean;
  role: { id: string; name: string; color: string } | null;
  lastIp: string | null;
  invitesRemaining: number;
  createdAt: string;
  counts: { uploads: number; seeds: number; activeSeeds: number; hnr: number };
}

const router = useRouter();
const notifications = useNotificationStore();
const { clear: clearSession, fetch: refreshSession } = useUserSession();
// The project ships its own minimal useColorMode (apps/web/app/composables/
// useColorMode.ts) — light/dark only, persisted in localStorage. We use
// `apply()` to set and `mode` (a readonly ref) for the active state.
const { mode: themeMode, apply: applyTheme } = useColorMode();

// ── Profile fetch ───────────────────────────────────────────────
const { data: profile, refresh: refreshProfile } = await useFetch<MeProfile>(
  '/api/me',
  { default: () => null as unknown as MeProfile }
);
const loaded = computed(() => !!profile.value);

// ── Form state (Identity + Privacy) ─────────────────────────────
const form = reactive({
  username: '',
  displayName: '',
  bio: '',
  showLastSeen: true,
  showAdultContent: false,
});
const snapshot = ref<{
  displayName: string;
  bio: string;
  showLastSeen: boolean;
  showAdultContent: boolean;
} | null>(null);

function hydrate() {
  if (!profile.value) return;
  form.username = profile.value.username;
  form.displayName = profile.value.displayName ?? '';
  form.bio = profile.value.bio ?? '';
  form.showLastSeen = profile.value.showLastSeen;
  form.showAdultContent = profile.value.showAdultContent ?? false;
  snapshot.value = {
    displayName: form.displayName,
    bio: form.bio,
    showLastSeen: form.showLastSeen,
    showAdultContent: form.showAdultContent,
  };
}
watch(profile, hydrate, { immediate: true });

const dirtyCount = computed(() => {
  const s = snapshot.value;
  if (!s) return 0;
  let n = 0;
  if (s.displayName !== form.displayName) n++;
  if (s.bio !== form.bio) n++;
  if (s.showLastSeen !== form.showLastSeen) n++;
  if (s.showAdultContent !== form.showAdultContent) n++;
  return n;
});

const hasOverflow = computed(
  () => form.displayName.length > 32 || form.bio.length > 1000
);

function overLimit(
  field: 'displayName' | 'bio',
  max: number
): string | undefined {
  return form[field].length > max ? 'char-counter--over' : undefined;
}

function resetForm() {
  hydrate();
}

const saving = ref(false);
const saveError = ref<string | null>(null);

async function save() {
  if (dirtyCount.value === 0 || saving.value) return;
  saving.value = true;
  saveError.value = null;
  try {
    const payload: Record<string, unknown> = {};
    const s = snapshot.value!;
    if (s.displayName !== form.displayName)
      payload.displayName = form.displayName.trim() || null;
    if (s.bio !== form.bio) payload.bio = form.bio.trim() || null;
    if (s.showLastSeen !== form.showLastSeen)
      payload.showLastSeen = form.showLastSeen;
    if (s.showAdultContent !== form.showAdultContent)
      payload.showAdultContent = form.showAdultContent;

    await $fetch('/api/me', { method: 'PATCH', body: payload });
    await refreshProfile();
    // displayName lives on the session payload (the navbar reads it
    // from there), so re-poll /api/auth/status to refresh the cached
    // session ref. No-op when displayName didn't change.
    if ('displayName' in payload) await refreshSession();
    notifications.success('Preferences saved');
  } catch (err: any) {
    saveError.value =
      err?.data?.message || err?.message || 'Failed to save preferences';
  } finally {
    saving.value = false;
  }
}

// ── Anchor nav ──────────────────────────────────────────────────
type SectionKey = 'identity' | 'privacy' | 'appearance' | 'security' | 'account';
const sections: Array<{
  key: SectionKey;
  num: string;
  label: string;
  icon: string;
}> = [
  { key: 'identity', num: '01', label: 'Identity', icon: 'ph:identification-card' },
  { key: 'privacy', num: '02', label: 'Privacy', icon: 'ph:eye-closed' },
  { key: 'appearance', num: '03', label: 'Appearance', icon: 'ph:palette' },
  { key: 'security', num: '04', label: 'Security', icon: 'ph:lock-key' },
  { key: 'account', num: '05', label: 'Account info', icon: 'ph:info' },
];
const activeSection = ref<SectionKey>('identity');
onMounted(() => {
  if (typeof window === 'undefined') return;
  // Highlight the section the user has scrolled to via IntersectionObserver.
  const opts: IntersectionObserverInit = {
    rootMargin: '-30% 0px -60% 0px',
    threshold: 0,
  };
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        const id = (e.target as HTMLElement).id as SectionKey;
        if (sections.some((s) => s.key === id)) activeSection.value = id;
      }
    }
  }, opts);
  for (const s of sections) {
    const el = document.getElementById(s.key);
    if (el) io.observe(el);
  }
  onBeforeUnmount(() => io.disconnect());
});

// ── Theme picker ────────────────────────────────────────────────
interface ThemeOption {
  value: 'light' | 'dark';
  label: string;
  sub: string;
  icon: string;
  dot: string;
}
const themes: ThemeOption[] = [
  {
    value: 'light',
    label: 'Light',
    sub: 'Day-friendly tones',
    icon: 'ph:sun-bold',
    dot: '#f5c518',
  },
  {
    value: 'dark',
    label: 'Dark',
    sub: 'Editorial midnight',
    icon: 'ph:moon-stars-bold',
    dot: '#34d4d8',
  },
];
function setTheme(value: 'light' | 'dark') {
  applyTheme(value);
}

// ── Password change ─────────────────────────────────────────────
const passwordOpen = ref(false);
const pwd = reactive({ current: '', next: '', confirm: '' });
const pwdSubmitting = ref(false);
const pwdError = ref<string | null>(null);

const canSubmitPassword = computed(
  () =>
    pwd.current.length > 0 &&
    pwd.next.length >= 8 &&
    pwd.next === pwd.confirm
);

function closePassword() {
  passwordOpen.value = false;
  pwd.current = '';
  pwd.next = '';
  pwd.confirm = '';
  pwdError.value = null;
}

async function submitPassword() {
  if (!canSubmitPassword.value || pwdSubmitting.value) return;
  if (pwd.next === pwd.current) {
    pwdError.value = 'New password must differ from the current one';
    return;
  }
  pwdSubmitting.value = true;
  pwdError.value = null;
  try {
    // 1. Get a server challenge for ourselves.
    const ch = await $fetch<{ salt: string; challenge: string }>(
      '/api/auth/challenge',
      { query: { username: profile.value!.username } }
    );

    // 2. Compute proof-of-current-password against the stored salt.
    const currentProof = await generateLoginProof(
      pwd.current,
      ch.salt,
      ch.challenge
    );

    // 3. Derive a fresh salt + verifier for the new password.
    const fresh = await generateCredentials(pwd.next);

    await $fetch('/api/auth/password', {
      method: 'PUT',
      body: {
        challenge: ch.challenge,
        currentProof,
        newSalt: fresh.salt,
        newVerifier: fresh.verifier,
      },
    });

    notifications.success('Password updated');
    closePassword();
  } catch (err: any) {
    pwdError.value =
      err?.data?.message || err?.message || 'Failed to update password';
  } finally {
    pwdSubmitting.value = false;
  }
}

// ── Sign out ────────────────────────────────────────────────────
async function signOut() {
  try {
    await $fetch('/api/auth/logout', { method: 'POST' });
  } catch {
    // logout endpoint always succeeds in practice, but a network blip
    // shouldn't keep the user stranded — the client clear below also
    // drops the cached session.
  }
  await clearSession();
  router.push('/auth/login');
}

// ── Account info derivations ────────────────────────────────────
// Pin the locale ('en-US') so SSR and the browser produce identical
// strings — using `undefined` here triggered Vue's hydration mismatch
// warning when the server-side ICU locale didn't match the user's.
const memberSince = computed(() =>
  profile.value
    ? new Date(profile.value.createdAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : ''
);
const roleName = computed(() => {
  const p = profile.value;
  if (!p) return '';
  if (p.isAdmin) return 'Admin';
  if (p.isModerator) return 'Moderator';
  return p.role?.name ?? 'Member';
});

// ── Unsaved-change guard on navigation ──────────────────────────
onBeforeRouteLeave((_to, _from, next) => {
  if (dirtyCount.value === 0) return next();
  if (
    typeof window !== 'undefined' &&
    !confirm('You have unsaved changes. Leave anyway?')
  ) {
    return next(false);
  }
  return next();
});
</script>

<style scoped>
.settings-page {
  max-width: 1280px;
  margin: 0 auto;
  padding: 0 0.25rem 6rem;
}

/* ─── Header ─────────────────────────────────────────────────── */
.settings-head {
  margin-bottom: 2rem;
}
.back-link {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  margin-bottom: 1.25rem;
  transition: color 0.15s;
}
.back-link:hover {
  color: rgb(var(--fg-strong));
}
.settings-title-row {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 2rem;
  flex-wrap: wrap;
}
.page-eyebrow {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  margin: 0 0 0.4rem;
}
.page-title {
  font-size: clamp(2rem, 4vw, 3rem);
  font-weight: 900;
  letter-spacing: -0.025em;
  text-transform: uppercase;
  margin: 0;
  line-height: 1;
}
.page-title-accent {
  color: rgb(var(--fg-muted));
  font-weight: 400;
  font-style: italic;
  letter-spacing: -0.01em;
}

.ready-state {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.85rem;
  border-radius: 9999px;
  border: 1px solid;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}
.ready-state.idle {
  border-color: rgba(108, 209, 97, 0.4);
  background: rgba(108, 209, 97, 0.08);
  color: #6cd161;
}
.ready-state.partial {
  border-color: rgba(245, 197, 24, 0.4);
  background: rgba(245, 197, 24, 0.08);
  color: #f5c518;
}

/* ─── Layout ─────────────────────────────────────────────────── */
.settings-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 40vh;
  font-size: 1.5rem;
  color: rgb(var(--fg-muted));
}
.settings-shell {
  display: grid;
  grid-template-columns: 14rem minmax(0, 1fr);
  gap: 3rem;
  align-items: flex-start;
}
@media (max-width: 960px) {
  .settings-shell {
    grid-template-columns: 1fr;
    gap: 1.5rem;
  }
}
.settings-nav {
  position: sticky;
  /* The page header is `position: sticky; top: 0` and 56px tall (plus
   * the optional announcement bar). Anchor the nav just below it so it
   * never slides under. The 1rem cushion keeps a clean gap. */
  top: calc(var(--header-total, 56px) + 1rem);
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.75rem;
  background: rgb(var(--bg-secondary));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.5rem;
}
@media (max-width: 960px) {
  .settings-nav {
    flex-direction: row;
    flex-wrap: wrap;
    position: static;
  }
}
.settings-nav-link {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.55rem 0.7rem;
  border-radius: 0.4rem;
  text-decoration: none;
  color: rgb(var(--fg-muted));
  transition: all 0.15s;
}
.settings-nav-link:hover {
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-strong));
}
.settings-nav-link--active {
  background: rgb(var(--fg-strong));
  color: rgb(var(--bg-base));
}
.settings-nav-num {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  padding: 0.1rem 0.3rem;
  border-radius: 0.2rem;
  border: 1px solid currentColor;
  opacity: 0.7;
}
.settings-nav-label {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.settings-main {
  display: flex;
  flex-direction: column;
  gap: 3rem;
  min-width: 0;
}

/* ─── Section header (matches upload form style) ───────────── */
.form-section {
  scroll-margin-top: calc(var(--header-total, 56px) + 1rem);
}
.section-head {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  margin-bottom: 1.25rem;
}
.section-number {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: rgb(var(--fg-muted));
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.25rem;
  padding: 0.2rem 0.5rem;
}
.section-title {
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
  margin: 0;
}
.section-rule {
  flex: 1;
  height: 1px;
  background: linear-gradient(
    to right,
    rgb(var(--line-default)),
    rgb(var(--line-default) / 0)
  );
}
.section-help {
  font-size: 0.78rem;
  color: rgb(var(--fg-muted));
  margin: 0;
  line-height: 1.55;
  max-width: 38rem;
}
.section-body {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}

/* ─── Inputs ─────────────────────────────────────────────────── */
.field-row {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  position: relative;
}
.field-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  display: inline-flex;
  align-items: baseline;
  gap: 0.5rem;
}
.field-hint {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9px;
  letter-spacing: 0.06em;
  text-transform: none;
  color: rgb(var(--fg-muted));
  opacity: 0.7;
}
.field-input {
  width: 100%;
}
.field-textarea {
  resize: vertical;
  min-height: 6rem;
  font-family:
    'IBM Plex Mono', 'Cascadia Code', Menlo, ui-monospace, monospace;
  line-height: 1.55;
}
.char-counter {
  position: absolute;
  right: 0.4rem;
  bottom: -1.25rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  letter-spacing: 0.06em;
  color: rgb(var(--fg-muted));
}
.char-counter--over {
  color: rgb(var(--danger));
  font-weight: 700;
}

.readonly-row {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding: 0.65rem 1rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.4rem;
}
.readonly-value {
  flex: 1;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.85rem;
  font-weight: 700;
  color: rgb(var(--fg-strong));
}
.readonly-hint {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}

/* ─── Toggle ────────────────────────────────────────────────── */
.toggle-row {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  padding: 0.95rem 1.1rem;
  background: rgb(var(--bg-secondary));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.5rem;
  cursor: pointer;
  transition: border-color 0.15s;
}
.toggle-row:hover {
  border-color: rgb(var(--fg-default) / 0.3);
}
.toggle-row--on {
  border-left: 3px solid #6cd161;
  padding-left: calc(1.1rem - 2px);
}
/* Adult-content toggle: when enabled, the left bar turns red so the
   "this surface is now showing XXX" semantics is unmissable in
   passing — the colour matches the gate's danger accent. */
.toggle-row--on.toggle-row--danger {
  border-left-color: rgb(var(--danger));
}
.toggle {
  position: relative;
  flex-shrink: 0;
  width: 2.6rem;
  height: 1.5rem;
  border-radius: 9999px;
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-elevated));
  cursor: pointer;
  transition: all 0.18s ease;
}
.toggle--on {
  background: #6cd161;
  border-color: #6cd161;
}
.toggle-knob {
  position: absolute;
  top: 1px;
  left: 1px;
  width: 1.25rem;
  height: 1.25rem;
  border-radius: 9999px;
  background: rgb(var(--fg-strong));
  transition: transform 0.18s cubic-bezier(0.5, 0, 0.2, 1);
}
.toggle--on .toggle-knob {
  background: rgb(var(--bg-base));
  transform: translateX(1.1rem);
}
.toggle-body {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
}
.toggle-title {
  margin: 0;
  font-size: 0.88rem;
  font-weight: 700;
  color: rgb(var(--fg-strong));
  letter-spacing: 0.01em;
}
.toggle-sub {
  margin: 0;
  font-size: 0.78rem;
  color: rgb(var(--fg-muted));
  line-height: 1.55;
  max-width: 38rem;
}

/* ─── Theme picker ──────────────────────────────────────────── */
.theme-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.6rem;
}
@media (max-width: 640px) {
  .theme-row {
    grid-template-columns: 1fr;
  }
}
.theme-btn {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding: 0.85rem 1rem;
  border-radius: 0.5rem;
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-secondary));
  color: rgb(var(--fg-default));
  text-align: left;
  cursor: pointer;
  transition: all 0.15s;
}
.theme-btn:hover {
  border-color: rgb(var(--fg-default) / 0.3);
}
.theme-btn--active {
  border-color: rgb(var(--fg-strong));
  background: rgb(var(--fg-strong) / 0.04);
  box-shadow: inset 0 0 0 1px rgb(var(--fg-strong));
}
.theme-btn-dot {
  flex-shrink: 0;
  width: 0.85rem;
  height: 0.85rem;
  border-radius: 9999px;
  border: 1px solid rgb(var(--line-default));
}
.theme-btn-body {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}
.theme-btn-label {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: rgb(var(--fg-strong));
}
.theme-btn-sub {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  color: rgb(var(--fg-muted));
  letter-spacing: 0.04em;
}

/* ─── Action cards ─────────────────────────────────────────── */
.action-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.25rem;
  padding: 1rem 1.1rem;
  background: rgb(var(--bg-secondary));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.5rem;
  flex-wrap: wrap;
}
.action-card-body {
  flex: 1;
  min-width: 0;
}
.action-card-title {
  margin: 0 0 0.25rem;
  font-size: 0.9rem;
  font-weight: 700;
  color: rgb(var(--fg-strong));
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}
.action-card-text {
  margin: 0;
  font-size: 0.78rem;
  color: rgb(var(--fg-muted));
  line-height: 1.55;
  max-width: 42rem;
}
.inline-link {
  color: rgb(var(--fg-strong));
  text-decoration: underline;
  text-underline-offset: 3px;
}

/* ─── Password panel ───────────────────────────────────────── */
.password-form {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  padding: 1.1rem 1.2rem 1.5rem;
  background: rgb(var(--bg-secondary));
  border: 1px dashed rgb(var(--line-default));
  border-radius: 0.5rem;
}
.password-actions {
  display: flex;
  gap: 0.6rem;
  justify-content: flex-end;
  margin-top: 0.25rem;
}
.password-error {
  margin: 0;
  font-size: 0.78rem;
  color: rgb(var(--danger));
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
.password-note {
  margin: 0;
  font-size: 0.72rem;
  color: rgb(var(--fg-muted));
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

/* ─── Buttons ──────────────────────────────────────────────── */
.btn-ghost,
.btn-primary,
.btn-secondary {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 0.95rem;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  border: 1px solid;
  transition: all 0.15s;
}
.btn-ghost {
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-default));
  border-color: rgb(var(--line-default));
}
.btn-ghost:hover:not(:disabled) {
  border-color: rgb(var(--fg-default) / 0.3);
  color: rgb(var(--fg-strong));
}
.btn-ghost--danger:hover:not(:disabled) {
  border-color: rgb(var(--danger) / 0.4);
  color: rgb(var(--danger));
  background: rgb(var(--danger) / 0.08);
}
.btn-primary {
  background: rgb(var(--fg-strong));
  color: rgb(var(--bg-base));
  border-color: rgb(var(--fg-strong));
}
.btn-primary:hover:not(:disabled) {
  filter: brightness(0.92);
}
.btn-primary:disabled,
.btn-ghost:disabled,
.btn-secondary:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.btn-secondary {
  background: transparent;
  color: rgb(var(--fg-muted));
  border-color: rgb(var(--line-default));
}
.btn-secondary:hover:not(:disabled) {
  border-color: rgb(var(--fg-default) / 0.3);
  color: rgb(var(--fg-strong));
}

/* ─── Account info grid ────────────────────────────────────── */
.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  gap: 0.75rem;
  margin: 0;
}
.info-grid > div {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.75rem 0.9rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.4rem;
}
.info-grid dt {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.info-grid dd {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 700;
  color: rgb(var(--fg-strong));
  word-break: break-all;
}
.info-grid code {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0;
  color: rgb(var(--fg-default));
}
.info-dim {
  color: rgb(var(--fg-muted));
  opacity: 0.6;
}

/* ─── Sticky action bar ────────────────────────────────────── */
.action-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 30;
  background: rgb(var(--bg-base) / 0.95);
  backdrop-filter: blur(10px);
  border-top: 1px solid rgb(var(--line-default));
  transform: translateY(0);
  transition: transform 0.25s ease, opacity 0.25s ease;
}
.action-bar--idle {
  transform: translateY(0);
  opacity: 0.95;
}
.action-bar-inner {
  max-width: 1280px;
  margin: 0 auto;
  padding: 0.85rem 1rem;
  display: flex;
  align-items: center;
  gap: 1.25rem;
}
.action-bar-status {
  flex: 1;
  display: flex;
  justify-content: center;
  font-size: 11px;
}
.action-hint {
  color: rgb(var(--fg-muted));
}
.action-ready {
  color: #6cd161;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
.action-error {
  color: rgb(var(--danger));
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
@media (max-width: 640px) {
  .action-bar-inner {
    flex-wrap: wrap;
  }
  .action-bar-status {
    order: -1;
    flex-basis: 100%;
    margin-bottom: 0.4rem;
  }
}

/* Password panel transition */
.pwd-fade-enter-active,
.pwd-fade-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.pwd-fade-enter-from,
.pwd-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
