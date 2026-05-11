<template>
  <div class="settings-page">
    <!-- Header -->
    <header class="settings-head">
      <NuxtLink to="/me" class="back-link">
        <Icon name="ph:arrow-left-bold" />
        {{ $t('settings.backToProfile') }}
      </NuxtLink>
      <div class="settings-title-row">
        <div>
          <p class="page-eyebrow">{{ $t('settings.eyebrow') }}</p>
          <h1 class="page-title">
            {{ $t('settings.titleMain') }} <span class="page-title-accent">{{ $t('settings.titleAccent') }}</span>
          </h1>
        </div>
        <div v-if="dirtyCount > 0" class="ready-state partial">
          <Icon name="ph:pencil-line-bold" />
          <span>{{ $t('settings.unsavedChangesCount', dirtyCount, { n: dirtyCount }) }}</span>
        </div>
        <div v-else class="ready-state idle">
          <Icon name="ph:check-bold" />
          <span>{{ $t('settings.allSaved') }}</span>
        </div>
      </div>
    </header>

    <div v-if="!loaded" class="settings-loading">
      <Icon name="ph:circle-notch" class="animate-spin" />
    </div>

    <div v-else class="settings-shell">
      <!-- Sidebar: anchor nav -->
      <aside class="settings-nav" :aria-label="$t('settings.navAriaLabel')">
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
            <h2 class="section-title">{{ $t('settings.sections.identity') }}</h2>
            <span class="section-rule" />
          </header>

          <div class="section-body">
            <p class="section-help">
              {{ $t('settings.identity.usernameLocked') }}
            </p>

            <div class="readonly-row">
              <span class="field-label">{{ $t('settings.identity.username') }}</span>
              <code class="readonly-value">{{ form.username }}</code>
              <span class="readonly-hint">
                <Icon name="ph:lock-key-bold" />
                {{ $t('settings.identity.immutable') }}
              </span>
            </div>

            <label class="field-row">
              <span class="field-label">
                {{ $t('settings.identity.displayName') }}
                <span class="field-hint">{{ $t('settings.identity.displayNameHint') }}</span>
              </span>
              <input
                v-model="form.displayName"
                type="text"
                maxlength="32"
                :placeholder="$t('settings.identity.displayNamePlaceholder')"
                class="input field-input"
              />
              <span class="char-counter" :class="overLimit('displayName', 32)">
                {{ form.displayName.length }} / 32
              </span>
            </label>

            <label class="field-row">
              <span class="field-label">
                {{ $t('settings.identity.bio') }}
                <span class="field-hint">{{ $t('settings.identity.bioHint') }}</span>
              </span>
              <textarea
                v-model="form.bio"
                maxlength="1000"
                rows="5"
                :placeholder="$t('settings.identity.bioPlaceholder')"
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
            <h2 class="section-title">{{ $t('settings.sections.privacy') }}</h2>
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
                  {{ $t('settings.privacy.showLastSeen') }}
                </p>
                <p class="toggle-sub">
                  {{ $t('settings.privacy.showLastSeenHint') }}
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
                <p class="toggle-title">{{ $t('settings.privacy.showAdultContent') }}</p>
                <p class="toggle-sub">
                  {{ $t('settings.privacy.showAdultContentHint') }}
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
            <!-- ── Theme picker ─────────────────────────────────── -->
            <div class="appearance-block">
              <div class="appearance-block-head">
                <span class="appearance-block-eyebrow">Mode</span>
                <h3 class="appearance-block-title">Theme</h3>
              </div>
              <p class="section-help">
                Theme follows you across devices — stored on your account and
                cached locally for a flicker-free first paint.
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

            <!-- ── Language picker ──────────────────────────────────
                 The active locale is saved on the user's account
                 (`users.language`) so the choice survives a logout,
                 a device swap, or a cookie flush. Switching here
                 hits PATCH /api/me which refreshes the session, and
                 the i18n-user.client plugin watches the session and
                 re-applies via `setLocale()`. The cookie used by
                 `detectBrowserLanguage` is overridden in the same
                 call so the next anonymous visit on this browser
                 doesn't drift back to the autodetected guess. -->
            <div class="appearance-block">
              <div class="appearance-block-head">
                <span class="appearance-block-eyebrow">Locale</span>
                <h3 class="appearance-block-title">{{ $t('common.language') }}</h3>
              </div>
              <p class="section-help">
                Saved on your account so the same UI language follows you
                across devices. New strings always fall back to English when
                a translation isn't ready yet.
              </p>
              <div class="lang-row">
                <button
                  v-for="l in languages"
                  :key="l.value"
                  type="button"
                  class="lang-btn"
                  :class="{
                    'lang-btn--active': languageMode === l.value,
                    'lang-btn--saving': languageSaving && pendingLanguage === l.value,
                  }"
                  :disabled="languageSaving"
                  :aria-pressed="languageMode === l.value"
                  @click="setLanguage(l.value)"
                >
                  <span class="lang-btn-code" aria-hidden="true">
                    <span class="lang-btn-bracket lang-btn-bracket--l">[</span>
                    {{ l.value.toUpperCase() }}
                    <span class="lang-btn-bracket lang-btn-bracket--r">]</span>
                  </span>
                  <span class="lang-btn-body">
                    <span class="lang-btn-label">
                      {{ l.native }}
                    </span>
                    <span class="lang-btn-sub">
                      <span class="lang-btn-region">{{ l.region }}</span>
                      <span
                        v-if="languageMode === l.value"
                        class="lang-btn-active-mark"
                        aria-hidden="true"
                      >
                        <Icon name="ph:check-bold" />
                        active
                      </span>
                    </span>
                  </span>
                </button>
              </div>
              <p
                v-if="languageError"
                class="lang-error"
                role="alert"
              >
                <Icon name="ph:warning-circle-bold" />
                {{ languageError }}
              </p>
            </div>
          </div>
        </section>

        <!-- 04 SECURITY -->
        <section id="security" class="form-section">
          <header class="section-head">
            <span class="section-number">04</span>
            <h2 class="section-title">{{ $t('settings.sections.security') }}</h2>
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
                  {{ $t('settings.security.changePassword') }}
                </h3>
                <p class="action-card-text">
                  {{ $t('settings.security.changePasswordHint') }}
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
                {{ passwordOpen ? $t('common.cancel') : $t('settings.security.changePassword') }}
              </button>
            </article>

            <Transition name="pwd-fade">
              <div v-if="passwordOpen" class="password-form">
                <label class="field-row">
                  <span class="field-label">{{ $t('settings.security.currentPassword') }}</span>
                  <input
                    v-model="pwd.current"
                    type="password"
                    autocomplete="current-password"
                    class="input field-input"
                    :placeholder="$t('settings.security.currentPasswordPlaceholder')"
                  />
                </label>
                <label class="field-row">
                  <span class="field-label">{{ $t('settings.security.newPassword') }}</span>
                  <input
                    v-model="pwd.next"
                    type="password"
                    autocomplete="new-password"
                    minlength="8"
                    class="input field-input"
                    :placeholder="$t('settings.security.newPasswordPlaceholder')"
                  />
                </label>
                <label class="field-row">
                  <span class="field-label">{{ $t('settings.security.confirmPassword') }}</span>
                  <input
                    v-model="pwd.confirm"
                    type="password"
                    autocomplete="new-password"
                    minlength="8"
                    class="input field-input"
                    :placeholder="$t('settings.security.confirmPasswordPlaceholder')"
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
                    {{ $t('common.cancel') }}
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
                    {{ pwdSubmitting ? $t('settings.security.updatingPassword') : $t('settings.security.updatePassword') }}
                  </button>
                </div>
                <p class="password-note">
                  <Icon name="ph:info-bold" />
                  {{ $t('settings.security.otherDevicesNote') }}
                </p>
              </div>
            </Transition>

            <article class="action-card">
              <div class="action-card-body">
                <h3 class="action-card-title">
                  <Icon name="ph:key-bold" />
                  {{ $t('settings.security.trackerPasskey') }}
                </h3>
                <p class="action-card-text">
                  {{ $t('settings.security.trackerPasskeyHint') }}
                </p>
              </div>
              <NuxtLink to="/me#01" class="btn-ghost">
                <Icon name="ph:arrow-up-right-bold" />
                {{ $t('settings.security.openProfile') }}
              </NuxtLink>
            </article>

            <article class="action-card">
              <div class="action-card-body">
                <h3 class="action-card-title">
                  <Icon name="ph:sign-out-bold" />
                  {{ $t('settings.security.signOutDevice') }}
                </h3>
                <p class="action-card-text">
                  {{ $t('settings.security.signOutDeviceHint') }}
                </p>
              </div>
              <button type="button" class="btn-ghost btn-ghost--danger" @click="signOut">
                <Icon name="ph:sign-out-bold" />
                {{ $t('settings.security.signOut') }}
              </button>
            </article>
          </div>
        </section>

        <!-- 05 NOTIFICATIONS -->
        <!--
          External notification destinations + per-type routing.
          Renders nothing if the admin hasn't enabled and tested any
          channel — the component's root `v-if` handles that
          gracefully so the section header just disappears.
        -->
        <section id="notifications" class="form-section">
          <header class="section-head">
            <span class="section-number">05</span>
            <h2 class="section-title">{{ $t('settings.sections.notifications') }}</h2>
            <span class="section-rule" />
          </header>
          <div class="section-body">
            <SettingsNotificationsSection />
          </div>
        </section>

        <!-- 06 ACCOUNT INFO -->
        <section id="account" class="form-section">
          <header class="section-head">
            <span class="section-number">06</span>
            <h2 class="section-title">{{ $t('settings.sections.accountInfo') }}</h2>
            <span class="section-rule" />
          </header>

          <div class="section-body">
            <dl class="info-grid">
              <div>
                <dt>{{ $t('settings.account.userId') }}</dt>
                <dd><code>{{ profile?.id }}</code></dd>
              </div>
              <div>
                <dt>{{ $t('settings.account.memberSince') }}</dt>
                <dd>{{ memberSince }}</dd>
              </div>
              <div>
                <dt>{{ $t('settings.account.role') }}</dt>
                <dd>{{ roleName }}</dd>
              </div>
              <div>
                <dt>{{ $t('settings.account.lastKnownIp') }}</dt>
                <dd>
                  <code v-if="profile?.lastIp">{{ profile.lastIp }}</code>
                  <span v-else class="info-dim">—</span>
                </dd>
              </div>
              <div>
                <dt>{{ $t('settings.account.invitesRemaining') }}</dt>
                <dd>{{ profile?.invitesRemaining ?? 0 }}</dd>
              </div>
              <div>
                <dt>{{ $t('settings.account.totalUploads') }}</dt>
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
          {{ $t('common.discard') }}
        </button>
        <span class="action-bar-status">
          <span v-if="saveError" class="action-error">
            <Icon name="ph:warning-circle-fill" />
            {{ saveError }}
          </span>
          <span v-else-if="dirtyCount === 0" class="action-hint">
            {{ $t('settings.upToDate') }}
          </span>
          <span v-else class="action-ready">
            <Icon name="ph:floppy-disk-bold" />
            {{ $t('settings.changesReady', dirtyCount, { n: dirtyCount }) }}
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
          {{ saving ? $t('settings.saving') : $t('common.saveChanges') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { generateLoginProof, generateCredentials } from '~/utils/crypto';
import TwoFactorSection from '~/components/security/TwoFactorSection.vue';

definePageMeta({ title: 'Settings' });

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
const { t, locale: i18nLocale, setLocale: setI18nLocale } = useI18n();
useHead({ title: () => t('settings.pageTitle') });
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
    notifications.success(t('settings.toasts.preferencesSaved'));
  } catch (err: any) {
    saveError.value =
      err?.data?.message || err?.message || t('settings.errors.savePreferences');
  } finally {
    saving.value = false;
  }
}

