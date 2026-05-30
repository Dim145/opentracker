<template>
  <div class="fed">
    <Transition name="fed-flash">
      <div v-if="flash" class="fed-flash" :class="`fed-flash--${flash.tone}`">
        <Icon :name="flash.tone === 'error' ? 'ph:warning-circle-fill' : 'ph:check-circle-fill'" />
        <span>{{ flash.msg }}</span>
      </div>
    </Transition>

    <p class="fed-intro">
      {{ $t('admin.federation.intro') }}
      <span class="fed-owner"><Icon name="ph:crown-simple-bold" /> {{ $t('admin.federation.ownerOnly') }}</span>
    </p>

    <!-- Master switch -->
    <div class="fed-master" :class="{ 'is-on': cfg?.enabled }">
      <span class="fed-master-ring"><Icon name="ph:broadcast-bold" /></span>
      <div class="fed-master-txt">
        <div class="fed-master-h">
          {{ $t('admin.federation.master.title') }}
          <span class="fed-dot" :class="cfg?.enabled ? 'on' : 'idle'" />
        </div>
        <p>{{ cfg?.enabled ? $t('admin.federation.master.on') : $t('admin.federation.master.off') }}</p>
      </div>
      <label class="switch">
        <input type="checkbox" :checked="cfg?.enabled" :disabled="busy.master" @change="toggleMaster" />
        <span class="track" /><span class="thumb" />
      </label>
    </div>

    <template v-if="cfg?.enabled">
      <!-- Identity + default scopes -->
      <div class="fed-grid">
        <section class="card">
          <div class="card-header"><Icon name="ph:fingerprint" /><span class="h-card">{{ $t('admin.federation.identity.title') }}</span></div>
          <div class="card-body">
            <template v-if="cfg?.provisioned">
              <dl class="fed-id">
                <dt>{{ $t('admin.federation.identity.instanceId') }}</dt>
                <dd>{{ cfg.instanceId }}</dd>
                <dt>{{ $t('admin.federation.identity.fingerprint') }}</dt>
                <dd><strong>{{ cfg.fingerprint }}</strong></dd>
              </dl>
              <div class="fed-field">
                <label>{{ $t('admin.federation.identity.name') }}</label>
                <input v-model="idName" class="input" :placeholder="$t('admin.federation.identity.namePlaceholder')" />
              </div>
              <div class="fed-field">
                <label>{{ $t('admin.federation.identity.publicUrl') }}</label>
                <input v-model="idUrl" class="input" :placeholder="$t('admin.federation.identity.urlPlaceholder')" />
              </div>
              <button class="btn-primary fed-save" :disabled="busy.identity" @click="saveIdentity">
                <Icon :name="busy.identity ? 'ph:circle-notch' : 'ph:floppy-disk'" :class="{ 'animate-spin': busy.identity }" />
                {{ $t('admin.federation.identity.save') }}
              </button>
              <p class="fed-hint"><Icon name="ph:info" /> {{ $t('admin.federation.identity.hint') }}</p>
            </template>
            <p v-else class="fed-hint">{{ $t('admin.federation.identity.notProvisioned') }}</p>
          </div>
        </section>

        <section class="card">
          <div class="card-header"><Icon name="ph:share-network" /><span class="h-card">{{ $t('admin.federation.scopes.title') }}</span></div>
          <div class="card-body">
            <p class="fed-hint" style="margin-bottom: 0.7rem">{{ $t('admin.federation.scopes.intro') }}</p>
            <div v-for="s in scopeDefs" :key="s.key" class="scope-row" :class="{ 'is-warn': s.key === 'swarm' }">
              <span class="scope-ico"><Icon :name="s.icon" /></span>
              <div class="scope-txt">
                <div class="scope-t">
                  {{ $t(s.label) }}
                  <span v-if="s.key === 'swarm'" class="fed-badge warn"><Icon name="ph:warning-bold" /> {{ $t('admin.federation.scopes.risky') }}</span>
                </div>
                <div class="scope-d">{{ $t(s.desc) }}</div>
              </div>
              <label class="switch" :class="s.key === 'swarm' ? 'is-warning' : 'is-gold'">
                <input type="checkbox" :checked="defScopes[s.key]" :disabled="busy.scopes" @change="toggleDefaultScope(s.key)" />
                <span class="track" /><span class="thumb" />
              </label>
            </div>
          </div>
        </section>
      </div>

      <!-- KPIs -->
      <div class="fed-kpis">
        <div class="kpi"><span class="kpi-n">{{ kpis.active }}</span><span class="kpi-l">{{ $t('admin.federation.kpis.activePeers') }}</span><Icon name="ph:plugs-connected-bold" class="kpi-i" /></div>
        <div class="kpi"><span class="kpi-n">{{ kpis.pending }}</span><span class="kpi-l">{{ $t('admin.federation.kpis.pending') }}</span><Icon name="ph:hourglass-medium-bold" class="kpi-i" /></div>
        <div class="kpi"><span class="kpi-n">{{ peers.length }}</span><span class="kpi-l">{{ $t('admin.federation.kpis.partners') }}</span><Icon name="ph:globe-hemisphere-west-bold" class="kpi-i" /></div>
      </div>

      <!-- Add partner -->
      <section class="card">
        <div class="card-body">
          <form class="fed-add-form" @submit.prevent="submitAdd">
            <div class="fed-field" style="flex: 1; margin: 0">
              <label>{{ $t('admin.federation.peers.addUrl') }}</label>
              <input v-model="addUrl" class="input" :placeholder="$t('admin.federation.peers.addUrlPlaceholder')" :disabled="busy.add" />
            </div>
            <button class="btn-primary" :disabled="busy.add || !addUrl">
              <Icon :name="busy.add ? 'ph:circle-notch' : 'ph:handshake-bold'" :class="{ 'animate-spin': busy.add }" />
              {{ $t('admin.federation.peers.send') }}
            </button>
          </form>
        </div>
      </section>

      <!-- Peer allow-list -->
      <div class="fed-peers">
        <div v-if="!peers.length" class="fed-empty"><Icon name="ph:broadcast" /> {{ $t('admin.federation.peers.empty') }}</div>
        <div v-for="p in peers" :key="p.id" class="peer" :class="{ 'peer--pending': p.status === 'pending_in' }">
          <span class="fed-dot" :class="dotClass(p.status)" />
          <div class="peer-id">
            <div class="peer-name">
              {{ p.displayName || hostOf(p.baseUrl) }}
              <span class="fed-badge" :class="statusTone(p.status)">{{ $t('admin.federation.peers.status.' + p.status) }}</span>
            </div>
            <div class="peer-url">{{ p.baseUrl }}<template v-if="p.instanceId"> · {{ p.instanceId }}</template></div>
            <div class="peer-meta">
              <div class="peer-scopes">
                <span v-for="k in activeScopeKeys(p.sharesWithThem)" :key="'s' + k" class="chip"><Icon :name="scopeIcon(k)" /> {{ k }}</span>
              </div>
              <span v-if="p.lastError" class="peer-err"><Icon name="ph:warning" /> {{ p.lastError }}</span>
            </div>
          </div>
          <div class="peer-actions">
            <button v-if="p.status === 'pending_in'" class="fbtn fbtn-ok" @click="openApprove(p)"><Icon name="ph:eye-bold" /> {{ $t('admin.federation.peers.review') }}</button>
            <button v-if="p.status === 'pending_out'" class="fbtn" :disabled="busy.row === p.id" @click="resend(p)"><Icon name="ph:arrows-clockwise" /> {{ $t('admin.federation.peers.resend') }}</button>
            <button class="fbtn fbtn-danger" :disabled="busy.row === p.id" :title="$t('admin.federation.peers.revoke')" @click="revoke(p)"><Icon name="ph:link-break-bold" /></button>
          </div>
        </div>
      </div>
    </template>

    <!-- Approve modal -->
    <Modal v-model="approveOpen" :title="$t('admin.federation.approve.title')" icon="ph:handshake" size="md">
      <div v-if="approveTarget" class="fed-modal">
        <dl class="fed-id">
          <dt>{{ $t('admin.federation.identity.name') }}</dt>
          <dd>{{ approveTarget.displayName || hostOf(approveTarget.baseUrl) }}</dd>
          <dt>URL</dt>
          <dd>{{ approveTarget.baseUrl }}</dd>
          <dt>{{ $t('admin.federation.identity.instanceId') }}</dt>
          <dd>{{ approveTarget.instanceId }}</dd>
          <dt>{{ $t('admin.federation.identity.fingerprint') }}</dt>
          <dd><strong>{{ approveTarget.fingerprint }}</strong></dd>
        </dl>
        <div class="fed-warn"><Icon name="ph:shield-warning-bold" /> {{ $t('admin.federation.approve.verify', { fp: approveTarget.fingerprint }) }}</div>
        <label class="fed-sub">{{ $t('admin.federation.approve.theyShare') }}</label>
        <div class="peer-scopes" style="margin: 0.4rem 0 1rem">
          <span v-for="k in activeScopeKeys(approveTarget.sharesWithThem)" :key="'t' + k" class="chip"><Icon :name="scopeIcon(k)" /> {{ k }}</span>
          <span v-if="!activeScopeKeys(approveTarget.sharesWithThem).length" class="fed-hint">—</span>
        </div>
        <label class="fed-sub">{{ $t('admin.federation.approve.youShareBack') }}</label>
        <div class="fed-modal-scopes">
          <div v-for="s in scopeDefs" :key="'a' + s.key" class="scope-row" :class="{ 'is-warn': s.key === 'swarm' }">
            <span class="scope-ico"><Icon :name="s.icon" /></span>
            <span class="scope-t" style="flex: 1">{{ $t(s.label) }}</span>
            <label class="switch" :class="s.key === 'swarm' ? 'is-warning' : 'is-gold'">
              <input v-model="approveShare[s.key]" type="checkbox" /><span class="track" /><span class="thumb" />
            </label>
          </div>
        </div>
      </div>
      <template #footer>
        <button class="fbtn" @click="approveOpen = false">{{ $t('admin.federation.approve.cancel') }}</button>
        <button class="fbtn fbtn-ok" :disabled="busy.approve" @click="confirmApprove">
          <Icon :name="busy.approve ? 'ph:circle-notch' : 'ph:check-bold'" :class="{ 'animate-spin': busy.approve }" />
          {{ $t('admin.federation.approve.confirm') }}
        </button>
      </template>
    </Modal>
  </div>
