<template>
  <!--
    Notifications settings — destinations + per-category routing.

    Visual identity is a control-console dossier: numbered blocks,
    hairline gold rules, status lights as physical-looking dots,
    monospace for keys / mono-letterspaced eyebrows. The aim is to
    make a previously dense screen scannable at a glance: which
    transports are wired up, where each event class goes, what's
    pending.

    Layout:
      • 01 — Destinations: compact rows for each configured channel
        with an inline edit drawer. Adding a new one reveals a
        picker of available types.
      • 02 — Routing: 8 event categories with a bulk dropdown per
        category PLUS the existing per-event picker. Categorising
        gets us from "36 flat checkboxes" to "8 meaningful axes".

    The whole section only renders when the API GET reports at
    least one channel (admin-enabled + last-tested-ok), per the
    spec — otherwise we show a clean empty state.
  -->
  <div v-if="loaded" class="ns">
    <!-- ── Empty state ─────────────────────────────────────────── -->
    <div v-if="availableChannels.length === 0" class="ns-empty">
      <Icon name="ph:plug-charging-bold" class="ns-empty-icon" />
      <h4 class="ns-empty-title">
        {{ $t('settings.notifications.emptyTitle') }}
      </h4>
      <p class="ns-empty-desc">
        {{ $t('settings.notifications.emptyDesc') }}
      </p>
    </div>

    <template v-else>
      <!-- ── Block 01 — Destinations ───────────────────────────── -->
      <section class="ns-block">
        <header class="ns-block-head">
          <span class="ns-block-num">01</span>
          <div class="ns-block-id">
            <h4>{{ $t('settings.notifications.destinationsTitle') }}</h4>
            <p>{{ $t('settings.notifications.destinationsDesc') }}</p>
          </div>
          <span class="ns-block-meta">
            <strong>{{ configuredChannels.length }}</strong>
            {{ $t('settings.notifications.configured') }}
            <span class="ns-block-meta-sep">·</span>
            {{ unconfiguredChannels.length }}
            {{ $t('settings.notifications.available') }}
          </span>
        </header>

        <ul class="dest-list">
          <li
            v-for="(ch, i) in configuredChannels"
            :key="ch.type"
            class="dest"
            :class="{ 'dest--open': expanded[ch.type] }"
            :style="{ '--stagger': `${i * 40}ms` }"
          >
            <header class="dest-head">
              <span class="dest-glyph" :data-status="ch.lastTestStatus ?? 'pending'">
                <Icon :name="ch.icon" />
                <span class="dest-glyph-dot" aria-hidden="true" />
              </span>

              <span class="dest-id">
                <strong class="dest-name">{{ $t(ch.labelKey) }}</strong>
                <code class="dest-target">{{ describeTarget(ch) }}</code>
              </span>

              <span class="dest-status" :class="`dest-status--${ch.lastTestStatus ?? 'pending'}`">
                {{ statusLabel(ch) }}
              </span>

              <div class="dest-actions">
                <button
                  type="button"
                  class="dest-btn"
                  :disabled="!!busy[ch.type]"
                  :title="$t('settings.notifications.test')"
                  @click="testChannel(ch)"
                >
                  <Icon
                    :name="busy[ch.type] === 'testing' ? 'ph:circle-notch' : 'ph:paper-plane-tilt-bold'"
                    :class="busy[ch.type] === 'testing' ? 'spin' : ''"
                  />
                </button>
                <button
                  type="button"
                  class="dest-btn"
                  :class="{ 'dest-btn--active': expanded[ch.type] }"
                  :title="$t('common.edit')"
                  @click="toggleExpand(ch.type)"
                >
                  <Icon name="ph:sliders-bold" />
                </button>
                <button
                  type="button"
                  class="dest-btn dest-btn--danger"
                  :disabled="!!busy[ch.type]"
                  :title="$t('settings.notifications.remove')"
                  @click="confirmRemove(ch)"
                >
                  <Icon name="ph:trash-bold" />
                </button>
              </div>
            </header>

            <Transition name="drawer">
              <div v-if="expanded[ch.type]" class="dest-drawer">
                <!-- Public server info — hostname/instance URL for
                     transports where the user has to point an app at
                     a specific instance (ntfy, Gotify). We hide the
                     block for `web_push`: its `publicServerInfo`
                     carries the VAPID subject + public key, which
                     the composable still reads from props to call
                     `pushManager.subscribe`, but neither value is
                     actionable for the end user. -->
                <div
                  v-if="
                    ch.type !== 'web_push' &&
                      ch.publicServerInfo &&
                      ch.publicServerInfo.length > 0
                  "
                  class="dest-pub"
                >
                  <Icon name="ph:info-bold" />
                  <dl>
                    <div v-for="(item, j) in ch.publicServerInfo" :key="j">
                      <dt>{{ $t(item.labelKey) }}</dt>
                      <dd><code>{{ item.value }}</code></dd>
                    </div>
                  </dl>
                </div>

                <p class="dest-tagline">{{ $t(ch.taglineKey) }}</p>

                <!-- Web Push has no manual fields — the subscription
                     JSON is captured straight from the browser. We
                     replace the field grid + Save button with a
                     single permission-aware toggle. -->
                <div v-if="ch.type === 'web_push'" class="dest-webpush">
                  <p class="dest-webpush-state">
                    <Icon :name="webPushIcon" />
                    {{ webPushStateLabel }}
                  </p>
                  <p
                    v-if="webPush.error.value"
                    class="dest-webpush-error"
                  >
                    <Icon name="ph:warning-bold" />
                    {{ webPush.error.value }}
                  </p>
                </div>

                <div v-else class="dest-fields">
                  <label
                    v-for="f in ch.userFields"
                    :key="f.key"
                    class="field"
                  >
                    <span class="field-label">
                      {{ $t(f.labelKey) }}
                      <span v-if="!f.required" class="field-opt">{{ $t('settings.notifications.optional') }}</span>
                    </span>
                    <span v-if="f.hintKey" class="field-hint">{{ $t(f.hintKey) }}</span>
                    <input
                      v-if="f.type === 'int'"
                      type="number"
                      class="field-input"
                      :placeholder="String(f.default ?? '')"
                      :value="userConfigs[ch.type]?.[f.key]"
                      @input="setField(ch.type, f.key, Number(($event.target as HTMLInputElement).value))"
                    />
                    <input
                      v-else-if="f.type === 'password' || f.secret"
                      type="password"
                      autocomplete="new-password"
                      class="field-input"
                      :placeholder="ch.configured ? $t('settings.notifications.keepSecret') : ''"
                      :value="userConfigs[ch.type]?.[f.key]"
                      @input="setField(ch.type, f.key, ($event.target as HTMLInputElement).value)"
                    />
                    <input
                      v-else
                      :type="f.type === 'email' ? 'email' : f.type === 'url' ? 'url' : 'text'"
                      class="field-input"
                      :placeholder="f.default ? String(f.default) : ''"
                      :value="userConfigs[ch.type]?.[f.key]"
                      @input="setField(ch.type, f.key, ($event.target as HTMLInputElement).value)"
                    />
                  </label>
                </div>

                <div
                  v-if="ch.configured && ch.lastTestStatus === 'error' && ch.lastTestError"
                  class="dest-error"
                >
                  <Icon name="ph:warning-bold" />
                  <span>{{ ch.lastTestError }}</span>
                </div>

                <div class="dest-drawer-foot">
                  <button
                    type="button"
                    class="btn btn--ghost"
                    @click="toggleExpand(ch.type)"
                  >
                    {{ $t('common.close') }}
                  </button>
                  <button
                    v-if="ch.type === 'web_push'"
                    type="button"
                    class="btn"
                    :disabled="!!busy[ch.type] || webPushBusy || webPushStatus === 'unsupported' || webPushStatus === 'blocked'"
                    @click="toggleWebPush(ch)"
                  >
                    <Icon
                      :name="webPushBusy ? 'ph:circle-notch' : webPushStatus === 'enabled' ? 'ph:bell-slash-bold' : 'ph:bell-ringing-bold'"
                      :class="webPushBusy ? 'spin' : ''"
                    />
                    {{
                      webPushStatus === 'enabled'
                        ? $t('settings.notifications.webPush.disable')
                        : $t('settings.notifications.webPush.enable')
                    }}
                  </button>
                  <button
                    v-else
                    type="button"
                    class="btn"
                    :disabled="!!busy[ch.type] || !canSave(ch)"
                    @click="saveChannel(ch)"
                  >
                    <Icon
                      :name="busy[ch.type] === 'saving' ? 'ph:circle-notch' : 'ph:floppy-disk-bold'"
                      :class="busy[ch.type] === 'saving' ? 'spin' : ''"
                    />
                    {{ $t('common.save') }}
                  </button>
                </div>
              </div>
            </Transition>
          </li>

          <!--
            Add-destination slot. When `unconfiguredChannels` is
            non-empty, render a single slot. Clicking expands it
            into a grid of available channel types — same expand
            interaction as a regular row so users learn one pattern.
          -->
          <li
            v-if="unconfiguredChannels.length > 0"
            class="dest dest--add"
            :class="{ 'dest--open': addMenuOpen }"
            :style="{ '--stagger': `${configuredChannels.length * 40}ms` }"
          >
            <header class="dest-head" @click="addMenuOpen = !addMenuOpen" role="button" tabindex="0" @keydown.enter.prevent="addMenuOpen = !addMenuOpen" @keydown.space.prevent="addMenuOpen = !addMenuOpen">
              <span class="dest-glyph dest-glyph--add">
                <Icon name="ph:plus-bold" />
              </span>
              <span class="dest-id">
                <strong class="dest-name">{{ $t('settings.notifications.addDestination') }}</strong>
                <span class="dest-target dest-target--soft">
                  {{ $t('settings.notifications.availablePicker', unconfiguredChannels.length, { n: unconfiguredChannels.length }) }}
                </span>
              </span>
              <Icon
                name="ph:caret-down-bold"
                class="dest-add-chevron"
                :class="{ 'rotate-180': addMenuOpen }"
              />
            </header>

            <Transition name="drawer">
              <div v-if="addMenuOpen" class="dest-drawer">
                <p class="dest-add-help">
                  {{ $t('settings.notifications.addPickerHelp') }}
                </p>
                <ul class="dest-add-grid">
                  <li v-for="ch in unconfiguredChannels" :key="ch.type">
                    <button
                      type="button"
                      class="dest-add-tile"
                      @click="startAdding(ch)"
                    >
                      <Icon :name="ch.icon" class="dest-add-tile-icon" />
                      <span class="dest-add-tile-name">{{ $t(ch.labelKey) }}</span>
                      <span class="dest-add-tile-tagline">{{ $t(ch.taglineKey) }}</span>
                    </button>
                  </li>
                </ul>
              </div>
            </Transition>
          </li>
        </ul>
      </section>

      <!-- ── Block 02 — Routing ──────────────────────────────────── -->
      <section v-if="configuredChannels.length > 0" class="ns-block">
        <header class="ns-block-head">
          <span class="ns-block-num">02</span>
          <div class="ns-block-id">
            <h4>{{ $t('settings.notifications.routingTitle') }}</h4>
            <p>{{ $t('settings.notifications.routingDesc') }}</p>
          </div>
          <span class="ns-block-meta">
            <strong>{{ activeRouteCount }}</strong>
            {{ $t('settings.notifications.eventsRouted', { total: notifTypes.length }) }}
          </span>
        </header>

        <!--
          Global quick actions — one button per configured channel
          ("route all to <name>"), plus a destructive mute-all. The
          row is the at-a-glance "set the whole pipeline" control;
          per-category bulk lives inside each accordion below.
        -->
        <div class="route-quick">
          <button
            v-for="ch in configuredChannels"
            :key="ch.type"
            type="button"
            class="route-quick-btn"
            @click="routeAllTo(ch.type)"
          >
            <Icon :name="ch.icon" />
            <span>{{ $t('settings.notifications.routeAllTo', { name: $t(ch.labelKey) }) }}</span>
          </button>
          <button
            type="button"
            class="route-quick-btn route-quick-btn--mute"
            @click="routeAllTo(null)"
          >
            <Icon name="ph:bell-slash-bold" />
            <span>{{ $t('settings.notifications.muteAll') }}</span>
          </button>
        </div>

        <div class="route-cats">
          <details
            v-for="(cat, i) in categories"
            :key="cat.key"
            class="cat"
            :open="i < 2"
            :style="{ '--cat-color': cat.color, '--stagger': `${i * 40}ms` }"
          >
            <summary class="cat-head">
              <span class="cat-glyph">
                <Icon :name="cat.icon" />
              </span>
              <div class="cat-id">
                <h5>{{ $t(`settings.notifications.categories.${cat.key}`) }}</h5>
                <span class="cat-stat">
                  <strong>{{ countRoutedInCat(cat) }}</strong>
                  / {{ cat.types.length }}
                  {{ $t('settings.notifications.eventsShort') }}
                </span>
              </div>
              <span class="cat-bulk-wrap" @click.stop>
                <select
                  class="cat-bulk"
                  :value="catBulkValue(cat)"
                  @change="catBulkApply(cat, ($event.target as HTMLSelectElement).value)"
                >
                  <option value="">{{ $t('settings.notifications.routeNone') }}</option>
                  <option v-for="c in configuredChannels" :key="c.type" :value="c.type">
                    {{ $t(c.labelKey) }}
                  </option>
                  <option
                    v-if="catBulkValue(cat) === '__mixed__'"
                    value="__mixed__"
                    disabled
                  >
                    {{ $t('settings.notifications.bulkMixed') }}
                  </option>
                </select>
              </span>
              <Icon name="ph:caret-down-bold" class="cat-chevron" />
            </summary>

            <ul class="cat-events">
              <li v-for="type in cat.types" :key="type" class="event">
                <span class="event-id">
                  <span class="event-title">{{ $t(`notifications.types.${type}.title`) }}</span>
                  <span class="event-desc">{{ $t(`notifications.types.${type}.desc`, samplePayload) }}</span>
                </span>
                <span class="event-route">
                  <span
                    class="event-target"
                    :class="{ 'event-target--muted': !routing[type] }"
                  >
                    <span class="event-target-dot" />
                    <span>{{ routing[type] ? $t(channelLabelOf(routing[type])) : $t('settings.notifications.routeNone') }}</span>
                  </span>
                  <select
                    :value="routing[type] ?? ''"
                    @change="setRoute(type, ($event.target as HTMLSelectElement).value || null)"
                  >
                    <option value="">{{ $t('settings.notifications.routeNone') }}</option>
                    <option
                      v-for="c in configuredChannels"
                      :key="c.type"
                      :value="c.type"
                    >
                      {{ $t(c.labelKey) }}
                    </option>
                  </select>
                </span>
              </li>
            </ul>
          </details>
        </div>

        <!--
          Floating save bar — only materialises when there's a diff
          versus the last server snapshot. Discards revert to that
          snapshot; save commits and refreshes.
        -->
        <Transition name="save-bar">
          <div v-if="routingDirty" class="route-save">
            <span class="route-save-info">
              <Icon name="ph:floppy-disk-bold" />
              <span>{{ $t('settings.notifications.changesPending', routingDiffCount, { n: routingDiffCount }) }}</span>
            </span>
            <button
              type="button"
              class="btn btn--ghost"
              :disabled="routingSaving"
              @click="discardRouting"
            >
              {{ $t('common.discard') }}
            </button>
            <button
              type="button"
              class="btn btn--primary"
              :disabled="!routingDirty || routingSaving"
              @click="() => saveRouting()"
            >
              <Icon
                :name="routingSaving ? 'ph:circle-notch' : 'ph:check-bold'"
                :class="routingSaving ? 'spin' : ''"
              />
              {{ $t('settings.notifications.saveRouting') }}
            </button>
          </div>
        </Transition>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
