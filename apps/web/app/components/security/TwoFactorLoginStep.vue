<template>
  <!-- Renders right after the SRP step succeeds. The user picks how
       they want to prove possession of their second factor — TOTP /
       passkey / recovery — and the corresponding panel takes over.
       On success, emits `verified` so the parent can refresh the
       session and redirect. -->
  <div class="step">
    <p class="step-eyebrow">
      <Icon name="ph:shield-check-bold" class="step-eyebrow-icon" />
      {{ $t('security.twoFactorLogin.eyebrow') }}
    </p>
    <p class="step-blurb">
      {{ $t('security.twoFactorLogin.blurb') }}
    </p>

    <div class="step-tabs" role="tablist">
      <button
        v-for="m in methods"
        :key="m"
        type="button"
        role="tab"
        :aria-selected="active === m"
        class="step-tab"
        :class="{ 'step-tab--on': active === m }"
        @click="active = m"
      >
        <Icon :name="iconFor(m)" />
        {{ labelFor(m) }}
      </button>
    </div>

    <!-- TOTP panel ----------------------------------------------- -->
    <div v-if="active === 'totp'" class="step-panel">
      <label class="step-label">{{ $t('security.twoFactorLogin.totpLabel') }}</label>
      <input
        v-model="totpCode"
        inputmode="numeric"
        maxlength="6"
        autocomplete="one-time-code"
        class="step-code-input"
        placeholder="123 456"
        @keydown.enter="submitTotp"
      />
    </div>

    <!-- Recovery panel ------------------------------------------- -->
    <div v-else-if="active === 'recovery'" class="step-panel">
      <label class="step-label">{{ $t('security.twoFactorLogin.recoveryLabel') }}</label>
      <input
        v-model="recoveryCode"
        class="step-input"
        placeholder="XXXX-XXXXXX"
        @keydown.enter="submitTotp"
      />
      <p class="step-hint">
        <Icon name="ph:info-bold" />
        {{ $t('security.twoFactorLogin.recoveryHint') }}
      </p>
    </div>

    <!-- Passkey panel -------------------------------------------- -->
    <div v-else-if="active === 'passkey'" class="step-panel">
      <p class="step-hint step-hint--center">
        <Icon name="ph:fingerprint-simple-bold" class="step-icon-lg" />
        <span>
          {{ $t('security.twoFactorLogin.passkeyHintPrefix') }}
          <strong>{{ $t('security.twoFactorLogin.passkeyHintAction') }}</strong>{{ $t('security.twoFactorLogin.passkeyHintSuffix') }}
        </span>
      </p>
    </div>

    <p v-if="error" class="step-error">
      <Icon name="ph:warning-circle-fill" />
      {{ error }}
    </p>

    <div class="step-actions">
      <button class="btn-ghost" type="button" @click="$emit('cancel')">
        {{ $t('common.cancel') }}
      </button>
      <button
        v-if="active !== 'passkey'"
        class="btn-primary"
        type="button"
        :disabled="!canSubmit || submitting"
        @click="submitTotp"
      >
        <Icon
          v-if="submitting"
          name="ph:circle-notch"
          class="animate-spin"
        />
        {{ submitting ? $t('security.twoFactorLogin.verifying') : $t('security.twoFactorLogin.verify') }}
      </button>
      <button
        v-else
        class="btn-primary"
        type="button"
        :disabled="submitting"
        @click="submitPasskey"
      >
        <Icon
          v-if="submitting"
          name="ph:circle-notch"
          class="animate-spin"
        />
        {{ submitting ? $t('security.twoFactorLogin.awaitingPasskey') : $t('security.twoFactorLogin.authenticate') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  startAuthentication,
  type AuthenticationResponseJSON,
} from '@simplewebauthn/browser';

type Method = 'totp' | 'recovery' | 'passkey';

const props = defineProps<{
  challengeToken: string;
  methods: Method[];
}>();
const emit = defineEmits<{
  verified: [];
  cancel: [];
}>();

const { t } = useI18n();

const active = ref<Method>(props.methods[0] ?? 'totp');
const totpCode = ref('');
const recoveryCode = ref('');
const submitting = ref(false);
const error = ref('');

const canSubmit = computed(() => {
  if (active.value === 'totp') return /^\d{6}$/.test(totpCode.value);
  if (active.value === 'recovery')
    return /^[a-z2-9]{4}-?[a-z2-9]{6}$/i.test(recoveryCode.value);
  return false;
});

function iconFor(m: Method): string {
  if (m === 'totp') return 'ph:device-mobile-camera-bold';
  if (m === 'recovery') return 'ph:lifebuoy-bold';
  return 'ph:fingerprint-simple-bold';
}
function labelFor(m: Method): string {
  if (m === 'totp') return t('security.twoFactorLogin.tabs.totp');
  if (m === 'recovery') return t('security.twoFactorLogin.tabs.recovery');
  return t('security.twoFactorLogin.tabs.passkey');
}

async function submitTotp() {
  if (!canSubmit.value || submitting.value) return;
  error.value = '';
  submitting.value = true;
  try {
    await $fetch('/api/auth/2fa/verify-totp', {
      method: 'POST',
      body: {
        challengeToken: props.challengeToken,
        ...(active.value === 'totp'
          ? { code: totpCode.value }
          : { recoveryCode: recoveryCode.value }),
      },
    });
    emit('verified');
  } catch (e: any) {
    error.value =
      e?.data?.message ||
      (active.value === 'recovery'
        ? t('security.twoFactorLogin.errors.invalidRecovery')
        : t('security.twoFactorLogin.errors.invalidCode'));
  } finally {
    submitting.value = false;
  }
}

async function submitPasskey() {
  if (submitting.value) return;
  error.value = '';
  submitting.value = true;
  try {
    const options = await $fetch('/api/auth/2fa/passkey-options', {
      method: 'POST',
      body: { challengeToken: props.challengeToken },
    });
    let assertion: AuthenticationResponseJSON;
    try {
      assertion = await startAuthentication({ optionsJSON: options as any });
    } catch (err: any) {
      throw new Error(err?.message || t('security.twoFactorLogin.errors.browserCancelled'));
    }
    await $fetch('/api/auth/2fa/passkey-verify', {
      method: 'POST',
      body: {
        challengeToken: props.challengeToken,
        response: assertion,
      },
    });
    emit('verified');
  } catch (e: any) {
    error.value =
      e?.message ||
      e?.data?.message ||
      t('security.twoFactorLogin.errors.passkeyFailed');
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
.step {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
.step-eyebrow {
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.step-eyebrow-icon {
  color: rgb(var(--fg-strong));
}
.step-blurb {
  margin: 0;
  font-size: 13px;
  color: rgb(var(--fg-muted));
}

.step-tabs {
  display: inline-flex;
  border: 1px solid rgb(var(--line-default));
  border-radius: 4px;
  background: rgb(var(--bg-surface));
  padding: 3px;
  align-self: flex-start;
}
.step-tab {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.85rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  background: transparent;
  border: 0;
  border-radius: 3px;
  color: rgb(var(--fg-muted));
  cursor: pointer;
  transition: all 0.14s;
}
.step-tab:hover {
  color: rgb(var(--fg-strong));
}
.step-tab--on {
  background: rgb(var(--fg-strong));
  color: rgb(var(--accent-fg));
}
.step-tab--on:hover {
  color: rgb(var(--accent-fg));
}

.step-panel {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.step-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--fg-subtle));
}
.step-input,
.step-code-input {
  width: 100%;
  padding: 0.55rem 0.75rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 4px;
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-default));
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}
.step-code-input {
  font-size: 1.6rem;
  font-weight: 700;
  letter-spacing: 0.4em;
  text-align: center;
  padding: 0.6rem;
}
.step-input:focus,
.step-code-input:focus {
  outline: none;
  border-color: rgb(var(--fg-default));
}
.step-hint {
  margin: 0;
  font-size: 11.5px;
  color: rgb(var(--fg-muted));
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  line-height: 1.55;
}
.step-hint--center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  text-align: center;
  padding: 1rem 0.5rem 0.25rem;
  color: rgb(var(--fg-default));
}
.step-icon-lg {
  font-size: 2rem;
  color: rgb(var(--fg-strong));
}

.step-error {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 12px;
  color: rgb(var(--danger));
  margin: 0;
}

.step-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.btn-primary,
.btn-ghost {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.55rem 1rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  border: 1px solid rgb(var(--line-default));
  border-radius: 2px;
  cursor: pointer;
  transition: all 0.14s;
}
.btn-primary {
  background: rgb(var(--accent));
  color: rgb(var(--accent-fg));
  border-color: rgb(var(--accent));
}
.btn-primary:hover:not(:disabled) {
  background: rgb(var(--accent-hover));
}
.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-ghost {
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-muted));
}
.btn-ghost:hover {
  color: rgb(var(--fg-strong));
}
</style>
