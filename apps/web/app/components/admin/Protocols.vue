<template>
  <article class="proto">
    <header class="proto-head">
      <span class="proto-head-tag">
        <Icon name="ph:plug-connect-bold" class="proto-head-tag-icon" />
        {{ $t('admin.protocols.title') }}
      </span>
      <span class="proto-head-meta tabular-nums">
        {{ $t('admin.protocols.activeCount', { n: activeCount, total: totalCount }) }}
      </span>
    </header>

    <ul class="proto-list">
      <li
        v-for="(active, name) in protocols ?? defaultProtocols"
        :key="name"
        class="proto-row"
        :class="{ 'proto-row--on': active }"
        :style="{ '--stagger': `${index(name) * 60}ms` }"
      >
        <span class="proto-rail" aria-hidden="true" />
        <Icon :name="protocolIcon(name)" class="proto-icon" />
        <span class="proto-name">{{ String(name).toUpperCase() }}</span>
        <span class="proto-state">
          <span class="proto-state-light">
            <span class="proto-state-dot" aria-hidden="true" />
          </span>
          {{ active ? $t('admin.protocols.active') : $t('admin.protocols.inactive') }}
        </span>
      </li>
    </ul>
  </article>
</template>

<script setup lang="ts">
const props = defineProps<{
  protocols: Record<string, boolean> | undefined;
}>();

const defaultProtocols = { http: false, udp: false, ws: false };

const activeCount = computed(() => {
  const p = props.protocols ?? defaultProtocols;
  return Object.values(p).filter(Boolean).length;
});
const totalCount = computed(() => {
  const p = props.protocols ?? defaultProtocols;
  return Object.keys(p).length;
});

const ORDER: Record<string, number> = { http: 0, udp: 1, ws: 2 };
function index(name: string | number): number {
  return ORDER[String(name).toLowerCase()] ?? 99;
}

function protocolIcon(name: string | number): string {
  const k = String(name).toLowerCase();
  if (k === 'http') return 'ph:globe-bold';
  if (k === 'udp') return 'ph:lightning-bold';
  if (k === 'ws') return 'ph:plugs-connected-bold';
  return 'ph:plug-bold';
}
</script>

<style scoped>
.proto {
  display: flex;
  flex-direction: column;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  overflow: hidden;
}
.proto-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0.7rem 0.95rem;
  background: rgb(var(--bg-base));
  border-bottom: 1px solid rgb(var(--line-default));
}
.proto-head-tag {
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
.proto-head-tag-icon { font-size: 0.95rem; color: #d4a734; }
.proto-head-meta {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}

.proto-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.proto-row {
  position: relative;
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.7rem;
  padding: 0.7rem 0.95rem 0.7rem 1.1rem;
  border-bottom: 1px solid rgb(var(--line-default));
  animation: proto-in 0.36s cubic-bezier(0.2, 0.7, 0.2, 1) backwards;
  animation-delay: var(--stagger, 0ms);
  transition: background 0.16s ease;
}
.proto-row:last-child { border-bottom: 0; }
.proto-row:hover {
  background: rgb(var(--bg-base));
}
@keyframes proto-in {
  from { opacity: 0; transform: translateX(-4px); }
  to { opacity: 1; transform: translateX(0); }
}
.proto-rail {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: rgb(var(--line-strong));
  opacity: 0.4;
}
.proto-row--on .proto-rail {
  background: #6cd161;
  opacity: 1;
  box-shadow: 0 0 8px rgba(108, 209, 97, 0.5);
}

.proto-icon {
  font-size: 1.1rem;
  color: rgb(var(--fg-muted));
}
.proto-row--on .proto-icon { color: rgb(var(--fg-strong)); }

.proto-name {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.92rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: rgb(var(--fg-strong));
}

.proto-state {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.proto-row--on .proto-state { color: #6cd161; }

.proto-state-light {
  position: relative;
  display: inline-grid;
  place-items: center;
  width: 14px;
  height: 14px;
}
.proto-state-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgb(var(--line-strong));
  opacity: 0.4;
}
.proto-row--on .proto-state-dot {
  background: #6cd161;
  opacity: 1;
  box-shadow: 0 0 8px rgba(108, 209, 97, 0.7);
  animation: proto-pulse 1.8s ease-in-out infinite;
}
@keyframes proto-pulse {
  0%, 100% { opacity: 0.6; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1.1); }
}
</style>
