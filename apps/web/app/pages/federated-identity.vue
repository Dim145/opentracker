<template>
  <FederationOff v-if="!federationEnabled" />
  <div v-else class="fid">
    <Transition name="fid-flash">
      <div v-if="flash" class="fid-flash" :class="`fid-flash--${flash.tone}`">
        <Icon :name="flash.tone === 'error' ? 'ph:warning-circle-fill' : 'ph:check-circle-fill'" />
        <span>{{ flash.msg }}</span>
      </div>
    </Transition>

    <header class="fid-head">
      <p class="eyebrow"><span class="eyebrow-rule" /> {{ $t('federatedIdentity.eyebrow') }}</p>
      <h1 class="fid-title">{{ $t('federatedIdentity.title') }}</h1>
      <p class="note">{{ $t('federatedIdentity.intro') }}</p>
    </header>

    <!-- Link a new account -->
    <section class="card fid-link">
      <div class="card-header"><Icon name="ph:link-bold" /><span class="h-card">{{ $t('federatedIdentity.link.title') }}</span></div>
      <div class="card-body">
        <div v-if="!partners.length" class="fid-empty-partners">
          <Icon name="ph:plugs" /> {{ $t('federatedIdentity.noPartners') }}
        </div>
        <form v-else class="fid-form" @submit.prevent="createLink">
          <div class="fid-field">
            <label>{{ $t('federatedIdentity.link.peer') }}</label>
            <select v-model="selPeer" class="input">
              <option value="" disabled>—</option>
              <option v-for="p in partners" :key="p.id" :value="p.id">{{ p.name || host(p.baseUrl) }}</option>
            </select>
          </div>
          <div class="fid-field grow">
            <label>{{ $t('federatedIdentity.link.username') }}</label>
            <input v-model="remoteUser" class="input" :placeholder="$t('federatedIdentity.link.usernamePlaceholder')" />
          </div>
          <button class="btn btn-primary" :disabled="busy.create || !selPeer || !remoteUser.trim()">
            <Icon :name="busy.create ? 'ph:circle-notch' : 'ph:key-bold'" :class="{ 'animate-spin': busy.create }" />
            {{ $t('federatedIdentity.link.generate') }}
          </button>
        </form>
      </div>
    </section>

    <!-- Prove it with a file instead.

         Above the bio flow rather than below it: this is the one that works
         when the other instance is gone, and the other instance being gone is
         the usual reason somebody is on this page. -->
    <section class="card fid-claim">
      <div class="card-header">
        <Icon name="ph:seal-check-bold" />
        <span class="h-card">{{ $t('federatedIdentity.claim.title') }}</span>
      </div>
      <div class="card-body">
        <p class="note">{{ $t('federatedIdentity.claim.intro') }}</p>
        <textarea
          v-model="claimText"
          class="input fid-claim-input"
          rows="4"
          :placeholder="$t('federatedIdentity.claim.placeholder')"
        />
        <div class="fid-claim-actions">
          <label class="btn-ghost fid-file">
            <Icon name="ph:paperclip-bold" />
            {{ $t('federatedIdentity.claim.pickFile') }}
            <input type="file" accept="application/json,.json" @change="loadFile" />
          </label>
          <button
            class="btn btn-primary"
            :disabled="busy.claim || !claimText.trim()"
            @click="submitClaim"
          >
            <Icon
              :name="busy.claim ? 'ph:circle-notch' : 'ph:seal-check-bold'"
              :class="{ 'animate-spin': busy.claim }"
            />
            {{ $t('federatedIdentity.claim.action') }}
          </button>
        </div>
      </div>
    </section>

    <!-- Linked accounts -->
    <section class="fid-list-section">
      <div class="section-head">
        <span class="section-tag"><Icon name="ph:identification-badge-bold" /> {{ $t('federatedIdentity.list.title') }}</span>
        <span class="section-rule" />
      </div>

      <div v-if="!identities.length" class="fid-empty">
        <Icon name="ph:identification-card" />
        <p>{{ $t('federatedIdentity.list.empty') }}</p>
      </div>

      <div v-for="idn in identities" :key="idn.id" class="fid-item">
        <div class="fid-item-head">
          <span class="fid-handle">
            <Icon name="ph:user-circle" /> <strong>{{ idn.remoteUsername }}</strong>
            <span class="fid-at">@ {{ idn.peerName || host(idn.peerBaseUrl) }}</span>
          </span>
          <span class="fid-badge" :class="idn.status === 'verified' ? 'ok' : 'pending'">
            <Icon :name="idn.status === 'verified' ? 'ph:seal-check-fill' : 'ph:hourglass-medium'" />
            {{ idn.status === 'verified' ? $t('federatedIdentity.list.verified') : $t('federatedIdentity.list.pending') }}
          </span>
          <button class="fid-x" :disabled="busy.remove === idn.id" :title="$t('federatedIdentity.list.remove')" @click="remove(idn.id)">
            <Icon :name="busy.remove === idn.id ? 'ph:circle-notch' : 'ph:trash'" :class="{ 'animate-spin': busy.remove === idn.id }" />
          </button>
        </div>

        <!-- pending: code + verify -->
        <div v-if="idn.status === 'pending' && idn.verifyCode" class="fid-pending">
          <p class="fid-instr">{{ $t('federatedIdentity.code.instructions', { peer: idn.peerName || host(idn.peerBaseUrl) }) }}</p>
          <div class="fid-code-row">
            <code class="fid-code">{{ idn.verifyCode }}</code>
            <button class="btn btn-secondary fid-verify" :disabled="busy.verify === idn.id" @click="verify(idn.id)">
              <Icon :name="busy.verify === idn.id ? 'ph:circle-notch' : 'ph:check-bold'" :class="{ 'animate-spin': busy.verify === idn.id }" />
              {{ busy.verify === idn.id ? $t('federatedIdentity.code.verifying') : $t('federatedIdentity.code.verify') }}
            </button>
          </div>
        </div>

        <!-- verified: reputation -->
        <div v-else-if="idn.status === 'verified'" class="fid-rep">
          <template v-if="idn.reputation">
            <span class="fid-rep-title">{{ $t('federatedIdentity.rep.title', { peer: idn.peerName || host(idn.peerBaseUrl) }) }}</span>
            <div class="fid-rep-stats">
              <span class="fid-stat"><span class="k">{{ $t('federatedIdentity.rep.ratio') }}</span><span class="v">{{ idn.reputation.ratio ?? '∞' }}</span></span>
              <span class="fid-stat"><span class="k">{{ $t('federatedIdentity.rep.uploads') }}</span><span class="v">{{ idn.reputation.uploadsCount }}</span></span>
              <span class="fid-stat"><span class="k">{{ $t('federatedIdentity.rep.memberSince') }}</span><span class="v">{{ fmtDate(idn.reputation.memberSince) }}</span></span>
            </div>
          </template>
          <span v-else class="fid-rep-na"><Icon name="ph:warning" /> {{ $t('federatedIdentity.rep.unavailable') }}</span>
        </div>
      </div>
    </section>

    <!-- Your work, wherever it is.

         The reason the rest of this page exists. A proven link that changes
         nothing visible is a checkbox; this is what it was for. It appears
         only when there is something to show, because an empty section here
         reads as a feature that does not work rather than as an account with
         nothing elsewhere. -->
    <section v-if="elsewhere.length" class="fid-list-section">
      <div class="section-head">
        <span class="section-tag">
          <Icon name="ph:stack-bold" />
          {{ $t('federatedIdentity.elsewhere.title') }}
        </span>
        <span class="section-rule" />
      </div>

      <p class="note fid-elsewhere-note">
        {{ $t('federatedIdentity.elsewhere.intro', { n: elsewhere.length }) }}
      </p>

      <ul class="fid-works">
        <li v-for="w in elsewhere" :key="w.recordId ?? w.infoHash" class="fid-work">
          <component
            :is="w.detailUrl ? 'a' : 'span'"
            v-bind="
              w.detailUrl
                ? { href: w.detailUrl, target: '_blank', rel: 'noopener noreferrer' }
                : {}
            "
            class="fid-work-name"
            :title="w.name"
            >{{ w.name }}</component
          >
          <span class="fid-work-peer">{{ w.peerName }}</span>
          <span class="fid-work-size">{{ formatSize(w.size) }}</span>
          <span class="fid-work-seed" :class="{ dead: !w.seeders }">
            <Icon name="ph:arrow-up-bold" />{{ w.seeders }}
          </span>
        </li>
      </ul>

      <p v-if="elsewhereTruncated" class="note">
        {{ $t('federatedIdentity.elsewhere.truncated') }}
      </p>
    </section>
  </div>
