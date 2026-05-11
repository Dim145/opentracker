<template>
  <!--
    Notification retention configuration.

    Two TTLs: read rows + unread rows. Different defaults are
    supported (e.g. 90 for read, 180 for unread); both default to
    90 server-side. Saved by PATCH-ing /api/admin/settings which
    Zod-validates 1..3650 days.

    Lives on /admin/settings alongside Registration/Announcements/
    Panic, matching the existing settings-section pattern.
  -->
  <div class="card">
    <div class="card-header">
      <div class="flex items-center gap-2">
        <Icon name="ph:bell" class="text-text-muted" />
        <h3 class="text-xs font-bold uppercase tracking-wider text-text-primary">
          {{ $t('admin.notifications.retention.title') }}
        </h3>
      </div>
    </div>
    <div class="card-body space-y-6">
      <p class="text-xs text-text-muted leading-relaxed">
        {{ $t('admin.notifications.retention.description') }}
      </p>

      <div class="space-y-5">
        <SettingsGroup
          :label="$t('admin.notifications.retention.readDays')"
          :description="$t('admin.notifications.retention.hint')"
        >
          <div class="flex items-center gap-3">
            <input
              v-model.number="readDays"
              type="number"
              min="1"
              max="3650"
              class="w-full md:w-32 bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-fg-default/20 font-mono"
            />
            <span class="text-xs text-text-muted">{{ $t('admin.notifications.retention.daysLabel') }}</span>
          </div>
        </SettingsGroup>

        <SettingsGroup
          :label="$t('admin.notifications.retention.unreadDays')"
          :description="$t('admin.notifications.retention.hint')"
        >
          <div class="flex items-center gap-3">
            <input
              v-model.number="unreadDays"
              type="number"
              min="1"
              max="3650"
              class="w-full md:w-32 bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-fg-default/20 font-mono"
            />
            <span class="text-xs text-text-muted">{{ $t('admin.notifications.retention.daysLabel') }}</span>
          </div>
        </SettingsGroup>
      </div>

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
        <Icon
          v-if="loading"
          name="ph:circle-notch"
          class="animate-spin"
        />
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
const readDays = ref(90);
const unreadDays = ref(90);
const loading = ref(false);
const saved = ref(false);

// Hydrate from the live settings endpoint. Same shape as the other
// admin panels: optimistic refs that the user can edit + a single
// PUT on save. Validation defends in depth — the server clamps
// 1–3650 — but the input attrs match for nicer in-browser hinting.
const { data } = await useFetch<{
  notificationsRetentionReadDays?: number;
  notificationsRetentionUnreadDays?: number;
}>('/api/admin/settings');
watch(
  data,
  (v) => {
    if (typeof v?.notificationsRetentionReadDays === 'number') {
      readDays.value = v.notificationsRetentionReadDays;
    }
    if (typeof v?.notificationsRetentionUnreadDays === 'number') {
      unreadDays.value = v.notificationsRetentionUnreadDays;
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
        notificationsRetentionReadDays: clamp(readDays.value),
        notificationsRetentionUnreadDays: clamp(unreadDays.value),
      },
    });
    saved.value = true;
    setTimeout(() => (saved.value = false), 2000);
  } finally {
    loading.value = false;
  }
}

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 90;
  return Math.max(1, Math.min(3650, Math.floor(n)));
}
</script>
