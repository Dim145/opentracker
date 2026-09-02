<template>
  <div class="totp-wizard">
    <!-- Step 1 — scan QR + enter first code ----------------------- -->
    <template v-if="!recoveryCodes.length">
      <p class="totp-blurb">
        {{ $t('security.totp.scanBlurb') }}
      </p>
      <figure class="totp-qr">
        <img v-if="setupData?.qrDataUrl" :src="setupData.qrDataUrl" :alt="$t('security.totp.qrAlt')" />
      </figure>
      <details class="totp-secret">
        <summary>{{ $t('security.totp.manualEntry') }}</summary>
        <code class="totp-secret-value">{{ setupData?.secret }}</code>
        <button
          type="button"
          class="totp-copy"
          @click="copySecret"
          :title="$t('security.totp.copySecretTitle')"
        >
          <Icon name="ph:copy-bold" />
          {{ secretCopied ? $t('common.copied') : $t('common.copy') }}
        </button>
      </details>

      <div class="totp-field">
        <label class="field-label">{{ $t('security.totp.codeLabel') }}</label>
        <input
          v-model="code"
          inputmode="numeric"
          maxlength="6"
          autocomplete="one-time-code"
          class="input totp-code-input"
          placeholder="123 456"
          @keydown.enter="submit"
        />
      </div>

      <p v-if="error" class="totp-error">
        <Icon name="ph:warning-circle-fill" />
        {{ error }}
      </p>

      <div class="totp-actions">
        <button class="sbtn-ghost" @click="$emit('cancel')">{{ $t('common.cancel') }}</button>
        <button
          class="sbtn-primary"
          :disabled="code.length !== 6 || submitting"
          @click="submit"
        >
          <Icon
            v-if="submitting"
            name="ph:circle-notch"
            class="animate-spin"
          />
          {{ submitting ? $t('security.totp.verifying') : $t('security.totp.verifyEnable') }}
        </button>
      </div>
    </template>

    <!-- Step 2 — show recovery codes once ------------------------ -->
    <template v-else>
      <p class="totp-success">
        <Icon name="ph:check-circle-fill" />
        <span>
          {{ $t('security.totp.enabledPrefix') }}
          <strong>{{ $t('security.totp.enabledStrong') }}</strong>{{ $t('security.totp.enabledSuffix') }}
        </span>
      </p>
      <RecoveryCodesView :codes="recoveryCodes" />
      <div class="totp-actions">
        <button class="sbtn-primary" @click="$emit('cancel')">
          <Icon name="ph:check-bold" />
          {{ $t('security.totp.saved') }}
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import RecoveryCodesView from '~/components/security/RecoveryCodesView.vue';

const props = defineProps<{
  setupData: { qrDataUrl: string; uri: string; secret: string } | null;
  recoveryCodes: string[];
}>();
const emit = defineEmits<{
  done: [codes: string[]];
  cancel: [];
}>();

const code = ref('');
const submitting = ref(false);
const error = ref('');
const secretCopied = ref(false);

const { t } = useI18n();
const notifications = useNotificationStore();

async function submit() {
  error.value = '';
  if (!/^\d{6}$/.test(code.value)) {
    error.value = t('security.totp.errors.invalidCode');
    return;
  }
  submitting.value = true;
  try {
    const r = await $fetch<{ recoveryCodes: string[] }>(
      '/api/me/2fa/totp/enable',
      { method: 'POST', body: { code: code.value } }
    );
    notifications.success(t('security.totp.toasts.enabled'));
    emit('done', r.recoveryCodes);
  } catch (e: any) {
    error.value =
      e?.data?.message ||
      t('security.totp.errors.rejected');
  } finally {
    submitting.value = false;
  }
}

async function copySecret() {
  if (!props.setupData?.secret) return;
  try {
    await navigator.clipboard.writeText(props.setupData.secret);
    secretCopied.value = true;
    setTimeout(() => (secretCopied.value = false), 1800);
  } catch {
    // Older browsers — silent.
  }
}
</script>

<style scoped>
.totp-wizard {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
.totp-blurb {
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.55;
  color: rgb(var(--fg-muted));
}
.totp-qr {
  margin: 0 auto;
  width: 200px;
  height: 200px;
  background: white;
  border-radius: var(--radius-sm);
  border: 1px solid rgb(var(--line-default));
  padding: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.totp-qr img {
  display: block;
  width: 100%;
  height: 100%;
}
.totp-secret {
  border: 1px dashed rgb(var(--line-default));
  border-radius: var(--radius-sm);
  padding: 0.5rem 0.75rem;
}
.totp-secret summary {
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  letter-spacing: calc(0.12em * var(--tracking-scale));
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.totp-secret summary:hover {
  color: rgb(var(--fg-strong));
}
.totp-secret-value {
  display: block;
  margin-top: 0.5rem;
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  letter-spacing: calc(0.04em * var(--tracking-scale));
  word-break: break-all;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  padding: 0.4rem 0.55rem;
  color: rgb(var(--fg-strong));
}
.totp-copy {
  margin-top: 0.5rem;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.6rem;
  font-family: var(--font-mono);
  font-size: 0.625rem;
  letter-spacing: calc(0.16em * var(--tracking-scale));
  text-transform: uppercase;
  background: transparent;
  color: rgb(var(--fg-muted));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-xs);
  cursor: pointer;
}
.totp-copy:hover {
  color: rgb(var(--fg-strong));
  border-color: rgb(var(--line-strong));
}

.totp-field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.totp-code-input {
  font-size: 1.6rem;
  font-weight: 700;
  letter-spacing: calc(0.4em * var(--tracking-scale));
  text-align: center;
  padding: 0.6rem;
  font-family: var(--font-mono);
}
.field-label {
  font-family: var(--font-mono);
  font-size: 0.6563rem;
  font-weight: 700;
  letter-spacing: calc(0.16em * var(--tracking-scale));
  text-transform: uppercase;
  color: rgb(var(--fg-subtle));
}
.input {
  width: 100%;
  padding: 0.55rem 0.75rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-default));
}
.input:focus {
  outline: none;
  border-color: rgb(var(--fg-default));
}
/* L'anneau rendu au clavier. `outline: none` ci-dessus est pour la souris, où
   un changement de bordure suffit ; en `<style scoped>` la règle compile avec un
   attribut de données, donc elle battait le `:focus-visible` global de `main.css`
   quel que soit l'ordre — et ce champ n'avait plus aucun indicateur de focus.
   `main.css` corrige exactement ça pour `.input`, avec la même explication. */
.input:focus-visible {
  outline: 2px solid rgb(var(--focus-ring));
  outline-offset: 2px;
}


.totp-error {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.75rem;
  color: rgb(var(--danger));
  margin: 0;
}
.totp-success {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
  color: rgb(var(--online));
  margin: 0 0 0.5rem;
}

.totp-actions {
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
  padding: 0.5rem 0.95rem;
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: calc(0.16em * var(--tracking-scale));
  text-transform: uppercase;
  border-radius: var(--radius-xs);
  cursor: pointer;
  border: 1px solid rgb(var(--line-default));
  transition: all var(--dur-2);
}
.sbtn-primary {
  background: rgb(var(--fg-strong));
  color: rgb(var(--accent-fg));
  border-color: rgb(var(--fg-strong));
}
.sbtn-primary:hover:not(:disabled) {
  background: rgb(var(--fg-default));
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