</template>

<script setup lang="ts">
interface Reputation {
  ratio: number | null;
  uploadsCount: number;
  memberSince: string | null;
}
interface Identity {
  id: string;
  peerId: string;
  peerName: string | null;
  peerBaseUrl: string;
  remoteUsername: string;
  status: string;
  verifyCode: string | null;
  verifiedAt: string | null;
  reputation: Reputation | null;
}
interface Partner {
  id: string;
  name: string | null;
  baseUrl: string;
  accountsEnabled: boolean;
}

const { t } = useI18n();
// Federation off is a real state a user can land in by typing the URL or
// following an old link — the nav items that lead here are already hidden.
// `branding` is fetched by the layout on every page, so this costs nothing.
const branding = await useBranding();
const federationEnabled = computed(() =>
  Boolean(branding.value?.federationEnabled),
);

// immediate: nothing to ask for when federation is off, and the page renders
// FederationOff in that case anyway.
const { data: partnersData } = await useFetch<{ partners: Partner[] }>(
  '/api/federation/partners',
  { default: () => ({ partners: [] }), immediate: federationEnabled.value },
);
const { data: idData, refresh } = await useFetch<{ identities: Identity[] }>(
  '/api/me/federated-identities',
  { default: () => ({ identities: [] }), immediate: federationEnabled.value },
);
const partners = computed(() =>
  (partnersData.value?.partners ?? []).filter((p) => p.accountsEnabled),
);
const identities = computed(() => idData.value?.identities ?? []);

