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
    </div>

    <div v-if="items.length" class="fb-list">
      <div v-for="t in items" :key="t.id" class="t-row" :class="{ 'is-fed': true }">
        <span class="cat" :class="catClass(t.categoryType)"><Icon :name="catIcon(t.categoryType)" /></span>
        <div class="t-main">
          <div class="t-name">
            <a :href="t.detailUrl || '#'" target="_blank" rel="noopener noreferrer">{{ t.name }}</a>
          </div>
          <div class="t-sub">
            <span class="origin"><Icon name="ph:broadcast-bold" /> {{ $t('federated.via', { peer: t.peerName || host(t.peerBaseUrl) }) }}</span>
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
        <a class="fb-open" :href="t.detailUrl || '#'" target="_blank" rel="noopener noreferrer">
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
interface Row {
  id: string;
  infoHash: string;
  name: string;
  size: number;
  categoryType: string | null;
  tags: string[] | null;
  seeders: number;
  leechers: number;
  remoteCreatedAt: string | null;
  detailUrl: string | null;
  peerName: string | null;
  peerBaseUrl: string;
  existsLocally: boolean;
  sameContentLocally: boolean;
}
interface Resp {
  items: Row[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

const { t } = useI18n();
const page = ref(1);
const search = ref('');
const q = ref('');

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
const items = computed(() => data.value?.items ?? []);
const pag = computed(
  () => data.value?.pagination ?? { page: 1, limit: 50, total: 0, pages: 1 },
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
.fb-title { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; color: var(--fg-strong); margin-top: 0.45rem; }
.fb-count { display: inline-flex; align-items: center; gap: 0.35rem; font-family: var(--font-mono, monospace); font-size: 11px; color: #7dd3fc; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.3); padding: 0.2rem 0.55rem; border-radius: var(--radius-sm); }

.fb-banner { display: flex; gap: 0.7rem; align-items: flex-start; padding: 0.8rem 1rem; border-radius: var(--radius-md); font-size: 12.5px; line-height: 1.55; background: rgba(56, 189, 248, 0.07); border: 1px solid rgba(56, 189, 248, 0.22); color: #bae6fd; margin-bottom: 1.25rem; }
.fb-banner :deep(svg) { color: var(--info, #38bdf8); font-size: 1.1rem; flex-shrink: 0; margin-top: 1px; }

.fb-toolbar { margin-bottom: 1.25rem; }
.fb-search { position: relative; max-width: 480px; }
.fb-search :deep(svg) { position: absolute; left: 0.7rem; top: 50%; transform: translateY(-50%); color: var(--fg-faint); }
.fb-search .input { padding-left: 2.1rem; }

.fb-list { border: 1px solid var(--line-default); border-radius: var(--radius-md); overflow: hidden; background: var(--bg-surface); }
.t-row { display: grid; grid-template-columns: 38px 1fr auto auto auto auto; gap: 1rem; align-items: center; padding: 0.8rem 1rem; border-bottom: 1px solid var(--line-default); transition: background 0.12s ease; }
.t-row:last-child { border-bottom: none; }
.t-row:hover { background: rgba(255, 255, 255, 0.025); }
.t-row.is-fed { background: linear-gradient(90deg, rgba(56, 189, 248, 0.035), transparent 40%); }
.cat { width: 38px; height: 38px; border-radius: var(--radius-sm); display: grid; place-items: center; font-size: 1.2rem; background: var(--bg-elevated); border: 1px solid var(--line-default); color: var(--fg-muted); }
.cat.movie { color: #f0abfc; } .cat.tv { color: #fda4af; } .cat.game { color: #fcd34d; } .cat.book { color: #93c5fd; }
.t-main { min-width: 0; }
.t-name a { font-weight: 600; color: var(--fg-default); }
.t-name a:hover { color: var(--fg-strong); text-decoration: underline; text-underline-offset: 2px; }
.t-sub { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.3rem; flex-wrap: wrap; }
.origin { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 10.5px; font-family: var(--font-mono, monospace); color: #7dd3fc; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.3); padding: 0.05rem 0.4rem; border-radius: var(--radius-sm); }
.dedupe { display: inline-flex; align-items: center; gap: 0.25rem; font-size: 10.5px; color: var(--fg-subtle); }
.t-tag { font-size: 10.5px; color: var(--fg-subtle); background: var(--bg-inset); border: 1px solid var(--line-default); border-radius: 99px; padding: 0.05rem 0.45rem; }
.num { font-family: var(--font-mono, monospace); font-size: 12.5px; text-align: right; color: var(--fg-muted); }
.sl { display: flex; gap: 0.35rem; }
.sl span { font-family: var(--font-mono, monospace); font-size: 11px; padding: 0.1rem 0.4rem; border-radius: var(--radius-sm); border: 1px solid; }
.sl .s { color: #4ade80; background: rgba(34, 197, 94, 0.08); border-color: rgba(34, 197, 94, 0.25); }
.sl .l { color: #fca5a5; background: rgba(239, 68, 68, 0.06); border-color: rgba(239, 68, 68, 0.2); }
.fb-open { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 12px; font-weight: 600; padding: 0.35rem 0.65rem; border-radius: var(--radius-sm); border: 1px solid var(--line-default); background: var(--bg-elevated); color: var(--fg-default); transition: all 0.14s ease; white-space: nowrap; }
.fb-open:hover { background: var(--bg-hover); border-color: var(--line-strong); }

.fb-empty { text-align: center; padding: 3rem 1rem; color: var(--fg-subtle); border: 1px dashed var(--line-default); border-radius: var(--radius-md); display: flex; flex-direction: column; align-items: center; gap: 0.6rem; font-size: 13px; line-height: 1.5; }
.fb-empty :deep(svg) { font-size: 1.8rem; opacity: 0.5; }
.fb-empty p { max-width: 46ch; }

.fb-pager { display: flex; align-items: center; justify-content: center; gap: 1rem; margin-top: 1.25rem; }
.fb-pager button { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 12px; font-weight: 600; color: var(--fg-muted); padding: 0.4rem 0.7rem; border: 1px solid var(--line-default); border-radius: var(--radius-sm); background: var(--bg-elevated); }
.fb-pager button:hover:not(:disabled) { background: var(--bg-hover); color: var(--fg-default); }
.fb-pager button:disabled { opacity: 0.4; cursor: not-allowed; }
.fb-pos { font-size: 12px; color: var(--fg-subtle); }
.fb-footer { text-align: center; margin-top: 1rem; font-size: 11px; color: var(--fg-faint); }

@media (max-width: 820px) {
  .t-row { grid-template-columns: 38px 1fr auto; }
  .t-row .num.size, .t-row .sl, .t-row .num.age { display: none; }
}
</style>