interface UserChannel {
  type: string;
  labelKey: string;
  taglineKey: string;
  icon: string;
  userFields: {
    key: string;
    labelKey: string;
    hintKey?: string;
    type: string;
    required: boolean;
    secret?: boolean;
    default?: unknown;
  }[];
  configured: boolean;
  enabled: boolean;
  lastTestStatus: 'ok' | 'error' | null;
  lastTestError: string | null;
  lastTestedAt: string | null;
  userValues?: Record<string, unknown>;
  publicServerInfo?: Array<{ labelKey: string; value: string }>;
}

interface RoutingEntry {
  type: string;
  channelType: string;
}

interface EventCategory {
  key: string;
  icon: string;
  color: string;
  types: string[];
}

const channels = ref<UserChannel[]>([]);
const routing = reactive<Record<string, string>>({});
const initialRouting = reactive<Record<string, string>>({});
const expanded = reactive<Record<string, boolean>>({});
const busy = reactive<Record<string, 'saving' | 'testing' | null>>({});
const userConfigs = reactive<Record<string, Record<string, any>>>({});
const loaded = ref(false);
const routingSaving = ref(false);
const addMenuOpen = ref(false);

const confirm = useConfirm();
const { t } = useI18n();

// ── Web Push lifecycle ────────────────────────────────────────
// The Web Push channel has no manual form — the subscription is
// captured straight from the browser via `useWebPush()`. The
// composable owns the permission / SW / subscribe ceremonies; this
// section only renders state + an enable/disable button.
const webPush = useWebPush();
const webPushBusy = ref(false);
const webPushStatus = computed(() => webPush.status.value);

