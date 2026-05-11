<template>
  <!--
    Channel card — one per transport on the /admin/notifications
    dispatch board. The card is its own self-contained shell: a
    compact header for at-a-glance status + actions, an expandable
    drawer with the full server-side config form.

    `variant` ('live' | 'action' | 'available') drives the tinting
    so the eye groups cards by state even before reading the
    surrounding section header.
  -->
  <li
    class="cc"
    :class="[
      `cc--${variant}`,
      { 'cc--open': expanded, 'cc--busy': busyState !== null },
    ]"
    :style="{ '--stagger': `${staggerIndex * 50}ms` }"
  >
    <!-- ── Card head — always visible ───────────────────────── -->
    <header class="cc-head">
      <span class="cc-glyph" :data-variant="variant">
        <Icon :name="ch.icon" />
        <span class="cc-glyph-dot" aria-hidden="true" />
      </span>

      <div class="cc-id">
        <div class="cc-title-row">
          <h3 class="cc-name">{{ $t(ch.labelKey) }}</h3>
          <span class="cc-status">
            <span class="cc-status-dot" />
            {{ statusLabel }}
          </span>
        </div>
        <p class="cc-tagline">{{ $t(ch.taglineKey) }}</p>
      </div>

      <!-- Quick toggle — visible on every variant. The CTA below
           changes based on state. -->
      <label class="cc-toggle" :title="$t('admin.notifications.cardToggle')">
        <input
          type="checkbox"
          :checked="ch.enabled"
          :disabled="!!busyState"
          @change="$emit('toggle-enabled', ($event.target as HTMLInputElement).checked)"
        />
        <span class="cc-toggle-track" />
      </label>
    </header>

    <!-- ── Status line — last test info ─────────────────────── -->
    <div v-if="ch.lastTestedAt || ch.lastTestError" class="cc-status-line">
      <span v-if="ch.lastTestedAt" class="cc-status-when">
        <Icon name="ph:clock-bold" />
        {{ relativeTime }}
      </span>
      <span
        v-if="ch.lastTestStatus === 'error' && ch.lastTestError"
        class="cc-status-error"
        :title="ch.lastTestError"
      >
        <Icon name="ph:warning-bold" />
        {{ ch.lastTestError }}
      </span>
    </div>

    <!-- ── Bottom action row — collapsed view ───────────────── -->
    <div v-if="!expanded" class="cc-actions">
      <span class="cc-context">{{ contextLabel }}</span>
      <div class="cc-action-buttons">
        <button
          v-if="ch.enabled"
          type="button"
          class="btn btn--ghost"
          :disabled="!!busyState"
          @click="$emit('test')"
        >
          <Icon
            :name="busyState === 'testing' ? 'ph:circle-notch' : 'ph:paper-plane-tilt-bold'"
            :class="busyState === 'testing' ? 'spin' : ''"
          />
          {{ $t('admin.notifications.test') }}
        </button>
        <button
          v-if="ch.hasServerConfig"
          type="button"
          class="btn btn--primary"
          :disabled="!!busyState"
          @click="$emit('toggle-expand')"
        >
          <Icon name="ph:sliders-bold" />
          {{ ch.configured ? $t('common.edit') : $t('admin.notifications.configure') }}
        </button>
      </div>
    </div>

    <!-- ── Expanded drawer — form ───────────────────────────── -->
    <Transition name="cc-drawer">
      <div v-if="expanded" class="cc-drawer">
        <!--
          When the channel has no admin-side config (pure user
          webhooks: Discord / Slack / Mattermost), the drawer just
          shows a note + the cancel/test affordances. The "Edit"
          button still opens it because the toggle to enable lives
          here too.
        -->
        <div v-if="!ch.hasServerConfig" class="cc-note">
          <Icon name="ph:info-bold" />
          <span>{{ $t('admin.notifications.channels.userOwned') }}</span>
        </div>

        <div v-else class="cc-form">
          <label v-for="f in ch.serverFields" :key="f.key" class="field">
            <span class="field-label">
              {{ $t(f.labelKey) }}
              <span v-if="!f.required" class="field-opt">{{
                $t('admin.notifications.optional')
              }}</span>
            </span>
            <span v-if="f.hintKey" class="field-hint">
              {{ $t(f.hintKey) }}
            </span>

            <!-- Boolean toggle -->
            <label v-if="f.type === 'bool'" class="field-bool">
              <input
                type="checkbox"
                :checked="!!serverConfig[f.key]"
                @change="
                  $emit('field-change', {
                    type: ch.type,
                    key: f.key,
                    value: ($event.target as HTMLInputElement).checked,
                  })
                "
              />
              <span class="field-bool-track" />
            </label>

            <!-- Number -->
            <input
              v-else-if="f.type === 'int'"
              type="number"
              class="field-input"
              :placeholder="String(f.default ?? '')"
              :value="serverConfig[f.key]"
              @input="
                $emit('field-change', {
                  type: ch.type,
                  key: f.key,
                  value: Number(($event.target as HTMLInputElement).value),
                })
              "
            />

            <!-- Password / secret -->
            <input
              v-else-if="f.type === 'password' || f.secret"
              type="password"
              autocomplete="new-password"
              class="field-input"
              :placeholder="
                ch.configured
                  ? $t('admin.notifications.channels.keepSecret')
                  : ''
              "
              :value="serverConfig[f.key]"
              @input="
                $emit('field-change', {
                  type: ch.type,
                  key: f.key,
                  value: ($event.target as HTMLInputElement).value,
                })
              "
            />

            <!-- Generic text / email / url -->
            <input
              v-else
              :type="f.type === 'email' ? 'email' : f.type === 'url' ? 'url' : 'text'"
              class="field-input"
              :placeholder="f.default ? String(f.default) : ''"
              :value="serverConfig[f.key]"
              @input="
                $emit('field-change', {
                  type: ch.type,
                  key: f.key,
                  value: ($event.target as HTMLInputElement).value,
                })
              "
            />
          </label>
        </div>

        <!--
          Inline error block when the last test failed. Repeats
          the compact error from the card-head but with more room
          to read the upstream's message.
        -->
        <div
          v-if="ch.lastTestStatus === 'error' && ch.lastTestError"
          class="cc-error"
        >
          <Icon name="ph:warning-bold" />
          <div>
            <strong>{{ $t('admin.notifications.lastFailure') }}</strong>
            <p>{{ ch.lastTestError }}</p>
          </div>
        </div>

        <div class="cc-drawer-foot">
          <button
            type="button"
            class="btn btn--ghost"
            @click="$emit('toggle-expand')"
          >
            {{ $t('common.close') }}
          </button>
          <button
            type="button"
            class="btn btn--ghost"
            v-if="ch.enabled"
            :disabled="!!busyState"
            @click="$emit('test')"
          >
            <Icon
              :name="busyState === 'testing' ? 'ph:circle-notch' : 'ph:paper-plane-tilt-bold'"
              :class="busyState === 'testing' ? 'spin' : ''"
            />
            {{ $t('admin.notifications.test') }}
          </button>
          <button
            v-if="ch.hasServerConfig"
            type="button"
            class="btn btn--primary"
            :disabled="!!busyState"
            @click="$emit('save')"
          >
            <Icon
              :name="busyState === 'saving' ? 'ph:circle-notch' : 'ph:floppy-disk-bold'"
              :class="busyState === 'saving' ? 'spin' : ''"
            />
            {{ $t('common.save') }}
          </button>
        </div>
      </div>
    </Transition>
  </li>