// ── Anchor nav ──────────────────────────────────────────────────
type SectionKey = 'identity' | 'privacy' | 'appearance' | 'security' | 'account';
const sections = computed<
  Array<{ key: SectionKey; num: string; label: string; icon: string }>
>(() => [
  { key: 'identity', num: '01', label: t('settings.sections.identity'), icon: 'ph:identification-card' },
  { key: 'privacy', num: '02', label: t('settings.sections.privacy'), icon: 'ph:eye-closed' },
  { key: 'appearance', num: '03', label: t('settings.sections.appearance'), icon: 'ph:palette' },
  { key: 'security', num: '04', label: t('settings.sections.security'), icon: 'ph:lock-key' },
  { key: 'notifications', num: '05', label: t('settings.sections.notifications'), icon: 'ph:bell-ringing' },
  { key: 'account', num: '06', label: t('settings.sections.accountInfo'), icon: 'ph:info' },
]);
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
        if (sections.value.some((s) => s.key === id)) activeSection.value = id;
      }
    }
  }, opts);
  for (const s of sections.value) {
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

// ── Language picker ─────────────────────────────────────────────
//
// `users.language` is the source of truth. The cards below mirror the
// theme picker visually but use a typographic `[XX]` badge instead of
// a colored dot to telegraph "language code" rather than "swatch".
// Switching:
//   1. optimistically update the in-memory locale + the i18n switcher
//      so the UI reacts before the network round-trips
//   2. PATCH /api/me with the new value
//   3. on failure, revert and surface the error
//
// `languageMode` is derived from the live i18n locale so the active
// state is correct even when the language was set elsewhere (e.g. by
// the `i18n-user.client` plugin reacting to a session refresh).
interface LanguageOption {
  value: 'en' | 'fr';
  native: string;
  region: string;
}
const languages: LanguageOption[] = [
  { value: 'en', native: 'English', region: 'English (US)' },
  { value: 'fr', native: 'Français', region: 'French (France)' },
];
// refreshSession is already destructured from useUserSession() near
// the top of the file; we reuse it after the language PATCH so the
// i18n-user.client plugin sees the updated `language` on the next
// session poll instead of fighting our optimistic switch.
const languageSaving = ref(false);
const pendingLanguage = ref<LanguageOption['value'] | null>(null);
const languageError = ref<string | null>(null);
const languageMode = computed<LanguageOption['value']>(() => {
  return (i18nLocale.value as LanguageOption['value']) ?? 'en';
});
async function setLanguage(value: LanguageOption['value']) {
  if (languageSaving.value) return;
  if (languageMode.value === value) return;
  const previous = languageMode.value;
  pendingLanguage.value = value;
  languageError.value = null;
  languageSaving.value = true;
  try {
    // 1) optimistic: paint the new language right away
    await setI18nLocale(value);
    // 2) persist to the user's account
    await $fetch('/api/me', {
      method: 'PATCH',
      body: { language: value },
    });
    // 3) refresh the cached session so the user object's `language`
    //    matches the DB on the next status poll, and the plugin
    //    watcher doesn't fight with whatever was just applied.
    await refreshSession();
  } catch (err: any) {
    // Revert the optimistic change so the active state matches what
    // actually got persisted.
    await setI18nLocale(previous);
    languageError.value =
      err?.data?.message ||
      err?.message ||
      'Could not save the language change. Please try again.';
  } finally {
    languageSaving.value = false;
    pendingLanguage.value = null;
  }
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
    pwdError.value = t('settings.security.errors.samePassword');
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

    notifications.success(t('settings.toasts.passwordUpdated'));
    closePassword();
  } catch (err: any) {
    pwdError.value =
      err?.data?.message || err?.message || t('settings.security.errors.updatePassword');
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
  if (p.isAdmin) return t('settings.account.roles.admin');
  if (p.isModerator) return t('settings.account.roles.moderator');
  return p.role?.name ?? t('settings.account.roles.member');
});

