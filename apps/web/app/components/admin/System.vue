<template>
  <div class="space-y-6">
    <!-- Version & Updates Section -->
    <div class="card">
      <div class="card-header">
        <div class="flex items-center gap-2">
          <Icon name="ph:package" class="text-text-muted" />
          <h3
            class="text-xs font-bold uppercase tracking-wider text-text-primary"
          >
            Version &amp; Updates
          </h3>
        </div>
      </div>
      <div class="card-body space-y-4">
        <!-- Current Version + repo + runtime ─────────────────── -->
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div class="min-w-0">
            <p class="text-sm font-medium text-text-primary">Current Version</p>
            <p class="text-[10px] text-text-muted mt-0.5">
              Installed version of Trackarr
            </p>
            <!-- Repo + runtime — small mono strip so admins can verify the
                 TRACKARR_REPO env var without shelling into the container. -->
            <p
              v-if="versionInfo"
              class="mt-1.5 flex items-center flex-wrap gap-x-2 gap-y-1 text-[10px] font-mono text-text-muted"
            >
              <span
                class="inline-flex items-center gap-1 px-1.5 py-0.5 border border-border rounded-sm bg-bg-tertiary"
              >
                <Icon
                  :name="versionInfo.runtime === 'docker' ? 'ph:cube' : 'ph:hard-drives'"
                  class="text-[10px]"
                />
                {{ versionInfo.runtime === 'docker' ? 'Docker' : 'Native' }}
              </span>
              <a
                v-if="versionInfo.repository"
                :href="versionInfo.repository.url"
                target="_blank"
                rel="noreferrer"
                class="inline-flex items-center gap-1 px-1.5 py-0.5 border border-border rounded-sm bg-bg-tertiary hover:border-fg-default/30 hover:text-text-primary transition-colors"
                :title="versionInfo.repository.configured ? `TRACKARR_REPO=${versionInfo.repository.configured}` : 'Default repository'"
              >
                <Icon name="ph:git-branch" class="text-[10px]" />
                {{ versionInfo.repository.ownerRepo || versionInfo.repository.url }}
                <Icon
                  v-if="!versionInfo.repository.configured"
                  name="ph:question"
                  class="text-[10px] opacity-60"
                  title="Default — no TRACKARR_REPO env var set"
                />
              </a>
            </p>
          </div>
          <div class="flex items-center gap-2 flex-shrink-0">
            <span
              class="px-3 py-1.5 bg-bg-tertiary border border-border rounded font-mono text-sm text-text-primary"
            >
              v{{ versionInfo?.currentVersion || '...' }}
            </span>
            <button
              @click="checkUpdates"
              :disabled="checkingUpdates"
              class="p-2 bg-bg-tertiary border border-border rounded hover:border-fg-default/20 transition-colors disabled:opacity-50"
              title="Check for updates"
            >
              <Icon
                name="ph:arrows-clockwise"
                :class="['text-text-muted', checkingUpdates && 'animate-spin']"
              />
            </button>
          </div>
        </div>

        <!-- Update Available ────────────────────────────────── -->
        <div
          v-if="versionInfo?.updateAvailable && versionInfo.latestRelease"
          class="p-4 bg-success/10 border border-success/30 rounded-lg space-y-3"
        >
          <div class="flex items-center gap-2">
            <Icon name="ph:arrow-circle-up" class="text-success" />
            <p class="text-sm font-medium text-success">
              Update Available: {{ versionInfo.latestRelease.version }}
            </p>
          </div>
          <p class="text-xs text-text-muted">
            Published {{ formatDate(versionInfo.latestRelease.publishedAt) }}
          </p>
          <a
            :href="versionInfo.latestRelease.url"
            target="_blank"
            class="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text-primary"
          >
            View changelog
            <Icon name="ph:arrow-square-out" class="text-[10px]" />
          </a>
        </div>

        <!-- No Update ─────────────────────────────────────── -->
        <div
          v-else-if="versionInfo && !versionInfo.checkError"
          class="p-4 bg-bg-tertiary border border-border rounded-lg"
        >
          <div class="flex items-center gap-2">
            <Icon name="ph:check-circle" class="text-success" />
            <p class="text-sm text-text-muted">
              You're running the latest version
            </p>
          </div>
        </div>

        <!-- Update check failed (e.g. non-GitHub repo, 404, network) ─── -->
        <div
          v-else-if="versionInfo?.checkError"
          class="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg space-y-2"
        >
          <div class="flex items-center gap-2">
            <Icon name="ph:warning" class="text-yellow-400" />
            <p class="text-sm font-medium text-yellow-400">
              Update check unavailable
            </p>
          </div>
          <p class="text-xs text-text-muted">
            {{ versionInfo.checkError }}
          </p>
          <a
            v-if="versionInfo.repository?.url"
            :href="versionInfo.repository.url"
            target="_blank"
            class="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text-primary"
          >
            Open repository
            <Icon name="ph:arrow-square-out" class="text-[10px]" />
          </a>
        </div>

        <!-- ── Update playbooks ───────────────────────────── -->
        <div v-if="showUpdateInstructions" class="space-y-4">
          <!-- Playbook tabs — only render the segment when more than one
               playbook is offered. We always have three on the API side
               but the recommendation logic could reduce that someday. -->
          <div
            v-if="playbooks.length > 1"
            class="flex flex-wrap gap-1 p-1 bg-bg-tertiary border border-border rounded-md"
            role="tablist"
            aria-label="Update playbook"
          >
            <button
              v-for="pb in playbooks"
              :key="pb.id"
              type="button"
              role="tab"
              :aria-selected="activePlaybookId === pb.id"
              class="flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded transition-colors"
              :class="
                activePlaybookId === pb.id
                  ? 'bg-fg-default text-accent-fg'
                  : 'text-text-muted hover:text-text-primary'
              "
              @click="activePlaybookId = pb.id"
            >
              <Icon :name="playbookIcon(pb.id)" />
              <span class="truncate">{{ pb.label }}</span>
              <span
                v-if="pb.id === recommendedPlaybookId"
                class="text-[8px] tracking-widest text-success"
                title="Recommended for your runtime"
              >
                ●
              </span>
            </button>
          </div>

          <!-- Active playbook -->
          <div v-if="activePlaybook" class="space-y-3">
            <p class="text-xs text-text-muted leading-relaxed">
              {{ activePlaybook.blurb }}
            </p>

            <p
              class="text-[10px] font-bold uppercase tracking-widest text-text-muted"
            >
              Update Commands
            </p>
            <div class="space-y-2">
              <div
                v-for="cmd in activePlaybook.commands"
                :key="`${activePlaybook.id}-${cmd.step}`"
                class="bg-bg-tertiary border border-border rounded-lg p-3"
              >
                <div class="flex items-center justify-between mb-1">
                  <span class="text-[10px] text-text-muted">
                    Step {{ cmd.step }}: {{ cmd.description }}
                  </span>
                  <button
                    @click="copyCommand(cmd.command)"
                    class="text-text-muted hover:text-text-primary inline-flex items-center justify-center w-7 h-7 -my-1 -mr-1.5"
                    title="Copy"
                  >
                    <Icon name="ph:copy" class="text-xs" />
                  </button>
                </div>
                <code
                  class="block text-xs font-mono text-text-primary break-all"
                >
                  {{ cmd.command }}
                </code>
              </div>
            </div>
          </div>

          <!-- Notes — same yellow caution box as before, driven by the
               server payload so admins can edit the wording in one place. -->
          <div
            v-if="updateNotes.length > 0"
            class="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg"
          >
            <Icon name="ph:warning" class="text-yellow-400 mt-0.5" />
            <ul class="text-xs text-yellow-400 space-y-1">
              <li v-for="note in updateNotes" :key="note">{{ note }}</li>
            </ul>
          </div>
        </div>

        <button
          @click="toggleUpdateInstructions"
          class="w-full bg-bg-tertiary border border-border text-[10px] font-bold uppercase tracking-widest py-2.5 rounded hover:border-fg-default/20 transition-colors flex items-center justify-center gap-2"
        >
          <Icon name="ph:terminal" />
          {{ showUpdateInstructions ? 'Hide' : 'Show' }} Update Instructions
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
type Runtime = 'docker' | 'native';
type PlaybookId = 'dockerPrebuilt' | 'dockerSource' | 'native';