</template>

<script setup lang="ts">
interface Scopes {
  catalog: boolean;
  social: boolean;
  accounts: boolean;
  swarm: boolean;
}
interface Cfg {
  enabled: boolean;
  instanceName: string | null;
  publicUrl: string | null;
  instanceId: string | null;
  publicKey: string | null;
  fingerprint: string | null;
  defaultScopes: Scopes;
  provisioned: boolean;
}
interface Peer {
  id: string;
  baseUrl: string;
  instanceId: string | null;
  displayName: string | null;
  status: string;
  sharesWithThem: Scopes;
  acceptsFromThem: Scopes;
  fingerprint: string | null;
  lastError: string | null;
}
interface Resp {
  config: Cfg;
  peers: Peer[];
}

const { t } = useI18n();
const { data, refresh } = await useFetch<Resp>('/api/admin/federation');
const cfg = computed(() => data.value?.config);
const peers = computed(() => data.value?.peers ?? []);

const EMPTY: Scopes = { catalog: false, social: false, accounts: false, swarm: false };
const SCOPE_KEYS = ['catalog', 'social', 'accounts', 'swarm'] as const;

const scopeDefs = [
  { key: 'catalog', icon: 'ph:database-bold', label: 'admin.federation.scopes.catalog', desc: 'admin.federation.scopes.catalogDesc' },
  { key: 'social', icon: 'ph:chat-circle-dots-bold', label: 'admin.federation.scopes.social', desc: 'admin.federation.scopes.socialDesc' },
  { key: 'accounts', icon: 'ph:trophy-bold', label: 'admin.federation.scopes.accounts', desc: 'admin.federation.scopes.accountsDesc' },
  { key: 'swarm', icon: 'ph:share-fat-bold', label: 'admin.federation.scopes.swarm', desc: 'admin.federation.scopes.swarmDesc' },
] as const;

