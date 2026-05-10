<template>
  <div class="card">
    <div class="card-header">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <Icon name="ph:gear" class="text-text-muted" />
          <h3
            class="text-xs font-bold uppercase tracking-wider text-text-primary"
          >
            {{ $t('admin.torznab.config.title') }}
          </h3>
        </div>
        <div class="flex items-center gap-2">
          <span
            class="px-2 py-1 rounded text-[10px] font-bold uppercase"
            :class="
              config?.enabled
                ? 'bg-success/20 text-success'
                : 'bg-red-500/20 text-red-400'
            "
          >
            {{ config?.enabled ? $t('admin.torznab.config.enabled') : $t('admin.torznab.config.disabled') }}
          </span>
        </div>
      </div>
    </div>
    <div class="card-body space-y-6">
      <!-- API Status Toggle -->
      <SettingsGroup
        :label="$t('admin.torznab.config.apiStatusLabel')"
        :description="$t('admin.torznab.config.apiStatusDescription')"
      >
        <div class="flex items-center gap-3">
          <button
            @click="toggleEnabled"
            :disabled="saving"
            class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
            :class="
              config?.enabled
                ? 'bg-success'
                : 'bg-bg-tertiary border border-border'
            "
          >
            <span
              class="inline-block h-4 w-4 transform rounded-full bg-fg-strong transition-transform"
              :class="config?.enabled ? 'translate-x-6' : 'translate-x-1'"
            />
          </button>
          <span class="text-sm text-text-muted">
            {{
              config?.enabled ? $t('admin.torznab.config.apiAccepting') : $t('admin.torznab.config.apiDisabled')
            }}
          </span>
        </div>
      </SettingsGroup>

      <!-- Request Logging -->
      <SettingsGroup
        :label="$t('admin.torznab.config.loggingLabel')"
        :description="$t('admin.torznab.config.loggingDescription')"
      >
        <div class="flex items-center gap-3">
          <button
            @click="toggleLogging"
            :disabled="saving"
            class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
            :class="
              config?.enableLogging
                ? 'bg-success'
                : 'bg-bg-tertiary border border-border'
            "
          >
            <span
              class="inline-block h-4 w-4 transform rounded-full bg-fg-strong transition-transform"
              :class="config?.enableLogging ? 'translate-x-6' : 'translate-x-1'"
            />
          </button>
          <span class="text-sm text-text-muted">
            {{ config?.enableLogging ? $t('admin.torznab.config.loggingEnabled') : $t('admin.torznab.config.loggingDisabled') }}
          </span>
        </div>
      </SettingsGroup>

      <!-- API URL Info -->
      <SettingsGroup
        :label="$t('admin.torznab.config.endpointLabel')"
        :description="$t('admin.torznab.config.endpointDescription')"
      >
        <div class="flex items-center gap-2">
          <input
            :value="apiUrl"
            readonly
            class="flex-1 bg-bg-tertiary border border-border rounded px-3 py-2 text-sm font-mono text-text-primary"
          />
          <button
            @click="copyUrl"
            class="p-2 bg-bg-tertiary border border-border rounded hover:border-fg-default/20 transition-colors"
            :title="$t('admin.torznab.config.copyUrlTitle')"
          >
            <Icon
              :name="copied ? 'ph:check' : 'ph:copy'"
              class="text-text-muted"
            />
          </button>
        </div>
      </SettingsGroup>
    </div>
  </div>
</template>

<script setup lang="ts">
interface TorznabConfig {
  enabled: boolean;
  rateLimitSearch: number;
  rateLimitDownload: number;
  rateLimitWindow: number;
  enableLogging: boolean;
  allowedCategories: string[];
}

const props = defineProps<{
  config?: TorznabConfig;
  loading?: boolean;
}>();

const emit = defineEmits<{
  update: [updates: Partial<TorznabConfig>];
}>();

const saving = ref(false);
const copied = ref(false);

const apiUrl = computed(() => {
  if (import.meta.client) {
    return `${window.location.origin}/api/torznab`;
  }
  return '/api/torznab';
});

async function toggleEnabled() {
  saving.value = true;
  try {
    emit('update', { enabled: !props.config?.enabled });
  } finally {
    saving.value = false;
  }
}

async function toggleLogging() {
  saving.value = true;
  try {
    emit('update', { enableLogging: !props.config?.enableLogging });
  } finally {
    saving.value = false;
  }
}

async function copyUrl() {
  try {
    await navigator.clipboard.writeText(apiUrl.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch (error) {
    console.error('Failed to copy URL:', error);
  }
}
</script>
