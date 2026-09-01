<template>
  <div class="irc">
    <header class="irc-head">
      <div>
        <p class="irc-eyebrow">{{ $t('admin.irc.eyebrow') }}</p>
        <h1 class="irc-title">{{ $t('admin.irc.title') }}</h1>
        <p class="irc-lede">{{ $t('admin.irc.lede') }}</p>
      </div>

      <!-- State first. An operator opening this page is almost always here to
           find out whether the bot is in the channel. -->
      <div class="irc-state" :class="`irc-state--${state}`">
        <span class="irc-dot" />
        <div>
          <p class="irc-state-label">{{ $t(`admin.irc.states.${state}`) }}</p>
          <p v-if="status?.nick" class="irc-state-sub">{{ status.nick }}</p>
          <p v-else-if="status?.lastError" class="irc-state-sub">{{ status.lastError }}</p>
        </div>
      </div>
    </header>

    <!-- Said plainly, because a console that shows `idle` on a working bot is
         how an operator concludes the feature is broken. -->
    <p v-if="status && !status.leader && enabled" class="irc-notice">
      <Icon name="ph:info" />
      {{ $t('admin.irc.notLeader') }}
    </p>

    <form class="irc-form" @submit.prevent="save">
      <section class="irc-card">
        <h2>{{ $t('admin.irc.sections.connection') }}</h2>
        <label class="irc-switch">
          <input v-model="form.enabled" type="checkbox" />
          <span>{{ $t('admin.irc.fields.enabled') }}</span>
        </label>
        <p class="irc-help">{{ $t('admin.irc.hints.enabled') }}</p>

        <div class="irc-grid">
          <div class="irc-field">
            <label for="irc-host">{{ $t('admin.irc.fields.host') }}</label>
            <input id="irc-host" v-model="form.host" class="input" autocomplete="off" placeholder="irc.example.com" />
          </div>
          <div class="irc-field irc-field--narrow">
            <label for="irc-port">{{ $t('admin.irc.fields.port') }}</label>
            <input id="irc-port" v-model.number="form.port" class="input" type="number" min="1" max="65535" />
          </div>
          <div class="irc-field irc-field--narrow">
            <label class="irc-switch irc-switch--inline">
              <input v-model="form.tls" type="checkbox" />
              <span>{{ $t('admin.irc.fields.tls') }}</span>
            </label>
          </div>
          <div class="irc-field">
            <label for="irc-nick">{{ $t('admin.irc.fields.nick') }}</label>
            <input id="irc-nick" v-model="form.nick" class="input" autocomplete="off" />
            <span class="irc-help">{{ $t('admin.irc.hints.nick') }}</span>
          </div>
          <div class="irc-field">
            <label for="irc-channel">{{ $t('admin.irc.fields.channel') }}</label>
            <input id="irc-channel" v-model="form.channel" class="input" autocomplete="off" placeholder="#announce" />
          </div>
          <div class="irc-field">
            <label for="irc-key">{{ $t('admin.irc.fields.channelKey') }}</label>
            <input
              id="irc-key"
              v-model="form.channelKey"
              class="input"
              type="password"
              autocomplete="new-password"
              :placeholder="config?.hasChannelKey ? $t('admin.irc.kept') : ''"
            />
          </div>
        </div>
      </section>

      <section class="irc-card">
        <h2>{{ $t('admin.irc.sections.auth') }}</h2>
        <p class="irc-help">{{ $t('admin.irc.hints.auth') }}</p>
        <div class="irc-grid">
          <div class="irc-field">
            <label for="irc-sasl-user">{{ $t('admin.irc.fields.saslUser') }}</label>
            <input id="irc-sasl-user" v-model="form.saslUser" class="input" autocomplete="off" />
          </div>
          <div class="irc-field">
            <label for="irc-sasl-pass">{{ $t('admin.irc.fields.saslPassword') }}</label>
            <input
              id="irc-sasl-pass"
              v-model="form.saslPassword"
              class="input"
              type="password"
              autocomplete="new-password"
              :placeholder="config?.hasSaslPassword ? $t('admin.irc.kept') : ''"
            />
          </div>
          <div class="irc-field">
            <label for="irc-server-pass">{{ $t('admin.irc.fields.serverPassword') }}</label>
            <input
              id="irc-server-pass"
              v-model="form.serverPassword"
              class="input"
              type="password"
              autocomplete="new-password"
              :placeholder="config?.hasServerPassword ? $t('admin.irc.kept') : ''"
            />
          </div>
        </div>

        <div class="irc-field">
          <label for="irc-perform">{{ $t('admin.irc.fields.perform') }}</label>
          <textarea
            id="irc-perform"
            v-model="performText"
            class="input irc-mono"
            rows="3"
            spellcheck="false"
            placeholder="PRIVMSG Voyager :invite trackarr KEY"
          />
          <span class="irc-help">{{ $t('admin.irc.hints.perform') }}</span>
        </div>
      </section>

      <section class="irc-card">
        <h2>{{ $t('admin.irc.sections.line') }}</h2>
        <div class="irc-field">
          <label for="irc-template">{{ $t('admin.irc.fields.template') }}</label>
          <textarea
            id="irc-template"
            v-model="form.template"
            class="input irc-mono"
            rows="3"
            spellcheck="false"
          />
          <span class="irc-help">{{ $t('admin.irc.hints.template') }}</span>
        </div>

        <!-- The rendered line, live. An operator editing a format needs to see
             the output, not a description of it. -->
        <div class="irc-preview">
          <p class="irc-preview-label">{{ $t('admin.irc.preview') }}</p>
          <p class="irc-preview-line">{{ preview }}</p>
        </div>

        <details class="irc-tokens">
          <summary>{{ $t('admin.irc.tokensTitle') }}</summary>
          <ul>
            <li v-for="tok in tokens" :key="tok.name">
              <code>{{ '{' + tok.name + '}' }}</code>
              <span>{{ tok.describes }}</span>
              <em v-if="tok.variable">{{ tok.variable }}</em>
              <em v-else class="irc-unmapped">{{ $t('admin.irc.unmapped') }}</em>
            </li>
          </ul>
        </details>

        <div class="irc-grid">
          <div class="irc-field">
            <label for="irc-siteurl">{{ $t('admin.irc.fields.siteUrl') }}</label>
            <input id="irc-siteurl" v-model="form.siteUrl" class="input" placeholder="https://tracker.example.com" />
            <span class="irc-help">{{ $t('admin.irc.hints.siteUrl') }}</span>
          </div>
          <div class="irc-field">
            <label class="irc-switch irc-switch--inline">
              <input v-model="form.announceAdult" type="checkbox" />
              <span>{{ $t('admin.irc.fields.announceAdult') }}</span>
            </label>
            <span class="irc-help">{{ $t('admin.irc.hints.announceAdult') }}</span>
          </div>
        </div>
      </section>

      <div class="irc-actions">
        <button type="submit" class="btn btn-primary" :disabled="saving">
          <Icon :name="saving ? 'ph:circle-notch' : 'ph:check'" :class="{ 'irc-spin': saving }" />
          {{ $t('common.save') }}
        </button>
        <button
          type="button"
          class="btn btn-secondary"
          :disabled="testing || state !== 'ready'"
          @click="sendTest"
        >
          <Icon :name="testing ? 'ph:circle-notch' : 'ph:paper-plane-tilt'" :class="{ 'irc-spin': testing }" />
          {{ $t('admin.irc.test') }}
        </button>
        <a
          v-if="enabled"
          href="/api/irc/autobrr.yml"
          class="btn btn-ghost"
          download
        >
          <Icon name="ph:download-simple" />
          {{ $t('admin.irc.definition') }}
        </a>
        <span v-if="message" class="irc-message" :class="{ 'irc-message--bad': failed }">
          {{ message }}
        </span>
      </div>
    </form>

    <section v-if="status" class="irc-card irc-card--stats">
      <h2>{{ $t('admin.irc.sections.traffic') }}</h2>
      <dl class="irc-stats">
        <div><dt>{{ $t('admin.irc.stats.sent') }}</dt><dd>{{ status.sent }}</dd></div>
        <div><dt>{{ $t('admin.irc.stats.queued') }}</dt><dd>{{ status.queued }}</dd></div>
        <div><dt>{{ $t('admin.irc.stats.dropped') }}</dt><dd>{{ status.dropped }}</dd></div>
        <div>
          <dt>{{ $t('admin.irc.stats.since') }}</dt>
          <dd>{{ status.since ? new Date(status.since).toLocaleString() : '—' }}</dd>
        </div>
      </dl>
      <p v-if="status.dropped > 0" class="irc-help">{{ $t('admin.irc.hints.dropped') }}</p>
    </section>
  </div>
