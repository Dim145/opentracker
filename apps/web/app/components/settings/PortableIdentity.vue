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

    <!-- The recourse, kept next to the thing that creates the risk. Somebody
         reading about exporting a private key is exactly who needs to know
         what happens if it gets out. -->
    <div class="pid-rotate">
      <p class="pid-rotate-text">{{ $t('settings.identityExport.leaked') }}</p>
      <button
        v-if="!rotateArmed"
        type="button"
        class="btn-ghost"
        :disabled="busy"
        @click="rotateArmed = true"
      >
        <Icon name="ph:arrows-clockwise-bold" />
        {{ $t('settings.identityExport.rotate') }}
      </button>
      <template v-else>
        <span class="pid-confirm">{{ $t('settings.identityExport.rotateWarning') }}</span>
        <button type="button" class="btn-ghost" :disabled="busy" @click="rotateArmed = false">
          {{ $t('common.cancel') }}
        </button>
        <button
          type="button"
          class="btn-ghost btn-ghost--danger"
          :disabled="busy"
          @click="rotate"
        >
          <Icon v-if="busy" name="ph:circle-notch" class="animate-spin" />
          <Icon v-else name="ph:arrows-clockwise-bold" />
          {{ $t('settings.identityExport.rotateConfirm') }}
        </button>
      </template>
    </div>

    <!-- Custody. Offered, never imposed: a key only the member holds is a key
         only the member can lose, and that is not a trade to make on somebody
         else's behalf. -->
    <div v-if="canHoldKey" class="pid-rotate">
      <p class="pid-rotate-text">
        {{ held ? $t('settings.identityExport.custodyOn') : $t('settings.identityExport.custodyOff') }}
      </p>
      <template v-if="!held && !custodyArmed">
        <button type="button" class="btn-ghost" :disabled="busy" @click="custodyArmed = true">
          <Icon name="ph:key-bold" />
          {{ $t('settings.identityExport.takeCustody') }}
        </button>
        <!-- The other half of custody: a member arriving in a new browser has
             the file and needs to put it back. Without this, "hold your own
             key" means "hold it in exactly one browser, forever". -->
        <label class="btn-ghost fid-file">
          <Icon name="ph:upload-simple-bold" />
          {{ $t('settings.identityExport.importKey') }}
          <input type="file" accept="application/json,.json" @change="importKey" />
        </label>
      </template>
      <template v-else-if="!held">
        <span class="pid-confirm">{{ $t('settings.identityExport.custodyWarning') }}</span>
        <button type="button" class="btn-ghost" :disabled="busy" @click="custodyArmed = false">
          {{ $t('common.cancel') }}
        </button>
        <button type="button" class="btn-ghost btn-ghost--danger" :disabled="busy" @click="takeCustody">
          <Icon v-if="busy" name="ph:circle-notch" class="animate-spin" />
          <Icon v-else name="ph:key-bold" />
          {{ $t('settings.identityExport.custodyConfirm') }}
        </button>
      </template>
      <template v-else>
        <code class="pid-held">{{ held.did }}</code>
        <label class="btn-ghost fid-file">
          <Icon name="ph:upload-simple-bold" />
          {{ $t('settings.identityExport.importKey') }}
          <input type="file" accept="application/json,.json" @change="importKey" />
        </label>
      </template>
    </div>

    <p v-if="error" class="pid-error">{{ error }}</p>
    <p v-else-if="did" class="pid-done">
      <Icon name="ph:check-circle-bold" />
      {{ rotated ? $t('settings.identityExport.rotated') : $t('settings.identityExport.done') }}
      <code>{{ did }}</code>
    </p>
  </article>
</template>

<script setup lang="ts">
import * as identityKey from '~/utils/identityKey';

const { t } = useI18n();

const armed = ref(false);
const rotateArmed = ref(false);
const custodyArmed = ref(false);
const rotated = ref(false);

/**
 * A key this browser holds, and whether it could hold one at all.
 *
 * Checked rather than assumed: Ed25519 in WebCrypto is recent enough that some
 * browsers in use will not have it, and offering an option that throws on
 * click is worse than not offering it.
 */