const webPushIcon = computed(() => {
  switch (webPushStatus.value) {
    case 'enabled':
      return 'ph:bell-ringing-fill';
    case 'blocked':
      return 'ph:bell-slash-fill';
    case 'unsupported':
      return 'ph:prohibit-bold';
    case 'enabling':
      return 'ph:circle-notch';
    default:
      return 'ph:bell-bold';
  }
});

const webPushStateLabel = computed(() => {
  switch (webPushStatus.value) {
    case 'enabled':
      return t('settings.notifications.webPush.enabledHere');
    case 'blocked':
      return t('settings.notifications.webPush.blocked');
    case 'unsupported':
      return t('settings.notifications.webPush.unsupported');
    case 'enabling':
      return t('settings.notifications.webPush.enabling');
    case 'error':
      return t('settings.notifications.webPush.error');
    default:
      return t('settings.notifications.webPush.disabledHere');
  }
});

onMounted(() => {
  void webPush.refresh();
});

async function toggleWebPush(ch: UserChannel) {
  if (webPushBusy.value) return;
  webPushBusy.value = true;
  try {
    if (webPushStatus.value === 'enabled') {
      await webPush.disable();
    } else {
      // Pull the VAPID public key from the admin server config. It
      // ships in `publicServerInfo` keyed by labelKey so the SETUP
      // path stays declarative.
      const pub = (ch.publicServerInfo ?? []).find(
        (i) => i.labelKey === 'admin.channels.web_push.publicKey'
      )?.value;
      if (!pub) {
        webPush.error.value = t(
          'settings.notifications.webPush.missingPublicKey'
        );
        return;
      }
      await webPush.enable(pub);
    }
    // Force a fresh fetch of the channel rows so the UI tracks the
    // server-side state (configured: true → row appears; trash →
    // row leaves).
    await refresh();
  } finally {
    webPushBusy.value = false;
  }
}

