<template>
  <!--
    Upload-request bounty board configuration.

    Two tunables:
      * auto-validate timeout (hours) — how long a `filled`
        request can sit before the cron auto-pays the filler.
        Bounded 1–8760 h (1 year max). Default 168 (7 days).
      * max fill attempts per user — how many proposals (including
        rejected ones) a single user can stack on the same request
        before they're locked out. Bounded 1–20. Default 3.

    Saved by PATCH-ing /api/admin/settings; the server clamps the
    same bounds as defence-in-depth.
  -->
  <div class="card">
    <div class="card-header">
      <div class="flex items-center gap-2">
        <Icon name="ph:megaphone-bold" class="text-text-muted" />
        <h3 class="text-xs font-bold uppercase tracking-wider text-text-primary">
          {{ $t('admin.requests.title') }}
        </h3>
      </div>
    </div>
    <div class="card-body space-y-6">
      <p class="text-xs text-text-muted leading-relaxed">
        {{ $t('admin.requests.description') }}
      </p>

      <div class="space-y-5">
        <SettingsGroup
          :label="$t('admin.requests.autoValidateHours')"
          :description="$t('admin.requests.autoValidateHint')"
        >
          <div class="flex items-center gap-3">
            <input
              v-model.number="autoValidateHours"
              type="number"
              min="1"
              max="8760"
              class="w-full md:w-32 bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-fg-default/20 font-mono"
            />
            <span class="text-xs text-text-muted">
              {{ $t('admin.requests.hoursLabel') }}
            </span>
          </div>
        </SettingsGroup>

        <SettingsGroup
          :label="$t('admin.requests.maxFills')"
          :description="$t('admin.requests.maxFillsHint')"
        >
          <div class="flex items-center gap-3">
            <input
              v-model.number="maxFillsPerUser"
              type="number"
              min="1"
              max="20"
              class="w-full md:w-32 bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-fg-default/20 font-mono"
            />
            <span class="text-xs text-text-muted">
              {{ $t('admin.requests.attemptsLabel') }}
            </span>
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
const autoValidateHours = ref(168);
const maxFillsPerUser = ref(3);
const loading = ref(false);
const saved = ref(false);

// Hydrate from the live settings endpoint. Same optimistic-edit
// pattern as the other settings panels.
const { data } = await useFetch<{
  requestAutoValidateHours?: number;
  requestMaxFillsPerUser?: number;
}>('/api/admin/settings');
watch(
  data,
  (v) => {
    if (typeof v?.requestAutoValidateHours === 'number') {
      autoValidateHours.value = v.requestAutoValidateHours;
    }
    if (typeof v?.requestMaxFillsPerUser === 'number') {
      maxFillsPerUser.value = v.requestMaxFillsPerUser;
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
        requestAutoValidateHours: clampHours(autoValidateHours.value),
        requestMaxFillsPerUser: clampFills(maxFillsPerUser.value),
      },
    });
    saved.value = true;
    setTimeout(() => (saved.value = false), 2000);
  } finally {
    loading.value = false;
  }
}

function clampHours(n: number): number {
  if (!Number.isFinite(n)) return 168;
  return Math.max(1, Math.min(8760, Math.floor(n)));
}
function clampFills(n: number): number {
  if (!Number.isFinite(n)) return 3;
  return Math.max(1, Math.min(20, Math.floor(n)));
}
</script>
