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

            <!--
              The three account-level privacy toggles. Each one gates a
              server read path, so the switch here is a statement of
              intent, not the enforcement: see utils/uploaderVisibility.ts
              and utils/commentPolicy.ts on the API side.
            -->
            <label
              class="toggle-row"
              :class="{ 'toggle-row--on': form.anonymousUploads }"
            >
              <button
                type="button"
                role="switch"
                :aria-checked="form.anonymousUploads"
                class="toggle"
                :class="{ 'toggle--on': form.anonymousUploads }"
                @click="form.anonymousUploads = !form.anonymousUploads"
              >
                <span class="toggle-knob" />
              </button>
              <div class="toggle-body">
                <p class="toggle-title">
                  {{ $t('settings.privacy.anonymousUploads') }}
                </p>
                <p class="toggle-sub">
                  {{ $t('settings.privacy.anonymousUploadsHint') }}
                </p>
              </div>
            </label>

            <label
              class="toggle-row"
              :class="{ 'toggle-row--on': form.hideDownloadHistory }"
            >
              <button
                type="button"
                role="switch"
                :aria-checked="form.hideDownloadHistory"
                class="toggle"
                :class="{ 'toggle--on': form.hideDownloadHistory }"
                @click="form.hideDownloadHistory = !form.hideDownloadHistory"
              >
                <span class="toggle-knob" />
              </button>
              <div class="toggle-body">
                <p class="toggle-title">
                  {{ $t('settings.privacy.hideDownloadHistory') }}
                </p>
                <p class="toggle-sub">
                  {{ $t('settings.privacy.hideDownloadHistoryHint') }}
                </p>
              </div>
            </label>

            <label
              class="toggle-row"
              :class="{ 'toggle-row--on': form.restrictComments }"
            >
              <button
                type="button"
                role="switch"
                :aria-checked="form.restrictComments"
                class="toggle"
                :class="{ 'toggle--on': form.restrictComments }"
                @click="form.restrictComments = !form.restrictComments"
              >
                <span class="toggle-knob" />
              </button>
              <div class="toggle-body">
                <p class="toggle-title">
                  {{ $t('settings.privacy.restrictComments') }}
                </p>
                <p class="toggle-sub">
                  {{ $t('settings.privacy.restrictCommentsHint') }}
                </p>
              </div>
            </label>

            <label
              class="toggle-row"
              :class="{ 'toggle-row--on': form.shareReputationFederated }"
            >
              <button
                type="button"
                role="switch"
                :aria-checked="form.shareReputationFederated"
                class="toggle"
                :class="{ 'toggle--on': form.shareReputationFederated }"
                @click="form.shareReputationFederated = !form.shareReputationFederated"
              >
                <span class="toggle-knob" />
              </button>
              <div class="toggle-body">
                <p class="toggle-title">
                  {{ $t('settings.privacy.shareReputationFederated') }}
                </p>
                <p class="toggle-sub">
                  {{ $t('settings.privacy.shareReputationFederatedHint') }}
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
                  :key="t.value ?? '__default'"
                  type="button"
                  class="theme-btn"
                  :class="{ 'theme-btn--active': themeChoice === t.value }"
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

            <!-- Filed under security rather than under identity on purpose:
                 the action hands over a private key, and that is what the
                 member needs to have in mind while doing it. -->
            <SettingsPortableIdentity />
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

        <!-- 07 LISTING TEMPLATES
             A pointer, not a panel: the editor is a two-pane modal that
             needs the full viewport width, so it lives on its own route
             and this section only carries the doorway. -->
        <section id="templates" class="form-section">
          <header class="section-head">
            <span class="section-number">07</span>
            <h2 class="section-title">{{ $t('settings.sections.templates') }}</h2>
            <span class="section-rule" />
          </header>

          <div class="section-body">
            <p class="templates-blurb">{{ $t('settings.templates.blurb') }}</p>
            <NuxtLink to="/templates" class="btn btn-secondary btn-sm templates-link">
              <Icon name="ph:brackets-curly" />
              {{ $t('settings.templates.manage') }}
              <Icon name="ph:arrow-right" class="text-xs" />
            </NuxtLink>
          </div>
        </section>

        <!-- Danger zone — irreversible self-service account erasure. Kept last
             and visually apart so it is never a mis-click away from a save. -->
        <section id="danger" class="form-section">
          <header class="section-head">
            <span class="section-number section-number--danger">!</span>
            <h2 class="section-title">{{ $t('settings.sections.danger') }}</h2>
            <span class="section-rule" />
          </header>

          <div class="section-body">
            <div class="danger-card">
              <div class="danger-copy">
                <h3 class="danger-title">
                  <Icon name="ph:warning-octagon-bold" />
                  {{ $t('settings.danger.deleteTitle') }}
                </h3>
                <p class="danger-text">{{ $t('settings.danger.deleteBody') }}</p>
              </div>

              <label class="danger-field">
                <span class="field-label">
                  {{ $t('settings.danger.confirmLabel', { username: form.username }) }}
                </span>
                <input
                  v-model="deleteConfirm"
                  class="danger-input"
                  :placeholder="form.username"
                  autocomplete="off"
                  spellcheck="false"
                />
              </label>

              <p v-if="deleteError" class="danger-error">
                <Icon name="ph:warning-circle-fill" /> {{ deleteError }}
              </p>

              <button
                type="button"
                class="danger-btn"
                :disabled="deleting || deleteConfirm !== form.username"
                @click="deleteAccount"
              >
                <Icon
                  :name="deleting ? 'ph:circle-notch' : 'ph:trash-bold'"
                  :class="{ 'animate-spin': deleting }"
                />
                {{ deleting ? $t('settings.danger.deleting') : $t('settings.danger.deleteButton') }}
              </button>
            </div>
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
  anonymousUploads: boolean;
  hideDownloadHistory: boolean;
  restrictComments: boolean;
  shareReputationFederated: boolean;
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
// The project ships its own useColorMode (apps/web/app/composables/
// useColorMode.ts). It is no longer light/dark: a theme is `system`, a built-in,
// or an admin theme's slug, persisted on the account and cached in a cookie so
// SSR can render `data-theme` without a correcting script. `apply()` sets it and
// `mode` (a readonly ref) is the active value.
// `choice` rather than `mode`: the picker has to show WHICH ENTRY the member
// selected, and `mode` is the resolved value. A member on `Site default` when
// the default is Nocturne has `mode === 'nocturne'` and `choice === null` — the
// highlight belongs on `Site default`, not on Nocturne.
const { choice: themeChoice, apply: applyTheme } = useColorMode();

