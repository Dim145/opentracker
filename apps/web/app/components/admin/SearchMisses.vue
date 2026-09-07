<script setup lang="ts">
/**
 * Ce que les membres cherchent sans rien trouver.
 *
 * La meilleure liste d'acquisition possible : ce qui manque, avec la
 * fréquence. Une ligne traitée (la release est arrivée, ou n'existe pas)
 * s'efface ; « Créer une demande » ouvre le formulaire des demandes.
 */
import { formatAgo } from '~/utils/format';

interface Miss {
  query: string;
  count: number;
  firstAt: string;
  lastAt: string;
}
const { t, locale } = useI18n();
const notifications = useNotificationStore();
const confirm = useConfirm();
const { data, refresh, pending } = await useFetch<{ items: Miss[] }>('/api/admin/search-misses', {
  query: { limit: 200 },
  default: () => ({ items: [] }),
});
const items = computed(() => data.value?.items ?? []);
const busy = ref<string | null>(null);

async function remove(query: string) {
  busy.value = query;
  try {
    await $fetch('/api/admin/search-misses', { method: 'DELETE', body: { query } });
    await refresh();
  } catch (err: any) {
    notifications.error(err?.data?.message || t('admin.searchMisses.failed'));
  } finally {
    busy.value = null;
  }
}
async function clearAll() {
  const ok = await confirm({
    title: t('admin.searchMisses.clearAll'),
    message: t('admin.searchMisses.clearAllConfirm'),
    confirmText: t('admin.searchMisses.clearAll'),
    destructive: true,
  });
  if (!ok) return;
  busy.value = '*';
  try {
    await $fetch('/api/admin/search-misses', { method: 'DELETE', body: {} });
    await refresh();
  } catch (err: any) {
    notifications.error(err?.data?.message || t('admin.searchMisses.failed'));
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <div class="card">
    <div class="card-header">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div class="flex items-center gap-2">
          <Icon name="ph:magnifying-glass-minus-bold" class="text-text-muted" />
          <h3 class="text-xs font-bold uppercase tracking-wider text-text-primary">
            {{ $t('admin.searchMisses.title') }}
          </h3>
        </div>
        <button
          v-if="items.length"
          type="button"
          class="tool-btn tool-btn--text"
          :disabled="busy !== null"
          @click="clearAll"
        >
          <Icon name="ph:broom-bold" />
          {{ $t('admin.searchMisses.clearAll') }}
        </button>
      </div>
    </div>
    <div class="card-body space-y-4">
      <p class="text-xs text-text-muted leading-relaxed">{{ $t('admin.searchMisses.description') }}</p>
      <p v-if="pending && !items.length" class="text-sm text-text-muted">…</p>
      <p v-else-if="!items.length" class="text-sm text-text-muted">{{ $t('admin.searchMisses.empty') }}</p>
      <div v-else class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-xs uppercase tracking-wider text-text-muted">
              <th class="py-2 pr-4">{{ $t('admin.searchMisses.query') }}</th>
              <th class="py-2 pr-4 text-right">{{ $t('admin.searchMisses.count') }}</th>
              <th class="py-2 pr-4">{{ $t('admin.searchMisses.last') }}</th>
              <th class="py-2 pr-4">{{ $t('admin.searchMisses.first') }}</th>
              <th class="py-2" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in items" :key="m.query" class="border-t border-border">
              <td class="py-2 pr-4 font-mono text-text-primary">{{ m.query }}</td>
              <td class="py-2 pr-4 text-right tabular-nums text-text-primary">{{ m.count }}</td>
              <td class="py-2 pr-4 text-text-muted">{{ formatAgo(m.lastAt, locale) }}</td>
              <td class="py-2 pr-4 text-text-muted">{{ formatAgo(m.firstAt, locale) }}</td>
              <td class="py-2">
                <div class="flex items-center justify-end gap-1">
                  <NuxtLink
                    :to="{ path: '/requests/new', query: { title: m.query } }"
                    class="tool-btn"
                    :title="$t('admin.searchMisses.request')"
                    :aria-label="$t('admin.searchMisses.request')"
                  >
                    <Icon name="ph:hand-palm-bold" />
                  </NuxtLink>
                  <NuxtLink
                    :to="{ path: '/torrents', query: { q: m.query } }"
                    class="tool-btn"
                    :title="$t('admin.searchMisses.search')"
                    :aria-label="$t('admin.searchMisses.search')"
                  >
                    <Icon name="ph:magnifying-glass-bold" />
                  </NuxtLink>
                  <button
                    type="button"
                    class="tool-btn"
                    :disabled="busy !== null"
                    :title="$t('admin.searchMisses.delete')"
                    :aria-label="$t('admin.searchMisses.delete')"
                    @click="remove(m.query)"
                  >
                    <Icon name="ph:x-bold" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