// Exhaustive list of every notification type the API can emit.
// Kept in sync with the union in apps/api/utils/notify.ts.
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
  // ── Social graph (follow) ─────────────────────────────────
  'followed_user_upload',
  // ── Upload-request bounty board ───────────────────────────
  'request_filled',
  'request_validated',
  'request_rejected',
  'request_auto_validated',
  'request_new_comment',
];

// 8 categories grouping the 35 events. Each carries an icon + a
// hint colour used to tint the category badge — visual anchoring
// is more important than scanning 35 flat rows.
const categories: EventCategory[] = [
  {
    key: 'uploads',
    icon: 'ph:cloud-arrow-up-bold',
    color: '#34d4d8',
    types: [
      'upload_accepted',
      'upload_rejected',
      'upload_changes_requested',
      'upload_reset',
      'moderation_message_received',
      'torrent_deleted_by_staff',
    ],
  },
  {
    key: 'hnr',
    icon: 'ph:siren-bold',
    color: '#ff6b6b',
    types: ['hnr_violation_marked', 'hnr_cleared', 'hnr_exempted'],
  },
  {
    key: 'account',
    icon: 'ph:user-circle-bold',
    color: '#a78bfa',
    types: [
      'account_banned',
      'account_unbanned',
      'role_attached_manually',
      'role_detached',
      'staff_status_changed',
    ],
  },
  {
    key: 'bonus',
    icon: 'ph:coin-bold',
    color: '#d4a734',
    types: [
      'bonus_points_adjusted',
      'bonus_event_started',
      'first_seeder_reward',
      'seeding_milestone_reached',
    ],
  },
  {
    key: 'security',
    icon: 'ph:shield-check-bold',
    color: '#6cd161',
    types: [
      'password_changed',
      'totp_enabled',
      'totp_disabled',
      'passkey_added',
      'passkey_removed',
      'recovery_codes_regenerated',
      'recovery_code_used',
      'login_new_ip',
      'trusted_device_added',
    ],
  },
  {
    key: 'social',
    icon: 'ph:chats-circle-bold',
    color: '#f472b6',
    types: [
      'comment_on_my_upload',
      'forum_reply_on_my_topic',
      'comment_deleted_by_staff',
      'forum_post_deleted_by_staff',
      // The follow-graph upload ping lands here too — it's
      // socially-motivated content (someone you subscribe to
      // released), not a moderation event.
      'followed_user_upload',
    ],
  },
  // Bounty board — every state-change on a request someone
  // staked points on. Own category because the audience differs
  // from `social`: the requester / filler relationship is one-
  // to-one, not a thread.
  {
    key: 'requests',
    icon: 'ph:megaphone-bold',
    color: '#d4a734',
    types: [
      'request_filled',
      'request_validated',
      'request_rejected',
      'request_auto_validated',
      'request_new_comment',
    ],
  },
  {
    key: 'invites',
    icon: 'ph:envelope-open-bold',
    color: '#fb923c',
    types: ['invite_redeemed', 'invitee_banned'],
  },
  {
    key: 'moderator',
    icon: 'ph:gavel-bold',
    color: '#f5c518',
    types: ['new_pending_upload', 'new_report_filed', 'report_actioned'],
  },
];

// Synthetic placeholders so the desc previews read like real
// notifs instead of `{torrentName}` literals. Mirrors the test
// payload the server uses for /test calls.
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
  // Bounty-board placeholders so the preview lines render real
  // text instead of `{requestTitle}` braces.
  requestTitle: 'Looking for: complete Cowboy Bebop run',
  requesterUsername: 'user_carol',
  fillerUsername: 'uploader_eve',
  authorUsername: 'user_frank',
  rewardPoints: 200,
};

// ── Channel sets ──────────────────────────────────────────────
const availableChannels = computed(() => channels.value);
const configuredChannels = computed(() =>
  channels.value.filter((c) => c.configured),
);
const unconfiguredChannels = computed(() =>
  channels.value.filter((c) => !c.configured),
);
const activeChannels = computed(() =>
  channels.value.filter((c) => c.configured && c.enabled),
);