// ── Profile fetch ───────────────────────────────────────────────
const { data: profile, refresh: refreshProfile } = await useFetch<MeProfile>(
  '/api/me',
  { default: () => null as unknown as MeProfile }
);
const loaded = computed(() => !!profile.value);

// The three account privacy toggles behave identically — read, diff and
// send — so they are driven off one list rather than three copies of the
// same four lines. Adding a fourth toggle means adding it here and in the
// template, not hunting for every place a boolean was spelled out.
const PRIVACY_TOGGLES = [
  'anonymousUploads',
  'hideDownloadHistory',
  'restrictComments',
] as const;

// ── Form state (Identity + Privacy) ─────────────────────────────
const form = reactive({
  username: '',
  displayName: '',
  bio: '',
  showLastSeen: true,
  showAdultContent: false,
  anonymousUploads: false,
  hideDownloadHistory: false,
  restrictComments: false,
  shareReputationFederated: false,
});
const snapshot = ref<{
  displayName: string;
  bio: string;
  showLastSeen: boolean;
  showAdultContent: boolean;
  anonymousUploads: boolean;
  hideDownloadHistory: boolean;
  restrictComments: boolean;
  shareReputationFederated: boolean;
} | null>(null);

function hydrate() {
  if (!profile.value) return;
  form.username = profile.value.username;
  form.displayName = profile.value.displayName ?? '';
  form.bio = profile.value.bio ?? '';
  form.showLastSeen = profile.value.showLastSeen;
  form.showAdultContent = profile.value.showAdultContent ?? false;
  form.anonymousUploads = profile.value.anonymousUploads ?? false;
  form.hideDownloadHistory = profile.value.hideDownloadHistory ?? false;
  form.restrictComments = profile.value.restrictComments ?? false;
  form.shareReputationFederated = profile.value.shareReputationFederated ?? false;
  snapshot.value = {
    displayName: form.displayName,
    bio: form.bio,
    showLastSeen: form.showLastSeen,
    showAdultContent: form.showAdultContent,
    anonymousUploads: form.anonymousUploads,
    hideDownloadHistory: form.hideDownloadHistory,
    restrictComments: form.restrictComments,
    shareReputationFederated: form.shareReputationFederated,
    shareReputationFederated: form.shareReputationFederated,
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
  for (const k of PRIVACY_TOGGLES) if (s[k] !== form[k]) n++;
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
    for (const k of PRIVACY_TOGGLES) if (s[k] !== form[k]) payload[k] = form[k];

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
type SectionKey =
  | 'identity'
  | 'privacy'
  | 'appearance'
  | 'security'
  | 'notifications'
  | 'account'
  | 'templates';
const sections = computed<
  Array<{ key: SectionKey; num: string; label: string; icon: string }>
>(() => [
  { key: 'identity', num: '01', label: t('settings.sections.identity'), icon: 'ph:identification-card' },
  { key: 'privacy', num: '02', label: t('settings.sections.privacy'), icon: 'ph:eye-closed' },
  { key: 'appearance', num: '03', label: t('settings.sections.appearance'), icon: 'ph:palette' },
  { key: 'security', num: '04', label: t('settings.sections.security'), icon: 'ph:lock-key' },
  { key: 'notifications', num: '05', label: t('settings.sections.notifications'), icon: 'ph:bell-ringing' },
  { key: 'account', num: '06', label: t('settings.sections.accountInfo'), icon: 'ph:info' },
  { key: 'templates', num: '07', label: t('settings.sections.templates'), icon: 'ph:brackets-curly' },
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
//
// The list is no longer two literals: it is System, the two built-ins, and every
// theme an admin has enabled and this member is entitled to.
//
// The swatch used to be a hardcoded hex per option. It is now the theme's own
// `--accent` read from the served stylesheet — which is both accurate and the
// only version that can work, since an admin theme's colours are not known to
// this file. Reading it means asking the browser to resolve a custom property in
// a scope other than the current one, so an off-screen element carries the
// theme's attribute and `getComputedStyle` answers for it.
interface ThemeOption {
  /** `null` is the `Site default` entry — "follow whatever the owner picked". */
  value: string | null;
  label: string;
  sub: string;
  icon: string;
  dot: string;
}

const branding = await useBranding();

/** `--accent` as the given theme would resolve it, or a neutral fallback. */
function swatchFor(slug: string): string {
  if (!import.meta.client) return 'transparent';
  const probe = document.createElement('div');
  probe.setAttribute('data-theme', slug);
  // `display:none` would work for custom properties but not for anything that
  // needs layout, and `visibility:hidden` keeps the element resolvable while
  // costing nothing visible.
  probe.style.cssText =
    'position:absolute;left:-9999px;visibility:hidden;pointer-events:none';
  document.documentElement.appendChild(probe);
  const accent = getComputedStyle(probe).getPropertyValue('--accent').trim();
  probe.remove();
  return accent ? `rgb(${accent})` : 'transparent';
}

const themes = computed<ThemeOption[]>(() => {
  const custom = (branding.value?.themes ?? []).filter(
    (t) => !['light', 'dark'].includes(t.slug),
  );
  const defaultName =
    [...(branding.value?.themes ?? []), { slug: 'light', name: 'Light' }, { slug: 'dark', name: 'Dark' }]
      .find((t) => t.slug === branding.value?.themeDefault)?.name ??
    (branding.value?.themeDefault === 'system' ? 'System' : branding.value?.themeDefault);

  return [
    {
      // The only entry whose value is `null`, and the only one that keeps
      // moving: a member on it follows the owner's default whenever it changes.
      // Everything below is a choice, and a change of default leaves it alone.
      value: null,
      label: 'Site default',
      sub: defaultName ? `Currently ${defaultName}` : 'Whatever the owner picks',
      icon: 'ph:buildings-bold',
      dot: swatchFor(branding.value?.themeDefault ?? 'dark'),
    },
    {
      value: 'system',
      label: 'System',
      sub: 'Follows your operating system',
      icon: 'ph:circle-half-bold',
      dot: 'transparent',
    },
    {
      value: 'light',
      label: 'Light',
      sub: 'Day-friendly tones',
      icon: 'ph:sun-bold',
      dot: swatchFor('light'),
    },
    {
      value: 'dark',
      label: 'Dark',
      sub: 'Editorial midnight',
      icon: 'ph:moon-stars-bold',
      dot: swatchFor('dark'),
    },
    ...custom.map((t) => ({
      value: t.slug,
      label: t.name,
      sub: t.base === 'light' ? 'Light-based' : 'Dark-based',
      icon: 'ph:palette-bold',
      dot: swatchFor(t.slug),
    })),
  ];
});

function setTheme(value: string | null) {
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

// ── Delete account (GDPR erasure) ───────────────────────────────
// Typing the exact username arms the button; the server re-checks it and also
// demands a fresh login. On success the account is already refused everywhere,
// so we just drop the local session and leave.
const deleteConfirm = ref('');
const deleting = ref(false);
const deleteError = ref('');
async function deleteAccount() {
  if (deleteConfirm.value !== form.username) return;
  deleting.value = true;
  deleteError.value = '';
  try {
    await $fetch('/api/me', {
      method: 'DELETE',
      body: { confirm: deleteConfirm.value },
    });
    await clearSession();
    router.push('/auth/login');
  } catch (err: unknown) {
    const e = err as { statusCode?: number; data?: { message?: string; data?: { reauthRequired?: boolean } }; message?: string };
    if (e?.data?.data?.reauthRequired || e?.statusCode === 401) {
      deleteError.value = t('settings.danger.reauthRequired');
    } else {
      deleteError.value = e?.data?.message || e?.message || t('settings.danger.error');
    }
  } finally {
    deleting.value = false;
  }
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
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: calc(0.18em * var(--tracking-scale));
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  margin-bottom: 1.25rem;
  transition: color var(--dur-2);
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
  font-family: var(--font-mono);
  font-size: 0.625rem;
  letter-spacing: calc(0.22em * var(--tracking-scale));
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  margin: 0 0 0.4rem;
}
.page-title {
  font-size: clamp(2rem, 4vw, 3rem);
  font-weight: 900;
  letter-spacing: calc(-0.025em * var(--tracking-scale));
  text-transform: uppercase;
  margin: 0;
  line-height: 1;
}
.page-title-accent {
  color: rgb(var(--fg-muted));
  font-weight: 400;
  font-style: italic;
  letter-spacing: calc(-0.01em * var(--tracking-scale));
}

.ready-state {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.85rem;
  border-radius: var(--radius-pill);
  border: 1px solid;
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: calc(0.16em * var(--tracking-scale));
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
  background: rgb(var(--bg-surface));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-lg);
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
  border-radius: var(--radius-md);
  text-decoration: none;
  color: rgb(var(--fg-muted));
  transition: all var(--dur-2);
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
  font-family: var(--font-mono);
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: calc(0.1em * var(--tracking-scale));
  padding: 0.1rem 0.3rem;
  border-radius: var(--radius-xs);
  border: 1px solid currentColor;
  opacity: 0.7;
}
.settings-nav-label {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: calc(0.12em * var(--tracking-scale));
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
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: calc(0.1em * var(--tracking-scale));
  color: rgb(var(--fg-muted));
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  padding: 0.2rem 0.5rem;
}
.section-title {
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: calc(0.22em * var(--tracking-scale));
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
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: calc(0.16em * var(--tracking-scale));
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  display: inline-flex;
  align-items: baseline;
  gap: 0.5rem;
}
.field-hint {
  font-family: var(--font-mono);
  font-size: 0.5625rem;
  letter-spacing: calc(0.06em * var(--tracking-scale));
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
  font-family: var(--font-mono);
  line-height: 1.55;
}
.char-counter {
  position: absolute;
  right: 0.4rem;
  bottom: -1.25rem;
  font-family: var(--font-mono);
  font-size: 0.625rem;
  letter-spacing: calc(0.06em * var(--tracking-scale));
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
  border-radius: var(--radius-md);
}
.readonly-value {
  flex: 1;
  font-family: var(--font-mono);
  font-size: 0.85rem;
  font-weight: 700;
  color: rgb(var(--fg-strong));
}
.readonly-hint {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: calc(0.14em * var(--tracking-scale));
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}

/* ─── Toggle ────────────────────────────────────────────────── */
.toggle-row {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  padding: 0.95rem 1.1rem;
  background: rgb(var(--bg-surface));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: border-color var(--dur-2);
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
  border-radius: var(--radius-pill);
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-elevated));
  cursor: pointer;
  transition: all var(--dur-3) ease;
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
  border-radius: var(--radius-pill);
  background: rgb(var(--fg-strong));
  transition: transform var(--dur-3) cubic-bezier(0.5, 0, 0.2, 1);
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
  letter-spacing: calc(0.01em * var(--tracking-scale));
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
  border-radius: var(--radius-lg);
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-surface));
  color: rgb(var(--fg-default));
  text-align: left;
  cursor: pointer;
  transition: all var(--dur-2);
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
  border-radius: var(--radius-pill);
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
  letter-spacing: calc(0.06em * var(--tracking-scale));
  color: rgb(var(--fg-strong));
}
.theme-btn-sub {
  font-family: var(--font-mono);
  font-size: 0.625rem;
  color: rgb(var(--fg-muted));
  letter-spacing: calc(0.04em * var(--tracking-scale));
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
  font-family: var(--font-mono);
  font-size: 0.5625rem;
  letter-spacing: calc(0.18em * var(--tracking-scale));
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  padding: 0.15rem 0.45rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
}
.appearance-block-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: calc(0.01em * var(--tracking-scale));
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
  border-radius: var(--radius-lg);
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-surface));
  color: rgb(var(--fg-default));
  text-align: left;
  cursor: pointer;
  transition:
    background var(--dur-3),
    border-color var(--dur-3),
    box-shadow var(--dur-3),
    transform var(--dur-1);
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
  transition: background var(--dur-3);
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
    0 0 0 2px rgb(var(--bg-base)),
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
  animation: lang-shimmer calc(1s * var(--motion-scale)) linear infinite;
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
  font-family: var(--font-mono);
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: calc(0.06em * var(--tracking-scale));
  color: rgb(var(--fg-default));
  transition: color var(--dur-3);
}
.lang-btn--active .lang-btn-code {
  color: rgb(var(--fg-strong));
}
.lang-btn-bracket {
  font-weight: 400;
  color: rgb(var(--fg-muted));
  margin: 0 0.08rem;
  transition: color var(--dur-3);
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
  letter-spacing: calc(0.005em * var(--tracking-scale));
  color: rgb(var(--fg-strong));
}
.lang-btn-sub {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  font-family: var(--font-mono);
  font-size: 0.625rem;
  letter-spacing: calc(0.04em * var(--tracking-scale));
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
  border-radius: var(--radius-sm);
  color: rgb(var(--fg-strong));
  font-size: 0.5625rem;
  letter-spacing: calc(0.12em * var(--tracking-scale));
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
  background: rgb(var(--bg-surface));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-lg);
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
  background: rgb(var(--bg-surface));
  border: 1px dashed rgb(var(--line-default));
  border-radius: var(--radius-lg);
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
  border-radius: var(--radius-pill);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: calc(0.16em * var(--tracking-scale));
  text-transform: uppercase;
  border: 1px solid;
  transition: all var(--dur-2);
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
  border-radius: var(--radius-md);
}
.info-grid dt {
  font-family: var(--font-mono);
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: calc(0.16em * var(--tracking-scale));
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
  font-family: var(--font-mono);
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0;
  color: rgb(var(--fg-default));
}
.info-dim {
  color: rgb(var(--fg-muted));
  opacity: 0.6;
}