interface VersionInfo {
  currentVersion: string;
  runtime: Runtime;
  repository: {
    url: string;
    provider: 'github' | 'unknown';
    ownerRepo: string | null;
    configured: string | null;
  };
  latestRelease: {
    version: string;
    name: string;
    publishedAt: string;
    url: string;
    notes: string;
  } | null;
  updateAvailable: boolean;
  checkError: string | null;
}

interface UpdateCommand {
  step: number;
  description: string;
  command: string;
}

interface Playbook {
  id: PlaybookId;
  label: string;
  blurb: string;
  commands: UpdateCommand[];
}

interface UpdatePayload {
  success: boolean;
  notes: string[];
  playbooks: Playbook[];
}

const versionInfo = ref<VersionInfo | null>(null);
const checkingUpdates = ref(false);
const showUpdateInstructions = ref(false);

const playbooks = ref<Playbook[]>([]);
const updateNotes = ref<string[]>([]);
const activePlaybookId = ref<PlaybookId | null>(null);

// The recommendation depends on the runtime: a containerised deploy almost
// certainly wants the prebuilt-images flow; a native install wants the
// pnpm one. The user can override via the tabs.
const recommendedPlaybookId = computed<PlaybookId>(() =>
  versionInfo.value?.runtime === 'docker' ? 'dockerPrebuilt' : 'native'
);

const activePlaybook = computed<Playbook | null>(() =>
  playbooks.value.find((p) => p.id === activePlaybookId.value) ?? null
);

onMounted(async () => {
  await checkUpdates();
});

async function checkUpdates() {
  checkingUpdates.value = true;
  try {
    versionInfo.value = await $fetch<VersionInfo>('/api/admin/system/version');
  } catch (error) {
    console.error('Failed to check for updates:', error);
  } finally {
    checkingUpdates.value = false;
  }
}

async function toggleUpdateInstructions() {
  if (!showUpdateInstructions.value && playbooks.value.length === 0) {
    try {
      const data = await $fetch<UpdatePayload>('/api/admin/system/update');
      playbooks.value = data.playbooks;
      updateNotes.value = data.notes;
      // Default to the recommended playbook on first open. Subsequent
      // toggles preserve the user's selection.
      activePlaybookId.value =
        data.playbooks.find((p) => p.id === recommendedPlaybookId.value)?.id
        ?? data.playbooks[0]?.id
        ?? null;
    } catch (error) {
      console.error('Failed to fetch update commands:', error);
    }
  }
  showUpdateInstructions.value = !showUpdateInstructions.value;
}

function playbookIcon(id: PlaybookId): string {
  if (id === 'dockerPrebuilt') return 'ph:cloud-arrow-down';
  if (id === 'dockerSource') return 'ph:wrench';
  return 'ph:hard-drives';
}

function copyCommand(command: string) {
  navigator.clipboard.writeText(command);
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
</script>
