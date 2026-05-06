<template>
  <div class="card">
    <div class="card-header">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <Icon name="ph:gear" class="text-text-muted" />
          <h3
            class="text-xs font-bold uppercase tracking-wider text-text-primary"
          >
            API Configuration
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
            {{ config?.enabled ? 'Enabled' : 'Disabled' }}
          </span>
        </div>
      </div>
    </div>
    <div class="card-body space-y-6">
      <!-- API Status Toggle -->
      <SettingsGroup
        label="Torznab API Status"
        description="Enable or disable the Torznab API for all users. When disabled, *arr apps won't be able to connect."
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
              class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
              :class="config?.enabled ? 'translate-x-6' : 'translate-x-1'"
            />
          </button>
          <span class="text-sm text-text-muted">
            {{
              config?.enabled ? 'API is accepting requests' : 'API is disabled'
            }}
          </span>
        </div>
      </SettingsGroup>

      <!-- Request Logging -->
      <SettingsGroup
        label="Request Logging"
        description="Log all API requests for debugging and monitoring. Logs are stored for 7 days."
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
              class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
              :class="config?.enableLogging ? 'translate-x-6' : 'translate-x-1'"
            />
          </button>
          <span class="text-sm text-text-muted">
            {{ config?.enableLogging ? 'Logging enabled' : 'Logging disabled' }}
          </span>
        </div>
      </SettingsGroup>

      <!-- API URL Info -->
      <SettingsGroup
        label="API Endpoint"
        description="The base URL for the Torznab API. Users add this in Prowlarr/Sonarr/Radarr."
      >
        <div class="flex items-center gap-2">
          <input
            :value="apiUrl"
            readonly
            class="flex-1 bg-bg-tertiary border border-border rounded px-3 py-2 text-sm font-mono text-text-primary"
          />
          <button
            @click="copyUrl"
            class="p-2 bg-bg-tertiary border border-border rounded hover:border-white/20 transition-colors"
            title="Copy URL"
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
