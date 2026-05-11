<template>
  <!--
    Admin notifications page — operator dispatch board.

    Visual identity: SOC / mission-control. Channels are buckets
    derived from their state, not a flat 10-card grid:

      • LIVE — enabled + last test OK → the fleet is operational.
        Green status light, compact, "Test" + "Edit" buttons.
      • ACTION REQUIRED — enabled but failing or never tested →
        the things the operator needs to deal with. Amber/red
        pulse, inline error message, "Re-test" CTA prominent.
      • AVAILABLE — disabled / unconfigured → optional transports
        the admin can opt into. Muted, dashed border, "Enable" or
        "Configure" CTA.

    Above the buckets, a 4-tile fleet-status strip surfaces the
    counts at a glance (Live / Action / Available / Total), with
    coin-gold accents threading through each numbered section
    header. Click a card → it expands into the config form
    in-place (same drawer pattern as the user-side settings
    redesign but with richer fields).
  -->
  <div v-if="loaded" class="ops">
    <!-- ── Fleet status strip ──────────────────────────────────── -->
    <section class="fleet">
      <article class="stat stat--live">
        <span class="stat-num tabular-nums">{{ liveChannels.length }}</span>
        <span class="stat-label">{{ $t('admin.notifications.fleet.live') }}</span>
        <span class="stat-dot stat-dot--live" />
      </article>
      <article class="stat stat--action">
        <span class="stat-num tabular-nums">{{ actionChannels.length }}</span>
        <span class="stat-label">{{ $t('admin.notifications.fleet.action') }}</span>
        <span class="stat-dot stat-dot--action" :class="{ 'stat-dot--pulse': actionChannels.length > 0 }" />
      </article>
      <article class="stat stat--available">
        <span class="stat-num tabular-nums">{{ availableChannels.length }}</span>
        <span class="stat-label">{{ $t('admin.notifications.fleet.available') }}</span>
        <span class="stat-dot stat-dot--available" />
      </article>
      <article class="stat stat--total">
        <span class="stat-num tabular-nums">{{ channels.length }}</span>
        <span class="stat-label">{{ $t('admin.notifications.fleet.total') }}</span>
        <span class="stat-rule" aria-hidden="true" />
      </article>
    </section>

    <!-- ── Section 01 — Live ───────────────────────────────────── -->
    <section v-if="liveChannels.length > 0" class="bucket bucket--live">
      <header class="bucket-head">
        <span class="bucket-num">01</span>
        <div class="bucket-id">
          <h2>{{ $t('admin.notifications.live.title') }}</h2>
          <p>{{ $t('admin.notifications.live.desc') }}</p>
        </div>
        <span class="bucket-meta">
          <strong>{{ liveChannels.length }}</strong>
          {{ $t('admin.notifications.fleet.channels', liveChannels.length, { n: liveChannels.length }) }}
        </span>
      </header>
      <ul class="card-grid">
        <ChannelCard
          v-for="(ch, i) in liveChannels"
          :key="ch.type"
          :ch="ch"
          :busy-state="busy[ch.type]"
          :expanded="!!expanded[ch.type]"
          :server-config="serverConfig[ch.type] ?? {}"
          :stagger-index="i"
          variant="live"
          @toggle-expand="toggleExpand(ch.type)"
          @toggle-enabled="toggleEnabled(ch, $event)"
          @save="saveConfig(ch)"
          @test="testChannel(ch)"
          @field-change="onFieldChange"
        />
      </ul>
    </section>

    <!-- ── Section 02 — Action required ───────────────────────── -->
    <section v-if="actionChannels.length > 0" class="bucket bucket--action">
      <header class="bucket-head">
        <span class="bucket-num">02</span>
        <div class="bucket-id">
          <h2>{{ $t('admin.notifications.action.title') }}</h2>
          <p>{{ $t('admin.notifications.action.desc') }}</p>
        </div>
        <span class="bucket-meta">
          <strong>{{ actionChannels.length }}</strong>
          {{ $t('admin.notifications.fleet.channels', actionChannels.length, { n: actionChannels.length }) }}
        </span>
      </header>
      <ul class="card-grid">
        <ChannelCard
          v-for="(ch, i) in actionChannels"
          :key="ch.type"
          :ch="ch"
          :busy-state="busy[ch.type]"
          :expanded="!!expanded[ch.type]"
          :server-config="serverConfig[ch.type] ?? {}"
          :stagger-index="i"
          variant="action"
          @toggle-expand="toggleExpand(ch.type)"
          @toggle-enabled="toggleEnabled(ch, $event)"
          @save="saveConfig(ch)"
          @test="testChannel(ch)"
          @field-change="onFieldChange"
        />
      </ul>
    </section>

    <!-- ── Section 03 — Available ─────────────────────────────── -->
    <section v-if="availableChannels.length > 0" class="bucket bucket--available">
      <header class="bucket-head">
        <span class="bucket-num">03</span>
        <div class="bucket-id">
          <h2>{{ $t('admin.notifications.available.title') }}</h2>
          <p>{{ $t('admin.notifications.available.desc') }}</p>
        </div>
        <span class="bucket-meta">
          <strong>{{ availableChannels.length }}</strong>
          {{ $t('admin.notifications.fleet.channels', availableChannels.length, { n: availableChannels.length }) }}
        </span>
      </header>
      <ul class="card-grid">
        <ChannelCard
          v-for="(ch, i) in availableChannels"
          :key="ch.type"
          :ch="ch"
          :busy-state="busy[ch.type]"
          :expanded="!!expanded[ch.type]"
          :server-config="serverConfig[ch.type] ?? {}"
          :stagger-index="i"
          variant="available"
          @toggle-expand="toggleExpand(ch.type)"
          @toggle-enabled="toggleEnabled(ch, $event)"
          @save="saveConfig(ch)"
          @test="testChannel(ch)"
          @field-change="onFieldChange"
        />
      </ul>
    </section>
  </div>

  <div v-else class="ops-loading">
    <Icon name="ph:circle-notch" class="animate-spin" />
  </div>
