<template>
  <article class="endp">
    <header class="endp-head">
      <span class="endp-head-tag">
        <Icon name="ph:broadcast-bold" class="endp-head-tag-icon" />
        {{ $t('admin.endpoints.title') }}
      </span>
      <span class="endp-head-meta">
        {{ $t('admin.endpoints.subtitle') }}
      </span>
    </header>

    <ul class="endp-list">
      <li
        v-for="(row, i) in rows"
        :key="row.kind"
        class="endp-row"
        :style="{ '--stagger': `${i * 60}ms` }"
      >
        <div class="endp-row-head">
          <Icon :name="row.icon" class="endp-row-icon" />
          <span class="endp-row-label">{{ row.label }}</span>
        </div>
        <div class="endp-row-body">
          <code class="endp-row-url" :title="row.url">{{ row.url || '—' }}</code>
          <button
            type="button"
            class="endp-row-copy"
            :class="{ 'endp-row-copy--copied': copied === row.kind }"
            :aria-label="$t('admin.endpoints.copy')"
            :title="$t('admin.endpoints.copy')"
            @click="copy(row.kind, row.url)"
          >
            <Icon :name="copied === row.kind ? 'ph:check-bold' : 'ph:copy-bold'" />
          </button>
        </div>
      </li>
    </ul>
  </article>
</template>

<script setup lang="ts">
const { t } = useI18n();
const config = useRuntimeConfig();

const rows = computed(() => [
  {
    kind: 'http' as const,
    label: t('admin.endpoints.httpAnnounce'),
    icon: 'ph:globe-bold',
    url: (config.public.trackerHttpUrl as string) || '',
  },
  {
    kind: 'udp' as const,
    label: t('admin.endpoints.udpAnnounce'),
    icon: 'ph:lightning-bold',
    url: (config.public.trackerUdpUrl as string) || '',
  },
  {
    kind: 'ws' as const,
    label: t('admin.endpoints.websocket'),
    icon: 'ph:plugs-connected-bold',
    url: (config.public.trackerWsUrl as string) || '',
  },
]);

// Briefly swap the copy icon for a check so the user gets a visual
// confirmation without us having to wire a toast.
const copied = ref<'http' | 'udp' | 'ws' | null>(null);
let copyTimer: ReturnType<typeof setTimeout> | null = null;

async function copy(kind: 'http' | 'udp' | 'ws', url: string) {
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    copied.value = kind;
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      copied.value = null;
    }, 1500);
  } catch {
    /* clipboard refused — silently swallow */
  }
}

onBeforeUnmount(() => {
  if (copyTimer) clearTimeout(copyTimer);
});
</script>

<style scoped>
.endp {
  display: flex;
  flex-direction: column;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  overflow: hidden;
}
.endp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0.7rem 0.95rem;
  background: rgb(var(--bg-base));
  border-bottom: 1px solid rgb(var(--line-default));
  flex-wrap: wrap;
}
.endp-head-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
}
.endp-head-tag-icon { font-size: 0.95rem; color: #d4a734; }
.endp-head-meta {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}

.endp-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.endp-row {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.7rem 0.95rem;
  border-bottom: 1px solid rgb(var(--line-default));
  animation: endp-in 0.36s cubic-bezier(0.2, 0.7, 0.2, 1) backwards;
  animation-delay: var(--stagger, 0ms);
}
.endp-row:last-child { border-bottom: 0; }
@keyframes endp-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

.endp-row-head {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}
.endp-row-icon {
  font-size: 0.95rem;
  color: rgb(var(--fg-muted));
}
.endp-row-label {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  flex: 1;
  min-width: 0;
}

.endp-row-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.5rem;
  align-items: stretch;
}
.endp-row-url {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11.5px;
  letter-spacing: 0.01em;
  color: rgb(var(--fg-strong));
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  padding: 0.45rem 0.65rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.endp-row-copy {
  display: grid;
  place-items: center;
  width: 36px;
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  color: rgb(var(--fg-muted));
  cursor: pointer;
  transition: all 0.15s ease;
}
.endp-row-copy:hover {
  color: #d4a734;
  border-color: rgba(212, 167, 52, 0.4);
  background: rgba(212, 167, 52, 0.06);
}
.endp-row-copy--copied {
  color: #6cd161;
  border-color: rgba(108, 209, 97, 0.5);
  background: rgba(108, 209, 97, 0.08);
}
</style>
