<template>
  <!--
    Reusable toggle row for the upload-rules admin form.

    Layout: title + description on the left, switch on the right;
    a default slot for any sub-fields that need to appear *below*
    the toggle when it's switched on (e.g. the description min-
    length input under "Description required").
  -->
  <div class="urt-row">
    <div class="urt-row-head">
      <div class="urt-row-text">
        <p class="urt-title">{{ title }}</p>
        <p v-if="description" class="urt-desc">{{ description }}</p>
      </div>
      <button
        type="button"
        class="urt-switch"
        :class="{ 'urt-switch--on': modelValue }"
        :aria-pressed="modelValue"
        :aria-label="title"
        @click="$emit('update:modelValue', !modelValue)"
      >
        <span class="urt-switch-thumb" />
      </button>
    </div>
    <slot />
  </div>
</template>

<script setup lang="ts">
defineProps<{
  modelValue: boolean;
  title: string;
  description?: string;
}>();

defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
}>();
</script>

<style scoped>
.urt-row {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.urt-row-head {
  display: flex;
  align-items: center;
  gap: 1rem;
}
.urt-row-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}
.urt-title {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 600;
  color: rgb(var(--fg-strong));
}
.urt-desc {
  margin: 0;
  font-size: 0.75rem;
  color: rgb(var(--fg-muted));
  line-height: 1.45;
}

.urt-switch {
  position: relative;
  flex-shrink: 0;
  width: 2.4rem;
  height: 1.3rem;
  padding: 0;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: 9999px;
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease;
}
.urt-switch:hover {
  border-color: rgb(var(--line-strong));
}
.urt-switch--on {
  background: rgb(var(--accent));
  border-color: rgb(var(--accent));
}
.urt-switch-thumb {
  position: absolute;
  top: 50%;
  left: 0.15rem;
  width: 0.95rem;
  height: 0.95rem;
  background: rgb(var(--fg-default));
  border-radius: 50%;
  transform: translateY(-50%);
  transition: left 0.2s cubic-bezier(0.4, 0, 0.2, 1), background 0.18s ease;
}
.urt-switch--on .urt-switch-thumb {
  left: calc(100% - 1.1rem);
  background: rgb(var(--accent-fg));
}
.urt-switch:focus-visible {
  outline: 2px solid rgb(var(--accent) / 0.6);
  outline-offset: 2px;
}
</style>