</template>

<script setup lang="ts">
import ChannelCard from '~/components/admin/notifications/ChannelCard.vue';

definePageMeta({
  middleware: 'admin',
});

interface AdminChannel {
  type: string;
  labelKey: string;
  taglineKey: string;
  icon: string;
  hasServerConfig: boolean;
  serverFields: {
    key: string;
    labelKey: string;
    hintKey?: string;
    type: string;
    required: boolean;
    secret?: boolean;
    default?: unknown;
  }[];
  userFields: unknown[];
  enabled: boolean;
  configured: boolean;
  lastTestStatus: 'ok' | 'error' | null;
  lastTestError: string | null;
  lastTestedAt: string | null;
  defaults: Record<string, unknown>;
  serverValues?: Record<string, unknown>;
}

const channels = ref<AdminChannel[]>([]);
const loaded = ref(false);
const busy = reactive<Record<string, 'saving' | 'testing' | null>>({});
// Per-channel form values: stored values + admin defaults +
// whatever the form has been typing live.
const serverConfig = reactive<Record<string, Record<string, any>>>({});
// Per-channel expansion (one card open at a time isn't strictly
// required — multiple may be open simultaneously).
const expanded = reactive<Record<string, boolean>>({});

async function refresh() {
  const res = await $fetch<{ channels: AdminChannel[] }>(
    '/api/admin/notification-channels',
  );
  channels.value = res.channels;
  for (const ch of res.channels) {
    serverConfig[ch.type] = {
      ...(ch.defaults || {}),
      ...(ch.serverValues || {}),
    };
  }
  loaded.value = true;
}

onMounted(() => {
  void refresh();
});

// ── Bucket derivation ─────────────────────────────────────────
// LIVE: enabled AND last admin test was OK. The user UI only
// exposes these to non-admin accounts.
const liveChannels = computed(() =>
  channels.value.filter((c) => c.enabled && c.lastTestStatus === 'ok'),
);
// ACTION REQUIRED: enabled but failing OR untested. The admin
// needs to retest after a config change, or fix credentials.
const actionChannels = computed(() =>
  channels.value.filter((c) => c.enabled && c.lastTestStatus !== 'ok'),
);
// AVAILABLE: disabled. Either never set up, or temporarily turned
// off. The admin can flip these on with one click.
const availableChannels = computed(() =>
  channels.value.filter((c) => !c.enabled),
);

// ── Mutations ─────────────────────────────────────────────────
function toggleExpand(type: string) {
  expanded[type] = !expanded[type];
}

function onFieldChange(payload: { type: string; key: string; value: any }) {
  if (!serverConfig[payload.type]) serverConfig[payload.type] = {};
  serverConfig[payload.type][payload.key] = payload.value;
}

async function toggleEnabled(ch: AdminChannel, enabled: boolean) {
  busy[ch.type] = 'saving';
  try {
    await $fetch(`/api/admin/notification-channels/${ch.type}`, {
      method: 'PUT',
      body: { enabled },
    });
    await refresh();
  } finally {
    busy[ch.type] = null;
  }
}

async function saveConfig(ch: AdminChannel) {
  busy[ch.type] = 'saving';
  try {
    // Strip empty strings on secret fields so we don't blank out a
    // stored password just because the admin didn't re-type it.
    const cleaned: Record<string, unknown> = {};
    for (const f of ch.serverFields) {
      const v = serverConfig[ch.type]?.[f.key];
      if (f.secret && (v === '' || v == null)) continue;
      if (v === '' || v == null) continue;
      cleaned[f.key] = v;
    }
    await $fetch(`/api/admin/notification-channels/${ch.type}`, {
      method: 'PUT',
      body: { serverConfig: cleaned },
    });
    await refresh();
  } finally {
    busy[ch.type] = null;
  }
}