/* ─── Listing templates doorway ───────────────────────────── */
.templates-blurb {
  margin: 0 0 1rem;
  max-width: 60ch;
  font-size: 0.8125rem;
  line-height: 1.6;
  color: rgb(var(--fg-muted));
}
.templates-link {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
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
  transition: transform var(--dur-slow) ease, opacity var(--dur-slow) ease;
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
  font-size: 0.6875rem;
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
  transition: opacity var(--dur-3) ease, transform var(--dur-3) ease;
}
.pwd-fade-enter-from,
.pwd-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

/* Danger zone — account erasure */
.section-number--danger {
  color: rgb(var(--danger));
  border-color: rgb(var(--danger) / 0.4);
  background: rgb(var(--danger) / 0.08);
}
.danger-card {
  border: 1px solid rgb(var(--danger) / 0.35);
  border-radius: var(--radius-xl);
  background: rgb(var(--danger) / 0.04);
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-width: 640px;
}
.danger-title {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.95rem;
  font-weight: 700;
  color: rgb(var(--danger));
}
.danger-text {
  color: rgb(var(--fg-muted));
  font-size: 0.85rem;
  line-height: 1.5;
  margin-top: 0.35rem;
}
.danger-field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.danger-input {
  padding: 0.55rem 0.7rem;
  border: 1px solid rgb(var(--danger) / 0.4);
  border-radius: var(--radius-lg);
  background: rgb(var(--bg-inset) / 0.6);
  color: rgb(var(--fg-default));
  font-size: 0.9rem;
  font-family: var(--font-mono);
}
.danger-input:focus {
  outline: none;
  border-color: rgb(var(--danger));
}
.danger-error {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  color: rgb(var(--danger));
  font-size: 0.82rem;
}
.danger-btn {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.55rem 1rem;
  border: 1px solid rgb(var(--danger) / 0.6);
  border-radius: var(--radius-lg);
  background: rgb(var(--danger) / 0.12);
  color: rgb(var(--danger));
  font-weight: 600;
  font-size: 0.85rem;
  cursor: pointer;
  transition: all var(--dur-2) ease;
}
.danger-btn:hover:not(:disabled) {
  background: rgb(var(--danger) / 0.2);
  border-color: rgb(var(--danger));
}
.danger-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
