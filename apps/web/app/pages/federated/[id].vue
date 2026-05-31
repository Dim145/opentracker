<template>
  <div class="fdetail">
    <NuxtLink to="/federated" class="fd-back"><Icon name="ph:arrow-left-bold" /> {{ $t('federated.detail.back') }}</NuxtLink>

    <div v-if="!t" class="fd-missing">
      <Icon name="ph:broadcast" />
      <p>{{ $t('federated.detail.notFound') }}</p>
    </div>

    <template v-else>
      <header class="fd-head">
        <span class="cat" :class="t.categoryType || 'other'"><Icon :name="catIcon(t.categoryType)" /></span>
        <div class="fd-id">
          <h1 class="fd-title">{{ t.name }}</h1>
          <div class="fd-meta">
            <span class="origin"><Icon name="ph:broadcast-bold" /> {{ $t('federated.via', { peer: peerName }) }}</span>
            <span v-if="t.uploaderName" class="muted"><Icon name="ph:user" /> {{ t.uploaderName }}</span>
            <span class="muted">{{ fmtBytes(t.size) }}</span>
            <span class="sl"><span class="s">▲ {{ t.seeders }}</span><span class="l">▼ {{ t.leechers }}</span></span>
            <span v-for="tag in (t.tags || []).slice(0, 5)" :key="tag" class="t-tag">{{ tag }}</span>
          </div>
        </div>
        <a v-if="t.detailUrl" class="fb-open" :href="safeHttpUrl(t.detailUrl) || '#'" target="_blank" rel="noopener noreferrer">
          <Icon name="ph:arrow-square-out-bold" /> {{ $t('federated.detail.openOnSource', { peer: peerName }) }}
        </a>
      </header>

      <section v-if="t.description" class="card fd-desc">
        <ClientOnly><DescriptionRender :source="t.description" /></ClientOnly>
      </section>

      <section class="fd-comments">
        <h2 class="fd-h2"><Icon name="ph:chat-circle-dots-bold" /> {{ $t('federated.detail.comments') }} <span class="fd-count">{{ comments.length }}</span></h2>

        <div v-if="comments.length" class="fd-comment-list">
          <article v-for="(c, i) in comments" :key="i" class="fd-comment">
            <div class="fd-comment-head">
              <Icon name="ph:user-circle" /> <strong>{{ c.authorName || '—' }}</strong>
              <span class="fd-comment-date">{{ fmtDate(c.createdAt) }}</span>
            </div>
            <div class="fd-comment-body"><ClientOnly><DescriptionRender :source="c.content" /></ClientOnly></div>
          </article>
        </div>
        <div v-else class="fd-empty-comments">
          <Icon :name="commentsError ? 'ph:warning' : 'ph:chat-circle-dots'" />
          <p>{{ commentsError ? $t('federated.detail.commentsError') : $t('federated.detail.noComments') }}</p>
        </div>

        <p v-if="t.detailUrl" class="fd-cta">
          <a :href="safeHttpUrl(t.detailUrl) || '#'" target="_blank" rel="noopener noreferrer">
            {{ $t('federated.detail.commentOnSource', { peer: peerName }) }} <Icon name="ph:arrow-square-out" />
          </a>
        </p>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { safeHttpUrl } from '~/utils/safeUrl';

interface Detail {
  torrent: {
    id: string;
    infoHash: string;
    name: string;
    size: number;
    description: string | null;
    categoryType: string | null;
    tags: string[] | null;
    seeders: number;
    leechers: number;
    uploaderName: string | null;
    detailUrl: string | null;
    remoteCreatedAt: string | null;
  } | null;
  peer: { name: string | null; baseUrl: string } | null;
  comments: { content: string; authorName: string | null; createdAt: string | null }[];
  commentsError: boolean;
}

const route = useRoute();
const { data } = await useFetch<Detail>(`/api/federation/remote/${route.params.id}`);
const t = computed(() => data.value?.torrent ?? null);
const comments = computed(() => data.value?.comments ?? []);
const commentsError = computed(() => !!data.value?.commentsError);
const peerName = computed(
  () => data.value?.peer?.name || host(data.value?.peer?.baseUrl || ''),
);

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
function fmtDate(d: string | null) {
  if (!d) return '';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}
</script>