</template>

<script setup lang="ts">
/**
 * The announce bot's console.
 *
 * Three things on this page are decisions rather than layout:
 *
 * 1. **The state block is at the top, next to the title.** Whatever else an
 *    operator came for, the first question is always "is it in the channel".
 * 2. **The rendered line is shown live, under the template field.** The format
 *    is a contract with software nobody here controls, and the only honest way
 *    to edit one is to watch what it produces. The same string is what the
 *    generated autobrr definition is tested against on save.
 * 3. **A blank password field means "keep the stored one".** The GET never
 *    returns a secret, so a form that round-tripped what it received would
 *    erase all three on the first save.
 */
definePageMeta({ middleware: 'admin' });

const { t } = useI18n();

interface IrcToken {
  name: string;
  variable: string | null;
  describes: string;
}
interface IrcPayload {
  enabled: boolean;
  config: {
    host: string;
    port: number;
    tls: boolean;
    nick: string;
    realname: string;
    serverPassword: string;
    saslUser: string;
    saslPassword: string;
    perform: string[];
    channel: string;
    channelKey: string;
    template: string;
    siteUrl: string;
    announceAdult: boolean;
    hasServerPassword: boolean;
    hasSaslPassword: boolean;
    hasChannelKey: boolean;
  };
  status: {
    state: string;
    nick: string;
    since: number | null;
    lastError: string | null;
    queued: number;
    sent: number;
    dropped: number;
    leader: boolean;
  };
  tokens: IrcToken[];
  defaultTemplate: string;
  pattern: string;
}