const held = ref<identityKey.HeldKey | null>(null);
const canHoldKey = ref(false);
onMounted(async () => {
  held.value = identityKey.load();
  canHoldKey.value = held.value !== null || (await identityKey.supported());
});

/**
 * Generate a key here and have the instance endorse it.
 *
 * From this point the server cannot sign as this member. It can still withhold
 * its endorsement, and it can still mint a different key and endorse THAT as
 * them — custody stops a forged proof for the key they actually use, not an
 * invented rival. The copy says as much.
 */
async function takeCustody(): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    const fresh = await identityKey.generate();
    await $fetch('/api/me/identity/adopt', {
      method: 'POST',
      body: { publicKeyPem: fresh.publicKeyPem, possession: fresh.possession },
    });
    // Stored only after the server accepted it: a key it does not know about
    // is a key that proves nothing, and keeping one would be a quiet lie.
    identityKey.store(fresh);
    held.value = fresh;
    did.value = fresh.did;
    custodyArmed.value = false;
  } catch (e) {
    error.value =
      (e as { data?: { message?: string } })?.data?.message ??
      t('settings.identityExport.failed');
  } finally {
    busy.value = false;
  }
}
const busy = ref(false);
const error = ref<string | null>(null);
const did = ref<string | null>(null);

interface ExportResponse {
  custody: 'member' | 'instance';
  identity: { did: string; document: unknown } & Record<string, unknown>;
}

/**
 * Retire the current key and take a new one.
 *
 * Everything the member proved elsewhere falls, and has to be re-proven from a
 * fresh export. That is the point rather than a shortcoming: carrying the links
 * forward would hand them to whoever took the file.
 */
async function rotate(): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    const res = await $fetch<{ did: string }>('/api/me/identity/rotate', {
      method: 'POST',
    });
    did.value = res.did;
    rotated.value = true;
    rotateArmed.value = false;
  } catch (e) {
    error.value =
      (e as { data?: { message?: string } })?.data?.message ??
      t('settings.identityExport.failed');
  } finally {
    busy.value = false;
  }
}

/**
 * Put a previously exported key back into this browser.
 *
 * Nothing is sent: the server already knows the public half, and the private
 * half is the one thing it must never see. What is checked is that the file
 * actually holds the key the instance has on record — importing a key the
 * server has never heard of would leave a member signing claims that verify
 * against nobody.
 */
async function importKey(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  busy.value = true;
  error.value = null;
  try {
    const parsed = JSON.parse(await file.text()) as Record<string, unknown>;
    const restored = await identityKey.readExportFile(parsed);
    if (!restored) {
      error.value = t('settings.identityExport.importBad');
      return;
    }
    identityKey.store(restored);
    held.value = restored;
    did.value = restored.did;
  } catch {
    error.value = t('settings.identityExport.importBad');
  } finally {
    busy.value = false;
  }
}

async function download(): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    const res = await $fetch<ExportResponse>('/api/me/identity/export', {
      method: 'POST',
    });
    // Under custody the server hands over its endorsement and nothing else —
    // it has no key to sign the member's half with. The browser completes the
    // document over the same bytes.
    if (res.custody === 'member') {
      const key = identityKey.load();
      if (!key || key.did !== res.identity.did) {
        error.value = t('settings.identityExport.keyMissing');
        return;
      }
      res.identity.document = await identityKey.signDocument(
        res.identity.document as Record<string, unknown>,
        key,
      );
      // And the key itself. Under custody the server has nothing to hand over,
      // so if this file did not carry it the member's only copy would be this
      // browser's storage — one cleared cache from losing an identity with no
      // recovery. The whole point of holding your own key is that you hold it.
      (res.identity as Record<string, unknown>).privateKeyPem =
        identityKey.toPem(key.privateKeyB64);
      (res.identity as Record<string, unknown>).publicKeyPem = key.publicKeyPem;
    }
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
.pid-rotate {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  padding-top: 0.75rem;
  border-top: 1px solid rgb(var(--line-default));
}
.pid-rotate-text {
  flex: 1 1 14rem;
  font-size: 0.75rem;
  color: rgb(var(--fg-muted));
}
.pid-held {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.625rem;
  color: rgb(var(--success));
  word-break: break-all;
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