const busy = reactive({ master: false, identity: false, scopes: false, add: false, approve: false, row: '' });
const flash = ref<{ msg: string; tone: 'ok' | 'error' } | null>(null);
function showFlash(msg: string, tone: 'ok' | 'error' = 'ok') {
  flash.value = { msg, tone };
  setTimeout(() => {
    if (flash.value?.msg === msg) flash.value = null;
  }, 4000);
}

const idName = ref('');
const idUrl = ref('');
const defScopes = reactive<Scopes>({ ...EMPTY });
watch(
  cfg,
  (c) => {
    if (c) {
      idName.value = c.instanceName ?? '';
      idUrl.value = c.publicUrl ?? '';
      Object.assign(defScopes, c.defaultScopes ?? EMPTY);
    }
  },
  { immediate: true },
);

const addUrl = ref('');
const approveOpen = ref(false);
const approveTarget = ref<Peer | null>(null);
const approveShare = reactive<Scopes>({ ...EMPTY });

const kpis = computed(() => ({
  active: peers.value.filter((p) => p.status === 'active').length,
  pending: peers.value.filter((p) => p.status === 'pending_in' || p.status === 'pending_out').length,
}));

function hostOf(u: string) {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
}
function scopeIcon(k: string) {
  return ({ catalog: 'ph:database', social: 'ph:chat-circle-dots', accounts: 'ph:trophy', swarm: 'ph:share-fat' } as Record<string, string>)[k] ?? 'ph:circle';
}
function activeScopeKeys(s: Scopes | undefined) {
  return SCOPE_KEYS.filter((k) => s?.[k]);
}
function dotClass(status: string) {
  if (status === 'active') return 'on';
  if (status === 'pending_in') return 'warn';
  if (status === 'blocked' || status === 'revoked') return 'off';
  return 'idle';
}
function statusTone(status: string) {
  if (status === 'active') return 'ok';
  if (status === 'pending_in') return 'warn';
  if (status === 'blocked' || status === 'revoked') return 'danger';
  return 'neutral';
}

