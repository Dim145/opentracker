<template>
  <div class="tfa">
    <div class="tfa-eyebrow">
      <Icon name="ph:shield-check-bold" class="tfa-eyebrow-icon" />
      <span>{{ $t('settings.security.twoFactor') }}</span>
      <span
        v-if="status"
        class="tfa-summary"
        :class="{ 'tfa-summary--on': status.totpEnabled || status.passkeys.length > 0 }"
      >
        <span v-if="status.totpEnabled">TOTP</span>
        <span v-if="status.passkeys.length > 0">
          {{ $t('security.twoFactor.passkeyCount', { n: status.passkeys.length }, status.passkeys.length) }}
        </span>
        <span v-if="!status.totpEnabled && status.passkeys.length === 0">{{ $t('settings.security.off') }}</span>
      </span>
    </div>

    <p class="tfa-blurb">
      {{ $t('settings.security.twoFactorHint') }}
    </p>

    <!-- TOTP card --------------------------------------------------- -->
    <article class="tfa-card">
      <div class="tfa-card-head">
        <Icon name="ph:device-mobile-camera-bold" class="tfa-card-icon" />
        <div>
          <h4 class="tfa-card-title">{{ $t('settings.security.totpTitle') }}</h4>
          <p class="tfa-card-meta">
            <template v-if="status?.totpEnabled">
              {{ $t('security.twoFactor.totpEnabled') }}
              <span class="tfa-dot tfa-dot--on" />
              ·
              {{ $t('security.twoFactor.recoveryCodesLeft', { n: status.recoveryCodesRemaining }, status.recoveryCodesRemaining) }}
            </template>
            <template v-else>
              {{ $t('settings.security.totpNotConfigured') }}
              <span class="tfa-dot tfa-dot--off" />
            </template>
          </p>
        </div>
        <div class="tfa-card-actions">
          <button
            v-if="!status?.totpEnabled"
            type="button"
            class="btn-primary"
            @click="startTotpSetup"
          >
            <Icon name="ph:plus-bold" />
            {{ $t('settings.security.totpEnable') }}
          </button>
          <template v-else>
            <button
              type="button"
              class="btn-ghost"
              @click="regenOpen = true"
            >
              <Icon name="ph:arrows-clockwise-bold" />
              {{ $t('security.twoFactor.regenerateCodes') }}
            </button>
            <button
              type="button"
              class="btn-ghost btn-ghost--danger"
              @click="disableOpen = true"
            >
              <Icon name="ph:x-circle-bold" />
              {{ $t('security.twoFactor.disable') }}
            </button>
          </template>
        </div>
      </div>
    </article>

    <!-- Passkey card ------------------------------------------------ -->
    <article class="tfa-card">
      <div class="tfa-card-head">
        <Icon name="ph:fingerprint-simple-bold" class="tfa-card-icon" />
        <div>
          <h4 class="tfa-card-title">{{ $t('settings.security.passkeysTitle') }}</h4>
          <p class="tfa-card-meta">
            <template v-if="status && status.passkeys.length > 0">
              {{ $t('security.twoFactor.passkeysRegistered', { n: status.passkeys.length }, status.passkeys.length) }}
              <span class="tfa-dot tfa-dot--on" />
            </template>
            <template v-else>
              {{ $t('settings.security.noPasskeys') }}
              <span class="tfa-dot tfa-dot--off" />
            </template>
          </p>
        </div>
        <div class="tfa-card-actions">
          <button
            type="button"
            class="btn-primary"
            :disabled="passkeyAdding"
            @click="addPasskey"
          >
            <Icon
              :name="passkeyAdding ? 'ph:circle-notch' : 'ph:plus-bold'"
              :class="{ 'animate-spin': passkeyAdding }"
            />
            {{ $t('settings.security.addPasskey') }}
          </button>
        </div>
      </div>
      <ul v-if="status && status.passkeys.length > 0" class="tfa-passkey-list">
        <li
          v-for="pk in status.passkeys"
          :key="pk.id"
          class="tfa-passkey-row"
        >
          <span class="tfa-passkey-name">
            <Icon name="ph:key-bold" />
            {{ pk.name }}
          </span>
          <span class="tfa-passkey-meta">
            {{ $t('security.twoFactor.added', { age: formatAge(pk.createdAt) }) }}
            <template v-if="pk.lastUsedAt">
              · {{ $t('security.twoFactor.lastUsed', { age: formatAge(pk.lastUsedAt) }) }}
            </template>
          </span>
          <button
            type="button"
            class="btn-ghost btn-ghost--danger btn-ghost--sm"
            @click="removePasskey(pk.id)"
          >
            <Icon name="ph:trash-bold" />
            {{ $t('security.twoFactor.remove') }}
          </button>
        </li>
      </ul>
    </article>

    <!-- Trusted devices card --------------------------------------- -->
    <article class="tfa-card">
      <div class="tfa-card-head">
        <Icon name="ph:laptop-bold" class="tfa-card-icon" />
        <div>
          <h4 class="tfa-card-title">{{ $t('settings.security.trustedDevices') }}</h4>
          <p class="tfa-card-meta">
            {{ $t('settings.security.trustedDevicesHint') }}
          </p>
        </div>
        <div class="tfa-card-actions">
          <label class="tfa-switch">
            <input
              type="checkbox"
              :checked="status?.trustDevicesEnabled"
              :disabled="trustToggling"
              @change="toggleTrustDevices(($event.target as HTMLInputElement).checked)"
            />
            <span class="tfa-switch-track" />
            <span class="tfa-switch-label">
              {{ status?.trustDevicesEnabled ? $t('settings.security.on') : $t('settings.security.off') }}
            </span>
          </label>
        </div>
      </div>
      <ul
        v-if="trustedDevices.length > 0"
        class="tfa-passkey-list"
      >
        <li
          v-for="d in trustedDevices"
          :key="d.id"
          class="tfa-passkey-row"
        >
          <span class="tfa-passkey-name">
            <Icon name="ph:globe-bold" />
            {{ d.label || $t('security.twoFactor.unknownBrowser') }}
          </span>
          <span class="tfa-passkey-meta">
            {{ $t('security.twoFactor.added', { age: formatAge(d.createdAt) }) }}
            <template v-if="d.lastUsedAt">
              · {{ $t('security.twoFactor.lastUsed', { age: formatAge(d.lastUsedAt) }) }}
            </template>
          </span>
          <button
            type="button"
            class="btn-ghost btn-ghost--danger btn-ghost--sm"
            @click="revokeDevice(d.id)"
          >
            <Icon name="ph:sign-out-bold" />
            {{ $t('security.twoFactor.revoke') }}
          </button>
        </li>
      </ul>
    </article>

    <!-- Modals ------------------------------------------------------ -->
    <Modal v-model="totpSetupOpen" :title="$t('security.twoFactor.modals.enableTotpTitle')" size="md">
      <TotpSetupWizard
        v-if="totpSetupOpen"
        :setup-data="totpSetup"
        :recovery-codes="totpRecoveryCodes"
        @done="onTotpEnabled"
        @cancel="totpSetupOpen = false"
      />
    </Modal>

    <Modal v-model="disableOpen" :title="$t('security.twoFactor.modals.disableTotpTitle')" size="sm">
      <p class="tfa-modal-blurb">
        {{ $t('security.twoFactor.modals.disableTotpBlurb') }}
      </p>
      <div class="tfa-modal-field">
        <label class="field-label">{{ $t('security.twoFactor.totpCodeLabel') }}</label>
        <input
          v-model="disableCode"
          inputmode="numeric"
          maxlength="6"
          class="input"
          placeholder="123 456"
        />
      </div>
      <p class="tfa-modal-or">{{ $t('security.twoFactor.orSeparator') }}</p>
      <div class="tfa-modal-field">
        <label class="field-label">{{ $t('security.twoFactor.recoveryCodeLabel') }}</label>
        <input
          v-model="disableRecovery"
          class="input"
          placeholder="XXXX-XXXXXX"
        />
      </div>
      <p v-if="disableError" class="tfa-modal-error">
        <Icon name="ph:warning-circle-fill" />
        {{ disableError }}
      </p>
      <template #footer>
        <button class="btn-ghost" @click="disableOpen = false">{{ $t('common.cancel') }}</button>
        <button
          class="btn-primary"
          :disabled="!canSubmitDisable || disableSubmitting"
          @click="submitDisable"
        >
          <Icon
            v-if="disableSubmitting"
            name="ph:circle-notch"
            class="animate-spin"
          />
          {{ disableSubmitting ? $t('security.twoFactor.modals.disabling') : $t('settings.security.totpDisable') }}
        </button>
      </template>
    </Modal>

    <Modal v-model="regenOpen" :title="$t('security.twoFactor.modals.regenerateTitle')" size="sm">
      <p class="tfa-modal-blurb">
        {{ $t('security.twoFactor.modals.regenerateBlurb') }}
      </p>
      <div class="tfa-modal-field">
        <label class="field-label">{{ $t('security.twoFactor.totpCodeLabel') }}</label>
        <input
          v-model="regenCode"
          inputmode="numeric"
          maxlength="6"
          class="input"
          placeholder="123 456"
        />
      </div>
      <RecoveryCodesView
        v-if="regenCodes.length > 0"
        :codes="regenCodes"
      />
      <p v-if="regenError" class="tfa-modal-error">
        <Icon name="ph:warning-circle-fill" />
        {{ regenError }}
      </p>
      <template #footer>
        <button class="btn-ghost" @click="closeRegen">{{ $t('common.close') }}</button>
        <button
          v-if="regenCodes.length === 0"
          class="btn-primary"
          :disabled="regenCode.length !== 6 || regenSubmitting"
          @click="submitRegen"
        >
          <Icon
            v-if="regenSubmitting"
            name="ph:circle-notch"
            class="animate-spin"
          />
          {{ regenSubmitting ? $t('security.twoFactor.modals.generating') : $t('security.twoFactor.modals.generate') }}
        </button>
      </template>
    </Modal>

    <Modal v-model="passkeyNameOpen" :title="$t('security.twoFactor.modals.namePasskeyTitle')" size="sm">
      <p class="tfa-modal-blurb">
        {{ $t('security.twoFactor.modals.namePasskeyBlurb') }}
      </p>
      <input
        v-model="passkeyName"
        class="input"
        maxlength="64"
        :placeholder="$t('security.twoFactor.modals.namePasskeyPlaceholder')"
      />
      <template #footer>
        <button class="btn-ghost" @click="passkeyNameOpen = false">
          {{ $t('common.cancel') }}
        </button>
        <button
          class="btn-primary"
          :disabled="!passkeyName.trim() || passkeyAdding"
          @click="confirmAddPasskey"
        >
          {{ passkeyAdding ? $t('security.twoFactor.modals.registering') : $t('security.twoFactor.modals.register') }}
        </button>
      </template>
    </Modal>
  </div>