// ── Routing diff & helpers ────────────────────────────────────
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
const routingDiffCount = computed(() => {
  let n = 0;
  const keys = new Set([
    ...Object.keys(routing),
    ...Object.keys(initialRouting),
  ]);
  for (const k of keys) {
    if ((routing[k] ?? '') !== (initialRouting[k] ?? '')) n += 1;
  }
  return n;
});
const activeRouteCount = computed(() =>
  notifTypes.reduce((n, t) => (routing[t] ? n + 1 : n), 0),
);

function channelLabelOf(type: string): string {
  const ch = channels.value.find((c) => c.type === type);
  return ch?.labelKey ?? type;
}

function countRoutedInCat(cat: EventCategory): number {
  return cat.types.reduce((n, t) => (routing[t] ? n + 1 : n), 0);
}

/** Compact bulk-state for a category's master select. */
function catBulkValue(cat: EventCategory): string {
  const targets = new Set<string>();
  let unrouted = 0;
  for (const t of cat.types) {
    const v = routing[t];
    if (v) targets.add(v);
    else unrouted += 1;
  }
  if (targets.size === 0 && unrouted === cat.types.length) return '';
  if (targets.size === 1 && unrouted === 0) {
    return targets.values().next().value as string;
  }
  return '__mixed__';
}

function catBulkApply(cat: EventCategory, value: string) {
  if (value === '__mixed__') return;
  for (const t of cat.types) {
    if (value) routing[t] = value;
    else delete routing[t];
  }
}

/** Global bulk: route every type to one destination (or mute all). */
function routeAllTo(channelType: string | null) {
  for (const t of notifTypes) {
    if (channelType) routing[t] = channelType;
    else delete routing[t];
  }
}

function discardRouting() {
  for (const k of Object.keys(routing)) delete routing[k];
  for (const [k, v] of Object.entries(initialRouting)) routing[k] = v;
}

// ── Channel target description ────────────────────────────────
/**
 * The first non-secret user value, formatted for at-a-glance
 * scanning. Falls back to a hint that the row is configured.
 * Secrets are never echoed back from the API, so this only ever
 * shows public-ish data (email "to", ntfy topic, …).
 */
function describeTarget(ch: UserChannel): string {
  const v = ch.userValues || {};
  for (const f of ch.userFields) {
    if (f.secret) continue;
    if (v[f.key] != null && v[f.key] !== '') return String(v[f.key]);
  }
  return t('settings.notifications.targetMasked');
}

function statusLabel(ch: UserChannel): string {
  if (ch.lastTestStatus === 'ok') return t('settings.notifications.statusOk');
  if (ch.lastTestStatus === 'error')
    return t('settings.notifications.statusError');
  return t('settings.notifications.statusPending');
}

// ── Data load & mutations ─────────────────────────────────────
async function refresh() {
  const res = await $fetch<{
    channels: UserChannel[];
    routing: RoutingEntry[];
  }>('/api/me/notification-channels');
  channels.value = res.channels;
  for (const ch of res.channels) {
    userConfigs[ch.type] = { ...(ch.userValues || {}) };
  }
  for (const k of Object.keys(routing)) delete routing[k];
  for (const k of Object.keys(initialRouting)) delete initialRouting[k];
  for (const r of res.routing) {
    routing[r.type] = r.channelType;
    initialRouting[r.type] = r.channelType;
  }
  loaded.value = true;
}

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
    if (f.secret && ch.configured) continue;
    if (cfg[f.key] == null || cfg[f.key] === '') return false;
  }
  return true;
}

function startAdding(ch: UserChannel) {
  addMenuOpen.value = false;
  // Optimistically expand the row so the form is ready. The channel
  // technically isn't `configured` yet — the next save creates it.
  expanded[ch.type] = true;
  userConfigs[ch.type] = {};
  // Move the soon-to-be-configured channel to the top of the list
  // by flipping its `configured` flag in the local copy. The server
  // round-trip will overwrite this in `refresh()` after save.
  const found = channels.value.find((c) => c.type === ch.type);
  if (found) {
    found.configured = true;
    // bring it to the front of the configured slice
    const list = channels.value;
    const idx = list.indexOf(found);
    list.splice(idx, 1);
    list.unshift(found);
  }
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

    // First-channel adoption: opt-out semantics — pre-route every
    // type to the new channel so the user sees a complete pipeline
    // out of the box. They can later untick or re-route per row.
    const wasFirst = !channels.value.some(
      (c) => c.configured && c.type !== ch.type,
    );
    if (wasFirst) {
      for (const ty of notifTypes) routing[ty] = ch.type;
      await saveRouting(true);
    }
    expanded[ch.type] = false;
    await refresh();
  } finally {
    busy[ch.type] = null;
  }
}

async function confirmRemove(ch: UserChannel) {
  const ok = await confirm({
    title: t('settings.notifications.removeConfirmTitle', {
      name: t(ch.labelKey),
    }),
    message: t('settings.notifications.removeConfirmMessage'),
    confirmText: t('settings.notifications.remove'),
    cancelText: t('common.cancel'),
    destructive: true,
  });
  if (!ok) return;
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
    for (const k of Object.keys(initialRouting)) delete initialRouting[k];
    for (const [k, v] of Object.entries(routing)) initialRouting[k] = v;
    if (!silent) await refresh();
  } finally {
    routingSaving.value = false;
  }
}
</script>

