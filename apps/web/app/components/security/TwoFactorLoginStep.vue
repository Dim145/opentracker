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
      <!-- `for`/`id`, sinon le libellé n'est qu'un paragraphe stylé : rien ne
           le relie au champ, le lecteur d'écran annonce « saisie de texte »
           sans nom, et un clic dessus ne donne pas le focus. Sur le chemin de
           connexion, avec un code à six chiffres qui expire. -->
      <label class="step-label" :for="totpId">{{ $t('security.twoFactorLogin.totpLabel') }}</label>
      <input
        :id="totpId"
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
      <label class="step-label" :for="recoveryId">{{ $t('security.twoFactorLogin.recoveryLabel') }}</label>
      <input
        :id="recoveryId"
        v-model="recoveryCode"
        class="step-input"
        placeholder="XXXX-XXXXXX"
        :aria-describedby="recoveryHintId"
        @keydown.enter="submitTotp"
      />
      <p :id="recoveryHintId" class="step-hint">
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
      <button class="sbtn-ghost" type="button" @click="$emit('cancel')">
        {{ $t('common.cancel') }}
      </button>
      <button
        v-if="active !== 'passkey'"
        class="sbtn-primary"
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
        class="sbtn-primary"
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

// `useId()` et non un compteur ou `Math.random()` : l'écran est rendu côté
// serveur, et deux valeurs différentes casseraient l'hydratation du lien
// `for` / `id` — le défaut corrigé dans `Modal.vue`.
const totpId = useId();
const recoveryId = useId();
const recoveryHintId = useId();

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
  font-family: var(--font-mono);
  font-size: 0.6563rem;
  font-weight: 700;
  letter-spacing: calc(0.18em * var(--tracking-scale));
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.step-eyebrow-icon {
  color: rgb(var(--fg-strong));
}
.step-blurb {
  margin: 0;
  font-size: 0.8125rem;
  color: rgb(var(--fg-muted));
}

.step-tabs {
  display: inline-flex;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  background: rgb(var(--bg-surface));
  padding: 3px;
  align-self: flex-start;
}
.step-tab {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.85rem;
  font-family: var(--font-mono);
  font-size: 0.6563rem;
  font-weight: 700;
  letter-spacing: calc(0.14em * var(--tracking-scale));
  text-transform: uppercase;
  background: transparent;
  border: 0;
  border-radius: var(--radius-xs);
  color: rgb(var(--fg-muted));
  cursor: pointer;
  transition: all var(--dur-2);
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
  font-family: var(--font-mono);
  font-size: 0.6563rem;
  font-weight: 700;
  letter-spacing: calc(0.16em * var(--tracking-scale));
  text-transform: uppercase;
  color: rgb(var(--fg-subtle));
}
.step-input,
.step-code-input {
  width: 100%;
  padding: 0.55rem 0.75rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-default));
  font-family: var(--font-mono);
}
.step-code-input {
  font-size: 1.6rem;
  font-weight: 700;
  letter-spacing: calc(0.4em * var(--tracking-scale));
  text-align: center;
  padding: 0.6rem;
}
.step-input:focus,
.step-code-input:focus {
  outline: none;
  border-color: rgb(var(--fg-default));
}
/* L'anneau rendu au clavier. `outline: none` ci-dessus est pour la souris, où
   un changement de bordure suffit ; en `<style scoped>` la règle compile avec un
   attribut de données, donc elle battait le `:focus-visible` global de `main.css`
   quel que soit l'ordre — et ce champ n'avait plus aucun indicateur de focus.
   `main.css` corrige exactement ça pour `.input`, avec la même explication. */
.step-code-input:focus-visible {
  outline: 2px solid rgb(var(--focus-ring));
  outline-offset: 2px;
}

.step-hint {
  margin: 0;
  font-size: 0.7188rem;
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
  font-size: 0.75rem;
  color: rgb(var(--danger));
  margin: 0;
}

.step-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

/*
 * Les boutons de cette surface, renommés depuis `btn-ghost` / `btn-primary`.
 *
 * Ce ne sont pas des copies ratées du bouton du système : c'est un dialecte à
 * part — mono, capitales, 0,656 rem, interlettrage large — que les écrans de
 * sécurité et de réglages emploient sciemment. Le défaut était le NOM : défini
 * dans un `<style scoped>`, donc hors couche, il l'emportait sur
 * `@layer components` quelle que soit la spécificité. Sept fichiers donnaient
 * ainsi deux boutons visuellement différents sous le même nom de classe, et
 * `class="btn btn-primary"` écrit dans l'un d'eux n'aurait pas donné le bouton
 * attendu.
 */
.sbtn-primary,
.sbtn-ghost {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.55rem 1rem;
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: calc(0.16em * var(--tracking-scale));
  text-transform: uppercase;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-xs);
  cursor: pointer;
  transition: all var(--dur-2);
}
.sbtn-primary {
  background: rgb(var(--accent));
  color: rgb(var(--accent-fg));
  border-color: rgb(var(--accent));
}
.sbtn-primary:hover:not(:disabled) {
  background: rgb(var(--accent-hover));
}
.sbtn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.sbtn-ghost {
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-muted));
}
.sbtn-ghost:hover {
  color: rgb(var(--fg-strong));
}
</style>
