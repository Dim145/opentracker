<template>
  <span :class="['status-chip', `status-chip--${status}`]">
    <span class="status-dot" aria-hidden="true" />
    {{ $t(`reports.status.${status}`) }}
  </span>
</template>

<script setup lang="ts">
defineProps<{
  status: 'pending' | 'resolved' | 'dismissed';
}>();
</script>

<style scoped>
.status-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.25rem 0.6rem;
  border-radius: 999px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  white-space: nowrap;
  border: 1px solid currentColor;
  background-color: transparent;
  /* The chip carries its own colour token; inheriting via
     `currentColor` keeps the dot, text, and border in sync without
     a second variable. */
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background-color: currentColor;
  box-shadow: 0 0 0 2px rgba(var(--bg-base), 0.7);
  position: relative;
}

/* Pending → amber pulse to draw the eye gently to "awaiting action" */
.status-chip--pending {
  color: rgb(var(--warning));
  background-color: rgba(var(--warning), 0.08);
}
.status-chip--pending .status-dot::after {
  content: '';
  position: absolute;
  inset: -3px;
  border-radius: 999px;
  border: 1px solid currentColor;
  opacity: 0;
  animation: chipPulse 2.4s ease-out infinite;
}
@keyframes chipPulse {
  0% {
    transform: scale(0.6);
    opacity: 0.6;
  }
  100% {
    transform: scale(2);
    opacity: 0;
  }
}

.status-chip--resolved {
  color: rgb(var(--online));
  background-color: rgba(var(--online), 0.08);
}

.status-chip--dismissed {
  color: rgb(var(--danger));
  background-color: rgba(var(--danger), 0.1);
}
</style>
