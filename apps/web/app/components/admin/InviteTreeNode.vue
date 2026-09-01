<template>
  <div class="node-row" :style="`--depth: ${node.depth}`" role="treeitem" :aria-level="node.depth">
    <component
      :is="node.erased ? 'span' : 'NuxtLink'"
      :to="node.erased ? undefined : `/users/${node.id}`"
      class="node"
      :class="{ 'node--banned': node.isBanned, 'node--erased': node.erased }"
    >
      <Icon :name="node.erased ? 'ph:user-minus' : node.isBanned ? 'ph:prohibit-bold' : 'ph:user'" />
      <span class="node-name">{{ node.erased ? $t('admin.inviteTree.erased') : node.username }}</span>
      <!-- "Banned" in words. It was a red tint and a small glyph, neither of
           which a screen reader perceives and neither of which says WHICH state
           red means — in a list of forty names, banned, erased and inactive
           would all have looked like "not normal". The erased case already
           carried its own text; this one did not. -->
      <span v-if="node.isBanned && !node.erased" class="stat-badge node-badge">
        {{ $t('admin.inviteTree.legendBanned') }}
      </span>
      <!-- When the sponsorship happened. `invitedAt` has been on the payload
           and on this interface from the start and was rendered nowhere, so an
           operator could not tell a three-year-old invitation from
           yesterday's — which is most of what decides whether a cluster of
           bans is a pattern. -->
      <time v-if="node.invitedAt" class="node-when" :datetime="node.invitedAt">
        {{ shortDay(node.invitedAt) }}
      </time>
    </component>
  </div>
  <AdminInviteTreeNode v-for="child in node.children ?? []" :key="child.id" :node="child" />
</template>

<script setup lang="ts">
/**
 * One member in the genealogy, plus its subtree.
 *
 * Recursive by name — the component renders itself for each child. The server
 * caps depth and total nodes, so the recursion is bounded by the payload
 * rather than by anything here.
 *
 * Indentation is a CSS custom property driven by the server's own `depth`
 * rather than by nesting the markup, so a deep tree does not become a deep DOM.
 * The cost of that choice is that there is no ancestor element to hang a
 * per-generation guide line on, which is why the line below is a pseudo-element
 * positioned from `--depth` rather than a `border-left` on the row: with the
 * border, every generation's line landed at the same 0.25rem from the left edge
 * and stacked into one bar, so past the third generation nothing said which
 * parent a name belonged to.
 *
 * `aria-level` carries the depth for a screen reader, which is what makes the
 * flat sibling list readable as a hierarchy without nesting the DOM.
 */
interface TreeNode {
  id: string;
  username: string;
  isBanned: boolean;
  erased: boolean;
  depth: number;
  invitedAt?: string | null;
  children?: TreeNode[];
}

defineProps<{ node: TreeNode }>();

const { locale } = useI18n();

/** `2023-04-18` → `18 Apr 2023` / `18 avr. 2023`. */
function shortDay(iso: string): string {
  return new Date(iso).toLocaleDateString(locale.value, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
</script>

<style scoped>
.node-row {
  position: relative;
  /*
   * Bounded indentation.
   *
   * `1.1rem * depth` is unbounded and `MAX_DEPTH` is 10, so generation ten sat
   * 176px in. On the ~350px a 390px phone actually offers, that left 174px for
   * an icon, a username, a badge and a date — names wrapped or overflowed, with
   * no `word-break` and no fallback. `min()` keeps the staircase legible on a
   * desktop and lets it compress on a phone.
   */
  padding-left: calc(min(1.1rem, 3.2vw) * var(--depth, 0));
}
/* One guide per generation, at that generation's own offset. */
.node-row::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: calc(min(1.1rem, 3.2vw) * (var(--depth, 1) - 1) + 0.25rem);
  border-left: 1px solid rgb(var(--line-default));
}
.node {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  /* 36px and a padded box: the whole row is the target. At ~20px with no
     vertical spacing, in a list that can run to 400 entries, every mis-tap
     navigates to the wrong member's dossier. */
  min-height: 2.25rem;
  padding: 0.35rem 0.5rem;
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
  max-width: 100%;
}
.node:hover { background: rgb(var(--fg-default) / 0.05); }
.node-name { overflow-wrap: anywhere; }
.node--banned {
  color: rgb(var(--danger));
}
.node-badge {
  color: rgb(var(--danger));
  border-color: rgb(var(--danger) / 0.4);
}
.node-when {
  font-family: var(--font-mono);
  font-size: 0.65rem;
  color: rgb(var(--fg-subtle));
  white-space: nowrap;
}
.node--erased {
  color: rgb(var(--fg-subtle));
  font-style: italic;
}
</style>
