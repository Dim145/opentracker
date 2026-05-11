<template>
  <!--
    Admin page for external notification channels.

    One card per channel adapter (10 total). Each card exposes:
      • Enable / disable toggle
      • Server-side config form (host, port, token, … — channel-
        specific). Webhook-only channels (Discord, Slack, Mattermost)
        skip the form.
      • Last-test status and (on failure) the error tooltip
      • Test button — runs `testServer` on the saved config

    Once a channel is enabled AND `lastTestStatus = 'ok'`, users can
    add it in /settings. The card surface is muted (border-dashed,
    desaturated) when the channel is disabled — same affordance as
    the BonusEvents card.
  -->
  <div class="space-y-6">
    <header class="card-head">
      <p class="card-eyebrow">{{ $t('admin.notifications.channels.eyebrow') }}</p>
      <h2 class="card-title">{{ $t('admin.notifications.channels.title') }}</h2>
      <p class="card-desc">{{ $t('admin.notifications.channels.desc') }}</p>
    </header>

    <div v-if="!loaded" class="empty">
      <Icon name="ph:circle-notch" class="animate-spin" />
    </div>

    <div v-else class="channel-grid">
      <article
        v-for="ch in channels"
        :key="ch.type"
        class="channel-card"
        :class="{ 'channel-card--off': !ch.enabled }"
      >
        <header class="channel-head">
          <div class="channel-id">
            <Icon :name="ch.icon" class="channel-icon" />
            <div>
              <h3 class="channel-title">{{ $t(ch.labelKey) }}</h3>
              <p class="channel-tagline">{{ $t(ch.taglineKey) }}</p>
            </div>
          </div>
          <label class="toggle">
            <input
              type="checkbox"
              :checked="ch.enabled"
              :disabled="!!busy[ch.type]"
              @change="toggleEnabled(ch, ($event.target as HTMLInputElement).checked)"
            />
            <span class="toggle-track" />
          </label>
        </header>

        <div class="channel-body">
          <!-- Pure user-channel notice (Discord/Slack/Mattermost) -->
          <p
            v-if="!ch.hasServerConfig"
            class="channel-note"
          >
            <Icon name="ph:info" />
            {{ $t('admin.notifications.channels.userOwned') }}
          </p>

          <!-- Server config form -->
          <div v-else class="channel-form">
            <label v-for="f in ch.serverFields" :key="f.key" class="field">
              <span class="field-label">{{ $t(f.labelKey) }}</span>
              <span v-if="f.hintKey" class="field-hint">{{ $t(f.hintKey) }}</span>
              <input
                v-if="f.type === 'bool'"
                type="checkbox"
                :checked="!!serverConfig[ch.type][f.key]"
                @change="serverConfig[ch.type][f.key] = ($event.target as HTMLInputElement).checked"
              />
              <input
                v-else-if="f.type === 'int'"
                type="number"
                :placeholder="String(f.default ?? '')"
                :value="serverConfig[ch.type][f.key]"
                @input="serverConfig[ch.type][f.key] = Number(($event.target as HTMLInputElement).value)"
              />
              <input
                v-else-if="f.type === 'password' || f.secret"
                type="password"
                autocomplete="new-password"
                :placeholder="ch.configured ? $t('admin.notifications.channels.keepSecret') : ''"
                :value="serverConfig[ch.type][f.key]"
                @input="serverConfig[ch.type][f.key] = ($event.target as HTMLInputElement).value"
              />
              <input
                v-else
                :type="f.type === 'email' ? 'email' : f.type === 'url' ? 'url' : 'text'"
                :placeholder="f.default ? String(f.default) : ''"
                :value="serverConfig[ch.type][f.key]"
                @input="serverConfig[ch.type][f.key] = ($event.target as HTMLInputElement).value"
              />
            </label>
          </div>

          <!-- Status + actions -->
          <div class="channel-foot">
            <div class="status">
              <span
                class="status-dot"
                :class="`status-dot--${ch.lastTestStatus ?? 'none'}`"
              />
              <span class="status-text">
                <template v-if="ch.lastTestStatus === 'ok'">
                  {{ $t('admin.notifications.channels.statusOk', { date: relTime(ch.lastTestedAt) }) }}
                </template>
                <template v-else-if="ch.lastTestStatus === 'error'">
                  {{ $t('admin.notifications.channels.statusError') }}
                </template>
                <template v-else>
                  {{ $t('admin.notifications.channels.statusUntested') }}
                </template>
              </span>
            </div>
            <div class="actions">
              <button
                v-if="ch.hasServerConfig"
                type="button"
                class="btn"
                :disabled="!!busy[ch.type]"
                @click="saveConfig(ch)"
              >
                <Icon
                  :name="busy[ch.type] === 'saving' ? 'ph:circle-notch' : 'ph:floppy-disk-bold'"
                  :class="busy[ch.type] === 'saving' ? 'animate-spin' : ''"
                />
                {{ $t('common.save') }}
              </button>
              <button
                type="button"
                class="btn btn--primary"
                :disabled="!ch.enabled || !!busy[ch.type]"
                @click="testChannel(ch)"
              >
                <Icon
                  :name="busy[ch.type] === 'testing' ? 'ph:circle-notch' : 'ph:paper-plane-tilt-bold'"
                  :class="busy[ch.type] === 'testing' ? 'animate-spin' : ''"
                />
                {{ $t('admin.notifications.channels.test') }}
              </button>
            </div>
          </div>

          <p
            v-if="ch.lastTestStatus === 'error' && ch.lastTestError"
            class="error-detail"
            :title="ch.lastTestError"
          >
            <Icon name="ph:warning-bold" />
            {{ ch.lastTestError }}
          </p>
        </div>
      </article>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({
  middleware: 'admin',
});