async function run(fn: () => Promise<unknown>, okMsg?: string) {
  try {
    await fn();
    await refresh();
    if (okMsg) showFlash(okMsg, 'ok');
  } catch (e: unknown) {
    const err = e as { data?: { message?: string }; message?: string };
    showFlash(err?.data?.message || err?.message || t('admin.federation.toast.error'), 'error');
  }
}

async function toggleMaster(e: Event) {
  const enabled = (e.target as HTMLInputElement).checked;
  busy.master = true;
  await run(() => $fetch('/api/admin/federation', { method: 'PUT', body: { enabled } }), t('admin.federation.toast.saved'));
  busy.master = false;
}
async function saveIdentity() {
  busy.identity = true;
  await run(
    () => $fetch('/api/admin/federation', { method: 'PUT', body: { instanceName: idName.value || null, publicUrl: idUrl.value || null } }),
    t('admin.federation.toast.saved'),
  );
  busy.identity = false;
}
async function toggleDefaultScope(k: keyof Scopes) {
  const next = { ...defScopes, [k]: !defScopes[k] };
  busy.scopes = true;
  await run(() => $fetch('/api/admin/federation', { method: 'PUT', body: { defaultScopes: next } }), t('admin.federation.toast.saved'));
  busy.scopes = false;
}
async function submitAdd() {
  const url = addUrl.value.trim();
  if (!url) return;
  busy.add = true;
  await run(() => $fetch('/api/admin/federation/peers', { method: 'POST', body: { baseUrl: url, scopes: { ...defScopes } } }), t('admin.federation.toast.sent'));
  busy.add = false;
  addUrl.value = '';
}
async function resend(p: Peer) {
  busy.row = p.id;
  await run(() => $fetch('/api/admin/federation/peers', { method: 'POST', body: { baseUrl: p.baseUrl, scopes: { ...p.sharesWithThem } } }), t('admin.federation.toast.sent'));
  busy.row = '';
}
async function revoke(p: Peer) {
  busy.row = p.id;
  await run(() => $fetch(`/api/admin/federation/peers/${p.id}`, { method: 'DELETE' }), t('admin.federation.toast.revoked'));
  busy.row = '';
}
function openApprove(p: Peer) {
  approveTarget.value = p;
  Object.assign(approveShare, cfg.value?.defaultScopes ?? EMPTY);
  approveOpen.value = true;
}
async function confirmApprove() {
  const p = approveTarget.value;
  if (!p) return;
  busy.approve = true;
  await run(
    () => $fetch(`/api/admin/federation/peers/${p.id}/approve`, { method: 'POST', body: { sharesWithThem: { ...approveShare }, acceptsFromThem: { ...p.sharesWithThem } } }),
    t('admin.federation.toast.approved'),
  );
  busy.approve = false;
  approveOpen.value = false;
}
</script>