<style scoped>
.fdetail { max-width: 920px; margin: 0 auto; padding: 1.5rem var(--container-pad) 5rem; }
.fd-back { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 12.5px; color: var(--fg-muted); margin-bottom: 1.25rem; }
.fd-back:hover { color: var(--fg-default); }
.fd-missing { text-align: center; padding: 4rem 1rem; color: var(--fg-subtle); display: flex; flex-direction: column; align-items: center; gap: 0.6rem; }
.fd-missing :deep(svg) { font-size: 2rem; opacity: 0.5; }

.fd-head { display: flex; gap: 1rem; align-items: flex-start; margin-bottom: 1.5rem; }
.cat { width: 48px; height: 48px; border-radius: var(--radius-md); display: grid; place-items: center; font-size: 1.5rem; background: var(--bg-elevated); border: 1px solid var(--line-default); color: var(--fg-muted); flex-shrink: 0; }
.cat.movie { color: #f0abfc; } .cat.tv { color: #fda4af; } .cat.game { color: #fcd34d; } .cat.book { color: #93c5fd; }
.fd-id { flex: 1; min-width: 0; }
.fd-title { font-size: 22px; font-weight: 700; color: var(--fg-strong); letter-spacing: -0.01em; }
.fd-meta { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; margin-top: 0.5rem; font-size: 12px; }
.fd-meta .muted { display: inline-flex; align-items: center; gap: 0.25rem; color: var(--fg-muted); }
.origin { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 11px; font-family: var(--font-mono, monospace); color: #7dd3fc; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.3); padding: 0.1rem 0.45rem; border-radius: var(--radius-sm); }
.sl { display: inline-flex; gap: 0.35rem; }
.sl span { font-family: var(--font-mono, monospace); font-size: 11px; padding: 0.1rem 0.4rem; border-radius: var(--radius-sm); border: 1px solid; }
.sl .s { color: #4ade80; background: rgba(34, 197, 94, 0.08); border-color: rgba(34, 197, 94, 0.25); }
.sl .l { color: #fca5a5; background: rgba(239, 68, 68, 0.06); border-color: rgba(239, 68, 68, 0.2); }
.t-tag { font-size: 10.5px; color: var(--fg-subtle); background: var(--bg-inset); border: 1px solid var(--line-default); border-radius: 99px; padding: 0.05rem 0.45rem; }
.fb-open { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 12px; font-weight: 600; padding: 0.4rem 0.7rem; border-radius: var(--radius-sm); border: 1px solid var(--line-default); background: var(--bg-elevated); color: var(--fg-default); white-space: nowrap; transition: all 0.14s ease; }
.fb-open:hover { background: var(--bg-hover); border-color: var(--line-strong); }

.card { background: var(--bg-surface); border: 1px solid var(--line-default); border-radius: var(--radius-md); }
.fd-desc { padding: 1.1rem; margin-bottom: 1.75rem; }

.fd-comments { margin-top: 1rem; }
.fd-h2 { display: flex; align-items: center; gap: 0.5rem; font-size: 16px; font-weight: 600; color: var(--fg-strong); padding-bottom: 0.7rem; border-bottom: 1px solid var(--line-default); margin-bottom: 1rem; }
.fd-h2 :deep(svg) { color: var(--gold, #d4a734); }
.fd-count { font-family: var(--font-mono, monospace); font-size: 12px; color: var(--fg-subtle); background: var(--bg-elevated); border: 1px solid var(--line-default); border-radius: 99px; padding: 0.05rem 0.45rem; }
.fd-comment-list { display: flex; flex-direction: column; gap: 0.7rem; }
.fd-comment { background: var(--bg-surface); border: 1px solid var(--line-default); border-radius: var(--radius-md); padding: 0.85rem 1rem; }
.fd-comment-head { display: flex; align-items: center; gap: 0.4rem; font-size: 12.5px; color: var(--fg-muted); margin-bottom: 0.4rem; }
.fd-comment-head strong { color: var(--fg-default); }
.fd-comment-date { margin-left: auto; font-family: var(--font-mono, monospace); font-size: 11px; color: var(--fg-faint); }
.fd-empty-comments { text-align: center; padding: 2rem 1rem; color: var(--fg-subtle); border: 1px dashed var(--line-default); border-radius: var(--radius-md); display: flex; flex-direction: column; align-items: center; gap: 0.5rem; font-size: 13px; }
.fd-empty-comments :deep(svg) { font-size: 1.5rem; opacity: 0.5; }
.fd-cta { margin-top: 1rem; text-align: center; font-size: 12.5px; }
.fd-cta a { color: var(--info, #38bdf8); display: inline-flex; align-items: center; gap: 0.3rem; }
.fd-cta a:hover { text-decoration: underline; }
</style>
