<template>
  <!--
    Messaging: who may use it, and what the room forgets.

    The two surfaces have independent scopes on purpose. Opening private
    messages without the room is a normal state — the room is the one that
    needs moderators watching, and it is the one you turn off first if it
    turns sour. A single boolean could not express that, nor "staff only",
    which is what a rollout wants.

    Everything here is off by default: a feature that appears the moment
    the code is deployed is a feature nobody decided to run.
  -->
  <div class="card">
    <div class="card-header">
      <div class="flex items-center gap-2">
        <Icon name="ph:chat-circle" class="text-text-muted" />
        <h3 class="text-xs font-bold uppercase tracking-wider text-text-primary">
          {{ $t('admin.messaging.title') }}
        </h3>
      </div>
    </div>
    <div class="card-body space-y-6">
      <p class="text-xs text-text-muted leading-relaxed">
        {{ $t('admin.messaging.description') }}
      </p>

      <div class="space-y-5">
        <SettingsGroup
          :label="$t('admin.messaging.dmScope')"
          :description="$t('admin.messaging.dmScopeHint')"
        >
          <select
            v-model="dmScope"
            class="w-full md:w-64 bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary focus:border-fg-default/20"
          >
            <option value="off">{{ $t('admin.messaging.scope.off') }}</option>
            <option value="staff">{{ $t('admin.messaging.scope.staff') }}</option>
            <option value="all">{{ $t('admin.messaging.scope.all') }}</option>
          </select>
        </SettingsGroup>

        <SettingsGroup
          :label="$t('admin.messaging.roomScope')"
          :description="$t('admin.messaging.roomScopeHint')"
        >
          <select
            v-model="roomScope"
            class="w-full md:w-64 bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary focus:border-fg-default/20"
          >
            <option value="off">{{ $t('admin.messaging.scope.off') }}</option>
            <option value="staff">{{ $t('admin.messaging.scope.staff') }}</option>
            <option value="all">{{ $t('admin.messaging.scope.all') }}</option>
          </select>
        </SettingsGroup>

        <SettingsGroup
          :label="$t('admin.messaging.retentionDays')"
          :description="$t('admin.messaging.retentionHint')"
        >
          <div class="flex items-center gap-3">
            <input
              v-model.number="retentionDays"
              type="number"
              min="1"
              max="365"
              class="w-full md:w-32 bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary focus:border-fg-default/20 font-mono"
            />
            <span class="text-xs text-text-muted">{{ $t('admin.messaging.daysLabel') }}</span>
          </div>
        </SettingsGroup>

        <SettingsGroup
          :label="$t('admin.messaging.dmRetentionDays')"
          :description="$t('admin.messaging.dmRetentionHint')"
        >
          <div class="flex items-center gap-3">
            <input
              v-model.number="dmRetentionDays"
              type="number"
              min="0"
              max="3650"
              class="w-full md:w-32 bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary focus:border-fg-default/20 font-mono"
            />
            <span class="text-xs text-text-muted">
              {{ dmRetentionDays > 0
                ? $t('admin.messaging.daysLabel')
                : $t('admin.messaging.dmRetentionOff') }}
            </span>
          </div>
          <p class="mt-2 text-xs text-text-muted">
            {{ $t('admin.messaging.dmRetentionPublished') }}
          </p>
        </SettingsGroup>

        <SettingsGroup
          :label="$t('admin.messaging.slowMode')"
          :description="$t('admin.messaging.slowModeHint')"
        >
          <div class="flex items-center gap-3">
            <input
              v-model.number="slowModeSeconds"
              type="number"
              min="0"
              max="3600"
              class="w-full md:w-32 bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary focus:border-fg-default/20 font-mono"
            />
            <span class="text-xs text-text-muted">{{ $t('admin.messaging.secondsLabel') }}</span>
          </div>
        </SettingsGroup>
      </div>

      <!--
        Said plainly rather than left to be discovered: turning the room off
        does not delete what is in it, and shortening retention drops whole
        days at the next sweep.
      -->
      <p class="text-xs text-warning leading-relaxed">
        {{ $t('admin.messaging.retentionWarning') }}
      </p>

      <button
        @click="save"
        :disabled="loading || saved"
        class="w-full text-[10px] font-bold uppercase tracking-widest py-2.5 rounded transition-all disabled:opacity-50 flex items-center justify-center gap-2"
        :class="
          saved
            ? 'bg-success text-white'
            : 'bg-text-primary text-bg-primary hover:opacity-90'
        "
      >
        <Icon v-if="loading" name="ph:circle-notch" class="animate-spin" />
        <Icon v-else-if="saved" name="ph:check-bold" />
        {{
          loading
            ? $t('admin.registration.saving')
            : saved
              ? $t('admin.registration.saved')
              : $t('admin.registration.saveConfiguration')
        }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
type Scope = 'off' | 'staff' | 'all';

const dmScope = ref<Scope>('off');
const roomScope = ref<Scope>('off');
const retentionDays = ref(14);
/**
 * Zero is off, and off is the default that survives an upgrade. These
 * rows are the members' correspondence rather than the instance's own
 * data: switching a timer on for them at deploy time would delete
 * conversations nobody told them were on one. Whatever is set here is
 * published on `/privacy`, which reads it live.
 */
const dmRetentionDays = ref(0);
const slowModeSeconds = ref(0);
const loading = ref(false);
const saved = ref(false);

const { data } = await useFetch<{
  messagingDmScope?: Scope;
  messagingRoomScope?: Scope;
  messagingRoomRetentionDays?: number;
  messagingRoomSlowModeSeconds?: number;
  messagingDmRetentionDays?: number;
}>('/api/admin/settings');

watch(
  data,
  (v) => {
    if (v?.messagingDmScope) dmScope.value = v.messagingDmScope;
    if (v?.messagingRoomScope) roomScope.value = v.messagingRoomScope;
    if (typeof v?.messagingRoomRetentionDays === 'number') {
      retentionDays.value = v.messagingRoomRetentionDays;
    }
    if (typeof v?.messagingDmRetentionDays === 'number') {
      dmRetentionDays.value = v.messagingDmRetentionDays;
    }
    if (typeof v?.messagingRoomSlowModeSeconds === 'number') {
      slowModeSeconds.value = v.messagingRoomSlowModeSeconds;
    }
  },
  { immediate: true },
);

async function save() {
  loading.value = true;
  saved.value = false;
  try {
    await $fetch('/api/admin/settings', {
      method: 'PUT',
      body: {
        messagingDmScope: dmScope.value,
        messagingRoomScope: roomScope.value,
        // The server clamps to its own floor and ceiling; these match so
        // the browser hints the same range rather than accepting a value
        // that comes back changed.
        messagingRoomRetentionDays: clamp(retentionDays.value, 1, 365, 14),
        // Zero passes through as zero — it is "off", not a value to floor
        // up to the minimum. Above zero the server's own floor is a week.
        messagingDmRetentionDays:
          dmRetentionDays.value > 0 ? clamp(dmRetentionDays.value, 7, 3650, 30) : 0,
        messagingRoomSlowModeSeconds: clamp(slowModeSeconds.value, 0, 3600, 0),
      },
    });
    saved.value = true;
    setTimeout(() => (saved.value = false), 2000);
  } finally {
    loading.value = false;
  }
}

function clamp(n: number, lo: number, hi: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}
</script>