<style scoped>
.fed { display: flex; flex-direction: column; gap: 1.25rem; }
.fed-intro { font-size: 13px; color: var(--fg-muted); line-height: 1.55; max-width: 70ch; display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
.fed-owner { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 11px; font-weight: 600; color: var(--gold, #d4a734); border: 1px solid color-mix(in srgb, var(--gold, #d4a734) 30%, transparent); background: color-mix(in srgb, var(--gold, #d4a734) 10%, transparent); padding: 0.15rem 0.5rem; border-radius: 99px; }

.fed-flash { display: flex; align-items: center; gap: 0.5rem; padding: 0.65rem 0.9rem; border-radius: var(--radius-md); font-size: 13px; border: 1px solid; }
.fed-flash--ok { color: #4ade80; background: rgba(34, 197, 94, 0.1); border-color: rgba(34, 197, 94, 0.3); }
.fed-flash--error { color: #f87171; background: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.3); }
.fed-flash-enter-active, .fed-flash-leave-active { transition: all 0.2s ease; }
.fed-flash-enter-from, .fed-flash-leave-to { opacity: 0; transform: translateY(-4px); }

.fed-master { display: flex; align-items: center; gap: 1rem; padding: 1.1rem 1.2rem; border: 1px solid var(--line-default); border-radius: var(--radius-md); background: var(--bg-surface); }
.fed-master.is-on { border-color: rgba(34, 197, 94, 0.3); background: linear-gradient(100deg, rgba(34, 197, 94, 0.06), transparent 60%); }
.fed-master-ring { width: 42px; height: 42px; border-radius: 50%; display: grid; place-items: center; background: var(--bg-elevated); color: var(--fg-subtle); font-size: 1.3rem; flex-shrink: 0; }
.fed-master.is-on .fed-master-ring { background: rgba(34, 197, 94, 0.12); color: var(--online); }
.fed-master-txt { flex: 1; min-width: 0; }
.fed-master-h { display: flex; align-items: center; gap: 0.5rem; font-size: 16px; font-weight: 600; color: var(--fg-strong); }
.fed-master-txt p { font-size: 12.5px; color: var(--fg-muted); margin-top: 0.2rem; }

.fed-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
@media (max-width: 860px) { .fed-grid { grid-template-columns: 1fr; } }

.fed-id { display: grid; grid-template-columns: auto 1fr; gap: 0.4rem 1rem; margin-bottom: 0.9rem; font-size: 12px; }
.fed-id dt { color: var(--fg-subtle); text-transform: uppercase; font-size: 10.5px; font-weight: 600; letter-spacing: 0.05em; }
.fed-id dd { font-family: var(--font-mono, monospace); color: var(--fg-default); word-break: break-all; }
.fed-field { margin-bottom: 0.7rem; }
.fed-field label { display: block; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--fg-subtle); margin-bottom: 0.3rem; }
.fed-save { margin-top: 0.2rem; }
.fed-hint { font-size: 12px; color: var(--fg-subtle); line-height: 1.5; margin-top: 0.6rem; display: flex; gap: 0.4rem; }

.scope-row { display: flex; align-items: center; gap: 0.7rem; padding: 0.6rem 0.7rem; border: 1px solid var(--line-default); border-radius: var(--radius-md); background: var(--bg-inset); margin-bottom: 0.5rem; }
.scope-ico { width: 30px; height: 30px; border-radius: var(--radius-sm); display: grid; place-items: center; background: var(--bg-elevated); color: var(--gold, #d4a734); font-size: 1rem; flex-shrink: 0; }
.scope-row.is-warn .scope-ico { color: var(--warning); }
.scope-txt { flex: 1; min-width: 0; }
.scope-t { font-weight: 600; font-size: 13px; color: var(--fg-default); display: flex; align-items: center; gap: 0.4rem; }
.scope-d { font-size: 11.5px; color: var(--fg-subtle); margin-top: 1px; }

.fed-kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.85rem; }
.kpi { position: relative; overflow: hidden; background: var(--bg-surface); border: 1px solid var(--line-default); border-radius: var(--radius-md); padding: 0.85rem 1rem; }
.kpi-n { font-size: 24px; font-weight: 700; color: var(--fg-strong); font-variant-numeric: tabular-nums; line-height: 1; }
.kpi-l { display: block; font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--fg-subtle); margin-top: 0.3rem; }
.kpi-i { position: absolute; top: 0.7rem; right: 0.8rem; font-size: 1.1rem; color: var(--line-strong); }

.fed-add-form { display: flex; gap: 0.75rem; align-items: flex-end; flex-wrap: wrap; }

.fed-peers { display: flex; flex-direction: column; gap: 0.6rem; }
.fed-empty { text-align: center; padding: 2rem; color: var(--fg-subtle); border: 1px dashed var(--line-default); border-radius: var(--radius-md); display: flex; flex-direction: column; align-items: center; gap: 0.5rem; font-size: 13px; }
.fed-empty :deep(svg) { font-size: 1.6rem; opacity: 0.5; }
.peer { display: grid; grid-template-columns: 10px 1fr auto; gap: 0.9rem; align-items: center; padding: 0.85rem 1rem; border: 1px solid var(--line-default); border-radius: var(--radius-md); background: var(--bg-surface); transition: border-color 0.16s ease; }
.peer:hover { border-color: var(--line-strong); }
.peer--pending { border-color: rgba(234, 179, 8, 0.35); background: rgba(234, 179, 8, 0.035); }
.peer-id { min-width: 0; }
.peer-name { font-weight: 600; color: var(--fg-strong); display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.peer-url { font-family: var(--font-mono, monospace); font-size: 11px; color: var(--fg-subtle); margin-top: 0.15rem; word-break: break-all; }
.peer-meta { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.45rem; align-items: center; }
.peer-scopes { display: flex; gap: 0.35rem; flex-wrap: wrap; }
.peer-err { font-size: 11px; color: #f87171; display: inline-flex; align-items: center; gap: 0.25rem; }
.peer-actions { display: flex; gap: 0.4rem; align-items: center; }

.chip { display: inline-flex; align-items: center; gap: 0.25rem; font-size: 11px; padding: 0.15rem 0.45rem; border-radius: 99px; border: 1px solid var(--line-strong); color: var(--fg-muted); background: var(--bg-elevated); text-transform: capitalize; }

.fed-badge { display: inline-flex; align-items: center; gap: 0.25rem; font-family: var(--font-mono, monospace); font-size: 10px; font-weight: 500; letter-spacing: 0.02em; padding: 0.12rem 0.4rem; border-radius: var(--radius-sm); border: 1px solid; text-transform: uppercase; }
.fed-badge.ok { color: #4ade80; background: rgba(34, 197, 94, 0.1); border-color: rgba(34, 197, 94, 0.3); }
.fed-badge.warn { color: #facc15; background: rgba(234, 179, 8, 0.1); border-color: rgba(234, 179, 8, 0.3); }
.fed-badge.danger { color: #f87171; background: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.3); }
.fed-badge.neutral { color: var(--fg-muted); background: rgba(255, 255, 255, 0.04); border-color: var(--line-default); }

/* switch */
.switch { position: relative; display: inline-flex; flex-shrink: 0; width: 42px; height: 24px; }
.switch input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.switch .track { position: absolute; inset: 0; border-radius: 99px; background: var(--bg-hover); border: 1px solid var(--line-strong); transition: all 0.2s ease; }
.switch .thumb { position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: var(--fg-subtle); transition: all 0.2s cubic-bezier(0.3, 1.4, 0.5, 1); }
.switch input:checked ~ .track { background: var(--online); border-color: var(--online); }
.switch input:checked ~ .thumb { left: 21px; background: #0a0a0a; }
.switch.is-gold input:checked ~ .track { background: var(--gold, #d4a734); border-color: var(--gold, #d4a734); }
.switch.is-warning input:checked ~ .track { background: var(--warning); border-color: var(--warning); }

/* status dot */
.fed-dot { position: relative; width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.fed-dot.on { background: var(--online); }
.fed-dot.warn { background: var(--warning); }
.fed-dot.off { background: var(--danger); }
.fed-dot.idle { background: var(--fg-subtle); }

/* small action buttons */
.fbtn { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.4rem 0.65rem; border-radius: var(--radius-sm); font-size: 12px; font-weight: 600; border: 1px solid var(--line-default); background: var(--bg-elevated); color: var(--fg-default); transition: all 0.14s ease; }
.fbtn:hover { background: var(--bg-hover); border-color: var(--line-strong); }
.fbtn:disabled { opacity: 0.5; cursor: not-allowed; }
.fbtn-ok { color: #4ade80; background: rgba(34, 197, 94, 0.12); border-color: rgba(34, 197, 94, 0.3); }
.fbtn-danger { color: #f87171; background: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.3); }

.fed-modal { display: flex; flex-direction: column; }
.fed-warn { display: flex; gap: 0.5rem; align-items: flex-start; padding: 0.7rem 0.9rem; border-radius: var(--radius-md); font-size: 12.5px; line-height: 1.5; background: rgba(234, 179, 8, 0.08); border: 1px solid rgba(234, 179, 8, 0.25); color: #fde68a; margin-bottom: 1rem; }
.fed-sub { display: block; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--fg-subtle); }
.fed-modal-scopes { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-top: 0.5rem; }
@media (max-width: 560px) { .fed-modal-scopes { grid-template-columns: 1fr; } }
</style>