const { data, refresh } = await useFetch<IrcPayload>('/api/admin/irc');

const config = computed(() => data.value?.config);
const status = computed(() => data.value?.status);
const tokens = computed(() => data.value?.tokens ?? []);
const enabled = computed(() => !!data.value?.enabled);
const state = computed(() => status.value?.state ?? 'idle');

const form = reactive({
  enabled: false,
  host: '',
  port: 6697,
  tls: true,
  nick: '',
  realname: '',
  serverPassword: '',
  saslUser: '',
  saslPassword: '',
  channel: '#announce',
  channelKey: '',
  template: '',
  siteUrl: '',
  announceAdult: false,
});
const performText = ref('');

watchEffect(() => {
  const c = config.value;
  if (!c) return;
  form.enabled = !!data.value?.enabled;
  form.host = c.host;
  form.port = c.port;
  form.tls = c.tls;
  form.nick = c.nick;
  form.realname = c.realname;
  form.saslUser = c.saslUser;
  form.channel = c.channel;
  form.template = c.template;
  form.siteUrl = c.siteUrl;
  form.announceAdult = c.announceAdult;
  performText.value = c.perform.join('\n');
});

/**
 * The line as the channel will see it, rendered here rather than round-tripped
 * to the server: an operator editing a template should not have to save a
 * broken one to find out it is broken.
 *
 * Deliberately a simple substitution rather than an import of the server's
 * renderer — the API validates the real thing on save, including that the
 * derived pattern reads it back, and duplicating the sanitiser in the browser
 * would be a second definition of a security boundary.
 */
const SAMPLE: Record<string, string> = {
  name: 'Example.Release.2026.1080p.BluRay.x264-GROUP',
  category: 'Movies',
  size: '14.62 GiB',
  freeleechPercent: '100%',
  uploadFactor: '2',
  tags: '1080p, bluray, x264',
  uploader: 'example',
  url: 'https://tracker.example.com/torrents/0123…4567',
  infoHash: '0123456789abcdef0123456789abcdef01234567',
};
const preview = computed(() =>
  (form.template || '').replace(/\{(\w+)\}/g, (whole, token: string) =>
    token in SAMPLE ? SAMPLE[token]! : whole
  )
);

const saving = ref(false);
const testing = ref(false);
const message = ref('');
const failed = ref(false);

async function save() {
  saving.value = true;
  message.value = '';
  failed.value = false;
  try {
    await $fetch('/api/admin/irc', {
      method: 'PUT',
      body: {
        ...form,
        // Empty means unchanged; the API only clears a secret on an explicit
        // null, which this form never sends — clearing one is done by removing
        // the whole configuration.
        serverPassword: form.serverPassword || undefined,
        saslPassword: form.saslPassword || undefined,
        channelKey: form.channelKey || undefined,
        perform: performText.value
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
      },
    });
    form.serverPassword = '';
    form.saslPassword = '';
    form.channelKey = '';
    message.value = t('admin.irc.saved');
    await refresh();
  } catch (err: unknown) {
    failed.value = true;
    message.value =
      (err as { data?: { message?: string } })?.data?.message ?? t('admin.irc.failed');
  } finally {
    saving.value = false;
  }
}

async function sendTest() {
  testing.value = true;
  message.value = '';
  failed.value = false;
  try {
    const res = await $fetch<{ line: string }>('/api/admin/irc/test', { method: 'POST' });
    message.value = t('admin.irc.tested', { line: res.line });
  } catch (err: unknown) {
    failed.value = true;
    message.value =
      (err as { data?: { message?: string } })?.data?.message ?? t('admin.irc.failed');
  } finally {
    testing.value = false;
    await refresh();
  }
}
</script>

<style scoped>
.irc {
  max-width: 60rem;
  margin: 0 auto;
  padding: 1.5rem 1rem 3rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}
