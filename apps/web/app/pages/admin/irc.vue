<template>
  <div class="irc">
    <!-- No page title here. `pages/admin.vue` already renders an `h1` and a
         description for every admin sub-page, so this one used to print a
         second `h1` and a second lede saying nearly the same thing — two page
         titles stacked, and two announced to a screen reader. `audit.vue` drops
         to `h2` for the same reason. -->
    <header class="irc-head">
      <!-- State first. An operator opening this page is almost always here to
           find out whether the bot is in the channel. A live region, because
           the answer changes without a navigation — after a save, after a
           reconnect — and a status nobody is told about is a status nobody
           reads. -->
      <div
        class="irc-state"
        :class="`irc-state--${state}`"
        role="status"
        aria-live="polite"
      >
        <span class="irc-dot" />
        <div>
          <p class="irc-state-label">{{ $t(`admin.irc.states.${state}`) }}</p>
          <p v-if="status?.nick" class="irc-state-sub">{{ status.nick }}</p>
        </div>
      </div>
      <!-- The state used to be a snapshot taken at mount and never touched
           again: no polling, no reload, so an operator who had just put the bot
           into service read "Connecting" and watched a dead word indefinitely.
           `audit.vue` and `Users.vue` both have a reload; this had none. -->
      <button
        type="button"
        class="tool-btn"
        :disabled="reloading"
        :title="$t('common.refresh')"
        :aria-label="$t('common.refresh')"
        @click="reload"
      >
        <Icon
          :name="reloading ? 'ph:circle-notch' : 'ph:arrows-clockwise'"
          :class="{ 'irc-spin': reloading }"
        />
      </button>
    </header>

    <!-- When it is broken, the reason is the most important string on the page,
         and it lived in a 22-character box with `text-overflow: ellipsis` and no
         `title` — so "SASL authentication failed: invalid credentials" reached
         the operator as "SASL authenticatio…". Truncating a nick is right;
         truncating the diagnosis is not. -->
    <p v-if="state === 'error' && status?.lastError" class="irc-fault">
      <Icon name="ph:warning-circle" />
      <span>
        {{ $t('admin.irc.faultLead') }}
        <code>{{ status.lastError }}</code>
      </span>
    </p>

    <!-- Said plainly, because a console that shows `idle` on a working bot is
         how an operator concludes the feature is broken. -->
    <p v-if="status && !status.leader && enabled" class="irc-notice">
      <Icon name="ph:info" />
      {{ $t('admin.irc.notLeader') }}
    </p>

    <form class="irc-form" @submit.prevent="save">
      <!-- The master switch, on its own. It governs all three cards below, and
           sitting inside the first one it read as though it belonged to the
           connection. Decking it also used to change nothing on screen: all
           fourteen fields stayed live and at full opacity, so an operator could
           fill the form in and never learn that nothing would be announced. -->
      <div class="irc-master" :class="{ 'irc-master--off': !form.enabled }">
        <label class="irc-switch">
          <input v-model="form.enabled" type="checkbox" />
          <span>{{ $t('admin.irc.fields.enabled') }}</span>
        </label>
        <p class="irc-help">{{ $t('admin.irc.hints.enabled') }}</p>
      </div>

      <!-- `inert` and not just dimmed: a field an operator cannot reach is a
           clearer statement than a field that looks faded and still takes
           input. -->
      <div class="irc-cards" :class="{ 'irc-cards--off': !form.enabled }" :inert="!form.enabled">
      <section class="irc-card">
        <h2>{{ $t('admin.irc.sections.connection') }}</h2>

        <!-- Server, port and TLS as one explicit row rather than three cells of
             an `auto-fit` grid: the port is five digits, so a 13rem track left a
             3rem hole beside it, and the checkbox was aligned to the inputs by a
             hardcoded top margin that became a stray gap at one column. -->
        <div class="irc-conn">
          <div class="irc-field">
            <label for="irc-host">{{ $t('admin.irc.fields.host') }}<span class="irc-req">*</span></label>
            <input id="irc-host" v-model="form.host" class="input" autocomplete="off" placeholder="irc.example.com" />
          </div>
          <div class="irc-field">
            <label for="irc-port">{{ $t('admin.irc.fields.port') }}<span class="irc-req">*</span></label>
            <input id="irc-port" v-model.number="form.port" class="input" type="number" min="1" max="65535" />
          </div>
          <div class="irc-field">
            <label class="irc-switch irc-switch--inline">
              <input v-model="form.tls" type="checkbox" />
              <span>{{ $t('admin.irc.fields.tls') }}</span>
            </label>
          </div>
        </div>

        <div class="irc-grid">
          <div class="irc-field">
            <label for="irc-nick">{{ $t('admin.irc.fields.nick') }}<span class="irc-req">*</span></label>
            <input id="irc-nick" v-model="form.nick" class="input" autocomplete="off" />
            <span class="irc-help">{{ $t('admin.irc.hints.nick') }}</span>
          </div>
          <div class="irc-field">
            <label for="irc-channel">{{ $t('admin.irc.fields.channel') }}<span class="irc-req">*</span></label>
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
        <!-- Nothing on this form said which of the fourteen fields were needed,
             so an operator filling everything in out of caution set a server
             password their network does not use. Four are required and marked;
             the rest are not. -->
        <p class="irc-help">{{ $t('admin.irc.hints.auth') }} {{ $t('admin.irc.optional') }}</p>
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

        <!-- The contract these three fields run on, said once. It was carried
             only by the word "unchanged" in a placeholder, conditional on a
             stored secret existing — so a blank field with a secret behind it
             and a blank field with nothing behind it differed by one grey word
             at 11px. -->
        <p class="irc-help irc-help--rule">{{ $t('admin.irc.secretsKept') }}</p>

        <div class="irc-field">
          <label for="irc-perform">{{ $t('admin.irc.fields.perform') }}</label>
          <textarea
            id="irc-perform"
            v-model="performText"
            class="input irc-mono"
            rows="3"
            spellcheck="false"
            placeholder="PRIVMSG Voyager :invite trackarr KEY"
            @input="performDirty = true"
          />
          <span class="irc-help">{{ $t('admin.irc.hints.perform') }}</span>
          <!-- Out of the placeholder and into a permanent line. As a
               placeholder, the count of what is stored vanished at the first
               keystroke — exactly when the operator is replacing lines they can
               no longer read, and has no way to know how many they are about to
               overwrite or to change their mind. -->
          <span v-if="config?.hasPerform" class="irc-help irc-help--kept">
            {{ $t('admin.irc.performKept', config.performCount) }}
            <button type="button" class="irc-linkbtn" @click="resetPerform">
              {{ $t('admin.irc.performReset') }}
            </button>
          </span>
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
          <p
            class="irc-preview-line"
            tabindex="0"
            role="group"
            :aria-label="$t('admin.irc.preview')"
          >{{ preview }}</p>
        </div>

        <!-- The autobrr definition is derived from the template above, so it
             belongs beside it rather than in the form's action row — where it
             was a borderless `<a download>` among two buttons, and where it
             appeared only after a save because it was keyed on the PERSISTED
             `enabled`, shifting the row under the operator. -->
        <p v-if="enabled" class="irc-export">
          <a href="/api/irc/autobrr.yml" class="btn btn-secondary btn-sm" download>
            <Icon name="ph:download-simple" />
            {{ $t('admin.irc.definition') }}
          </a>
        </p>

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
        <!-- Why it is dead, said. `.btn:disabled` sets `pointer-events: none`,
             which removes even the possibility of a tooltip, so a greyed
             control with no explanation was all the operator got. -->
        <span v-if="state !== 'ready'" class="irc-help">{{ $t('admin.irc.testWhen') }}</span>
        <!-- Always in the DOM, so an insertion is announced rather than missed,
             and `aria-live` because this is the only feedback the page's main
             action has. -->
        <span
          class="irc-message"
          :class="{ 'irc-message--bad': failed }"
          role="status"
          aria-live="polite"
        >
          {{ message }}
        </span>
      </div>
      </div>
    </form>

    <!-- Only once there is something to report. Four zeros and an em dash before
         the bot has ever connected is a panel that looks like a failure. -->
    <section v-if="status && status.since" class="irc-card irc-card--stats">
      <h2>{{ $t('admin.irc.sections.traffic') }}</h2>
      <dl class="irc-stats">
        <div><dt>{{ $t('admin.irc.stats.sent') }}</dt><dd>{{ status.sent.toLocaleString() }}</dd></div>
        <div><dt>{{ $t('admin.irc.stats.queued') }}</dt><dd>{{ status.queued.toLocaleString() }}</dd></div>
        <div><dt>{{ $t('admin.irc.stats.dropped') }}</dt><dd>{{ status.dropped.toLocaleString() }}</dd></div>
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
    hasPerform: boolean;
    performCount: number;
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

