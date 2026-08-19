<template>
  <div class="fbrowse">
    <header class="fb-head">
      <div>
        <p class="eyebrow"><span class="eyebrow-rule" /> {{ $t('federated.eyebrow') }}</p>
        <h1 class="fb-title">{{ $t('federated.title') }}</h1>
      </div>
      <span class="fb-count"><Icon name="ph:broadcast-bold" /> {{ $t('federated.count', { n: pag.total }) }}</span>
    </header>

    <div class="fb-banner">
      <Icon name="ph:broadcast-bold" />
      <span>{{ $t('federated.lead') }}</span>
    </div>

    <div class="fb-toolbar">
      <div class="fb-search">
        <Icon name="ph:magnifying-glass" />
        <input v-model="search" type="search" class="input" :placeholder="$t('federated.searchPlaceholder')" />
      </div>
      <div class="fb-modes" role="tablist">
        <button type="button" role="tab" :class="{ active: mode === 'cache' }" @click="mode = 'cache'">
          <Icon name="ph:database-bold" /> {{ $t('federated.modeCache') }}
        </button>
        <button type="button" role="tab" :class="{ active: mode === 'live' }" @click="mode = 'live'">
          <Icon :name="liveBusy ? 'ph:circle-notch' : 'ph:broadcast-bold'" :class="{ 'animate-spin': liveBusy }" /> {{ $t('federated.modeLive') }}
        </button>
      </div>
    </div>
    <p v-if="mode === 'live'" class="fb-live-hint">
      <Icon name="ph:lightning-bold" />
      {{ q.trim().length < 2 ? $t('federated.livePrompt') : $t('federated.liveResult', { peers: livePeers }) }}
    </p>

    <div v-if="items.length" class="fb-list">
      <div v-for="t in items" :key="t.key" class="t-row is-fed" :class="{ 'menu-open': openKey === t.key }">
        <span class="cat" :class="catClass(t.categoryType)"><Icon :name="catIcon(t.categoryType)" /></span>
        <div class="t-main">
          <div class="t-name">
            <NuxtLink v-if="mode === 'cache'" :to="`/federated/${t.id}`">{{ t.name }}</NuxtLink>
            <span v-else>{{ t.name }}</span>
          </div>
          <div class="t-sub">
            <!-- Same release on several instances: collapse to one chip that
                 unfolds the per-instance sources (each with its own remote
                 category + swarm + open link). -->
            <span v-if="t.sourceCount > 1" class="sources" :class="{ open: openKey === t.key }">
              <button type="button" class="origin origin-multi" @click="toggleSources(t.key)">
                <Icon name="ph:broadcast-bold" /> {{ $t('federated.sources', { n: t.sourceCount }) }}
                <Icon name="ph:caret-down-bold" class="caret" />
              </button>
              <div v-if="openKey === t.key" class="src-menu">
                <a
                  v-for="s in t.sources"
                  :key="s.id"
                  class="src-opt"
                  :href="safeHttpUrl(s.detailUrl) || '#'"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span class="src-peer"><Icon name="ph:broadcast-bold" /> {{ s.peerName || host(s.peerBaseUrl) }}</span>
                  <span class="src-meta">
                    <span v-if="s.categorySlug" class="src-cat">{{ s.categorySlug }}</span>
                    <span class="s">▲ {{ s.seeders }}</span>
                    <span class="l">▼ {{ s.leechers }}</span>
                    <Icon name="ph:arrow-square-out-bold" />
                  </span>
                </a>
              </div>
            </span>
            <span v-else class="origin"><Icon name="ph:broadcast-bold" /> {{ $t('federated.via', { peer: t.peerName || host(t.peerBaseUrl) }) }}</span>
            <span v-if="t.uploaderName" class="uploader">
              <Icon name="ph:user" /> {{ t.uploaderName }}
              <button
                class="follow-btn"
                :class="{ 'is-following': isFollowing(t.peerId, t.uploaderName) }"
                :disabled="followBusy"
                :title="isFollowing(t.peerId, t.uploaderName) ? $t('federated.following') : $t('federated.follow')"
                @click="toggleFollow(t.peerId, t.uploaderName)"
              >
                <Icon :name="isFollowing(t.peerId, t.uploaderName) ? 'ph:user-check-fill' : 'ph:user-plus'" />
                {{ isFollowing(t.peerId, t.uploaderName) ? $t('federated.following') : $t('federated.follow') }}
              </button>
            </span>
            <span v-if="t.existsLocally" class="dedupe"><Icon name="ph:link-bold" /> {{ $t('federated.alsoLocal') }}</span>
            <span v-else-if="t.sameContentLocally" class="dedupe"><Icon name="ph:copy-bold" /> {{ $t('federated.sameContent') }}</span>
            <span v-for="tag in (t.tags || []).slice(0, 3)" :key="tag" class="t-tag">{{ tag }}</span>
          </div>
        </div>
        <span class="num size">{{ fmtBytes(t.size) }}</span>
        <span class="sl">
          <span class="s">▲ {{ t.seeders }}</span>
          <span class="l">▼ {{ t.leechers }}</span>
        </span>
        <span class="num age">{{ timeAgo(t.remoteCreatedAt) }}</span>
        <a class="fb-open" :href="safeHttpUrl(t.detailUrl) || '#'" target="_blank" rel="noopener noreferrer">
          <Icon name="ph:arrow-square-out-bold" /> {{ $t('federated.open') }}
        </a>
      </div>
    </div>

    <div v-else class="fb-empty">
      <Icon name="ph:broadcast" />
      <p>{{ $t('federated.empty') }}</p>
    </div>

    <div v-if="pag.pages > 1" class="fb-pager">
      <button :disabled="page <= 1" @click="page--"><Icon name="ph:caret-left-bold" /> {{ $t('federated.prev') }}</button>
      <span class="fb-pos tabular">{{ page }} / {{ pag.pages }}</span>
      <button :disabled="page >= pag.pages" @click="page++">{{ $t('federated.next') }} <Icon name="ph:caret-right-bold" /></button>
    </div>

    <p v-if="items.length" class="fb-footer">
      {{ $t('federated.showing', { shown: items.length, total: pag.total }) }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { safeHttpUrl } from '~/utils/safeUrl';

interface Source {
  id: string;
  peerId: string;
  peerName: string | null;
  peerBaseUrl: string;
  uploaderName: string | null;
  categorySlug: string | null;
  seeders: number;
  leechers: number;
  detailUrl: string | null;
}
interface Row {
  id: string;
  key: string;
  infoHash: string;
  name: string;
  size: number;
  categoryType: string | null;
  tags: string[] | null;
  seeders: number;
  leechers: number;
  remoteCreatedAt: string | null;
  detailUrl: string | null;
  peerId: string;
  peerName: string | null;
  peerBaseUrl: string;
  uploaderName: string | null;
  existsLocally: boolean;
  sameContentLocally: boolean;
  sourceCount: number;
  sources: Source[];
}
interface Resp {
  items: Row[];
  pagination: { page: number; limit: number; total: number; pages: number };
}
interface FollowRow {
  peerId: string;
  remoteUsername: string;
}

const { t } = useI18n();
const page = ref(1);
const search = ref('');
const q = ref('');
const mode = ref<'cache' | 'live'>('cache');

let debounce: ReturnType<typeof setTimeout> | undefined;
watch(search, (v) => {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    q.value = v;
    page.value = 1;
  }, 350);
});