.irc-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}
.irc-eyebrow {
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: calc(0.16em * var(--tracking-scale));
  color: rgb(var(--accent-warm));
}
.irc-title {
  font-family: var(--font-display);
  font-size: 1.75rem;
  font-weight: 700;
  color: rgb(var(--fg-strong));
}
.irc-lede {
  font-size: 0.8125rem;
  color: rgb(var(--fg-muted));
  max-width: 48ch;
  margin-top: 0.25rem;
}

/* ── state ────────────────────────────────────────────────────────────── */
.irc-state {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.6rem 0.85rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  background: rgb(var(--bg-elevated));
}
.irc-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 999px;
  background: rgb(var(--fg-faint));
  flex: none;
}
.irc-state--ready .irc-dot { background: rgb(var(--online)); }
.irc-state--error .irc-dot { background: rgb(var(--danger)); }
.irc-state--connecting .irc-dot,
.irc-state--registering .irc-dot,
.irc-state--joining .irc-dot { background: rgb(var(--warning)); }
.irc-state--ready { border-color: rgb(var(--online) / 0.4); }
.irc-state--error { border-color: rgb(var(--danger) / 0.4); }
.irc-state-label { font-size: 0.8125rem; color: rgb(var(--fg-default)); }
.irc-state-sub {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  color: rgb(var(--fg-subtle));
  max-width: 22ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.irc-notice {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid rgb(var(--info) / 0.4);
  border-radius: var(--radius-sm);
  background: rgb(var(--info) / 0.08);
  font-size: 0.75rem;
  color: rgb(var(--fg-muted));
}

/* ── form ─────────────────────────────────────────────────────────────── */
.irc-form { display: flex; flex-direction: column; gap: 1rem; }
.irc-card {
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  background: rgb(var(--bg-surface));
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}
.irc-card h2 {
  font-size: 0.9375rem;
  font-weight: 600;
  color: rgb(var(--fg-strong));
}
.irc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
  gap: 0.75rem;
}
.irc-field { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; }
.irc-field--narrow { max-width: 10rem; }
.irc-field label {
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: calc(0.12em * var(--tracking-scale));
  color: rgb(var(--fg-muted));
}
.irc-help { font-size: 0.6875rem; color: rgb(var(--fg-subtle)); }
.irc-mono { font-family: var(--font-mono); font-size: 0.75rem; }
.irc-switch {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
  color: rgb(var(--fg-default));
  cursor: pointer;
  /* The whole row is the target, so the checkbox is not a 13px hit area. */
  min-height: 2.25rem;
}
.irc-switch--inline { margin-top: 1rem; }

.irc-preview {
  border: 1px dashed rgb(var(--line-strong));
  border-radius: var(--radius-sm);
  background: rgb(var(--bg-inset));
  padding: 0.6rem 0.75rem;
}
.irc-preview-label {
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: calc(0.12em * var(--tracking-scale));
  color: rgb(var(--fg-muted));
  margin-bottom: 0.3rem;
}
.irc-preview-line {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: rgb(var(--fg-default));
  overflow-x: auto;
  white-space: pre;
}

.irc-tokens { font-size: 0.75rem; }
.irc-tokens summary { cursor: pointer; color: rgb(var(--fg-muted)); padding: 0.2rem 0; }
.irc-tokens ul { display: flex; flex-direction: column; gap: 0.2rem; margin-top: 0.4rem; }
.irc-tokens li {
  display: grid;
  grid-template-columns: 10rem minmax(0, 1fr) auto;
  gap: 0.6rem;
  align-items: baseline;
  padding: 0.15rem 0;
  border-bottom: 1px solid rgb(var(--line-default));
}
.irc-tokens code {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  color: rgb(var(--accent-warm));
}
.irc-tokens span { color: rgb(var(--fg-muted)); }
.irc-tokens em {
  font-family: var(--font-mono);
  font-style: normal;
  font-size: 0.625rem;
  color: rgb(var(--fg-faint));
}
.irc-unmapped { opacity: 0.7; }
@media (max-width: 640px) {
  .irc-tokens li { grid-template-columns: minmax(0, 1fr); }
}

.irc-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
}
.irc-message { font-size: 0.75rem; color: rgb(var(--online)); }
.irc-message--bad { color: rgb(var(--danger)); }
.irc-spin { animation: irc-spin 900ms linear infinite; }
@keyframes irc-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .irc-spin { animation-duration: 2.4s; }
}

.irc-card--stats { gap: 0.5rem; }
.irc-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
  gap: 0.75rem;
}
.irc-stats dt {
  font-size: 0.625rem;
  text-transform: uppercase;
  letter-spacing: calc(0.1em * var(--tracking-scale));
  color: rgb(var(--fg-subtle));
}
.irc-stats dd {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 1rem;
  color: rgb(var(--fg-strong));
}
</style>