const reloading = ref(false);
async function reload() {
  reloading.value = true;
  try {
    await refresh();
  } finally {
    reloading.value = false;
  }
}

/**
 * Keep watching while the answer is still moving.
 *
 * `ready` and `idle` are settled; everything between them — connecting,
 * registering, joining, error-then-retry — resolves in seconds without any
 * navigation, and the page had no way to notice. Ten seconds is slow enough to
 * be free and fast enough that an operator does not reach for the reload they
 * now also have.
 */
const SETTLED = new Set(['ready', 'idle']);
onMounted(() => {
  const timer = setInterval(() => {
    if (!SETTLED.has(state.value)) void refresh();
  }, 10_000);
  onBeforeUnmount(() => clearInterval(timer));
});

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
/**
 * Whether the admin has touched the field — see the note at the save.
 *
 * Set from the textarea's own `@input`, not from a `watch` on the value. A
 * watcher flushes on the microtask queue, so `performText.value = ''` followed
 * by `performDirty.value = false` at the end of a save ran in that order and
 * THEN the watcher fired, leaving the flag true — and the next save therefore
 * sent `perform: []` and deleted the operator's stored perform lines without
 * anybody asking it to.
 */
const performDirty = ref(false);
function resetPerform() {
  performText.value = '';
  performDirty.value = false;
}

