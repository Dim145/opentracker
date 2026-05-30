<template>
  <div class="ff">
    <NuxtLink to="/forum" class="ff-back"><Icon name="ph:arrow-left-bold" /> {{ $t('forumFederated.back') }}</NuxtLink>

    <header class="ff-head">
      <p class="eyebrow"><span class="eyebrow-rule" /> {{ $t('forumFederated.eyebrow') }}</p>
      <h1 class="ff-title">{{ $t('forumFederated.title') }}</h1>
      <p class="note">{{ $t('forumFederated.lead') }}</p>
    </header>

    <div v-if="peers.length" class="ff-peers">
      <section v-for="p in peers" :key="p.peerId" class="ff-peer">
        <h2 class="ff-peer-head">
          <Icon name="ph:broadcast-bold" /> {{ p.peerName || host(p.peerBaseUrl) }}
          <span class="ff-c">{{ p.topics.length }}</span>
        </h2>
        <ul class="ff-topics">
          <li v-for="(tp, i) in p.topics" :key="i" class="ff-topic">
            <a :href="tp.url || '#'" target="_blank" rel="noopener noreferrer" class="ff-topic-title">
              {{ tp.title }} <Icon name="ph:arrow-square-out" />
            </a>
            <div class="ff-topic-meta">
              <span v-if="tp.categoryName" class="ff-cat">{{ tp.categoryName }}</span>
              <span v-if="tp.authorName" class="muted"><Icon name="ph:user" /> {{ tp.authorName }}</span>
              <span class="muted">{{ fmtDate(tp.updatedAt) }}</span>
            </div>
          </li>
        </ul>
      </section>
    </div>

    <div v-else class="ff-empty">
      <Icon name="ph:chat-circle-dots" />
      <p>{{ $t('forumFederated.empty') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
interface RemoteTopic {
  title: string;
  categoryName: string | null;
  authorName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  url: string | null;
}
interface PeerForum {
  peerId: string;
  peerName: string | null;
  peerBaseUrl: string;
  topics: RemoteTopic[];
}

const { data } = await useFetch<{ peers: PeerForum[] }>(
  '/api/federation/remote-forum',
  { default: () => ({ peers: [] }) },
);
const peers = computed(() => data.value?.peers ?? []);

function host(u: string) {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
}
function fmtDate(d: string | null) {
  if (!d) return '';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}
</script>

<style scoped>
.ff { max-width: 920px; margin: 0 auto; padding: 1.5rem var(--container-pad) 5rem; }
.ff-back { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 12.5px; color: var(--fg-muted); margin-bottom: 1.25rem; }
.ff-back:hover { color: var(--fg-default); }
.ff-head { margin-bottom: 1.5rem; }
.ff-title { font-size: 28px; font-weight: 700; color: var(--fg-strong); letter-spacing: -0.02em; margin-top: 0.45rem; }
.ff-head .note { font-size: 13px; color: var(--fg-muted); margin-top: 0.4rem; max-width: 64ch; line-height: 1.55; }

.ff-peers { display: flex; flex-direction: column; gap: 1.5rem; }
.ff-peer-head { display: flex; align-items: center; gap: 0.5rem; font-size: 14px; font-weight: 600; color: var(--fg-strong); padding-bottom: 0.6rem; border-bottom: 1px solid var(--line-default); margin-bottom: 0.7rem; }
.ff-peer-head :deep(svg) { color: #7dd3fc; }
.ff-c { font-family: var(--font-mono, monospace); font-size: 11px; color: var(--fg-subtle); background: var(--bg-elevated); border: 1px solid var(--line-default); border-radius: 99px; padding: 0.05rem 0.45rem; margin-left: 0.2rem; }
.ff-topics { display: flex; flex-direction: column; gap: 0.5rem; list-style: none; }
.ff-topic { padding: 0.7rem 0.9rem; border: 1px solid var(--line-default); border-radius: var(--radius-md); background: var(--bg-surface); transition: border-color 0.14s ease; }
.ff-topic:hover { border-color: var(--line-strong); }
.ff-topic-title { font-weight: 600; color: var(--fg-default); display: inline-flex; align-items: center; gap: 0.35rem; }
.ff-topic-title :deep(svg) { font-size: 0.85em; color: var(--fg-subtle); }
.ff-topic-title:hover { color: var(--fg-strong); }
.ff-topic-meta { display: flex; align-items: center; gap: 0.6rem; margin-top: 0.35rem; font-size: 11.5px; }
.ff-topic-meta .muted { display: inline-flex; align-items: center; gap: 0.25rem; color: var(--fg-subtle); }
.ff-cat { font-size: 10.5px; color: var(--gold, #d4a734); background: rgba(212, 167, 52, 0.1); border: 1px solid rgba(212, 167, 52, 0.3); border-radius: 99px; padding: 0.05rem 0.45rem; }
.ff-empty { text-align: center; padding: 3rem 1rem; color: var(--fg-subtle); border: 1px dashed var(--line-default); border-radius: var(--radius-md); display: flex; flex-direction: column; align-items: center; gap: 0.6rem; font-size: 13px; }
.ff-empty :deep(svg) { font-size: 1.8rem; opacity: 0.5; }
</style>