const { data } = await useFetch<Resp>('/api/federation/browse', {
  query: { q, page },
  default: () => ({ items: [], pagination: { page: 1, limit: 50, total: 0, pages: 1 } }),
});
// --- live fan-out search (mode === 'live') --------------------------------
const liveItems = ref<Row[]>([]);
const liveBusy = ref(false);
const livePeers = ref(0);
// Monotonic token guarding against out-of-order live-search responses: a
// slow earlier query must not clobber the result of a newer one.
let liveSeq = 0;
async function runLive() {
  if (mode.value !== 'live' || q.value.trim().length < 2) {
    liveItems.value = [];
    livePeers.value = 0;
    return;
  }
  const seq = ++liveSeq;
  liveBusy.value = true;
  try {
    const res = await $fetch<{ items: Row[]; peers: number; reached: number }>(
      '/api/federation/search-live',
      { query: { q: q.value } },
    );
    // A newer query started while we awaited — discard this stale result.
    if (seq !== liveSeq) return;
    // The endpoint already returns the deduped shape (id/key/sources/…); a
    // live hit has no remote_torrents row so the name isn't an internal
    // /federated/:id link (only the origin "open" link works).
    liveItems.value = res.items ?? [];
    livePeers.value = res.peers ?? 0;
  } catch {
    if (seq !== liveSeq) return;
    liveItems.value = [];
  } finally {
    if (seq === liveSeq) liveBusy.value = false;
  }
}
watch([q, mode], runLive);