/**
 * The member's work across every identifier they answer to.
 *
 * Fetched alongside the links rather than per link: one person's catalogue is
 * one list, and splitting it per partner would put the emphasis back on where
 * a release happens to live — which is the thing this whole feature exists to
 * stop mattering.
 */
interface RemoteWork {
  recordId: string | null;
  name: string;
  size: number;
  infoHash: string;
  seeders: number;
  detailUrl: string | null;
  peerName: string | null;
}
const { data: elsewhereData, refresh: refreshElsewhere } = await useFetch<{
  uploads: RemoteWork[];
  truncated?: boolean;
}>('/api/me/federated-uploads', { default: () => ({ uploads: [] , immediate: federationEnabled.value}) });
const elsewhere = computed(() => elsewhereData.value?.uploads ?? []);
const elsewhereTruncated = computed(
  () => elsewhereData.value?.truncated === true,
);

const selPeer = ref('');
const remoteUser = ref('');
const busy = reactive({ create: false, verify: '', remove: '', claim: false });
const claimText = ref('');
const flash = ref<{ msg: string; tone: 'ok' | 'error' } | null>(null);
function showFlash(msg: string, tone: 'ok' | 'error' = 'ok') {
  flash.value = { msg, tone };
  setTimeout(() => {
    if (flash.value?.msg === msg) flash.value = null;
  }, 5000);
}

/**
 * Prove a past account from the file its instance issued.
 *
 * Everything is checked on our side, from the bytes pasted here: the member's
 * key proves they hold the identifier, the partner's endorsement proves it was
 * their member. Nothing is asked of the other instance, which is the point —
 * it may well be the reason this member is here.
 */
async function submitClaim() {
  const raw = claimText.value.trim();
  if (!raw) return;
  busy.claim = true;
  try {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      showFlash(t('federatedIdentity.claim.notJson'), 'error');
      return;
    }
    // The export is a file with the document inside it. Accept either — a
    // member pasting the whole file is doing the obvious thing.
    const doc =
      (parsed as { document?: unknown })?.document ??
      (parsed as { identity?: { document?: unknown } })?.identity?.document ??
      parsed;

    const res = await $fetch<{ remoteUsername: string; peerName: string | null }>(
      '/api/federation/identities/claim',
      { method: 'POST', body: { document: doc } },
    );
    claimText.value = '';
    await Promise.all([refresh(), refreshElsewhere()]);
    showFlash(
      t('federatedIdentity.claim.proven', {
        name: res.remoteUsername,
        peer: res.peerName ?? '',
      }),
      'ok',
    );
  } catch (e: unknown) {
    showFlash(
      (e as { data?: { message?: string } })?.data?.message ||
        t('federatedIdentity.toast.error'),
      'error',
    );
  } finally {
    busy.claim = false;
  }
}

/** Read the exported file straight into the box, so nobody has to open it. */
function loadFile(event: Event): void {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    claimText.value = String(reader.result ?? '');
  };
  reader.readAsText(file);
}

