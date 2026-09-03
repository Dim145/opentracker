<template>
  <!--
    A torrent link, rendered as what it points at.

    Half of what gets sent on a tracker is "have you seen this" followed
    by a hash, and a bare 40-character hex string tells the reader
    nothing. This resolves it to a name, a size and a swarm.

    Fetched by the READER, not embedded by the sender: the card shows what
    the torrent is now — including that it has been removed, or that this
    reader is not allowed to see it — rather than a snapshot of what it
    was when the message was written.
  -->
  <NuxtLink v-if="torrent" :to="`/torrents/${hash}`" class="tc">
    <Icon name="ph:file-arrow-down" class="tc-icon" />
    <span class="tc-main">
      <span class="tc-name">{{ torrent.name }}</span>
      <span class="tc-meta">
        <span v-if="torrent.size">{{ formatSize(Number(torrent.size)) }}</span>
        <span class="tc-swarm">
          <b class="tc-seed">{{ torrent.stats?.seeders ?? 0 }}</b>
          /
          <b class="tc-leech">{{ torrent.stats?.leechers ?? 0 }}</b>
        </span>
      </span>
    </span>
  </NuxtLink>

  <!-- Said, not hidden. A card that silently vanishes leaves the reader
       wondering whether the link was ever there. -->
  <span v-else-if="failed" class="tc tc--gone">
    <Icon name="ph:file-x" class="tc-icon" />
    {{ $t('messaging.torrentGone') }}
  </span>
</template>

<script setup lang="ts">
const props = defineProps<{ hash: string }>();

interface Torrent {
  name: string;
  size?: number | string;
  stats?: { seeders: number; leechers: number };
}

const torrent = ref<Torrent | null>(null);
const failed = ref(false);

onMounted(async () => {
  try {
    torrent.value = await $fetch<Torrent>(`/api/torrents/${props.hash}`);
  } catch {
    // 404 for a removed torrent, 403 for one this reader may not see.
    // Both render the same way on purpose: the difference would tell an
    // unauthorised reader that the torrent exists.
    failed.value = true;
  }
});

</script>

<style scoped>
.tc {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.3rem;
  padding: 0.35rem 0.5rem;
  border: 1px solid rgb(var(--line-strong));
  border-radius: var(--radius-sm);
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-default));
  font-size: 0.7rem;
  text-decoration: none;
}
.tc:hover { border-color: rgb(var(--accent-warm) / 0.6); }
.tc--gone { color: rgb(var(--fg-muted)); font-style: italic; }
.tc-icon { flex: none; color: rgb(var(--fg-muted)); }
.tc-main { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; }
.tc-name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tc-meta {
  display: flex;
  gap: 0.5rem;
  color: rgb(var(--fg-muted));
  font-family: var(--font-mono);
  font-size: 0.62rem;
}
.tc-seed { color: rgb(var(--online)); }
.tc-leech { color: rgb(var(--warning)); }
</style>