<style scoped>
/* ── Container ────────────────────────────────────────────── */
.ns {
  display: flex;
  flex-direction: column;
  gap: 2rem;
  position: relative;
}
.ns::before {
  /* Hairline gold rule along the left edge of the section — same
     thread the /me bonus tile uses, signalling "this is the
     notifications surface". Doesn't shift layout because the
     pseudo is absolute. */
  content: '';
  position: absolute;
  left: -1rem;
  top: 0.5rem;
  bottom: 0.5rem;
  width: 1px;
  background: linear-gradient(
    to bottom,
    rgba(212, 167, 52, 0) 0%,
    rgba(212, 167, 52, 0.4) 15%,
    rgba(212, 167, 52, 0.4) 85%,
    rgba(212, 167, 52, 0) 100%
  );
  pointer-events: none;
}

.ns-empty {
  text-align: center;
  padding: 2.5rem 2rem;
  border: 1px dashed rgb(var(--line-default));
  border-radius: var(--radius-md);
  background: rgb(var(--bg-elevated));
}
.ns-empty-icon {
  font-size: 2rem;
  color: rgb(var(--fg-muted));
  margin-bottom: 0.75rem;
}
.ns-empty-title {
  margin: 0 0 0.4rem;
  font-size: 0.95rem;
  font-weight: 700;
  color: rgb(var(--fg-strong));
}
.ns-empty-desc {
  margin: 0;
  max-width: 38ch;
  margin-inline: auto;
  font-size: 0.82rem;
  line-height: 1.5;
  color: rgb(var(--fg-muted));
}

