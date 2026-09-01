<template>
  <div class="node-row" :style="`--depth: ${node.depth}`">
    <component
      :is="node.erased ? 'span' : 'NuxtLink'"
      :to="node.erased ? undefined : `/users/${node.id}`"
      class="node"
      :class="{ 'node--banned': node.isBanned, 'node--erased': node.erased }"
    >
      <Icon :name="node.erased ? 'ph:user-minus' : node.isBanned ? 'ph:prohibit-bold' : 'ph:user'" />
      <span>{{ node.erased ? $t('admin.inviteTree.erased') : node.username }}</span>
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
 */
interface TreeNode {
  id: string;
  username: string;
  isBanned: boolean;
  erased: boolean;
  depth: number;
  children?: TreeNode[];
}

defineProps<{ node: TreeNode }>();
</script>

<style scoped>
.node-row {
  padding-left: calc(1.1rem * var(--depth, 0));
  border-left: 1px solid rgb(var(--line-default));
  margin-left: 0.25rem;
}
.node {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.2rem 0;
  font-size: 0.85rem;
}
.node--banned {
  color: rgb(var(--danger));
}
.node--erased {
  color: rgb(var(--fg-subtle));
  font-style: italic;
}
</style>