async function createLink() {
  if (!selPeer.value || !remoteUser.value.trim()) return;
  busy.create = true;
  try {
    await $fetch('/api/federation/identities', {
      method: 'POST',
      body: { peerId: selPeer.value, remoteUsername: remoteUser.value.trim() },
    });
    remoteUser.value = '';
    await refresh();
    showFlash(t('federatedIdentity.toast.codeGenerated'), 'ok');
  } catch (e: unknown) {
    showFlash((e as { data?: { message?: string } })?.data?.message || t('federatedIdentity.toast.error'), 'error');
  } finally {
    busy.create = false;
  }
}
async function verify(id: string) {
  busy.verify = id;
  try {
    const r = await $fetch<{ verified: boolean }>(`/api/federation/identities/${id}/verify`, { method: 'POST' });
    await refresh();
    showFlash(r.verified ? t('federatedIdentity.toast.verified') : t('federatedIdentity.toast.notVerified'), r.verified ? 'ok' : 'error');
  } catch (e: unknown) {
    showFlash((e as { data?: { message?: string } })?.data?.message || t('federatedIdentity.toast.error'), 'error');
  } finally {
    busy.verify = '';
  }
}
async function remove(id: string) {
  busy.remove = id;
  try {
    await $fetch(`/api/federation/identities/${id}`, { method: 'DELETE' });
    await refresh();
    showFlash(t('federatedIdentity.toast.removed'), 'ok');
  } catch {
    showFlash(t('federatedIdentity.toast.error'), 'error');
  } finally {
    busy.remove = '';
  }
}

function host(u: string) {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
}
function fmtDate(d: string | null) {
  if (!d) return '—';
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? '—' : date.toISOString().slice(0, 10);
}
</script>

<style scoped>
.fid-elsewhere-note {
  margin-bottom: 0.6rem;
}
.fid-works {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md, 8px);
  overflow: hidden;
}
.fid-work {
  display: grid;
  grid-template-columns: 1fr auto auto auto;
  align-items: center;
  gap: 0.75rem;
  padding: 0.45rem 0.7rem;
  font-size: 0.75rem;
  border-bottom: 1px solid rgb(var(--line-default) / 0.5);
}
.fid-work:last-child {
  border-bottom: 0;
}
.fid-work-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgb(var(--fg-default));
  text-decoration: none;
}
a.fid-work-name:hover {
  color: rgb(var(--accent));
  text-decoration: underline;
}
/* Where it lives, said quietly: the point of the list is that it is one body
   of work, not four lists that happen to be adjacent. */
.fid-work-peer {
  font-size: 0.625rem;
  color: rgb(125 211 252);
  white-space: nowrap;
}
.fid-work-size,
.fid-work-seed {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.6875rem;
  color: rgb(var(--fg-muted));
  white-space: nowrap;
}
.fid-work-seed {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
  color: rgb(var(--success));
}
.fid-work-seed.dead {
  color: rgb(var(--fg-faint));
}
@media (max-width: 640px) {
  .fid-work {
    grid-template-columns: 1fr auto;
    row-gap: 0.2rem;
  }
}