/**
 * Seed the form from the stored config — once, and never over live edits.
 *
 * This ran on every change to `data`, which meant every `refresh()`. The test
 * button called one in its `finally`, so pressing "Say a test line" to check
 * the bot silently reverted every unsaved field on the page, including the
 * template the operator had just written, while the message said the test had
 * been sent. A slow save did the same to whatever was being typed while it was
 * in flight.
 */
const formDirty = ref(false);
watchEffect(() => {
  const c = config.value;
  if (!c) return;
  if (formDirty.value) return;
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
  // Not prefilled: the GET no longer returns these lines, because the field's
  // job is a NickServ password. Empty means "keep what is stored"; the count
  // below is what tells the admin something IS stored.
  performText.value = '';
});

// Anything the operator changes marks the form dirty, which stops the seeding
// above from reaching in and overwriting it.
watch(
  () => ({ ...form }),
  () => {
    formDirty.value = true;
  },
  { deep: true }
);

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
        // Absent means unchanged, the same contract as the passwords. An admin
        // clearing the field on purpose sends an empty array, which the API
        // treats as "no perform lines".
        perform: performDirty.value
          ? performText.value
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean)
          : undefined,
      },
    });
    form.serverPassword = '';
    form.saslPassword = '';
    form.channelKey = '';
    performText.value = '';
    performDirty.value = false;
    message.value = t('admin.irc.saved');
    // Saved is saved: let the seeding take over again so the page shows what is
    // stored rather than a stale copy of what was typed.
    formDirty.value = false;
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
    // Deliberately no `refresh()`. Testing the connection is not a reason to
    // re-read the configuration, and doing it here is what discarded unsaved
    // work. `reload()` is the operator's own control for that, and the poll
    // below keeps the state block honest.
  }
}
</script>

