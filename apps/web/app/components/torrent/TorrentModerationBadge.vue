<template>
  <span
    v-if="status && status !== 'accepted'"
    :class="['mod-badge', `mod-badge--${status}`, sizeClass]"
    :title="title"
  >
    <Icon :name="iconName" class="mod-badge-icon" />
    <span class="mod-badge-label">{{ label }}</span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';

type ModerationStatus = 'pending' | 'accepted' | 'changes_requested' | 'rejected';

const props = withDefaults(
  defineProps<{
    status?: ModerationStatus | null;
    size?: 'sm' | 'md';
  }>(),
  { size: 'md' }
);

const sizeClass = computed(() =>
  props.size === 'sm' ? 'mod-badge--sm' : 'mod-badge--md'
);

const label = computed(() => {
  switch (props.status) {
    case 'pending': return 'Pending review';
    case 'changes_requested': return 'Changes requested';
    case 'rejected': return 'Rejected';
    default: return '';
  }
});

const iconName = computed(() => {
  switch (props.status) {
    case 'pending': return 'ph:hourglass-medium-fill';
    case 'changes_requested': return 'ph:pencil-line-fill';
    case 'rejected': return 'ph:prohibit-fill';
    default: return 'ph:circle';
  }
});

const title = computed(() => {
  switch (props.status) {
    case 'pending':
      return 'Awaiting moderation. Hidden from public listings until accepted.';
    case 'changes_requested':
      return 'A moderator asked for changes. Edit the torrent to resubmit it.';
    case 'rejected':
      return 'Rejected. Hidden from public listings; only a moderator can move it elsewhere.';
    default:
      return '';
  }
});
</script>

<style scoped>
/*
 * Badges are deliberately loud: they're the surface that tells a user
 * (and a moderator) that a row is in an unusual state. Each variant
 * carries a hue from the existing semantic palette (--warning,
 * --info, --danger) and uses three layers (saturated background, full
 * 1.5px border, inset highlight) so the badge reads as a "stamp" even
 * on busy headers and table rows.
 *
 * The native CSS vars are stored as raw RGB triplets in main.css, so
 * we wrap them in `rgb(...)` here to compose color-mix and alpha
 * fades. Earlier drafts used `var(--success)`/`var(--error)` (Tailwind
 * tokens with no CSS-variable counterpart) and rendered colourless.
 */

.mod-badge {
  --c: 234 179 8;            /* fallback amber */
  --c-bg-soft: rgb(var(--c) / 0.16);
  --c-bg: rgb(var(--c) / 0.22);
  --c-line: rgb(var(--c) / 0.55);
  --c-text: rgb(var(--c));

  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  color: var(--c-text);
  background: linear-gradient(180deg, var(--c-bg) 0%, var(--c-bg-soft) 100%);
  border: 1.5px solid var(--c-line);
  border-radius: 4px;
  white-space: nowrap;
  vertical-align: middle;
  position: relative;
  isolation: isolate;
  box-shadow: inset 0 1px 0 rgb(var(--c) / 0.18);
}

/*
 * A faint diagonal stripe behind the text mimics the backdrop of an
 * inked rubber stamp. Subtle enough to stay readable, distinctive
 * enough to look intentional.
 */
.mod-badge::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: repeating-linear-gradient(
    -38deg,
    transparent,
    transparent 6px,
    rgb(var(--c) / 0.06) 6px,
    rgb(var(--c) / 0.06) 7px
  );
  pointer-events: none;
  z-index: -1;
}

.mod-badge-icon { font-size: 1em; }
.mod-badge-label { line-height: 1; }

.mod-badge--md {
  font-size: 10px;
  padding: 0.32rem 0.55rem;
}
.mod-badge--sm {
  font-size: 9px;
  padding: 0.2rem 0.45rem;
  letter-spacing: 0.14em;
  gap: 0.3rem;
}

/* ── Variants ───────────────────────────────────────────── */

/* Amber — caution / hold */
.mod-badge--pending { --c: 234 179 8; }

/* Sky blue — informational, "back to the author" */
.mod-badge--changes_requested { --c: 56 189 248; }

/* Red — refusal */
.mod-badge--rejected { --c: 239 68 68; }
</style>