interface AdminChannel {
  type: string;
  labelKey: string;
  taglineKey: string;
  icon: string;
  hasServerConfig: boolean;
  serverFields: { key: string; labelKey: string; hintKey?: string; type: string; required: boolean; secret?: boolean; default?: unknown }[];
  userFields: unknown[];
  enabled: boolean;
  configured: boolean;
  lastTestStatus: 'ok' | 'error' | null;
  lastTestError: string | null;
  lastTestedAt: string | null;
  defaults: Record<string, unknown>;
  /** Decrypted server values for non-secret fields. Lets the admin
   *  form re-hydrate after a save instead of looking empty. Secret
   *  fields (passwords, tokens, HMAC) are stripped server-side. */
  serverValues?: Record<string, unknown>;
}

const channels = ref<AdminChannel[]>([]);
const loaded = ref(false);
const busy = reactive<Record<string, 'saving' | 'testing' | null>>({});
// Pending server-side config edits per channel — typed as a record of
// the field key → value the form currently shows. Reset on `refresh()`.
const serverConfig = reactive<Record<string, Record<string, any>>>({});

const { t } = useI18n();

async function refresh() {
  const res = await $fetch<{ channels: AdminChannel[] }>(
    '/api/admin/notification-channels'
  );
  channels.value = res.channels;
  for (const ch of res.channels) {
    // Hydrate the form with:
    //   1. the stored non-secret values (when the row exists),
    //      so a re-open shows the host/port/from the admin entered
    //      last time;
    //   2. otherwise the adapter's defaults (e.g. SMTP port 587,
    //      ntfy base URL https://ntfy.sh).
    // Secret fields stay empty — the placeholder communicates
    // "leave blank to preserve" and the PUT route merges them in.
    serverConfig[ch.type] = {
      ...(ch.defaults || {}),
      ...(ch.serverValues || {}),
    };
  }
  loaded.value = true;
}

// Run the initial fetch on the client only — `$fetch` doesn't
// forward the auth cookie during SSR, which would surface as a
// 401 on the admin GET. Same pattern as Roles.vue and the other
// admin panels.
onMounted(() => {
  void refresh();
});

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

function relTime(iso: string | null): string {
  if (!iso) return t('common.never');
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return t('common.justNow');
  if (mins < 60) return t('common.minutesAgo', { n: mins });
  const hours = Math.round(mins / 60);
  if (hours < 24) return t('common.hoursAgo', { n: hours });
  return new Date(iso).toLocaleDateString();
}
</script>