async function testChannel(ch: AdminChannel) {
  busy[ch.type] = 'testing';
  try {
    await $fetch(`/api/admin/notification-channels/${ch.type}/test`, {
      method: 'POST',
    });
    await refresh();
  } finally {
    busy[ch.type] = null;
  }
}
</script>

<style scoped>
.ops {
  display: flex;
  flex-direction: column;
  gap: 2.25rem;
  position: relative;
}
.ops::before {
  /* Hairline gold rail along the left edge of the page body —
     same thread the /me bonus tile and the user-side notifications
     section use. Signals "this is a notifications surface". */
  content: '';
  position: absolute;
  left: -0.75rem;
  top: 0;
  bottom: 0;
  width: 1px;
  background: linear-gradient(
    to bottom,
    rgba(212, 167, 52, 0) 0%,
    rgba(212, 167, 52, 0.35) 12%,
    rgba(212, 167, 52, 0.35) 88%,
    rgba(212, 167, 52, 0) 100%
  );
  pointer-events: none;
}

.ops-loading {
  display: grid;
  place-items: center;
  padding: 4rem 2rem;
  color: rgb(var(--fg-muted));
  font-size: 1.5rem;
}

/* ── Fleet status strip ──────────────────────────────────────── */
.fleet {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  background: rgb(var(--bg-elevated));
  overflow: hidden;
  position: relative;
}
.fleet::before {
  content: '';
  position: absolute;
  inset-inline: 1rem;
  top: 0;
  height: 1px;
  background: linear-gradient(
    to right,
    rgba(212, 167, 52, 0.6) 0%,
    rgba(212, 167, 52, 0.2) 60%,
    rgba(212, 167, 52, 0) 100%
  );
}
@media (max-width: 720px) {
  .fleet {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.stat {
  position: relative;
  padding: 1.1rem 1.2rem 1.2rem;
  border-right: 1px solid rgb(var(--line-default));
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.stat:last-child {
  border-right: 0;
}
@media (max-width: 720px) {
  .stat {
    border-bottom: 1px solid rgb(var(--line-default));
  }
  .stat:nth-child(2n) {
    border-right: 0;
  }
  .stat:nth-last-child(-n + 2) {
    border-bottom: 0;
  }
}
.stat-num {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: clamp(1.6rem, 3vw, 2.1rem);
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1;
  color: rgb(var(--fg-strong));
}
.stat--live .stat-num {
  color: rgb(var(--online));
}
.stat--action .stat-num {
  color: rgb(var(--warning));
}
.stat--available .stat-num {
  color: rgb(var(--fg-muted));
}
.stat-label {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.stat-dot,
.stat-rule {
  position: absolute;
  top: 1.2rem;
  right: 1.1rem;
}
.stat-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgb(var(--fg-faint));
}
.stat-dot--live {
  background: rgb(var(--online));
  box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.15);
}
.stat-dot--action {
  background: rgb(var(--warning));
  box-shadow: 0 0 0 4px rgba(234, 179, 8, 0.15);
}
.stat-dot--pulse {
  animation: ops-pulse 1.6s ease-in-out infinite;
}
.stat-dot--available {
  background: rgb(var(--fg-faint));
}
.stat-rule {
  width: 18px;
  height: 2px;
  background: #d4a734;
  top: 1.45rem;
  border-radius: 1px;
}

/* ── Bucket scaffolding ──────────────────────────────────────── */
.bucket {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.bucket-head {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.85rem;
  padding-bottom: 0.85rem;
  border-bottom: 1px solid rgb(var(--line-default));
  position: relative;
}
.bucket-head::after {
  /* Short gold accent that matches the section number — anchors
     the row visually. */
  content: '';
  position: absolute;
  left: 0;
  bottom: -1px;
  width: 40px;
  height: 1px;
  background: #d4a734;
}
.bucket-num {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.2em;
  color: #d4a734;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgba(212, 167, 52, 0.35);
  padding: 0.3rem 0.55rem;
  border-radius: var(--radius-sm);
}
.bucket-id h2 {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
}
.bucket-id p {
  margin: 0.2rem 0 0;
  font-size: 0.78rem;
  color: rgb(var(--fg-muted));
}
.bucket-meta {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  letter-spacing: 0.1em;
  color: rgb(var(--fg-muted));
  text-transform: uppercase;
}
.bucket-meta strong {
  color: rgb(var(--fg-strong));
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 640px) {
  .bucket-head {
    grid-template-columns: auto 1fr;
  }
  .bucket-meta {
    grid-column: 1 / -1;
    margin-top: 0.3rem;
  }
}

/* ── Card grid ───────────────────────────────────────────────── */
.card-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.85rem;
}
@media (min-width: 900px) {
  .card-grid {
    grid-template-columns: 1fr 1fr;
  }
  .card-grid > :global(.cc--open) {
    grid-column: 1 / -1;
  }
}

@keyframes ops-pulse {
  0%, 100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.18);
    opacity: 0.7;
  }
}
</style>