</template>

<script setup lang="ts">
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

const props = defineProps<{
  ch: AdminChannel;
  busyState: 'saving' | 'testing' | null;
  expanded: boolean;
  serverConfig: Record<string, any>;
  staggerIndex: number;
  variant: 'live' | 'action' | 'available';
}>();

defineEmits<{
  'toggle-expand': [];
  'toggle-enabled': [boolean];
  save: [];
  test: [];
  'field-change': [{ type: string; key: string; value: any }];
}>();

const { t } = useI18n();

// At-a-glance status label.
const statusLabel = computed(() => {
  if (!props.ch.enabled) return t('admin.notifications.statusDisabled');
  if (props.ch.lastTestStatus === 'ok')
    return t('admin.notifications.statusLive');
  if (props.ch.lastTestStatus === 'error')
    return t('admin.notifications.statusFailing');
  return t('admin.notifications.statusUntested');
});

/**
 * Tiny contextual line under the status — what the next action
 * should be, in plain language. Reduces the number of times an
 * admin has to think about "what now".
 */
const contextLabel = computed(() => {
  if (!props.ch.enabled) {
    return props.ch.hasServerConfig && !props.ch.configured
      ? t('admin.notifications.contextNeverConfigured')
      : t('admin.notifications.contextDisabled');
  }
  if (props.ch.lastTestStatus === 'error') {
    return t('admin.notifications.contextRetestNeeded');
  }
  if (props.ch.lastTestStatus === null) {
    return t('admin.notifications.contextUntested');
  }
  return t('admin.notifications.contextDelivering');
});

/**
 * Relative-time formatter for the "tested X ago" pill — keeps
 * the dispatch board scannable without forcing the admin to do
 * timezone math.
 */