const items = computed(() =>
  mode.value === 'live' ? liveItems.value : data.value?.items ?? [],
);
const pag = computed(() =>
  mode.value === 'live'
    ? {
        page: 1,
        limit: liveItems.value.length,
        total: liveItems.value.length,
        pages: 1,
      }
    : data.value?.pagination ?? { page: 1, limit: 50, total: 0, pages: 1 },
);

// --- multi-source picker --------------------------------------------------
// Only one row's source list is open at a time; clicking outside closes it.
const openKey = ref<string | null>(null);
function toggleSources(key: string) {
  openKey.value = openKey.value === key ? null : key;
}
function onDocClick(e: MouseEvent) {
  const el = e.target as HTMLElement | null;
  if (!el?.closest('.sources')) openKey.value = null;
}
onMounted(() => document.addEventListener('click', onDocClick));
onBeforeUnmount(() => document.removeEventListener('click', onDocClick));

// --- federated follows ----------------------------------------------------
const { data: followsData } = await useFetch<{ follows: FollowRow[] }>(
  '/api/me/federated-follows',
  { default: () => ({ follows: [] }) },
);
const followed = reactive(new Set<string>());
const fkey = (peerId: string, username: string) => `${peerId} ${username}`;
watch(
  followsData,
  (d) => {
    followed.clear();
    for (const f of d?.follows ?? []) followed.add(fkey(f.peerId, f.remoteUsername));
  },
  { immediate: true },
);
function isFollowing(peerId: string, username: string | null) {
  return !!username && followed.has(fkey(peerId, username));
}
const followBusy = ref(false);
async function toggleFollow(peerId: string, username: string | null) {
  if (!username || followBusy.value) return;
  const key = fkey(peerId, username);
  const wasFollowing = followed.has(key);
  followBusy.value = true;
  if (wasFollowing) followed.delete(key);
  else followed.add(key);
  try {
    await $fetch('/api/federation/follows', {
      method: wasFollowing ? 'DELETE' : 'POST',
      body: { peerId, username },
    });
  } catch {
    if (wasFollowing) followed.add(key);
    else followed.delete(key);
  } finally {
    followBusy.value = false;
  }
}

// --- helpers --------------------------------------------------------------
function host(u: string) {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
}
function catIcon(type: string | null) {
  return (
    {
      movie: 'ph:film-slate-fill',
      tv: 'ph:television-fill',
      game: 'ph:game-controller-fill',
      book: 'ph:book-open-text-fill',
    } as Record<string, string>
  )[type ?? ''] ?? 'ph:file-fill';
}
function catClass(type: string | null) {
  return type ?? 'other';
}
function fmtBytes(n: number) {
  if (!n || n < 1) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}
function timeAgo(d: string | null) {
  if (!d) return '—';
  const ts = new Date(d).getTime();
  if (Number.isNaN(ts)) return '—';
  const diff = Date.now() - ts;
  const day = 86_400_000;
  if (diff < day) return `${Math.max(1, Math.round(diff / 3_600_000))} h`;
  if (diff < 30 * day) return `${Math.round(diff / day)} d`;
  if (diff < 365 * day) return `${Math.round(diff / (30 * day))} mo`;
  return `${Math.round(diff / (365 * day))} y`;
}
</script>

