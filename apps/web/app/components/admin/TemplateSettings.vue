<template>
  <!--
    Presentation-template quota.

    One tunable: how many templates a single user may own, counted over
    their own rows (published ones included — publishing is a visibility
    flag, not a hand-off). Bounded 1–100, default 5.

    Saved by PUT-ing /api/admin/settings; the server clamps the same
    bounds, and a value outside them falls back to the default rather
    than being pinned to the nearest bound — a stored 9999 is far more
    likely to be a typo than a request for the ceiling.
  -->
  <div class="card">
    <div class="card-header">
      <div class="flex items-center gap-2">
        <Icon name="ph:layout-bold" class="text-text-muted" />
        <h3 class="text-xs font-bold uppercase tracking-wider text-text-primary">
          {{ $t('admin.templates.title') }}
        </h3>
      </div>
    </div>
    <div class="card-body space-y-6">
      <p class="text-xs text-text-secondary leading-relaxed">
        {{ $t('admin.templates.description') }}
      </p>

      <SettingsGroup
        :label="$t('admin.templates.quotaPerUser')"
        :description="$t('admin.templates.quotaHint')"
      >
        <div class="flex items-center gap-3">
          <!-- `aria-label` rather than a `for`/`id` pair: SettingsGroup
               renders a bare <label> with no `for`, and giving it one would
               change every admin panel. The name has to come from somewhere,
               and duplicating the group's own string is the smallest honest
               way to say it.
               `focus:outline-none` is deliberately absent — the app's global
               focus-visible ring (main.css) is the visible one, and replacing
               it with a 20%-opacity border left the field with no perceptible
               focus state at all. -->
          <input
            v-model.number="quotaPerUser"
            type="number"
            min="1"
            max="100"
            :aria-label="$t('admin.templates.quotaPerUser')"
            class="w-full md:w-32 bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary font-mono"
          />
          <span class="text-xs text-text-secondary">
            {{ $t('admin.templates.templatesLabel') }}
          </span>
        </div>
      </SettingsGroup>

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
const QUOTA_DEFAULT = 5;
const QUOTA_MIN = 1;
const QUOTA_MAX = 100;

const quotaPerUser = ref(QUOTA_DEFAULT);
const loading = ref(false);
const saved = ref(false);

// Hydrate from the live settings endpoint — same optimistic-edit
// pattern as the other settings panels.
const { data } = await useFetch<{ templateQuotaPerUser?: number }>(
  '/api/admin/settings',
);
watch(
  data,
  (v) => {
    if (typeof v?.templateQuotaPerUser === 'number') {
      quotaPerUser.value = v.templateQuotaPerUser;
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
      body: { templateQuotaPerUser: clampQuota(quotaPerUser.value) },
    });
    saved.value = true;
    setTimeout(() => (saved.value = false), 2000);
  } finally {
    loading.value = false;
  }
}

// Mirrors clampTemplateQuota() on the server: the input is a number
// field, so a cleared box arrives as NaN rather than as 0.
function clampQuota(n: number): number {
  if (!Number.isFinite(n)) return QUOTA_DEFAULT;
  return Math.max(QUOTA_MIN, Math.min(QUOTA_MAX, Math.floor(n)));
}
</script>