<style scoped>
.irc {
  /* No own max-width and no own gutter: `pages/admin.vue` already constrains
     the column this sits in, so re-centring inside it at 60rem indented the
     content by a gutter and capped it 20rem short of its neighbours — moving
     from Audit to IRC stepped everything sideways. */
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}
.irc-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
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
  /* Only ever a nick now, which is what this bound was right for. */
  max-width: 22ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* The diagnosis, full width and wrapping. */
.irc-fault {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.6rem 0.8rem;
  border: 1px solid rgb(var(--danger) / 0.4);
  border-radius: var(--radius-sm);
  background: rgb(var(--danger) / 0.08);
  font-size: 0.75rem;
  line-height: 1.5;
  color: rgb(var(--fg-default));
}
.irc-fault svg { flex: none; margin-top: 0.1rem; color: rgb(var(--danger)); }
.irc-fault code {
  font-family: var(--font-mono);
  overflow-wrap: anywhere;
  color: rgb(var(--fg-strong));
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
.irc-cards { display: flex; flex-direction: column; gap: 1rem; }
.irc-cards--off { opacity: 0.55; }
.irc-master {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35rem 1rem;
  padding: 0.6rem 0.9rem;
  border: 1px solid rgb(var(--line-strong));
  border-radius: var(--radius-md);
  background: rgb(var(--bg-elevated));
}
.irc-master--off { border-color: rgb(var(--line-default)); }
.irc-conn {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0.75rem;
  align-items: end;
}
@media (min-width: 40rem) {
  .irc-conn { grid-template-columns: minmax(0, 1fr) 7rem auto; }
}
.irc-req {
  color: rgb(var(--accent-warm));
  margin-left: 0.15rem;
}
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
  /* From the top. `end` was an attempt to line a checkbox up with its
     neighbours' inputs, and it made every row bottom-aligned instead — so a
     cell with a three-line hint pushed its own label above the others'. The
     server/port/TLS row that actually needed it has its own grid. */
  align-items: start;
}
.irc-field { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; }
/* A port is five digits: `max-width` inside a 13rem track left a 3rem hole in
   the middle of the first row, and at one column it stranded a 160px field in
   350px of space. Narrowing the TRACK is what was wanted. */
.irc-field--narrow { max-width: 100%; }
@media (min-width: 40rem) {
  .irc-field--narrow { max-width: 8rem; }
}
.irc-field label {
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: calc(0.12em * var(--tracking-scale));
  color: rgb(var(--fg-muted));
}
.irc-help { font-size: 0.6875rem; color: rgb(var(--fg-subtle)); }
/* The count of what is stored, and the way back to it. */
.irc-help--kept { color: rgb(var(--fg-muted)); }
.irc-help--rule {
  padding-top: 0.5rem;
  border-top: 1px solid rgb(var(--line-default));
}
.irc-linkbtn {
  background: none;
  border: 0;
  padding: 0;
  font: inherit;
  color: rgb(var(--info));
  cursor: pointer;
  text-decoration: underline;
}
.irc-export { margin-top: 0.2rem; }
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
/* No `margin-top` hack. `align-items: end` on the grid does the alignment, and
   the hack became a stray 16px gap the moment the grid dropped to one column. */
.irc-switch--inline { min-height: 2.25rem; }

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
.irc-preview-line:focus-visible {
  outline: 2px solid rgb(var(--focus-ring));
  outline-offset: 2px;
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
/* No local `prefers-reduced-motion` block: `main.css` already overrides every
   animation duration to 0.01ms with `!important`, so the 2.4s this used to
   declare never applied. Code that claims to handle a case already handled is
   worse than no code, because the next reader believes it. */

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
