<template>
  <!--
    Hit & Run : les trois réglages que le tracker et l'API lisaient déjà en
    base sans qu'aucune interface ne les expose. Le seuil de 24 h par défaut
    s'affichait sur chaque fiche de torrent (« vous engage à 24 h de partage »)
    sans qu'un exploitant puisse le changer autrement qu'en SQL.

      * activé — sans lui, aucune ligne n'est créée et rien n'est jamais signalé ;
      * seuil de partage (heures) — le temps de seed exigé par release ;
        figé sur chaque ligne à sa création, donc le changer ne rejuge pas
        les téléchargements passés ;
      * délai de grâce (heures) — le temps laissé après le téléchargement
        avant qu'une release non partagée assez longtemps soit signalée.
  -->
  <div class="card">
    <div class="card-header">
      <div class="flex items-center gap-2">
        <Icon name="ph:hourglass-medium-bold" class="text-text-muted" />
        <h3 class="text-xs font-bold uppercase tracking-wider text-text-primary">
          {{ $t('admin.hnrSettings.title') }}
        </h3>
      </div>
    </div>
    <div class="card-body space-y-6">
      <p class="text-xs text-text-muted leading-relaxed">
        {{ $t('admin.hnrSettings.description') }}
      </p>

      <div class="space-y-5">
        <SettingsGroup
          :control-id="fid('hnrEnabled')"
          :label="$t('admin.hnrSettings.enabled')"
          :description="$t('admin.hnrSettings.enabledHint')"
        >
          <label class="hnr-toggle" :for="fid('hnrEnabled')">
            <input :id="fid('hnrEnabled')" v-model="enabled" type="checkbox" class="hnr-toggle-box" />
            <span>{{ enabled ? $t('admin.hnrSettings.on') : $t('admin.hnrSettings.off') }}</span>
          </label>
        </SettingsGroup>

        <SettingsGroup
          :control-id="fid('requiredHours')"
          :label="$t('admin.hnrSettings.requiredHours')"
          :description="$t('admin.hnrSettings.requiredHint')"
        >
          <div class="flex items-center gap-3">
            <input
              :id="fid('requiredHours')"
              v-model.number="requiredHours"
              type="number"
              min="0"
              max="8760"
              :disabled="!enabled"
              class="w-full md:w-32 bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary focus:border-fg-default/20 font-mono disabled:opacity-50"
            />
            <span class="text-xs text-text-muted">{{ $t('admin.hnrSettings.hoursLabel') }}</span>
          </div>
        </SettingsGroup>

        <SettingsGroup
          :control-id="fid('graceHours')"
          :label="$t('admin.hnrSettings.graceHours')"
          :description="$t('admin.hnrSettings.graceHint')"
        >
          <div class="flex items-center gap-3">
            <input
              :id="fid('graceHours')"
              v-model.number="graceHours"
              type="number"
              min="0"
              max="8760"
              :disabled="!enabled"
              class="w-full md:w-32 bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary focus:border-fg-default/20 font-mono disabled:opacity-50"
            />
            <span class="text-xs text-text-muted">{{ $t('admin.hnrSettings.hoursLabel') }}</span>
          </div>
        </SettingsGroup>
      </div>

      <button
        type="button"
        :disabled="loading || saved"
        class="w-full text-[10px] font-bold uppercase tracking-widest py-2.5 rounded transition-all disabled:opacity-50 flex items-center justify-center gap-2"
        :class="saved ? 'bg-success/20 text-success' : 'bg-fg-default/10 text-text-primary hover:bg-fg-default/15'"
        @click="save"
      >
        <Icon :name="saved ? 'ph:check-bold' : 'ph:floppy-disk-bold'" />
        {{ saved ? $t('admin.hnrSettings.saved') : $t('admin.hnrSettings.save') }}
      </button>
      <p v-if="saveError" class="text-xs text-danger" role="alert">{{ saveError }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
const fid = useFieldIds();
const enabled = ref(false);
const requiredHours = ref(24);
const graceHours = ref(72);
const loading = ref(false);
const saved = ref(false);

const { data } = await useFetch<{
  hnrEnabled?: boolean;
  hnrRequiredSeedHours?: number;
  hnrGraceHours?: number;
}>('/api/admin/settings');

watch(
  data,
  (v) => {
    if (typeof v?.hnrEnabled === 'boolean') enabled.value = v.hnrEnabled;
    if (typeof v?.hnrRequiredSeedHours === 'number') requiredHours.value = v.hnrRequiredSeedHours;
    if (typeof v?.hnrGraceHours === 'number') graceHours.value = v.hnrGraceHours;
  },
  { immediate: true },
);

/** Un entier d'heures entre 0 et un an ; le serveur reborne de son côté. */
function clampHours(n: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(8760, Math.floor(n)));
}

const saveError = ref<string | null>(null);
async function save() {
  loading.value = true;
  saved.value = false;
  try {
    await $fetch('/api/admin/settings', {
      method: 'PUT',
      body: {
        hnrEnabled: enabled.value,
        hnrRequiredSeedHours: clampHours(requiredHours.value, 24),
        hnrGraceHours: clampHours(graceHours.value, 72),
      },
    });
    saved.value = true;
    saveError.value = null;
    setTimeout(() => (saved.value = false), 2000);
  } catch (err) {
    // Sans cela, un 4xx/5xx partait en rejet non géré et l'écran ne bougeait pas.
    saveError.value = (err as { data?: { message?: string }; message?: string }).data?.message ?? (err as Error).message ?? 'error';
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.hnr-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 2rem;
  font-size: 0.8125rem;
  color: rgb(var(--fg-default));
  cursor: pointer;
}
.hnr-toggle-box {
  width: 1.1rem;
  height: 1.1rem;
  margin: 0;
  accent-color: rgb(var(--accent-warm));
  cursor: pointer;
}
</style>