const relativeTime = computed(() => {
  if (!props.ch.lastTestedAt) return t('common.never');
  const diffMs = Date.now() - new Date(props.ch.lastTestedAt).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return t('common.justNow');
  if (mins < 60) return t('common.minutesAgo', { n: mins });
  const hours = Math.round(mins / 60);
  if (hours < 24) return t('common.hoursAgo', { n: hours });
  const days = Math.round(hours / 24);
  return t('admin.notifications.daysAgo', { n: days });
});
</script>

<style scoped>
/* ── Card shell ─────────────────────────────────────────────── */
.cc {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.95rem 1rem 1rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  background: rgb(var(--bg-elevated));
  transition: border-color 0.18s ease, background 0.18s ease,
    box-shadow 0.18s ease, transform 0.18s ease;
  /* Stagger fade-in driven by the inline --stagger custom prop. */
  animation: cc-in 0.4s cubic-bezier(0.2, 0.7, 0.2, 1) backwards;
  animation-delay: var(--stagger, 0ms);
}
@keyframes cc-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.cc:hover {
  border-color: rgb(var(--line-strong));
}

/* Live variant: subtle green-tinted accent on the left border. */
.cc--live {
  border-left: 2px solid rgb(var(--online));
  padding-left: calc(1rem - 1px);
}
.cc--live:hover {
  background: rgb(34, 197, 94, 0.02);
}

/* Action variant: amber/red left rule + faint pulse aura when the
   card is unread. The colour escalates with status: amber for
   untested, red for an explicit error. */
.cc--action {
  border-left: 2px solid rgb(var(--warning));
  padding-left: calc(1rem - 1px);
  background: rgb(234, 179, 8, 0.03);
}
.cc--action:hover {
  background: rgb(234, 179, 8, 0.06);
}

/* Available variant: dashed border + extra muted. The card reads
   as "optional". */
.cc--available {
  border-style: dashed;
  background: rgb(var(--bg-elevated) / 0.5);
}
.cc--available:hover {
  background: rgb(var(--bg-hover) / 0.5);
}

.cc--open {
  border-color: rgba(212, 167, 52, 0.55) !important;
  box-shadow: 0 0 0 3px rgba(212, 167, 52, 0.1);
}

/* ── Header row ─────────────────────────────────────────────── */
.cc-head {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.85rem;
}

.cc-glyph {
  position: relative;
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  background: rgb(var(--bg-inset));
  border: 1px solid rgb(var(--line-default));
  font-size: 1.25rem;
  color: rgb(var(--fg-strong));
  flex-shrink: 0;
}
.cc-glyph[data-variant='available'] {
  color: rgb(var(--fg-muted));
}
.cc-glyph-dot {
  position: absolute;
  right: -4px;
  top: -4px;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: rgb(var(--fg-faint));
  border: 2px solid rgb(var(--bg-elevated));
  transition: background 0.2s ease, box-shadow 0.2s ease;
}
.cc--live .cc-glyph-dot {
  background: rgb(var(--online));
  box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.18);
}
.cc--action .cc-glyph-dot {
  background: rgb(var(--warning));
  box-shadow: 0 0 0 3px rgba(234, 179, 8, 0.2);
  animation: cc-glow 1.8s ease-in-out infinite;
}
.cc--action.cc-status-error-row .cc-glyph-dot {
  background: rgb(var(--danger));
  box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.22);
}
@keyframes cc-glow {
  0%, 100% { transform: scale(1); opacity: 1; }
  50%      { transform: scale(1.15); opacity: 0.75; }
}

.cc-id {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}
.cc-title-row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  flex-wrap: wrap;
}
.cc-name {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 800;
  letter-spacing: 0.01em;
  color: rgb(var(--fg-strong));
}
.cc-tagline {
  margin: 0;
  font-size: 0.74rem;
  color: rgb(var(--fg-muted));
  line-height: 1.45;
}

.cc-status {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  padding: 0.18rem 0.5rem 0.18rem 0.4rem;
  border-radius: var(--radius-sm);
  border: 1px solid currentColor;
  white-space: nowrap;
}
.cc--live .cc-status {
  color: rgb(var(--online));
  background: rgba(34, 197, 94, 0.06);
}
.cc--action .cc-status {
  color: rgb(var(--warning));
  background: rgba(234, 179, 8, 0.06);
}
.cc--available .cc-status {
  color: rgb(var(--fg-muted));
  background: rgb(var(--bg-base) / 0.4);
}
.cc-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