.fid-claim-input {
  width: 100%;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.6875rem;
  resize: vertical;
}
.fid-claim-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.6rem;
  flex-wrap: wrap;
}
.fid-file {
  position: relative;
  overflow: hidden;
  cursor: pointer;
}
.fid-file input[type='file'] {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.fid { max-width: 760px; margin: 0 auto; padding: 1.75rem var(--container-pad) 5rem; display: flex; flex-direction: column; gap: 1.5rem; }
.fid-flash { display: flex; align-items: center; gap: 0.5rem; padding: 0.65rem 0.9rem; border-radius: var(--radius-md); font-size: 13px; border: 1px solid; }
.fid-flash--ok { color: #4ade80; background: rgba(34, 197, 94, 0.1); border-color: rgba(34, 197, 94, 0.3); }
.fid-flash--error { color: #f87171; background: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.3); }
.fid-flash-enter-active, .fid-flash-leave-active { transition: all 0.2s ease; }
.fid-flash-enter-from, .fid-flash-leave-to { opacity: 0; transform: translateY(-4px); }

.fid-title { font-size: 28px; font-weight: 700; color: rgb(var(--fg-strong)); letter-spacing: -0.02em; margin-top: 0.45rem; }
.fid-head .note { font-size: 13px; color: rgb(var(--fg-muted)); margin-top: 0.4rem; max-width: 64ch; line-height: 1.55; }

.card { background: rgb(var(--bg-surface)); border: 1px solid rgb(var(--line-default)); border-radius: var(--radius-md); }
.card-header { padding: 0.9rem 1.1rem; border-bottom: 1px solid rgb(var(--line-default)); display: flex; align-items: center; gap: 0.55rem; }
.card-header :deep(svg) { color: rgb(var(--fg-subtle)); }
.card-body { padding: 1.1rem; }
.fid-empty-partners { display: flex; align-items: center; gap: 0.5rem; font-size: 13px; color: rgb(var(--fg-subtle)); }
.fid-form { display: flex; gap: 0.75rem; align-items: flex-end; flex-wrap: wrap; }
.fid-field { display: flex; flex-direction: column; gap: 0.3rem; }
.fid-field.grow { flex: 1; min-width: 160px; }
.fid-field label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: rgb(var(--fg-subtle)); }
.fid-field select.input { min-width: 180px; }

.section-head { display: flex; align-items: center; gap: 0.6rem; padding-bottom: 0.7rem; border-bottom: 1px solid rgb(var(--line-default)); margin-bottom: 1rem; }
.section-tag { display: inline-flex; align-items: center; gap: 0.45rem; font-family: var(--font-mono, monospace); font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: rgb(var(--fg-muted)); }
.section-tag :deep(svg) { color: var(--gold, rgb(var(--accent-warm))); font-size: 1rem; }
.section-rule { flex: 1; height: 1px; background: rgb(var(--line-default)); }

.fid-empty { text-align: center; padding: 2.5rem 1rem; color: rgb(var(--fg-subtle)); border: 1px dashed rgb(var(--line-default)); border-radius: var(--radius-md); display: flex; flex-direction: column; align-items: center; gap: 0.5rem; font-size: 13px; }
.fid-empty :deep(svg) { font-size: 1.7rem; opacity: 0.5; }

.fid-item { border: 1px solid rgb(var(--line-default)); border-radius: var(--radius-md); background: rgb(var(--bg-surface)); padding: 0.9rem 1rem; margin-bottom: 0.7rem; }
.fid-item-head { display: flex; align-items: center; gap: 0.6rem; }
.fid-handle { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 14px; color: rgb(var(--fg-default)); }
.fid-handle strong { color: rgb(var(--fg-strong)); }
.fid-at { font-family: var(--font-mono, monospace); font-size: 11.5px; color: rgb(var(--fg-subtle)); }
.fid-badge { display: inline-flex; align-items: center; gap: 0.25rem; font-size: 10.5px; font-weight: 600; padding: 0.12rem 0.45rem; border-radius: 99px; border: 1px solid; text-transform: uppercase; letter-spacing: 0.03em; }
.fid-badge.ok { color: #4ade80; background: rgba(34, 197, 94, 0.1); border-color: rgba(34, 197, 94, 0.3); }
.fid-badge.pending { color: #facc15; background: rgba(234, 179, 8, 0.1); border-color: rgba(234, 179, 8, 0.3); }
.fid-x { margin-left: auto; color: rgb(var(--fg-subtle)); width: 28px; height: 28px; border-radius: var(--radius-sm); display: grid; place-items: center; border: 1px solid transparent; }
.fid-x:hover:not(:disabled) { background: rgb(var(--bg-hover)); color: #f87171; }
.fid-x:disabled { opacity: 0.5; }

.fid-pending { margin-top: 0.7rem; padding-top: 0.7rem; border-top: 1px solid rgb(var(--line-default)); }
.fid-instr { font-size: 12.5px; color: rgb(var(--fg-muted)); margin-bottom: 0.5rem; }
.fid-code-row { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
.fid-code { font-family: var(--font-mono, monospace); font-size: 12.5px; background: rgb(var(--bg-inset)); border: 1px dashed rgb(var(--line-strong)); border-radius: var(--radius-sm); padding: 0.35rem 0.6rem; color: var(--gold, rgb(var(--accent-warm))); user-select: all; }

.fid-rep { margin-top: 0.7rem; padding-top: 0.7rem; border-top: 1px solid rgb(var(--line-default)); }
.fid-rep-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: rgb(var(--fg-subtle)); }
.fid-rep-stats { display: flex; gap: 1.25rem; margin-top: 0.5rem; flex-wrap: wrap; }
.fid-stat { display: flex; flex-direction: column; gap: 0.1rem; }
.fid-stat .k { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: rgb(var(--fg-faint)); }
.fid-stat .v { font-family: var(--font-mono, monospace); font-size: 15px; font-weight: 700; color: rgb(var(--fg-strong)); }
.fid-rep-na { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 12px; color: rgb(var(--fg-subtle)); }
</style>