<style scoped>
.card-head {
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.5rem;
  background: rgb(var(--bg-elevated));
  padding: 1.25rem 1.5rem;
}
.card-eyebrow {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  margin: 0 0 0.5rem;
}
.card-title {
  font-size: 1.1rem;
  font-weight: 800;
  margin: 0 0 0.5rem;
  color: rgb(var(--fg-strong));
}
.card-desc {
  font-size: 0.85rem;
  color: rgb(var(--fg-muted));
  margin: 0;
}

.empty {
  padding: 3rem;
  text-align: center;
  color: rgb(var(--fg-muted));
}

.channel-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: 1fr;
}
@media (min-width: 980px) {
  .channel-grid {
    grid-template-columns: 1fr 1fr;
  }
}

.channel-card {
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.5rem;
  background: rgb(var(--bg-elevated));
  display: flex;
  flex-direction: column;
}
.channel-card--off {
  opacity: 0.7;
  border-style: dashed;
}
.channel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.1rem 1.25rem;
  border-bottom: 1px solid rgb(var(--line-default));
}
.channel-id {
  display: flex;
  align-items: center;
  gap: 0.85rem;
}
.channel-icon {
  font-size: 1.5rem;
  color: rgb(var(--fg-strong));
}
.channel-title {
  font-size: 0.95rem;
  font-weight: 700;
  color: rgb(var(--fg-strong));
  margin: 0;
}
.channel-tagline {
  font-size: 0.7rem;
  color: rgb(var(--fg-muted));
  margin: 0.15rem 0 0;
}

.toggle {
  position: relative;
  display: inline-block;
  width: 36px;
  height: 20px;
}
.toggle input {
  position: absolute;
  opacity: 0;
  inset: 0;
  cursor: pointer;
}
.toggle-track {
  position: absolute;
  inset: 0;
  background: rgb(var(--line-default));
  border-radius: 999px;
  transition: background 0.18s ease;
}
.toggle-track::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background: white;
  border-radius: 50%;
  transition: transform 0.18s ease;
}
.toggle input:checked + .toggle-track {
  background: #6cd161;
}
.toggle input:checked + .toggle-track::after {
  transform: translateX(16px);
}

.channel-body {
  padding: 1.1rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  flex: 1;
}
.channel-note {
  font-size: 0.78rem;
  color: rgb(var(--fg-muted));
  display: flex;
  gap: 0.4rem;
  align-items: center;
  margin: 0;
  padding: 0.7rem 0.85rem;
  background: rgb(var(--bg-base) / 0.6);
  border-radius: 0.35rem;
  border: 1px dashed rgb(var(--line-default));
}

.channel-form {
  display: grid;
  gap: 0.65rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.field-label {
  font-size: 0.78rem;
  font-weight: 600;
  color: rgb(var(--fg-strong));
}
.field-hint {
  font-size: 0.7rem;
  color: rgb(var(--fg-muted));
}
.field input[type='text'],
.field input[type='email'],
.field input[type='url'],
.field input[type='password'],
.field input[type='number'] {
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.35rem;
  padding: 0.5rem 0.7rem;
  color: rgb(var(--fg-strong));
  font-size: 0.85rem;
}
.field input[type='checkbox'] {
  align-self: flex-start;
  width: 1.1rem;
  height: 1.1rem;
}

.channel-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  flex-wrap: wrap;
  margin-top: auto;
}
.status {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.74rem;
  color: rgb(var(--fg-muted));
  font-family: ui-monospace, SFMono-Regular, monospace;
}
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgb(var(--line-default));
}
.status-dot--ok {
  background: #6cd161;
  box-shadow: 0 0 0 3px rgba(108, 209, 97, 0.18);
}
.status-dot--error {
  background: #ff6b6b;
  box-shadow: 0 0 0 3px rgba(255, 107, 107, 0.18);
}
.actions {
  display: flex;
  gap: 0.4rem;
}
.btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.45rem 0.75rem;
  border-radius: 0.35rem;
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-base));
  color: rgb(var(--fg-strong));
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
}
.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.btn--primary {
  background: rgb(var(--accent));
  color: rgb(var(--accent-fg));
  border-color: rgb(var(--accent));
}

.error-detail {
  margin: 0;
  font-size: 0.74rem;
  color: #ff6b6b;
  display: flex;
  align-items: flex-start;
  gap: 0.4rem;
  background: rgba(255, 107, 107, 0.08);
  padding: 0.5rem 0.7rem;
  border-radius: 0.3rem;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
