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

    <!-- A legend, because "banned" was an icon and a colour with no text, and
         nothing on the page said what red meant. -->
    <p class="tree-legend">
      <span class="tree-legend-item tree-legend-item--banned">
        <Icon name="ph:prohibit-bold" />{{ $t('admin.inviteTree.legendBanned') }}
      </span>
      <span class="tree-legend-item tree-legend-item--erased">
        <Icon name="ph:user-minus" />{{ $t('admin.inviteTree.legendErased') }}
      </span>
    </p>

    <p v-if="error" class="tree-error" role="alert">{{ error }}</p>

    <!-- What the page is for, said before there is anything on it. The first
         screen used to be an empty search box and nothing else: no title, no
         lede, no legend, no hint of what a result looks like. -->
    <div v-else-if="!data && !busy" class="tree-blank">
      <Icon name="ph:git-fork" class="tree-blank-icon" />
      <p>{{ $t('admin.inviteTree.blank') }}</p>
    </div>

    <template v-if="data">
      <!-- Upwards: who vouched for them, nearest first. The chain reads from
           the subject outwards, because that is the direction the question is
           asked in. -->
      <section class="tree-block">
        <h3 class="tree-block-title">{{ $t('admin.inviteTree.invitedBy') }}</h3>
        <p v-if="!data.ancestors.length" class="tree-note">
          {{ $t('admin.inviteTree.noInviter') }}
        </p>
        <!-- Out of the `!ancestors.length` branch it used to live in, where it
             could never render: `ancestorsEnd === 'depth-limit'` requires ten
             ancestors to have been found, so the condition was
             self-contradictory and the message was dead code. The real case —
             ten found, the chain continues — fell through to the list with no
             warning at all, and an operator tracing a filiation concluded the
             topmost account shown was the original sponsor. -->
        <p v-if="data.truncatedUp" class="tree-note tree-note--warn">
          <Icon name="ph:warning-bold" />
          {{ $t('admin.inviteTree.depthLimit', { depth: data.limits.maxDepth }) }}
        </p>
        <ol v-else class="tree-chain">
          <!-- `--i` is what drives the indentation, and it was never set — the
               `<li>` carried no `:style`, so the fallback `0` applied to every
               row and the chain rendered perfectly flat while the comment on
               the CSS rule described a staircase. Read outwards from the
               subject: each step right is one generation further back, which is
               the direction the question is asked in. -->
          <li
            v-for="a in data.ancestors"
            :key="a.id"
            class="tree-chain-item"
            :style="{ '--i': a.depth - 1 }"
          >
            <component
              :is="a.erased ? 'span' : 'NuxtLink'"
              :to="a.erased ? undefined : `/users/${a.id}`"
              class="tree-node"
              :class="nodeClass(a)"
            >
              <Icon :name="nodeIcon(a)" />
              <span class="tree-name">{{ a.erased ? $t('admin.inviteTree.erased') : a.username }}</span>
              <!-- "Banned" was carried by `--danger` and a small glyph, neither
                   of which a screen reader perceives, on the one page where an
                   operator is looking for exactly that. -->
              <span v-if="a.isBanned" class="stat-badge tree-banned">
                {{ $t('admin.inviteTree.legendBanned') }}
              </span>
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
        <!-- The figure the procedure runs on. The component's own note says the
             point is "the one every tracker runs after a ban" — look at the
             sponsor, then at their other invitees — and the count of how many of
             those are banned was computable from data already on the page and
             shown nowhere. -->
        <p v-if="data.subject.children?.length" class="tree-summary">
          {{ $t('admin.inviteTree.summary', {
            members: descendantCount,
            banned: bannedDescendants,
            depth: deepestGeneration,
          }) }}
        </p>
        <p v-if="!data.subject.children?.length" class="tree-note">
          {{ $t('admin.inviteTree.noInvitees') }}
        </p>
        <!-- `role="tree"` so the flat sibling list the recursion produces is
             announced as a hierarchy: each row carries `aria-level`, which
             conveys the depth without nesting the DOM — the trade this component
             was built to make. -->
        <div v-else role="tree" :aria-label="$t('admin.inviteTree.invited', { name: data.subject.username })">
          <AdminInviteTreeNode
            v-for="child in data.subject.children ?? []"
            :key="child.id"
            :node="child"
          />
        </div>
        <p v-if="data.truncatedDown" class="tree-note tree-note--warn">
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
  truncatedUp: boolean;
  truncatedDown: boolean;
  limits: { maxDepth: number; maxNodes: number };
  nodeCount: number;
}

const { t } = useI18n();

const term = ref('');
const busy = ref(false);
const error = ref('');
const data = ref<TreePayload | null>(null);
const candidates = ref<Array<{ id: string; username: string }>>([]);

/**
 * The one line of arithmetic the page exists for.
 *
 * `isBanned` is on every node and `nodeCount` is on the payload, and neither was
 * ever turned into the sentence a moderator opens this page to read: how many of
 * this account's invitees are banned, and how far the branch goes. Walked here
 * rather than asked of the server, because the whole subtree is already in hand.
 */
function walk(node: TreeNode, seen: { total: number; banned: number; depth: number }) {
  for (const child of node.children ?? []) {
    seen.total += 1;
    if (child.isBanned) seen.banned += 1;
    if (child.depth > seen.depth) seen.depth = child.depth;
    walk(child, seen);
  }
}
const descendants = computed(() => {
  const seen = { total: 0, banned: 0, depth: 0 };
  if (data.value) walk(data.value.subject, seen);
  return seen;
});
const descendantCount = computed(() => descendants.value.total);
const bannedDescendants = computed(() => descendants.value.banned);
const deepestGeneration = computed(() => descendants.value.depth);

/**
 * A member id in the query string loads that member straight away.
 *
 * The procedure this page serves starts on a user's row or on their dossier, and
 * there was no path from either — the only way in was to retype a username by
 * hand into a page reached from the sidebar.
 */
const route = useRoute();
onMounted(() => {
  const id = route.query.userId;
  if (typeof id === 'string' && id) void load(id);
});

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
  /* Scaled, so a theme that opens the tracking does not leave these two labels
     behind. */
  letter-spacing: calc(0.1em * var(--tracking-scale));
  text-transform: uppercase;
  color: rgb(var(--fg-subtle));
}
.tree-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin: 0;
  font-size: 0.7rem;
  color: rgb(var(--fg-subtle));
}
.tree-legend-item { display: inline-flex; align-items: center; gap: 0.25rem; }
.tree-legend-item--banned { color: rgb(var(--danger)); }
.tree-legend-item--erased { font-style: italic; }
.tree-blank {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
  padding: 2.5rem 1rem;
  border: 1px dashed rgb(var(--line-default));
  border-radius: var(--radius-md);
  text-align: center;
  font-size: 0.8125rem;
  color: rgb(var(--fg-subtle));
}
.tree-blank-icon { font-size: 1.75rem; }
.tree-summary {
  margin: 0 0 0.6rem;
  font-size: 0.8125rem;
  color: rgb(var(--fg-muted));
}
.tree-banned {
  color: rgb(var(--danger));
  border-color: rgb(var(--danger) / 0.4);
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
  /* 36px and a padded box, so the whole row is the target. At ~22px with no
     vertical spacing, in a list that can run to 400 names, this was a
     mis-tap machine — and every mis-tap navigates to the wrong member. */
  min-height: 2.25rem;
  padding: 0.35rem 0.5rem;
  margin-left: -0.5rem;
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
}
.tree-node:hover { background: rgb(var(--fg-default) / 0.05); }
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
