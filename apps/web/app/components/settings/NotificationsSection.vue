<template>
  <!--
    User-facing notifications settings.

    Two stacked blocks:
      1. **Channels** — one row per channel the admin enabled +
         tested. User adds/edits/deletes their own row. Server-side
         secrets (SMTP password, Telegram bot token) are never
         exposed; only the per-user fields (their email, chat_id,
         …) show in the form.

      2. **Routing** — one row per notification type. When the user
         has a single channel configured, each type just has a
         checkbox ("notify me here"). With 2+ channels, the checkbox
         pairs with a dropdown to pick which channel handles the
         type. Default on first channel adoption: every type routed
         to that channel (opt-out semantics, per the design).

    Rendered only when at least one channel is "available" — that's
    the gate from the spec ("section apparait if au moins un canal
    activé et fonctionnel").
  -->
  <section v-if="loaded && channels.length > 0" class="notif-section">
    <header class="block-head">
      <p class="block-eyebrow">{{ $t('settings.notifications.eyebrow') }}</p>
      <h3 class="block-title">{{ $t('settings.notifications.channelsTitle') }}</h3>
    </header>

    <ul class="channel-list">
      <li
        v-for="ch in channels"
        :key="ch.type"
        class="channel-row"
        :class="{ 'channel-row--configured': ch.configured }"
      >
        <button
          type="button"
          class="channel-row-head"
          @click="toggleExpand(ch.type)"
        >
          <Icon :name="ch.icon" class="channel-icon" />
          <span class="channel-label">{{ $t(ch.labelKey) }}</span>
          <span v-if="ch.configured" class="channel-state">
            <span class="state-dot" :class="`state-dot--${ch.lastTestStatus ?? 'pending'}`" />
            <template v-if="ch.lastTestStatus === 'ok'">
              {{ $t('settings.notifications.statusOk') }}
            </template>
            <template v-else-if="ch.lastTestStatus === 'error'">
              {{ $t('settings.notifications.statusError') }}
            </template>
            <template v-else>{{ $t('settings.notifications.statusPending') }}</template>
          </span>
          <span v-else class="channel-state channel-state--add">
            <Icon name="ph:plus-bold" />
            {{ $t('settings.notifications.add') }}
          </span>
          <Icon
            name="ph:caret-down-bold"
            class="channel-chevron"
            :class="{ 'rotate-180': expanded[ch.type] }"
          />
        </button>

        <div v-if="expanded[ch.type]" class="channel-form">
          <p class="channel-tagline">{{ $t(ch.taglineKey) }}</p>

          <!--
            Public server info — ntfy/Gotify expose their base URL
            here so users can point their mobile app at the right
            instance. The block renders only when the adapter
            opted in via `publicServerInfo` and the admin row
            actually has a value.
          -->
          <div v-if="ch.publicServerInfo && ch.publicServerInfo.length > 0" class="public-info">
            <Icon name="ph:info-bold" />
            <dl class="public-info-list">
              <div v-for="(item, i) in ch.publicServerInfo" :key="i">
                <dt>{{ $t(item.labelKey) }}</dt>
                <dd><code>{{ item.value }}</code></dd>
              </div>
            </dl>
          </div>

          <label v-for="f in ch.userFields" :key="f.key" class="field">
            <span class="field-label">{{ $t(f.labelKey) }}</span>
            <span v-if="f.hintKey" class="field-hint">{{ $t(f.hintKey) }}</span>
            <input
              v-if="f.type === 'int'"
              type="number"
              :placeholder="String(f.default ?? '')"
              :value="userConfigs[ch.type]?.[f.key]"
              @input="setField(ch.type, f.key, Number(($event.target as HTMLInputElement).value))"
            />
            <input
              v-else-if="f.type === 'password' || f.secret"
              type="password"
              autocomplete="new-password"
              :placeholder="ch.configured ? $t('settings.notifications.keepSecret') : ''"
              :value="userConfigs[ch.type]?.[f.key]"
              @input="setField(ch.type, f.key, ($event.target as HTMLInputElement).value)"
            />
            <input
              v-else
              :type="f.type === 'email' ? 'email' : f.type === 'url' ? 'url' : 'text'"
              :placeholder="f.default ? String(f.default) : ''"
              :value="userConfigs[ch.type]?.[f.key]"
              @input="setField(ch.type, f.key, ($event.target as HTMLInputElement).value)"
            />
          </label>

          <div v-if="ch.configured && ch.lastTestStatus === 'error' && ch.lastTestError" class="error-detail">
            <Icon name="ph:warning-bold" />
            {{ ch.lastTestError }}
          </div>

          <div class="form-actions">
            <button
              v-if="ch.configured"
              type="button"
              class="btn btn--ghost btn--danger"
              :disabled="!!busy[ch.type]"
              @click="removeChannel(ch)"
            >
              <Icon name="ph:trash-bold" />
              {{ $t('settings.notifications.remove') }}
            </button>
            <button
              type="button"
              class="btn"
              :disabled="!!busy[ch.type] || !canTest(ch)"
              @click="testChannel(ch)"
            >
              <Icon
                :name="busy[ch.type] === 'testing' ? 'ph:circle-notch' : 'ph:paper-plane-tilt-bold'"
                :class="busy[ch.type] === 'testing' ? 'animate-spin' : ''"
              />
              {{ $t('settings.notifications.test') }}
            </button>
            <button
              type="button"
              class="btn btn--primary"
              :disabled="!!busy[ch.type] || !canSave(ch)"
              @click="saveChannel(ch)"
            >
              <Icon
                :name="busy[ch.type] === 'saving' ? 'ph:circle-notch' : 'ph:floppy-disk-bold'"
                :class="busy[ch.type] === 'saving' ? 'animate-spin' : ''"
              />
              {{ ch.configured ? $t('common.save') : $t('common.add') }}
            </button>
          </div>
        </div>
      </li>
    </ul>

    <!-- Routing -->
    <header class="block-head block-head--secondary">
      <h3 class="block-title">{{ $t('settings.notifications.routingTitle') }}</h3>
      <p class="block-desc">{{ $t('settings.notifications.routingDesc') }}</p>
    </header>

    <div v-if="activeChannels.length === 0" class="empty">
      <Icon name="ph:info" />
      <span>{{ $t('settings.notifications.routingEmpty') }}</span>
    </div>

    <!--
      Bulk control row — lets the user flip every notification type
      at once instead of clicking 37 checkboxes / dropdowns. Sits
      above the per-type list with a slightly emphasised border so
      it reads as a global control, not just another row.

      Single-channel layout: a tri-state checkbox (off / mixed /
      all-routed). Clicking it routes every type to the one
      channel, or clears every routing entry.

      Multi-channel layout: a dropdown — "Don't send any", then
      one option per active channel. Selecting a channel routes
      every type to it; selecting "Don't send any" wipes all
      routings. When the per-row picks are mixed (≥2 different
      channels in use), the dropdown shows a disabled "Mixed"
      sentinel so the user knows they're not in a uniform state.
    -->
    <div v-if="activeChannels.length > 0" class="bulk-row">
      <span class="bulk-label">{{ $t('settings.notifications.bulkAll') }}</span>
      <template v-if="activeChannels.length === 1">
        <label class="check">
          <input
            type="checkbox"
            :checked="bulkAllChecked"
            :indeterminate.prop="bulkMixed"
            @change="bulkApply(($event.target as HTMLInputElement).checked ? activeChannels[0]!.type : null)"
          />
          <span>
            {{ bulkAllChecked
              ? $t('settings.notifications.bulkAllOn')
              : $t('settings.notifications.bulkAllOff') }}
          </span>
        </label>
      </template>
      <template v-else>
        <select :value="bulkValue" @change="bulkApply(($event.target as HTMLSelectElement).value || null)">
          <option value="">{{ $t('settings.notifications.routeNone') }}</option>
          <option v-for="c in activeChannels" :key="c.type" :value="c.type">
            {{ $t(c.labelKey) }}
          </option>
          <option v-if="bulkValue === '__mixed__'" value="__mixed__" disabled>
            {{ $t('settings.notifications.bulkMixed') }}
          </option>
        </select>
      </template>
    </div>

    <ul v-if="activeChannels.length > 0" class="routing-list">
      <li v-for="t in notifTypes" :key="t" class="routing-row">
        <span class="routing-label">
          <span class="routing-title">{{ $t(`notifications.types.${t}.title`) }}</span>
          <span class="routing-desc">{{ $t(`notifications.types.${t}.desc`, samplePayload) }}</span>
        </span>
        <span class="routing-control">
          <!-- Single-channel UX: just a checkbox -->
          <label v-if="activeChannels.length === 1" class="check">
            <input
              type="checkbox"
              :checked="routing[t] === activeChannels[0]!.type"
              @change="setRoute(t, ($event.target as HTMLInputElement).checked ? activeChannels[0]!.type : null)"
            />
            <span>{{ $t('settings.notifications.routeMe') }}</span>
          </label>
          <!-- Multi-channel UX: dropdown w/ "none" + each channel -->
          <select
            v-else
            :value="routing[t] ?? ''"
            @change="setRoute(t, ($event.target as HTMLSelectElement).value || null)"
          >
            <option value="">{{ $t('settings.notifications.routeNone') }}</option>
            <option v-for="c in activeChannels" :key="c.type" :value="c.type">
              {{ $t(c.labelKey) }}
            </option>
          </select>
        </span>
      </li>
    </ul>

    <div class="block-foot">
      <button
        type="button"
        class="btn btn--primary"
        :disabled="!routingDirty || routingSaving"
        @click="() => saveRouting()"
      >
        <Icon
          :name="routingSaving ? 'ph:circle-notch' : 'ph:floppy-disk-bold'"
          :class="routingSaving ? 'animate-spin' : ''"
        />
        {{ $t('settings.notifications.saveRouting') }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
interface UserChannel {
  type: string;
  labelKey: string;
  taglineKey: string;
  icon: string;
  userFields: { key: string; labelKey: string; hintKey?: string; type: string; required: boolean; secret?: boolean; default?: unknown }[];
  configured: boolean;
  enabled: boolean;
  lastTestStatus: 'ok' | 'error' | null;
  lastTestError: string | null;
  lastTestedAt: string | null;
  /** Decrypted user values for non-secret fields, so the form
   *  re-hydrates with what the user previously saved (ntfy topic,
   *  SMTP "to", Gotify priority…). Secret fields are filtered
   *  server-side. */
  userValues?: Record<string, unknown>;
  /** Read-only server-side info the user needs to see (ntfy /
   *  Gotify base URL — required to subscribe from the mobile app). */
  publicServerInfo?: Array<{ labelKey: string; value: string }>;
}

interface RoutingEntry {
  type: string;
  channelType: string;
}

const channels = ref<UserChannel[]>([]);
const routing = reactive<Record<string, string>>({});
const initialRouting = reactive<Record<string, string>>({});
const expanded = reactive<Record<string, boolean>>({});
const busy = reactive<Record<string, 'saving' | 'testing' | null>>({});
const userConfigs = reactive<Record<string, Record<string, any>>>({});
const loaded = ref(false);
const routingSaving = ref(false);

// 37 notification types — kept in sync with the NotificationType
// union in apps/api/utils/notify.ts. Listed exhaustively so the
// routing matrix shows every event the system can emit.
const notifTypes = [
  'upload_accepted',
  'upload_rejected',
  'upload_changes_requested',
  'upload_reset',
  'moderation_message_received',
  'torrent_deleted_by_staff',
  'hnr_violation_marked',
  'hnr_cleared',
  'hnr_exempted',
  'account_banned',
  'account_unbanned',
  'role_attached_manually',
  'role_detached',
  'staff_status_changed',
  'bonus_points_adjusted',
  'password_changed',
  'totp_enabled',
  'totp_disabled',
  'passkey_added',
  'passkey_removed',
  'recovery_codes_regenerated',
  'recovery_code_used',
  'login_new_ip',
  'comment_on_my_upload',
  'forum_reply_on_my_topic',
  'comment_deleted_by_staff',
  'forum_post_deleted_by_staff',
  'bonus_event_started',
  'first_seeder_reward',
  'seeding_milestone_reached',
  'invite_redeemed',
  'invitee_banned',
  'new_pending_upload',
  'new_report_filed',
  'report_actioned',
  'trusted_device_added',
];

// Sample payload so the desc previews show real-looking content
// instead of `{torrentName}` placeholders. Mirrors the test payload
// the server uses for /test calls.
const samplePayload = {
  torrentName: 'Sample.Release.2026.1080p.WEB-DL',
  moderatorUsername: 'mod_alice',
  actorUsername: 'mod_alice',
  uploaderUsername: 'user_bob',
  reporterUsername: 'user_carol',
  inviteeUsername: 'newcomer_dave',
  roleName: 'Trusted',
  passkeyName: 'Example device',
  message: 'reason here',
  preview: 'a short preview',
  reason: 'reason here',
  resolution: 'no action needed',
  targetType: 'torrent',
  reasonPreview: 'a short preview',
  status: 'resolved',
  newStatus: 'pending',
  title: 'Sample bonus event',
  topicTitle: 'Sample topic',
  delta: 100,
  amount: 100,
  currentIp: '192.0.2.1',
  previousIp: '192.0.2.42',
};

const activeChannels = computed(() =>
  channels.value.filter((c) => c.configured && c.enabled)
);

// ── Bulk-edit helpers ────────────────────────────────────────────
//
// `routing` carries one entry per type → channelType. We expose a few
// computed views so the bulk control row at the top of the routing
// table can show a sensible state and toggle every type at once.

/** True when every notif type is routed to the single active
 *  channel (single-channel layout only). */
const bulkAllChecked = computed(() => {
  if (activeChannels.value.length !== 1) return false;
  const target = activeChannels.value[0]!.type;
  return notifTypes.every((t) => routing[t] === target);
});

/** Single-channel UX: "mixed" means some types are routed and some
 *  aren't. The checkbox renders indeterminate to flag this. */
const bulkMixed = computed(() => {
  if (activeChannels.value.length !== 1) return false;
  const target = activeChannels.value[0]!.type;
  let on = 0;
  let off = 0;
  for (const t of notifTypes) {
    if (routing[t] === target) on += 1;
    else off += 1;
  }
  return on > 0 && off > 0;
});

/** Multi-channel UX: the dropdown value the master select shows.
 *   '' = every type is "don't send" (no routing rows at all);
 *   '<channelType>' = every routed type points at the same channel
 *     AND no type is in "don't send" — uniform state;
 *   '__mixed__' = anything else (some types unrouted, some routed to
 *     different channels, etc.). The dropdown surfaces this as a
 *     disabled sentinel so the user knows they're customising
 *     individual rows. */
const bulkValue = computed<string>(() => {
  if (activeChannels.value.length < 2) return '';
  const targets = new Set<string>();
  let unrouted = 0;
  for (const t of notifTypes) {
    const v = routing[t];
    if (v) targets.add(v);
    else unrouted += 1;
  }
  if (targets.size === 0 && unrouted === notifTypes.length) return '';
  if (targets.size === 1 && unrouted === 0) {
    return targets.values().next().value as string;
  }
  return '__mixed__';
});

/** Apply one value to every notif type. `null` clears all routings
 *  (equivalent to "don't send any"). Doesn't auto-save — the
 *  existing "Save routing" button still gates the commit. */
function bulkApply(channelType: string | null) {
  for (const t of notifTypes) {
    if (channelType) routing[t] = channelType;
    else delete routing[t];
  }
}

const routingDirty = computed(() => {
  const keys = new Set([
    ...Object.keys(routing),
    ...Object.keys(initialRouting),
  ]);
  for (const k of keys) {
    if ((routing[k] ?? '') !== (initialRouting[k] ?? '')) return true;
  }
  return false;
});

async function refresh() {
  const res = await $fetch<{
    channels: UserChannel[];
    routing: RoutingEntry[];
  }>('/api/me/notification-channels');
  channels.value = res.channels;
  for (const ch of res.channels) {
    // Hydrate the form with the user's previously-saved non-secret
    // values so a re-open shows what's actually stored. Secret
    // fields stay empty — the "(unchanged — leave blank)"
    // placeholder hints at preservation semantics.
    userConfigs[ch.type] = { ...(ch.userValues || {}) };
  }
  // Replace routing in-place so reactivity tracks the right keys.
  for (const k of Object.keys(routing)) delete routing[k];
  for (const k of Object.keys(initialRouting)) delete initialRouting[k];
  for (const r of res.routing) {
    routing[r.type] = r.channelType;
    initialRouting[r.type] = r.channelType;
  }
  loaded.value = true;
}

// Defer the initial fetch to client mount — `$fetch` skips the auth
// cookie during SSR, which would 401 on a top-level await even
// though the user *is* logged in. Matches the admin page pattern.
onMounted(() => {
  void refresh();
});

function toggleExpand(type: string) {
  expanded[type] = !expanded[type];
}

function setField(type: string, key: string, value: any) {
  if (!userConfigs[type]) userConfigs[type] = {};
  userConfigs[type][key] = value;
}

function canSave(ch: UserChannel): boolean {
  const cfg = userConfigs[ch.type] || {};
  for (const f of ch.userFields) {
    if (!f.required) continue;
    if (f.secret && ch.configured) continue; // can keep old value
    if (cfg[f.key] == null || cfg[f.key] === '') return false;
  }
  return true;
}

function canTest(ch: UserChannel): boolean {
  return ch.configured && ch.enabled;
}

async function saveChannel(ch: UserChannel) {
  busy[ch.type] = 'saving';
  try {
    const cleaned: Record<string, unknown> = {};
    for (const f of ch.userFields) {
      const v = userConfigs[ch.type]?.[f.key];
      if (f.secret && (v === '' || v == null)) continue;
      if (v === '' || v == null) continue;
      cleaned[f.key] = v;
    }
    await $fetch(`/api/me/notification-channels/${ch.type}`, {
      method: 'PUT',
      body: { enabled: true, userConfig: cleaned },
    });

    // First-time adoption: opt-out semantics — pre-route every type
    // to the channel. The user can untick later.
    const wasFirst = !channels.value.some((c) => c.configured);
    if (wasFirst) {
      for (const ty of notifTypes) routing[ty] = ch.type;
      await saveRouting(true);
    }
    // refresh() re-populates userConfigs with the server's view
    // (non-secret fields only — secrets are stripped server-side),
    // so any pasted token the user typed naturally drops out of
    // memory without us wiping it manually.
    await refresh();
  } finally {
    busy[ch.type] = null;
  }
}

async function removeChannel(ch: UserChannel) {
  busy[ch.type] = 'saving';
  try {
    await $fetch(`/api/me/notification-channels/${ch.type}`, {
      method: 'DELETE',
    });
    userConfigs[ch.type] = {};
    expanded[ch.type] = false;
    await refresh();
  } finally {
    busy[ch.type] = null;
  }
}

async function testChannel(ch: UserChannel) {
  busy[ch.type] = 'testing';
  try {
    await $fetch(`/api/me/notification-channels/${ch.type}/test`, {
      method: 'POST',
    });
    await refresh();
  } finally {
    busy[ch.type] = null;
  }
}

function setRoute(type: string, channelType: string | null) {
  if (channelType) routing[type] = channelType;
  else delete routing[type];
}

async function saveRouting(silent = false) {
  routingSaving.value = true;
  try {
    const entries = Object.entries(routing).map(([type, channelType]) => ({
      type,
      channelType,
    }));
    await $fetch('/api/me/notification-routing', {
      method: 'PUT',
      body: { entries },
    });
    // Snapshot the new baseline.
    for (const k of Object.keys(initialRouting)) delete initialRouting[k];
    for (const [k, v] of Object.entries(routing)) initialRouting[k] = v;
    if (!silent) {
      // refresh keeps state consistent if the server filtered any
      // entries (e.g. user-channel no longer enabled).
      await refresh();
    }
  } finally {
    routingSaving.value = false;
  }
}
</script>

<style scoped>
.notif-section {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.block-head {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.block-head--secondary {
  margin-top: 1.5rem;
  padding-top: 1.5rem;
  border-top: 1px solid rgb(var(--line-default));
}
.block-eyebrow {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  margin: 0;
}
.block-title {
  font-size: 0.95rem;
  font-weight: 700;
  margin: 0;
  color: rgb(var(--fg-strong));
}
.block-desc {
  margin: 0;
  font-size: 0.78rem;
  color: rgb(var(--fg-muted));
}

.channel-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.channel-row {
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.4rem;
  background: rgb(var(--bg-elevated));
}
.channel-row--configured {
  border-color: rgb(212, 167, 52, 0.4);
}
.channel-row-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.75rem 1rem;
  background: transparent;
  border: 0;
  cursor: pointer;
  color: inherit;
  text-align: left;
  font: inherit;
}
.channel-icon {
  font-size: 1.15rem;
  color: rgb(var(--fg-strong));
  flex-shrink: 0;
}
.channel-label {
  flex: 1;
  font-size: 0.88rem;
  font-weight: 600;
  color: rgb(var(--fg-strong));
}
.channel-state {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.72rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  color: rgb(var(--fg-muted));
}
.state-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgb(var(--line-default));
}
.state-dot--ok {
  background: #6cd161;
}
.state-dot--error {
  background: #ff6b6b;
}
.channel-state--add {
  color: #d4a734;
}
.channel-chevron {
  font-size: 0.85rem;
  color: rgb(var(--fg-muted));
  transition: transform 0.2s ease;
}
.rotate-180 {
  transform: rotate(180deg);
}

.channel-form {
  padding: 0.85rem 1rem 1rem;
  border-top: 1px dashed rgb(var(--line-default));
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.channel-tagline {
  margin: 0;
  font-size: 0.74rem;
  color: rgb(var(--fg-muted));
}

/* Read-only server info (ntfy / Gotify base URL — users need it to
   subscribe from their mobile app). Sits above the form, tinted
   amber to read as "from the admin, not editable". */
.public-info {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  background: rgba(212, 167, 52, 0.08);
  border: 1px solid rgba(212, 167, 52, 0.25);
  border-radius: 0.35rem;
  padding: 0.55rem 0.75rem;
  font-size: 0.74rem;
  color: rgb(var(--fg-strong));
}
.public-info > svg {
  color: #d4a734;
  font-size: 0.95rem;
  flex-shrink: 0;
  margin-top: 0.1rem;
}
.public-info-list {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}
.public-info-list > div {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.public-info-list dt {
  font-weight: 600;
  color: rgb(var(--fg-strong));
  margin: 0;
}
.public-info-list dd {
  margin: 0;
  min-width: 0;
}
.public-info-list code {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.72rem;
  background: rgba(var(--bg-base), 0.4);
  padding: 0.1rem 0.35rem;
  border-radius: 0.25rem;
  word-break: break-all;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.field-label {
  font-size: 0.74rem;
  font-weight: 600;
  color: rgb(var(--fg-strong));
}
.field-hint {
  font-size: 0.68rem;
  color: rgb(var(--fg-muted));
}
.field input {
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.3rem;
  padding: 0.45rem 0.65rem;
  color: rgb(var(--fg-strong));
  font-size: 0.82rem;
}
.form-actions {
  display: flex;
  gap: 0.4rem;
  justify-content: flex-end;
  margin-top: 0.4rem;
}
.btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.4rem 0.7rem;
  border-radius: 0.3rem;
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-base));
  color: rgb(var(--fg-strong));
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
}
.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.btn--primary {
  background: rgb(var(--accent));
  color: rgb(var(--accent-fg));
  border-color: rgb(var(--accent));
}
.btn--ghost {
  background: transparent;
  border-color: rgb(var(--line-default));
}
.btn--danger {
  color: #ff6b6b;
  border-color: rgba(255, 107, 107, 0.4);
}
.error-detail {
  display: flex;
  align-items: flex-start;
  gap: 0.35rem;
  font-size: 0.72rem;
  color: #ff6b6b;
  background: rgba(255, 107, 107, 0.07);
  border-radius: 0.3rem;
  padding: 0.45rem 0.6rem;
  word-break: break-word;
}

.empty {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.85rem 1rem;
  border-radius: 0.4rem;
  background: rgb(var(--bg-elevated));
  border: 1px dashed rgb(var(--line-default));
  font-size: 0.78rem;
  color: rgb(var(--fg-muted));
}

/* Bulk-edit row — sits flush above the per-type list, sharing the
   same horizontal rhythm but with a heavier border so it reads as
   a global control rather than another routing entry. */
.bulk-row {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 1rem;
  padding: 0.65rem 0.85rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-bottom-width: 2px;
  border-bottom-color: rgba(212, 167, 52, 0.5);
  border-radius: 0.35rem 0.35rem 0 0;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}
.bulk-label {
  font-weight: 700;
  color: rgb(var(--fg-strong));
}
.bulk-row select {
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.3rem;
  padding: 0.35rem 0.55rem;
  font-size: 0.78rem;
  color: rgb(var(--fg-strong));
  text-transform: none;
  letter-spacing: 0;
}
.bulk-row .check {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  text-transform: none;
  letter-spacing: 0;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 0.8rem;
  cursor: pointer;
}

.routing-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.routing-row {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 1rem;
  padding: 0.55rem 0.85rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.35rem;
}
.routing-label {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}
.routing-title {
  font-size: 0.8rem;
  font-weight: 600;
  color: rgb(var(--fg-strong));
}
.routing-desc {
  font-size: 0.7rem;
  color: rgb(var(--fg-muted));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.routing-control select {
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.3rem;
  padding: 0.35rem 0.55rem;
  font-size: 0.8rem;
  color: rgb(var(--fg-strong));
}
.check {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.78rem;
  cursor: pointer;
}

.block-foot {
  display: flex;
  justify-content: flex-end;
  margin-top: 0.5rem;
}
</style>