</template>

<script setup lang="ts">
import {
  startRegistration,
  type RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import Modal from '~/components/Modal.vue';
import TotpSetupWizard from '~/components/security/TotpSetupWizard.vue';
import RecoveryCodesView from '~/components/security/RecoveryCodesView.vue';
import { formatAge } from '~/utils/format';

interface Passkey {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}
interface StatusPayload {
  totpEnabled: boolean;
  trustDevicesEnabled: boolean;
  passkeys: Passkey[];
  recoveryCodesRemaining: number;
  freshAuth: boolean;
}
interface TrustedDevice {
  id: string;
  label: string | null;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
}

const { t } = useI18n();
const notifications = useNotificationStore();

const status = ref<StatusPayload | null>(null);
const trustedDevices = ref<TrustedDevice[]>([]);

async function refresh() {
  try {
    status.value = await $fetch<StatusPayload>('/api/me/2fa/status');
    if (status.value.trustDevicesEnabled) {
      const r = await $fetch<{ devices: TrustedDevice[] }>(
        '/api/me/2fa/sessions'
      );
      trustedDevices.value = r.devices;
    } else {
      trustedDevices.value = [];
    }
  } catch (e: any) {
    notifications.error(e?.data?.message || t('security.twoFactor.errors.loadStatus'));
  }
}
onMounted(refresh);

// ── TOTP setup ────────────────────────────────────────────────
const totpSetupOpen = ref(false);
const totpSetup = ref<{ qrDataUrl: string; uri: string; secret: string } | null>(
  null
);
const totpRecoveryCodes = ref<string[]>([]);

async function startTotpSetup() {
  try {
    totpSetup.value = await $fetch('/api/me/2fa/totp/setup', {
      method: 'POST',
    });
    totpRecoveryCodes.value = [];
    totpSetupOpen.value = true;
  } catch (e: any) {
    notifications.error(e?.data?.message || t('security.twoFactor.errors.startSetup'));
  }
}
async function onTotpEnabled(codes: string[]) {
  totpRecoveryCodes.value = codes;
  await refresh();
}

// ── TOTP disable ──────────────────────────────────────────────
const disableOpen = ref(false);
const disableCode = ref('');
const disableRecovery = ref('');
const disableError = ref('');
const disableSubmitting = ref(false);
const canSubmitDisable = computed(
  () =>
    /^\d{6}$/.test(disableCode.value) ||
    /^[a-z2-9]{4}-?[a-z2-9]{6}$/i.test(disableRecovery.value)
);
async function submitDisable() {
  disableError.value = '';
  disableSubmitting.value = true;
  try {
    await $fetch('/api/me/2fa/totp/disable', {
      method: 'POST',
      body: disableCode.value
        ? { code: disableCode.value }
        : { recoveryCode: disableRecovery.value },
    });
    notifications.success(t('security.twoFactor.toasts.totpDisabled'));
    disableOpen.value = false;
    disableCode.value = '';
    disableRecovery.value = '';
    await refresh();
  } catch (e: any) {
    disableError.value =
      e?.data?.message || t('security.twoFactor.errors.disable');
  } finally {
    disableSubmitting.value = false;
  }
}

// ── Recovery codes regen ──────────────────────────────────────
const regenOpen = ref(false);
const regenCode = ref('');
const regenCodes = ref<string[]>([]);
const regenError = ref('');
const regenSubmitting = ref(false);
async function submitRegen() {
  regenError.value = '';
  regenSubmitting.value = true;
  try {
    const r = await $fetch<{ recoveryCodes: string[] }>(
      '/api/me/2fa/recovery-codes/regenerate',
      { method: 'POST', body: { code: regenCode.value } }
    );
    regenCodes.value = r.recoveryCodes;
    notifications.success(t('security.twoFactor.toasts.codesRegenerated'));
    await refresh();
  } catch (e: any) {
    regenError.value = e?.data?.message || t('security.twoFactor.errors.regenerate');
  } finally {
    regenSubmitting.value = false;
  }
}
function closeRegen() {
  regenOpen.value = false;
  regenCode.value = '';
  regenCodes.value = [];
  regenError.value = '';
}

// ── Passkey add ───────────────────────────────────────────────
const passkeyNameOpen = ref(false);
const passkeyName = ref('');
const passkeyAdding = ref(false);
function addPasskey() {
  passkeyName.value = '';
  passkeyNameOpen.value = true;
}
async function confirmAddPasskey() {
  if (!passkeyName.value.trim()) return;
  passkeyAdding.value = true;
  try {
    const options = await $fetch('/api/me/2fa/passkey/register-challenge', {
      method: 'POST',
    });
    let attResp: RegistrationResponseJSON;
    try {
      attResp = await startRegistration({ optionsJSON: options as any });
    } catch (err: any) {
      throw new Error(err?.message || t('security.twoFactor.errors.browserCancelled'));
    }
    await $fetch('/api/me/2fa/passkey/register-verify', {
      method: 'POST',
      body: { name: passkeyName.value.trim(), response: attResp },
    });
    notifications.success(t('security.twoFactor.toasts.passkeyAdded', { name: passkeyName.value.trim() }));
    passkeyNameOpen.value = false;
    await refresh();
  } catch (e: any) {
    notifications.error(e?.message || e?.data?.message || t('security.twoFactor.errors.addPasskey'));
  } finally {
    passkeyAdding.value = false;
  }
}
async function removePasskey(id: string) {
  try {
    await $fetch(`/api/me/2fa/passkey/${id}` as '/api/me/2fa/passkey/:id', {
      method: 'DELETE',
    } as any);
    notifications.success(t('security.twoFactor.toasts.passkeyRemoved'));
    await refresh();
  } catch (e: any) {
    notifications.error(e?.data?.message || t('security.twoFactor.errors.removePasskey'));
  }
}

// ── Trusted devices toggle / revoke ───────────────────────────
const trustToggling = ref(false);
async function toggleTrustDevices(enabled: boolean) {
  trustToggling.value = true;
  try {
    await $fetch('/api/me/2fa/trust-devices', {
      method: 'PUT',
      body: { enabled },
    });
    await refresh();
  } catch (e: any) {
    notifications.error(e?.data?.message || t('security.twoFactor.errors.updateToggle'));
  } finally {
    trustToggling.value = false;
  }
}
async function revokeDevice(id: string) {
  try {
    await $fetch(
      `/api/me/2fa/sessions/${id}` as '/api/me/2fa/sessions/:id',
      { method: 'DELETE' } as any
    );
    await refresh();
  } catch (e: any) {
    notifications.error(e?.data?.message || t('security.twoFactor.errors.revokeDevice'));
  }
}
</script>

<style scoped>
.tfa {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
.tfa-eyebrow {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.tfa-eyebrow-icon {
  font-size: 0.95rem;
  color: rgb(var(--fg-strong));
}
.tfa-summary {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  text-transform: uppercase;
  color: rgb(var(--fg-faint));
}
.tfa-summary--on {
  color: rgb(var(--online));
}
.tfa-blurb {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: rgb(var(--fg-muted));
  max-width: 60ch;
}
.tfa-card {
  background: rgb(var(--bg-surface));
  border: 1px solid rgb(var(--line-default));
  border-radius: 4px;
  overflow: hidden;
}
.tfa-card-head {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 1rem;
  padding: 0.95rem 1.1rem;
}
.tfa-card-icon {
  font-size: 1.5rem;
  color: rgb(var(--fg-strong));
  width: 2.5rem;
  height: 2.5rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: 4px;
}
.tfa-card-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
  color: rgb(var(--fg-strong));
}
.tfa-card-meta {
  margin: 0.15rem 0 0;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  letter-spacing: 0.06em;
  color: rgb(var(--fg-muted));
  text-transform: uppercase;
}
.tfa-dot {
  width: 6px;
  height: 6px;
  border-radius: 9999px;
}
.tfa-dot--on {
  background: rgb(var(--online));
}
.tfa-dot--off {
  background: rgb(var(--fg-faint));
}
.tfa-card-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.btn-primary,
.btn-ghost {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.85rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  border-radius: 2px;
  cursor: pointer;
  transition: all 0.14s;
  border: 1px solid rgb(var(--line-default));
}
.btn-primary {
  background: rgb(var(--fg-strong));
  color: rgb(var(--accent-fg));
  border-color: rgb(var(--fg-strong));
}
.btn-primary:hover:not(:disabled) {
  background: rgb(var(--fg-default));
  border-color: rgb(var(--fg-default));
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
  border-color: rgb(var(--line-strong));
  color: rgb(var(--fg-strong));
}
.btn-ghost--sm {
  padding: 0.3rem 0.6rem;
  font-size: 9.5px;
}
.btn-ghost--danger:hover {
  color: rgb(var(--danger));
  border-color: rgb(var(--danger) / 0.4);
  background: rgb(var(--danger) / 0.08);
}

.tfa-passkey-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid rgb(var(--line-default));
}
.tfa-passkey-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 1rem;
  padding: 0.65rem 1.1rem;
  border-bottom: 1px solid rgb(var(--line-default) / 0.6);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
}
.tfa-passkey-row:last-child {
  border-bottom: 0;
}
.tfa-passkey-name {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-weight: 700;
  color: rgb(var(--fg-strong));
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.tfa-passkey-meta {
  color: rgb(var(--fg-muted));
}

/* Toggle switch */
.tfa-switch {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}
.tfa-switch input {
  display: none;
}
.tfa-switch-track {
  width: 2.4rem;
  height: 1.2rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: 9999px;
  position: relative;
  transition: all 0.14s;
}
.tfa-switch-track::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 0.85rem;
  height: 0.85rem;
  background: rgb(var(--fg-muted));
  border-radius: 9999px;
  transition: all 0.14s;
}
.tfa-switch input:checked + .tfa-switch-track {
  background: rgb(var(--fg-strong));
  border-color: rgb(var(--fg-strong));
}
.tfa-switch input:checked + .tfa-switch-track::after {
  left: calc(100% - 0.85rem - 3px);
  background: rgb(var(--accent-fg));
}
.tfa-switch-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}

/* Modal helpers */
.tfa-modal-blurb {
  margin: 0 0 0.85rem;
  font-size: 13px;
  line-height: 1.55;
  color: rgb(var(--fg-muted));
}
.tfa-modal-field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-bottom: 0.65rem;
}
.tfa-modal-or {
  margin: 0.4rem 0;
  text-align: center;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-faint));
}
.tfa-modal-error {
  margin: 0.5rem 0 0;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 12px;
  color: rgb(var(--danger));
}
.field-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--fg-subtle));
}
.input {
  width: 100%;
  padding: 0.55rem 0.75rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 4px;
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-default));
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.92rem;
}
.input:focus {
  outline: none;
  border-color: rgb(var(--fg-default));
}

@media (max-width: 640px) {
  .tfa-card-head {
    grid-template-columns: auto 1fr;
  }
  .tfa-card-actions {
    grid-column: 1 / -1;
    justify-content: flex-start;
  }
  .tfa-passkey-row {
    grid-template-columns: 1fr;
    gap: 0.4rem;
  }
}
</style>
