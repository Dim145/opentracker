<template>
  <div class="tree">
    <div class="tree-search">
      <label class="tree-field">
        <span class="field-label">{{ $t('admin.inviteTree.lookup') }}</span>
        <input
          v-model="term"
          type="search"
          class="input"
          autocomplete="off"
          spellcheck="false"
          :placeholder="$t('admin.inviteTree.lookupPlaceholder')"
          @keydown.enter.prevent="search"
        />
      </label>
      <button type="button" class="btn btn-secondary" :disabled="!term.trim() || busy" @click="search">
        <Icon :name="busy ? 'ph:circle-notch' : 'ph:magnifying-glass-bold'" :class="{ 'animate-spin': busy }" />
        {{ $t('admin.inviteTree.search') }}
      </button>
    </div>

    <ul v-if="candidates.length > 1" class="tree-candidates">
      <li v-for="c in candidates" :key="c.id">
        <button type="button" class="tree-candidate" @click="load(c.id)">
          @{{ c.username }}
        </button>
      </li>
    </ul>

    <p v-if="error" class="tree-error">{{ error }}</p>

    <template v-if="data">
      <!-- Upwards: who vouched for them, nearest first. The chain reads from
           the subject outwards, because that is the direction the question is
           asked in. -->
      <section class="tree-block">
        <h3 class="tree-block-title">{{ $t('admin.inviteTree.invitedBy') }}</h3>
        <p v-if="!data.ancestors.length" class="tree-note">
          {{
            data.ancestorsEnd === 'root'
              ? $t('admin.inviteTree.noInviter')
              : $t('admin.inviteTree.depthLimit')
          }}
        </p>
        <ol v-else class="tree-chain">
          <li v-for="a in data.ancestors" :key="a.id" class="tree-chain-item">
            <component
              :is="a.erased ? 'span' : 'NuxtLink'"
              :to="a.erased ? undefined : `/users/${a.id}`"
              class="tree-node"
              :class="nodeClass(a)"
            >
              <Icon :name="nodeIcon(a)" />
              <span class="tree-name">{{ a.erased ? $t('admin.inviteTree.erased') : a.username }}</span>
              <span class="tree-depth">{{ $t('admin.inviteTree.generation', { n: a.depth }) }}</span>
            </component>
          </li>
        </ol>
      </section>

      <!-- Downwards. -->
      <section class="tree-block">
        <h3 class="tree-block-title">
          {{ $t('admin.inviteTree.invited', { name: data.subject.username }) }}
        </h3>
        <p v-if="!data.subject.children?.length" class="tree-note">
          {{ $t('admin.inviteTree.noInvitees') }}
        </p>
        <AdminInviteTreeNode
          v-for="child in data.subject.children ?? []"
          v-else
          :key="child.id"
          :node="child"
        />
        <p v-if="data.truncated" class="tree-note tree-note--warn">
          <Icon name="ph:warning-bold" />
          {{ $t('admin.inviteTree.truncated', { nodes: data.limits.maxNodes, depth: data.limits.maxDepth }) }}
        </p>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * The invitation genealogy.
 *
 * Two directions from one member: who vouched for them, and who they let in.
 * The procedure it serves is the one every tracker runs after a ban — whoever
 * invited a cheat is either careless or complicit, and their other invitees
 * are worth a look.
 *
 * An erased account renders as a tombstone rather than a link: the edges
 * survive an erasure intact (which is what makes the tree usable at all), but
 * the name behind them is gone and clicking through would show a stranger.
 */
interface TreeNode {
  id: string;
  username: string;
  isBanned: boolean;
  erased: boolean;
  createdAt: string;
  invitedAt: string | null;
  depth: number;
  children?: TreeNode[];
}

interface TreePayload {
  subject: TreeNode;
  ancestors: TreeNode[];
  ancestorsEnd: 'root' | 'depth-limit';
  truncated: boolean;
  limits: { maxDepth: number; maxNodes: number };
  nodeCount: number;
}

const { t } = useI18n();

const term = ref('');
const busy = ref(false);
const error = ref('');
const data = ref<TreePayload | null>(null);
const candidates = ref<Array<{ id: string; username: string }>>([]);

async function search() {
  const q = term.value.trim();
  if (!q) return;
  busy.value = true;
  error.value = '';
  candidates.value = [];
  try {
    // Reuse the admin user search rather than adding a second one — the two
    // would answer "who is this" differently the day one of them changes.
    const res = await $fetch<{
      items: Array<{ id: string; username: string }>;
    }>('/api/admin/users', { query: { search: q, pageSize: 10 } });
    const users = res.items ?? [];
    if (users.length === 0) {
      error.value = t('admin.inviteTree.notFound');
    } else if (users.length === 1) {
      await load(users[0]!.id);
    } else {
      candidates.value = users;
    }
  } catch (err: unknown) {
    const e = err as { data?: { message?: string }; message?: string };
    error.value = e?.data?.message || e?.message || t('admin.inviteTree.failed');
  } finally {
    busy.value = false;
  }
}

async function load(userId: string) {
  busy.value = true;
  error.value = '';
  candidates.value = [];
  try {
    data.value = await $fetch<TreePayload>('/api/admin/invites/tree', {
      query: { userId },
    });
  } catch (err: unknown) {
    const e = err as { data?: { message?: string }; message?: string };
    error.value = e?.data?.message || e?.message || t('admin.inviteTree.failed');
  } finally {
    busy.value = false;
  }
}

function nodeClass(n: TreeNode) {
  if (n.erased) return 'tree-node--erased';
  if (n.isBanned) return 'tree-node--banned';
  return '';
}
function nodeIcon(n: TreeNode) {
  if (n.erased) return 'ph:user-minus';
  if (n.isBanned) return 'ph:prohibit-bold';
  return 'ph:user';
}
</script>

<style scoped>
.tree {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}
.tree-search {
  display: flex;
  align-items: flex-end;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.tree-field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  flex: 1 1 20rem;
}
.tree-candidates {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  list-style: none;
  margin: 0;
  padding: 0;
}
.tree-candidate {
  padding: 0.2rem 0.5rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.25rem;
  font-size: 0.78rem;
  background: none;
  color: rgb(var(--fg-default));
  cursor: pointer;
}
.tree-candidate:hover {
  border-color: rgb(var(--accent));
  color: rgb(var(--accent));
}
.tree-error {
  margin: 0;
  font-size: 0.82rem;
  color: rgb(var(--danger));
}
.tree-block-title {
  margin: 0 0 0.6rem;
  font-size: 0.72rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgb(var(--fg-subtle));
}
.tree-note {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  font-size: 0.8125rem;
  color: rgb(var(--fg-subtle));
}
.tree-note--warn {
  margin-top: 0.75rem;
  color: rgb(var(--warning));
}
.tree-chain {
  list-style: none;
  margin: 0;
  padding: 0;
}
/* Each generation steps right, so the chain reads as a chain rather than as a
   list of unrelated names. */
.tree-chain-item {
  padding-left: calc(1.1rem * (var(--i, 0)));
}
.tree-node {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.25rem 0;
  font-size: 0.85rem;
}
.tree-node--banned {
  color: rgb(var(--danger));
}
.tree-node--erased {
  color: rgb(var(--fg-subtle));
  font-style: italic;
}
.tree-depth {
  font-size: 0.7rem;
  color: rgb(var(--fg-subtle));
}
</style>
