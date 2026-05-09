<template>
  <!-- Public-facing role badge. Shape mirrors the design language of
       the existing Admin/Mod chips on /users/:id (small pill with icon
       + label) but accepts an arbitrary CSS hex colour so the operator
       can theme each role distinctly. The colour drives:
         - the dot
         - the foreground tint
         - a low-alpha background tint
         - a low-alpha border
       all derived from the same hex via `color-mix(...)`. -->
  <span
    v-if="role"
    class="role-badge"
    :style="badgeStyle"
    :title="title ?? role.name"
  >
    <Icon
      v-if="role.icon"
      :name="role.icon"
      class="role-badge__icon"
      aria-hidden="true"
    />
    <span class="role-badge__dot" v-else aria-hidden="true" />
    <span class="role-badge__label">{{ role.name }}</span>
  </span>
</template>

<script setup lang="ts">
interface RoleLike {
  id: string;
  name: string;
  color: string;
  icon?: string | null;
}

const props = defineProps<{
  role: RoleLike | null | undefined;
  title?: string;
}>();

// Derive a colour-stop set from the role's hex. We rely on
// color-mix() at render time so each role pill carries its own
// accent without needing per-role CSS variables.
const badgeStyle = computed(() => {
  const c = props.role?.color || '#6b7280';
  return {
    '--role-c': c,
    color: `color-mix(in srgb, ${c} 78%, white 22%)`,
    backgroundColor: `color-mix(in srgb, ${c} 14%, transparent)`,
    borderColor: `color-mix(in srgb, ${c} 45%, transparent)`,
  } as Record<string, string>;
});
</script>

<style scoped>
.role-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.18rem 0.6rem;
  border: 1px solid transparent;
  border-radius: 9999px;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.12em;
  line-height: 1.4;
  /* The label is the only part that breaks rhythm — keep tight. */
  white-space: nowrap;
}
.role-badge__icon {
  font-size: 12px;
  flex-shrink: 0;
}
.role-badge__dot {
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  background: var(--role-c, #6b7280);
  flex-shrink: 0;
  /* A faint glow lets the dot read as "live" without depending on the
     role's colour saturation (gray dots otherwise look dead). */
  box-shadow: 0 0 6px color-mix(in srgb, var(--role-c, #6b7280) 60%, transparent);
}
</style>
