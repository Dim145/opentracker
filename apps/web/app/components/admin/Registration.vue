<template>
  <div class="card">
    <div class="card-header">
      <div class="flex items-center gap-2">
        <Icon name="ph:user-plus" class="text-text-muted" />
        <h3
          class="text-xs font-bold uppercase tracking-wider text-text-primary"
        >
          Registration
        </h3>
      </div>
    </div>
    <div class="card-body">
      <!-- Three-way mode selector. Replaces the previous pair of
           independent toggles, which surfaced four raw combinations
           but only three meaningful product states. The selected
           option drives both `registrationOpen` and `inviteEnabled`
           in a single PUT. -->
      <SettingsGroup
        label="Registration Mode"
        description="How members can join the tracker."
      >
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <button
            v-for="opt in MODE_OPTIONS"
            :key="opt.value"
            type="button"
            :disabled="settingsLoading"
            class="text-left px-3 py-3 rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-white/10"
            :class="[
              mode === opt.value
                ? `${opt.activeBg} ${opt.activeBorder}`
                : 'bg-bg-tertiary border-border hover:border-fg-default/20',
            ]"
            @click="setMode(opt.value)"
          >
            <div class="flex items-center gap-2 mb-1">
              <Icon
                :name="opt.icon"
                :class="mode === opt.value ? opt.activeText : 'text-text-muted'"
              />
              <span
                class="text-xs font-bold uppercase tracking-widest"
                :class="mode === opt.value ? opt.activeText : 'text-text-secondary'"
              >
                {{ opt.label }}
              </span>
            </div>
            <p class="text-[11px] leading-relaxed text-text-muted">
              {{ opt.description }}
            </p>
          </button>
        </div>
      </SettingsGroup>

      <div class="space-y-0">
        <!-- Default Invites Per User -->
        <SettingsGroup
          v-if="mode !== 'closed'"
          label="Default Invites"
          description="Number of invitation codes each new user receives upon registration."
        >
          <div class="flex items-center gap-3">
            <input
              v-model.number="defaultInvites"
              type="number"
              min="0"
              max="100"
              class="w-full md:w-32 bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-fg-default/20 font-mono"
              placeholder="2"
            />
          </div>
        </SettingsGroup>

        <!-- Minimum Ratio -->
        <SettingsGroup
          label="Minimum Ratio"
          description="Users with a ratio below this value will be blocked from downloading. Set to 0 to disable."
        >
          <div class="flex items-center gap-3">
            <input
              v-model.number="minRatio"
              type="number"
              step="0.1"
              min="0"
              class="w-full md:w-32 bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-fg-default/20 font-mono"
              placeholder="0.00"
            />
            <span
              class="text-xs text-text-muted font-mono"
              v-if="minRatio <= 0"
            >
              (Disabled)
            </span>
          </div>
        </SettingsGroup>

        <!-- Starter Credit -->
        <SettingsGroup
          label="Starter Credit (GB)"
          description="Initial upload amount given to new users to prevent immediate ratio blocking."
        >
          <div class="flex items-center gap-3">
            <input
              v-model.number="starterUploadGB"
              type="number"
              min="0"
              class="w-full md:w-32 bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-fg-default/20 font-mono"
              placeholder="0"
            />
            <span class="text-xs text-text-muted">GB</span>
          </div>
        </SettingsGroup>
      </div>

      <button
        @click="saveSettings"
        :disabled="settingsLoading || saved"
        class="w-full text-[10px] font-bold uppercase tracking-widest py-2.5 rounded transition-all disabled:opacity-50 flex items-center justify-center gap-2"
        :class="
          saved
            ? 'bg-success text-white'
            : 'bg-text-primary text-bg-primary hover:opacity-90'
        "
      >
        <Icon
          v-if="settingsLoading"
          name="ph:circle-notch"
          class="animate-spin"
        />
        <Icon v-else-if="saved" name="ph:check-bold" />
        {{
          settingsLoading ? 'Saving...' : saved ? 'Saved' : 'Save Configuration'
        }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
type RegistrationMode = 'closed' | 'invite-only' | 'open';

const mode = ref<RegistrationMode>('closed');
const defaultInvites = ref(2);
const minRatio = ref(0);
const starterUploadGB = ref(0);
const settingsLoading = ref(false);
const saved = ref(false);

/**
 * Three-way selector entries. Each option carries:
 *   - what it sets on the back-end (`registrationOpen` / `inviteEnabled`)
 *   - the visual treatment when active (background / border / text)
 *
 * The 'open' state forces inviteEnabled=false: when the door is
 * unrestricted, the invite-code path adds nothing useful and risks
 * confusing the user-side counter logic.
 */
const MODE_OPTIONS = [
  {
    value: 'closed' as const,
    label: 'Closed',
    icon: 'ph:lock-simple',
    description:
      'No new accounts. Existing members can still sign in and operate normally.',
    payload: { registrationOpen: false, inviteEnabled: false },
    activeBg: 'bg-bg-tertiary',
    activeBorder: 'border-text-muted',
    activeText: 'text-text-primary',
  },
  {
    value: 'invite-only' as const,
    label: 'Invite-only',
    icon: 'ph:envelope-simple',
    description:
      'Only people with a valid invitation code from a member can register.',
    payload: { registrationOpen: false, inviteEnabled: true },
    activeBg: 'bg-accent/10',
    activeBorder: 'border-accent/40',
    activeText: 'text-accent',
  },
  {
    value: 'open' as const,
    label: 'Open',
    icon: 'ph:lock-open',
    description:
      'Anyone can sign up freely. Invitation codes are not required.',
    payload: { registrationOpen: true, inviteEnabled: false },
    activeBg: 'bg-success/10',
    activeBorder: 'border-success/40',
    activeText: 'text-success',
  },
] as const;

function deriveMode(
  registrationOpen: boolean,
  inviteEnabled: boolean
): RegistrationMode {
  if (registrationOpen) return 'open';
  if (inviteEnabled) return 'invite-only';
  return 'closed';
}

// Fetch settings on mount
onMounted(async () => {
  try {
    const settings = await $fetch<{
      registrationOpen: boolean;
      inviteEnabled: boolean;
      defaultInvites: number;
      minRatio: number;
      starterUpload: number;
    }>('/api/admin/settings');
    mode.value = deriveMode(settings.registrationOpen, settings.inviteEnabled);
    defaultInvites.value = settings.defaultInvites;
    minRatio.value = settings.minRatio;
    starterUploadGB.value = Math.floor(settings.starterUpload / 1024 ** 3);
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
});

async function setMode(next: RegistrationMode) {
  if (next === mode.value || settingsLoading.value) return;
  const opt = MODE_OPTIONS.find((o) => o.value === next);
  if (!opt) return;
  settingsLoading.value = true;
  try {
    await $fetch('/api/admin/settings', {
      method: 'PUT',
      body: opt.payload,
    });
    mode.value = next;
  } catch (error) {
    console.error('Failed to update registration mode:', error);
  } finally {
    settingsLoading.value = false;
  }
}

async function saveSettings() {
  settingsLoading.value = true;
  try {
    await $fetch('/api/admin/settings', {
      method: 'PUT',
      body: {
        minRatio: minRatio.value,
        starterUpload: starterUploadGB.value * 1024 ** 3,
        defaultInvites: defaultInvites.value,
      },
    });
    saved.value = true;
    setTimeout(() => {
      saved.value = false;
    }, 2000);
  } catch (error) {
    console.error('Failed to save settings:', error);
  } finally {
    settingsLoading.value = false;
  }
}
</script>