/* ── Block scaffolding ───────────────────────────────────── */
.ns-block {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.ns-block-head {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.85rem;
  padding-bottom: 0.85rem;
  border-bottom: 1px solid rgb(var(--line-default));
}
.ns-block-num {
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
.ns-block-id h4 {
  margin: 0;
  font-size: 0.92rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
}
.ns-block-id p {
  margin: 0.18rem 0 0;
  font-size: 0.75rem;
  color: rgb(var(--fg-muted));
  letter-spacing: 0.01em;
}
.ns-block-meta {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: rgb(var(--fg-muted));
  text-transform: uppercase;
}
.ns-block-meta strong {
  color: rgb(var(--fg-strong));
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.ns-block-meta-sep {
  margin: 0 0.25rem;
  color: rgb(var(--fg-faint));
}
@media (max-width: 640px) {
  .ns-block-head {
    grid-template-columns: auto 1fr;
  }
  .ns-block-meta {
    grid-column: 1 / -1;
    margin-top: 0.4rem;
  }
}

/* ── Destinations ────────────────────────────────────────── */
.dest-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.dest {
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  background: rgb(var(--bg-elevated));
  overflow: hidden;
  transition: border-color 0.18s ease, background 0.18s ease;
  /* Staggered fade-in on mount — `--stagger` set inline as the row
     index × 40ms. Cheap orchestration, plays once. */
  animation: dest-in 0.36s cubic-bezier(0.2, 0.7, 0.2, 1) backwards;
  animation-delay: var(--stagger, 0ms);
}
@keyframes dest-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.dest:hover {
  border-color: rgb(var(--line-strong));
}
.dest--open {
  border-color: rgba(212, 167, 52, 0.45);
  background: rgb(var(--bg-elevated));
}
.dest-head {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: center;
  gap: 0.85rem;
  padding: 0.85rem 1rem;
  cursor: default;
}
.dest--add .dest-head {
  cursor: pointer;
  transition: background 0.18s ease;
}
.dest--add .dest-head:hover {
  background: rgb(var(--bg-hover) / 0.4);
}

.dest-glyph {
  position: relative;
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  background: rgb(var(--bg-inset));
  border: 1px solid rgb(var(--line-default));
  font-size: 1rem;
  color: rgb(var(--fg-strong));
  flex-shrink: 0;
}
.dest-glyph--add {
  border-style: dashed;
  color: rgb(var(--fg-muted));
}
.dest-glyph-dot {
  position: absolute;
  right: -3px;
  top: -3px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 2px solid rgb(var(--bg-elevated));
  background: rgb(var(--fg-faint));
  transition: background 0.18s ease, box-shadow 0.18s ease;
}
.dest-glyph[data-status='ok'] .dest-glyph-dot {
  background: rgb(var(--online));
  box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.18);
}
.dest-glyph[data-status='error'] .dest-glyph-dot {
  background: rgb(var(--danger));
  box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.22);
}
.dest-glyph[data-status='pending'] .dest-glyph-dot {
  background: rgb(var(--warning));
  box-shadow: 0 0 0 2px rgba(234, 179, 8, 0.22);
}

.dest-id {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}
.dest-name {
  font-size: 0.92rem;
  font-weight: 700;
  color: rgb(var(--fg-strong));
  letter-spacing: 0.01em;
}
.dest-target {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11.5px;
  color: rgb(var(--fg-muted));
  background: transparent;
  padding: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.dest-target--soft {
  font-style: italic;
}

.dest-status {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  font-weight: 700;
  padding: 0.22rem 0.55rem;
  border-radius: var(--radius-sm);
  border: 1px solid currentColor;
  white-space: nowrap;
}
.dest-status--ok {
  color: rgb(var(--online));
  background: rgba(34, 197, 94, 0.06);
}
.dest-status--error {
  color: rgb(var(--danger));
  background: rgba(239, 68, 68, 0.08);
}
.dest-status--pending {
  color: rgb(var(--warning));
  background: rgba(234, 179, 8, 0.06);
}

.dest-actions {
  display: inline-flex;
  gap: 0.25rem;
}
.dest-btn {
  background: transparent;
  border: 1px solid transparent;
  color: rgb(var(--fg-muted));
  padding: 0.4rem;
  border-radius: var(--radius-sm);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.95rem;
  transition: background 0.16s ease, color 0.16s ease, border-color 0.16s ease;
}
.dest-btn:hover:not(:disabled) {
  background: rgb(var(--bg-hover) / 0.5);
  color: rgb(var(--fg-strong));
  border-color: rgb(var(--line-default));
}
.dest-btn--active {
  background: rgba(212, 167, 52, 0.12);
  color: #d4a734;
  border-color: rgba(212, 167, 52, 0.4);
}
.dest-btn--danger:hover:not(:disabled) {
  color: rgb(var(--danger));
  border-color: rgba(239, 68, 68, 0.4);
  background: rgba(239, 68, 68, 0.06);
}
.dest-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.dest-add-chevron {
  font-size: 0.95rem;
  color: rgb(var(--fg-muted));
  transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}
.rotate-180 {
  transform: rotate(180deg);
}

/* Drawer (edit form for a row) */
.dest-drawer {
  padding: 0 1rem 1rem;
  border-top: 1px dashed rgb(var(--line-default));
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
.dest-tagline {
  margin: 0.75rem 0 0;
  font-size: 0.78rem;
  color: rgb(var(--fg-muted));
  line-height: 1.5;
}

.dest-pub {
  margin-top: 0.85rem;
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  background: rgba(212, 167, 52, 0.07);
  border: 1px solid rgba(212, 167, 52, 0.25);
  border-radius: var(--radius-sm);
  padding: 0.7rem 0.85rem;
  font-size: 0.78rem;
  color: rgb(var(--fg-strong));
}
.dest-pub > svg {
  color: #d4a734;
  font-size: 1rem;
  flex-shrink: 0;
  margin-top: 0.1rem;
}
.dest-pub dl {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.dest-pub dl > div {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.5rem;
}
.dest-pub dt {
  font-weight: 600;
  color: rgb(var(--fg-strong));
  margin: 0;
}
.dest-pub dd {
  margin: 0;
}
.dest-pub code {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11.5px;
  background: rgb(var(--bg-base) / 0.6);
  padding: 0.12rem 0.4rem;
  border-radius: var(--radius-sm);
  word-break: break-all;
}

.dest-fields {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.75rem;
}
@media (min-width: 640px) {
  .dest-fields {
    grid-template-columns: 1fr 1fr;
  }
  .dest-fields .field--full {
    grid-column: 1 / -1;
  }
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.field-label {
  font-size: 0.78rem;
  font-weight: 600;
  color: rgb(var(--fg-strong));
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.field-opt {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgb(var(--fg-subtle));
  font-weight: 500;
}
.field-hint {
  font-size: 0.7rem;
  color: rgb(var(--fg-muted));
  line-height: 1.45;
}
.field-input {
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  padding: 0.5rem 0.7rem;
  color: rgb(var(--fg-strong));
  font-size: 0.85rem;
  font-family: inherit;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}
.field-input:focus {
  outline: none;
  border-color: rgba(212, 167, 52, 0.6);
  box-shadow: 0 0 0 3px rgba(212, 167, 52, 0.12);
}
.field-input::placeholder {
  color: rgb(var(--fg-faint));
  font-style: italic;
}

.dest-error {
  display: flex;
  align-items: flex-start;
  gap: 0.4rem;
  font-size: 0.74rem;
  color: rgb(var(--danger));
  background: rgba(239, 68, 68, 0.08);
  border-radius: var(--radius-sm);
  padding: 0.55rem 0.7rem;
  word-break: break-word;
}

/* Web Push has no manual form — surface the browser permission
   state in lieu of fields so the operator sees what's happening
   before they click. */
.dest-webpush {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 0.7rem 0.85rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
}
.dest-webpush-state {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0;
  font-size: 0.84rem;
  color: rgb(var(--fg-default));
}
.dest-webpush-state > svg {
  font-size: 1rem;
  color: rgb(var(--fg-muted));
}
.dest-webpush-error {
  display: inline-flex;
  align-items: flex-start;
  gap: 0.35rem;
  margin: 0;
  font-size: 0.74rem;
  color: rgb(var(--danger));
}

.dest-drawer-foot {
  display: flex;
  justify-content: flex-end;
  gap: 0.45rem;
}

/* Add-destination picker */
.dest-add-help {
  margin: 0.75rem 0 0;
  font-size: 0.78rem;
  color: rgb(var(--fg-muted));
}
.dest-add-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.5rem;
}
@media (min-width: 640px) {
  .dest-add-grid {
    grid-template-columns: 1fr 1fr;
  }
}
@media (min-width: 900px) {
  .dest-add-grid {
    grid-template-columns: 1fr 1fr 1fr;
  }
}
.dest-add-tile {
  width: 100%;
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  padding: 0.85rem;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.18s ease, background 0.18s ease,
    transform 0.18s ease;
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: auto auto;
  column-gap: 0.7rem;
  row-gap: 0.1rem;
  font-family: inherit;
  color: inherit;
}
.dest-add-tile:hover {
  border-color: rgba(212, 167, 52, 0.45);
  background: rgb(var(--bg-hover) / 0.45);
  transform: translateY(-1px);
}
.dest-add-tile-icon {
  grid-row: 1 / 3;
  font-size: 1.3rem;
  color: rgb(var(--fg-strong));
  align-self: center;
}
.dest-add-tile-name {
  font-size: 0.85rem;
  font-weight: 700;
  color: rgb(var(--fg-strong));
}
.dest-add-tile-tagline {
  font-size: 0.7rem;
  color: rgb(var(--fg-muted));
  line-height: 1.4;
}

/* ── Routing — quick actions ─────────────────────────────── */
.route-quick {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.route-quick-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  padding: 0.4rem 0.75rem;
  font-size: 0.74rem;
  font-weight: 600;
  color: rgb(var(--fg-muted));
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: inherit;
}
.route-quick-btn:hover {
  color: rgb(var(--fg-strong));
  border-color: rgba(212, 167, 52, 0.4);
  background: rgba(212, 167, 52, 0.06);
}
.route-quick-btn--mute {
  margin-left: auto;
}
.route-quick-btn--mute:hover {
  color: rgb(var(--danger));
  border-color: rgba(239, 68, 68, 0.35);
  background: rgba(239, 68, 68, 0.06);
}

/* ── Routing — categories ─────────────────────────────────── */
.route-cats {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.cat {
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  background: rgb(var(--bg-elevated));
  overflow: hidden;
  animation: dest-in 0.36s cubic-bezier(0.2, 0.7, 0.2, 1) backwards;
  animation-delay: var(--stagger, 0ms);
}
.cat[open] {
  border-color: rgb(var(--line-strong));
}
.cat-head {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: center;
  gap: 0.85rem;
  padding: 0.7rem 0.95rem;
  cursor: pointer;
  list-style: none;
  transition: background 0.16s ease;
}
.cat-head::-webkit-details-marker {
  display: none;
}
.cat-head:hover {
  background: rgb(var(--bg-hover) / 0.4);
}
.cat-glyph {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  display: grid;
  place-items: center;
  font-size: 1rem;
  color: var(--cat-color);
  background: color-mix(in srgb, var(--cat-color) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--cat-color) 30%, transparent);
}
.cat-id {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}
.cat-id h5 {
  margin: 0;
  font-size: 0.82rem;
  font-weight: 700;
  color: rgb(var(--fg-strong));
  letter-spacing: 0.01em;
}
.cat-stat {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  letter-spacing: 0.08em;
  color: rgb(var(--fg-muted));
  text-transform: uppercase;
}
.cat-stat strong {
  color: var(--cat-color);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.cat-bulk-wrap {
  /* Wrapper exists so the `@click.stop` we attach prevents the
     surrounding `<summary>` from toggling when the user fiddles
     with the select. */
}
.cat-bulk {
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  padding: 0.32rem 0.55rem;
  font-size: 0.74rem;
  font-weight: 600;
  color: rgb(var(--fg-strong));
  font-family: inherit;
  min-width: 140px;
  cursor: pointer;
  transition: border-color 0.18s ease;
}
.cat-bulk:hover {
  border-color: rgba(212, 167, 52, 0.45);
}
.cat-chevron {
  font-size: 0.9rem;
  color: rgb(var(--fg-muted));
  transition: transform 0.24s cubic-bezier(0.4, 0, 0.2, 1);
}
.cat[open] .cat-chevron {
  transform: rotate(180deg);
  color: #d4a734;
}
@media (max-width: 640px) {
  .cat-head {
    grid-template-columns: auto 1fr auto;
  }
  .cat-bulk-wrap {
    grid-column: 1 / -1;
    margin-top: 0.4rem;
  }
  .cat-bulk {
    width: 100%;
  }
}

.cat-events {
  list-style: none;
  margin: 0;
  padding: 0 0.5rem 0.5rem;
  border-top: 1px dashed rgb(var(--line-default));
}
.event {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 1rem;
  padding: 0.6rem 0.5rem;
  border-bottom: 1px solid rgb(var(--line-default) / 0.5);
  transition: background 0.16s ease;
}
.event:last-child {
  border-bottom: 0;
}
.event:hover {
  background: rgb(var(--bg-hover) / 0.3);
}
.event-id {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}
.event-title {
  font-size: 0.82rem;
  font-weight: 600;
  color: rgb(var(--fg-strong));
}
.event-desc {
  font-size: 0.72rem;
  color: rgb(var(--fg-muted));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.event-route {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  position: relative;
}
.event-target {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  letter-spacing: 0.04em;
  color: rgb(var(--fg-strong));
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-radius: 999px;
  padding: 0.22rem 0.55rem 0.22rem 0.5rem;
  pointer-events: none;
}
.event-target--muted {
  color: rgb(var(--fg-faint));
  border-style: dashed;
}
.event-target-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #d4a734;
}
.event-target--muted .event-target-dot {
  background: rgb(var(--fg-faint));
}
/* The select sits ON TOP of the chip (invisible) so the chip is
   the visual affordance and the select is the interaction. */
.event-route select {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
  font-family: inherit;
}
@media (max-width: 480px) {
  .event-desc {
    display: none;
  }
}

/* ── Floating save bar ────────────────────────────────────── */
.route-save {
  position: sticky;
  bottom: 1rem;
  margin-top: 0.5rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 0.85rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgba(212, 167, 52, 0.55);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-overlay);
  backdrop-filter: blur(8px);
  z-index: 3;
}
.route-save-info {
  flex: 1;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.78rem;
  color: rgb(var(--fg-strong));
  font-weight: 600;
}
.route-save-info > svg {
  color: #d4a734;
}

/* ── Generic buttons ──────────────────────────────────────── */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.85rem;
  border-radius: var(--radius-sm);
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-base));
  color: rgb(var(--fg-strong));
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: inherit;
}
.btn:hover:not(:disabled) {
  border-color: rgba(212, 167, 52, 0.55);
  background: rgba(212, 167, 52, 0.06);
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn--ghost {
  background: transparent;
}
.btn--primary {
  background: #d4a734;
  border-color: #d4a734;
  color: #1a1a1a;
}
.btn--primary:hover:not(:disabled) {
  background: #e8b94e;
  border-color: #e8b94e;
}

/* ── Transitions ──────────────────────────────────────────── */
.drawer-enter-active,
.drawer-leave-active {
  transition: max-height 0.3s cubic-bezier(0.2, 0.7, 0.2, 1),
    opacity 0.22s ease;
  overflow: hidden;
}
.drawer-enter-from,
.drawer-leave-to {
  max-height: 0;
  opacity: 0;
}
.drawer-enter-to,
.drawer-leave-from {
  max-height: 2000px;
  opacity: 1;
}

.save-bar-enter-active,
.save-bar-leave-active {
  transition: transform 0.28s cubic-bezier(0.2, 0.7, 0.2, 1),
    opacity 0.22s ease;
}
.save-bar-enter-from,
.save-bar-leave-to {
  transform: translateY(120%);
  opacity: 0;
}

.spin {
  animation: ns-spin 1s linear infinite;
}
@keyframes ns-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