<style scoped>
.fbrowse { max-width: var(--container-max); margin: 0 auto; padding: 1.75rem var(--container-pad) 5rem; }
.fb-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.25rem; }
.fb-title { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; color: rgb(var(--fg-strong)); margin-top: 0.45rem; }
.fb-count { display: inline-flex; align-items: center; gap: 0.35rem; font-family: var(--font-mono, monospace); font-size: 11px; color: #7dd3fc; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.3); padding: 0.2rem 0.55rem; border-radius: var(--radius-sm); }

.fb-banner { display: flex; gap: 0.7rem; align-items: flex-start; padding: 0.8rem 1rem; border-radius: var(--radius-md); font-size: 12.5px; line-height: 1.55; background: rgba(56, 189, 248, 0.07); border: 1px solid rgba(56, 189, 248, 0.22); color: #bae6fd; margin-bottom: 1.25rem; }
.fb-banner :deep(svg) { color: var(--info, #38bdf8); font-size: 1.1rem; flex-shrink: 0; margin-top: 1px; }

.fb-toolbar { margin-bottom: 1.25rem; display: flex; gap: 0.75rem; align-items: center; justify-content: space-between; flex-wrap: wrap; }
.fb-search { position: relative; max-width: 480px; flex: 1; min-width: 220px; }
.fb-modes { display: inline-flex; border: 1px solid rgb(var(--line-default)); border-radius: var(--radius-sm); overflow: hidden; flex-shrink: 0; }
.fb-modes button { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 12px; font-weight: 600; padding: 0.45rem 0.8rem; color: rgb(var(--fg-muted)); background: rgb(var(--bg-elevated)); border: none; cursor: pointer; transition: all 0.14s ease; }
.fb-modes button + button { border-left: 1px solid rgb(var(--line-default)); }
.fb-modes button.active { color: #0a0a0a; background: var(--info, #38bdf8); }
.fb-modes button:not(.active):hover { background: rgb(var(--bg-hover)); color: rgb(var(--fg-default)); }
.fb-live-hint { display: flex; align-items: center; gap: 0.4rem; font-size: 11.5px; color: #7dd3fc; margin: -0.5rem 0 1rem; }
.fb-search :deep(svg) { position: absolute; left: 0.7rem; top: 50%; transform: translateY(-50%); color: rgb(var(--fg-faint)); }
.fb-search .input { padding-left: 2.1rem; }

.fb-list { border: 1px solid rgb(var(--line-default)); border-radius: var(--radius-md); overflow: hidden; background: rgb(var(--bg-surface)); }
.t-row { position: relative; display: grid; grid-template-columns: 38px 1fr auto auto auto auto; gap: 1rem; align-items: center; padding: 0.8rem 1rem; border-bottom: 1px solid rgb(var(--line-default)); transition: background 0.12s ease; }
.t-row.menu-open { z-index: 30; }
.t-row:last-child { border-bottom: none; }
.t-row:hover { background: rgba(255, 255, 255, 0.025); }
.t-row.is-fed { background: linear-gradient(90deg, rgba(56, 189, 248, 0.035), transparent 40%); }
.cat { width: 38px; height: 38px; border-radius: var(--radius-sm); display: grid; place-items: center; font-size: 1.2rem; background: rgb(var(--bg-elevated)); border: 1px solid rgb(var(--line-default)); color: rgb(var(--fg-muted)); }
.cat.movie { color: #f0abfc; } .cat.tv { color: #fda4af; } .cat.game { color: #fcd34d; } .cat.book { color: #93c5fd; }
.t-main { min-width: 0; }
.t-name a { font-weight: 600; color: rgb(var(--fg-default)); }
.t-name a:hover { color: rgb(var(--fg-strong)); text-decoration: underline; text-underline-offset: 2px; }
.t-sub { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.3rem; flex-wrap: wrap; }
.origin { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 10.5px; font-family: var(--font-mono, monospace); color: #7dd3fc; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.3); padding: 0.05rem 0.4rem; border-radius: var(--radius-sm); }
.sources { position: relative; display: inline-flex; }
.origin-multi { cursor: pointer; }
.origin-multi .caret { font-size: 0.8em; opacity: 0.7; transition: transform 0.14s ease; }
.sources.open .origin-multi .caret { transform: rotate(180deg); }
/* --bg-* tokens are raw "r g b" triples meant for rgb(); a popover that
   overlays other rows needs an OPAQUE fill, so wrap them in rgb(). */
.src-menu { position: absolute; top: calc(100% + 4px); left: 0; z-index: 20; min-width: 232px; background: rgb(var(--bg-elevated)); border: 1px solid rgb(var(--line-strong)); border-radius: var(--radius-sm); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55); padding: 4px; display: flex; flex-direction: column; gap: 2px; }
.src-opt { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 0.4rem 0.55rem; border-radius: var(--radius-sm); font-size: 11.5px; color: rgb(var(--fg-muted)); transition: background 0.12s ease; }
.src-opt:hover { background: rgb(var(--bg-hover)); color: rgb(var(--fg-default)); }
.src-peer { display: inline-flex; align-items: center; gap: 0.3rem; color: #7dd3fc; font-family: var(--font-mono, monospace); white-space: nowrap; }
.src-meta { display: inline-flex; align-items: center; gap: 0.45rem; font-family: var(--font-mono, monospace); font-size: 10.5px; color: rgb(var(--fg-faint)); }
.src-cat { color: rgb(var(--fg-subtle)); background: rgb(var(--bg-inset)); border: 1px solid rgb(var(--line-default)); border-radius: 99px; padding: 0.05rem 0.4rem; }
.src-menu .s { color: #4ade80; }
.src-menu .l { color: #fca5a5; }
.uploader { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 11px; color: rgb(var(--fg-subtle)); }
.uploader :deep(svg) { font-size: 0.95em; }
.follow-btn { display: inline-flex; align-items: center; gap: 0.25rem; margin-left: 0.2rem; font-size: 10px; font-weight: 600; padding: 0.1rem 0.45rem; border-radius: 99px; border: 1px solid rgb(var(--line-strong)); background: rgb(var(--bg-elevated)); color: rgb(var(--fg-muted)); cursor: pointer; transition: all 0.14s ease; }
.follow-btn:hover:not(:disabled) { color: rgb(var(--fg-default)); border-color: rgb(var(--fg-subtle)); }
.follow-btn.is-following { color: #4ade80; border-color: rgba(34, 197, 94, 0.4); background: rgba(34, 197, 94, 0.1); }
.follow-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.dedupe { display: inline-flex; align-items: center; gap: 0.25rem; font-size: 10.5px; color: rgb(var(--fg-subtle)); }
.t-tag { font-size: 10.5px; color: rgb(var(--fg-subtle)); background: rgb(var(--bg-inset)); border: 1px solid rgb(var(--line-default)); border-radius: 99px; padding: 0.05rem 0.45rem; }
.num { font-family: var(--font-mono, monospace); font-size: 12.5px; text-align: right; color: rgb(var(--fg-muted)); }
.sl { display: flex; gap: 0.35rem; }
.sl span { font-family: var(--font-mono, monospace); font-size: 11px; padding: 0.1rem 0.4rem; border-radius: var(--radius-sm); border: 1px solid; }
.sl .s { color: #4ade80; background: rgba(34, 197, 94, 0.08); border-color: rgba(34, 197, 94, 0.25); }
.sl .l { color: #fca5a5; background: rgba(239, 68, 68, 0.06); border-color: rgba(239, 68, 68, 0.2); }
.fb-open { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 12px; font-weight: 600; padding: 0.35rem 0.65rem; border-radius: var(--radius-sm); border: 1px solid rgb(var(--line-default)); background: rgb(var(--bg-elevated)); color: rgb(var(--fg-default)); transition: all 0.14s ease; white-space: nowrap; }
.fb-open:hover { background: rgb(var(--bg-hover)); border-color: rgb(var(--line-strong)); }

.fb-empty { text-align: center; padding: 3rem 1rem; color: rgb(var(--fg-subtle)); border: 1px dashed rgb(var(--line-default)); border-radius: var(--radius-md); display: flex; flex-direction: column; align-items: center; gap: 0.6rem; font-size: 13px; line-height: 1.5; }
.fb-empty :deep(svg) { font-size: 1.8rem; opacity: 0.5; }
.fb-empty p { max-width: 46ch; }

.fb-pager { display: flex; align-items: center; justify-content: center; gap: 1rem; margin-top: 1.25rem; }
.fb-pager button { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 12px; font-weight: 600; color: rgb(var(--fg-muted)); padding: 0.4rem 0.7rem; border: 1px solid rgb(var(--line-default)); border-radius: var(--radius-sm); background: rgb(var(--bg-elevated)); }
.fb-pager button:hover:not(:disabled) { background: rgb(var(--bg-hover)); color: rgb(var(--fg-default)); }
.fb-pager button:disabled { opacity: 0.4; cursor: not-allowed; }
.fb-pos { font-size: 12px; color: rgb(var(--fg-subtle)); }
.fb-footer { text-align: center; margin-top: 1rem; font-size: 11px; color: rgb(var(--fg-faint)); }

@media (max-width: 820px) {
  .t-row { grid-template-columns: 38px 1fr auto; }
  .t-row .num.size, .t-row .sl, .t-row .num.age { display: none; }
}
</style>