// ── Unsaved-change guard on navigation ──────────────────────────
onBeforeRouteLeave((_to, _from, next) => {
  if (dirtyCount.value === 0) return next();
  if (
    typeof window !== 'undefined' &&
    !confirm(t('settings.unsavedChangesPrompt'))
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

/* ─── Appearance blocks (theme + language as siblings) ──────── */
/* The Appearance section now hosts two pickers. We give each one
   its own header so the picker rhythm doesn't read as one giant
   undifferentiated grid. The first block has no top border; every
   subsequent one gets a hairline divider. */
.appearance-block + .appearance-block {
  margin-top: 1.6rem;
  padding-top: 1.4rem;
  border-top: 1px dashed rgb(var(--line-default) / 0.6);
}
.appearance-block-head {
  display: flex;
  align-items: baseline;
  gap: 0.65rem;
  margin: 0 0 0.55rem;
}
.appearance-block-eyebrow {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  padding: 0.15rem 0.45rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.3rem;
}
.appearance-block-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: rgb(var(--fg-strong));
}

/* ─── Language picker ───────────────────────────────────────── */
/* Same grid as `.theme-row` so the two cards line up vertically
   when stacked. We keep the lang-row class distinct so future
   evolution of either picker doesn't drag the other along. */
.lang-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.6rem;
  margin-top: 0.4rem;
}
@media (max-width: 640px) {
  .lang-row {
    grid-template-columns: 1fr;
  }
}
.lang-btn {
  display: flex;
  align-items: stretch;
  gap: 0.85rem;
  padding: 0.85rem 1rem;
  border-radius: 0.5rem;
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-secondary));
  color: rgb(var(--fg-default));
  text-align: left;
  cursor: pointer;
  transition:
    background 0.18s,
    border-color 0.18s,
    box-shadow 0.18s,
    transform 0.12s;
  position: relative;
  overflow: hidden;
}
.lang-btn::before {
  /* Faint vertical rule between the typographic badge and the
     body text. Reads as a structural divider rather than a
     decorative line. */
  content: '';
  position: absolute;
  top: 0.85rem;
  bottom: 0.85rem;
  left: calc(0.85rem + 2.6rem);
  width: 1px;
  background: rgb(var(--line-default));
  transition: background 0.18s;
}
.lang-btn:hover {
  border-color: rgb(var(--fg-default) / 0.3);
  transform: translateY(-1px);
}
.lang-btn:active {
  transform: translateY(0);
}
.lang-btn:focus-visible {
  outline: none;
  box-shadow:
    0 0 0 2px rgb(var(--bg-primary)),
    0 0 0 3px rgb(var(--fg-strong));
}
.lang-btn:disabled {
  cursor: progress;
  opacity: 0.85;
}
.lang-btn--active {
  border-color: rgb(var(--fg-strong));
  background: rgb(var(--fg-strong) / 0.04);
  box-shadow: inset 0 0 0 1px rgb(var(--fg-strong));
}
.lang-btn--active::before {
  background: rgb(var(--fg-strong) / 0.4);
}
.lang-btn--saving {
  /* Subtle progress shimmer along the top edge while the PATCH
     is in flight. CSS-only; no JS timer to clean up. */
  background-image: linear-gradient(
    90deg,
    transparent 0%,
    rgb(var(--fg-strong) / 0.08) 50%,
    transparent 100%
  );
  background-size: 200% 2px;
  background-repeat: no-repeat;
  background-position: -100% 0;
  animation: lang-shimmer 1s linear infinite;
}
@keyframes lang-shimmer {
  to {
    background-position: 200% 0;
  }
}

