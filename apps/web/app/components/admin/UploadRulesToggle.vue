<template>
  <!--
    Reusable toggle for upload-rules admin.

    Two variants:
      • `default` — title + description on the left, switch on the
        right, optional sub-fields slot under the row. Used by
        section 02's "enforce title patterns" master toggle.
      • `bare` — just the switch. The gate cards in section 01
        already render their own glyph + name + description, so
        embedding the full toggle would duplicate copy and force
        an awkward layout.
  -->
  <button
    v-if="variant === 'bare'"
    type="button"
    class="urt-switch"
    :class="{ 'urt-switch--on': modelValue }"
    :aria-pressed="modelValue"
    :aria-label="title"
    @click="$emit('update:modelValue', !modelValue)"
  >
    <span class="urt-switch-thumb" />
  </button>

  <div v-else class="urt-row">
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
withDefaults(
  defineProps<{
    modelValue: boolean;
    title: string;
    description?: string;
    /** `bare` strips the wrapper down to the switch only — used by
     *  cards that supply their own title / description chrome. */
    variant?: 'default' | 'bare';
  }>(),
  {
    description: '',
    variant: 'default',
  },
);

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
  font-weight: 700;
  color: rgb(var(--fg-strong));
  letter-spacing: 0.01em;
}
.urt-desc {
  margin: 0;
  font-size: 0.75rem;
  color: rgb(var(--fg-muted));
  line-height: 1.5;
}

/* Switch — track + thumb. The on-state colour is coin gold to
   thread the upload-rules surface with the other admin redesigns
   (notifications dispatch board, bonus rules console). */
.urt-switch {
  position: relative;
  flex-shrink: 0;
  width: 2.45rem;
  height: 1.35rem;
  padding: 0;
  background: rgb(var(--line-default));
  border: 0;
  border-radius: 9999px;
  cursor: pointer;
  transition: background 0.2s ease;
}
.urt-switch:hover {
  background: rgb(var(--line-strong));
}
.urt-switch--on {
  background: #d4a734;
}
.urt-switch--on:hover {
  background: #e8b94e;
}
.urt-switch-thumb {
  position: absolute;
  top: 0.15rem;
  left: 0.15rem;
  width: 1.05rem;
  height: 1.05rem;
  background: rgb(var(--bg-elevated));
  border-radius: 50%;
  transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1),
    background 0.18s ease;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
}
.urt-switch--on .urt-switch-thumb {
  transform: translateX(calc(2.45rem - 1.35rem));
  background: rgb(var(--bg-base));
}
.urt-switch:focus-visible {
  outline: 2px solid rgba(212, 167, 52, 0.6);
  outline-offset: 2px;
}
</style>