/* ── Toggle switch ──────────────────────────────────────────── */
.cc-toggle {
  position: relative;
  display: inline-block;
  width: 38px;
  height: 22px;
  flex-shrink: 0;
}
.cc-toggle input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
  width: 100%;
  height: 100%;
}
.cc-toggle input:disabled {
  cursor: not-allowed;
}
.cc-toggle-track {
  position: absolute;
  inset: 0;
  background: rgb(var(--line-default));
  border-radius: 999px;
  transition: background 0.18s ease;
}
.cc-toggle-track::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  background: rgb(var(--bg-elevated));
  border-radius: 50%;
  transition: transform 0.18s ease;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
}
.cc-toggle input:checked + .cc-toggle-track {
  background: rgb(var(--online));
}
.cc-toggle input:checked + .cc-toggle-track::after {
  transform: translateX(16px);
  background: white;
}

/* ── Status line — last test info ──────────────────────────── */
.cc-status-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.85rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  color: rgb(var(--fg-muted));
}
.cc-status-when {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}
.cc-status-error {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  color: rgb(var(--danger));
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Bottom action row ─────────────────────────────────────── */
.cc-actions {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 0.85rem;
  padding-top: 0.4rem;
  border-top: 1px dashed rgb(var(--line-default) / 0.6);
}
.cc-context {
  font-size: 0.74rem;
  color: rgb(var(--fg-muted));
  font-style: italic;
}
.cc-action-buttons {
  display: inline-flex;
  gap: 0.4rem;
}

/* ── Drawer / expanded form ─────────────────────────────────── */
.cc-drawer {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding-top: 0.6rem;
  border-top: 1px dashed rgb(var(--line-default) / 0.6);
}

.cc-note {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.6rem 0.7rem;
  font-size: 0.78rem;
  color: rgb(var(--fg-strong));
  background: rgb(var(--bg-inset));
  border: 1px dashed rgb(var(--line-default));
  border-radius: var(--radius-sm);
}
.cc-note > svg {
  color: #d4a734;
  flex-shrink: 0;
  margin-top: 0.1rem;
}

.cc-form {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.75rem;
}
@media (min-width: 640px) {
  .cc-form {
    grid-template-columns: 1fr 1fr;
  }
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
  display: inline-flex;
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

/* Boolean field — render a compact toggle instead of a raw checkbox
   so the form keeps a consistent visual weight per field. */
.field-bool {
  position: relative;
  display: inline-block;
  width: 38px;
  height: 22px;
  margin-top: 0.2rem;
}
.field-bool input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
.field-bool-track {
  position: absolute;
  inset: 0;
  background: rgb(var(--line-default));
  border-radius: 999px;
  transition: background 0.18s ease;
}
.field-bool-track::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  background: rgb(var(--bg-elevated));
  border-radius: 50%;
  transition: transform 0.18s ease;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
}
.field-bool input:checked + .field-bool-track {
  background: #d4a734;
}
.field-bool input:checked + .field-bool-track::after {
  transform: translateX(16px);
  background: rgb(var(--bg-base));
}

/* Error block — only renders in the expanded drawer. */
.cc-error {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  padding: 0.65rem 0.85rem;
  background: rgba(239, 68, 68, 0.07);
  border: 1px solid rgba(239, 68, 68, 0.25);
  border-radius: var(--radius-sm);
  color: rgb(var(--fg-strong));
}
.cc-error > svg {
  color: rgb(var(--danger));
  flex-shrink: 0;
  margin-top: 0.15rem;
}
.cc-error strong {
  display: block;
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: rgb(var(--danger));
  margin-bottom: 0.15rem;
}
.cc-error p {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.72rem;
  color: rgb(var(--fg-strong));
  word-break: break-word;
  line-height: 1.5;
}

.cc-drawer-foot {
  display: flex;
  justify-content: flex-end;
  gap: 0.4rem;
  flex-wrap: wrap;
}

/* ── Buttons ─────────────────────────────────────────────────── */
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
  border-color: rgba(212, 167, 52, 0.5);
  background: rgba(212, 167, 52, 0.05);
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
.cc-drawer-enter-active,
.cc-drawer-leave-active {
  transition: max-height 0.3s cubic-bezier(0.2, 0.7, 0.2, 1),
    opacity 0.22s ease, padding-top 0.22s ease;
  overflow: hidden;
}
.cc-drawer-enter-from,
.cc-drawer-leave-to {
  max-height: 0;
  opacity: 0;
  padding-top: 0;
}
.cc-drawer-enter-to,
.cc-drawer-leave-from {
  max-height: 2000px;
  opacity: 1;
}

.spin {
  animation: cc-spin 1s linear infinite;
}
@keyframes cc-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