/* The typographic badge — a mono `[EN]` / `[FR]` set in a tall
   reserved column. The brackets are subtle and tracked open to
   feel like a label in an editorial table-of-contents, not a
   button affordance. */
.lang-btn-code {
  flex-shrink: 0;
  width: 2.6rem;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: rgb(var(--fg-default));
  transition: color 0.18s;
}
.lang-btn--active .lang-btn-code {
  color: rgb(var(--fg-strong));
}
.lang-btn-bracket {
  font-weight: 400;
  color: rgb(var(--fg-muted));
  margin: 0 0.08rem;
  transition: color 0.18s;
}
.lang-btn--active .lang-btn-bracket {
  color: rgb(var(--fg-strong));
}
.lang-btn-bracket--l {
  margin-right: 0.18rem;
}
.lang-btn-bracket--r {
  margin-left: 0.18rem;
}

.lang-btn-body {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0.18rem;
  min-width: 0;
  padding-left: 0.05rem;
}
.lang-btn-label {
  font-size: 0.92rem;
  font-weight: 700;
  letter-spacing: 0.005em;
  color: rgb(var(--fg-strong));
}
.lang-btn-sub {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  letter-spacing: 0.04em;
  color: rgb(var(--fg-muted));
}
.lang-btn-region {
  text-transform: uppercase;
}
.lang-btn-active-mark {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  padding: 0.05rem 0.35rem;
  border: 1px solid rgb(var(--fg-strong) / 0.4);
  border-radius: 0.25rem;
  color: rgb(var(--fg-strong));
  font-size: 9px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.lang-error {
  margin-top: 0.6rem;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.78rem;
  color: rgb(220, 50, 47);
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
