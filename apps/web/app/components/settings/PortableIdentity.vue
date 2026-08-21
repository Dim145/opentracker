<template>
  <!--
    Taking your identity with you.

    The screen has one job beyond the button, and it is the harder one: making
    sure nobody learns what does NOT travel after they have already left. The
    warning is therefore above the action rather than beside it, and phrased as
    what happens rather than as a caution — "your ratio stays here" is a fact
    somebody can act on, "be careful" is not.
  -->
  <article class="pid">
    <div class="pid-head">
      <h3 class="action-card-title">
        <Icon name="ph:identification-badge-bold" />
        {{ $t('settings.identityExport.title') }}
      </h3>
      <p class="action-card-text">{{ $t('settings.identityExport.what') }}</p>
    </div>

    <!-- Two columns, because they are two different answers and reading them
         as one list would blur exactly the distinction that matters. -->
    <div class="pid-split">
      <div class="pid-col pid-col--goes">
        <span class="pid-col-head">
          <Icon name="ph:arrow-square-out-bold" />
          {{ $t('settings.identityExport.travels') }}
        </span>
        <ul>
          <li>{{ $t('settings.identityExport.travelsName') }}</li>
          <li>{{ $t('settings.identityExport.travelsUploads') }}</li>
        </ul>
      </div>
      <div class="pid-col pid-col--stays">
        <span class="pid-col-head">
          <Icon name="ph:anchor-simple-bold" />
          {{ $t('settings.identityExport.stays') }}
        </span>
        <ul>
          <li>{{ $t('settings.identityExport.staysRatio') }}</li>
          <li>{{ $t('settings.identityExport.staysBonus') }}</li>
          <li>{{ $t('settings.identityExport.staysInvites') }}</li>
        </ul>
      </div>
    </div>

    <p class="pid-warn">
      <Icon name="ph:warning-bold" />
      {{ $t('settings.identityExport.keyWarning') }}
    </p>

    <div class="pid-actions">
      <button
        v-if="!armed"
        type="button"
        class="btn-ghost"
        :disabled="busy"
        @click="armed = true"
      >
        <Icon name="ph:download-simple-bold" />
        {{ $t('settings.identityExport.action') }}
      </button>

      <template v-else>
        <span class="pid-confirm">{{ $t('settings.identityExport.confirm') }}</span>
        <button type="button" class="btn-ghost" :disabled="busy" @click="armed = false">
          {{ $t('common.cancel') }}
        </button>
        <button
          type="button"
          class="btn-ghost btn-ghost--danger"
          :disabled="busy"
          @click="download"
        >
          <Icon v-if="busy" name="ph:circle-notch" class="animate-spin" />
          <Icon v-else name="ph:download-simple-bold" />
          {{ $t('settings.identityExport.confirmAction') }}
        </button>
      </template>
    </div>

    <p v-if="error" class="pid-error">{{ error }}</p>
    <p v-else-if="did" class="pid-done">
      <Icon name="ph:check-circle-bold" />
      {{ $t('settings.identityExport.done') }}
      <code>{{ did }}</code>
    </p>
  </article>
</template>

<script setup lang="ts">
const { t } = useI18n();

const armed = ref(false);
const busy = ref(false);
const error = ref<string | null>(null);
const did = ref<string | null>(null);

interface ExportResponse {
  identity: { did: string } & Record<string, unknown>;
}

async function download(): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    const res = await $fetch<ExportResponse>('/api/me/identity/export', {
      method: 'POST',
    });
    // Built and saved in the browser: the file holds a private key, and the
    // fewer places it is written down the better. No server-side artefact, no
    // URL anybody can be sent, nothing in a proxy's cache.
    const blob = new Blob([JSON.stringify(res.identity, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trackarr-identity-${res.identity.did.slice(-12)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    did.value = res.identity.did;
    armed.value = false;
  } catch (e) {
    error.value =
      (e as { data?: { message?: string } })?.data?.message ??
      t('settings.identityExport.failed');
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.pid {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 1rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md, 8px);
  background: rgb(var(--bg-elevated) / 0.35);
}
.pid-head {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.pid-split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}
@media (max-width: 640px) {
  .pid-split {
    grid-template-columns: 1fr;
  }
}
.pid-col {
  padding: 0.6rem 0.75rem;
  border-radius: 6px;
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-base) / 0.5);
}
.pid-col-head {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
/* Two colours because they are two different answers, and the one people get
   wrong is the right-hand one. */
.pid-col--goes {
  border-color: rgb(56 189 248 / 0.35);
}
.pid-col--goes .pid-col-head {
  color: rgb(125 211 252);
}
.pid-col--stays {
  border-color: rgb(var(--warning) / 0.35);
}
.pid-col--stays .pid-col-head {
  color: rgb(var(--warning));
}
.pid-col ul {
  margin: 0.4rem 0 0;
  padding-left: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.75rem;
  color: rgb(var(--fg-muted));
}

.pid-warn {
  display: flex;
  align-items: flex-start;
  gap: 0.4rem;
  font-size: 0.75rem;
  color: rgb(var(--fg-muted));
}
.pid-warn svg {
  flex-shrink: 0;
  margin-top: 0.15rem;
  color: rgb(var(--warning));
}

.pid-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.pid-confirm {
  font-size: 0.75rem;
  color: rgb(var(--fg-default));
}
.pid-error {
  font-size: 0.75rem;
  color: rgb(var(--danger));
}
.pid-done {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.75rem;
  color: rgb(var(--success));
}
.pid-done code {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.6875rem;
  color: rgb(var(--fg-muted));
  word-break: break-all;
}
</style>
