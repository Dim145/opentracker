<script setup lang="ts">
/**
 * La barre du catalogue : un champ qui comprend ce qu'on lui tape.
 *
 * « frieren 1080p x265 vostfr » : les trois qualificatifs se détachent en
 * puces au premier espace, le titre reste dans le champ. Chaque puce est un
 * filtre typé (voir `utils/searchTokens.ts`) ; un lien IMDb/TMDb/TVDB collé
 * part vers le filtre d'identifiant de la page, comme avant. Retour arrière
 * sur un champ vide reprend la dernière puce ; `/` ramène le focus ici de
 * n'importe où.
 *
 * Sous le champ, quand il a le focus : les ŒUVRES que le texte désigne (avant
 * les releases — c'est ce qu'on cherche le plus souvent), les formes que la
 * barre comprend, et les recherches récentes. Un combobox au sens ARIA : les
 * flèches parcourent, Entrée choisit, Échap ferme.
 */
import { detectMediaId, type DetectedMediaId } from '~/utils/mediaIdDetect';
import { mergeTokens, parseSearchInput, tokenLabel, type SearchToken } from '~/utils/searchTokens';

export interface SuggestedWork {
  key: string;
  source: 'tmdb' | 'igdb' | 'openlibrary' | 'solo';
  externalId: string;
  title: string;
  year: number | null;
  posterUrl: string | null;
  releaseCount: number;
}
export interface RecentSearch {
  label: string;
  query: Record<string, string>;
}

const props = withDefaults(
  defineProps<{
    modelValue: string;
    tokens: SearchToken[];
    loading?: boolean;
    placeholder?: string;
    recent?: RecentSearch[];
  }>(),
  { loading: false, placeholder: '', recent: () => [] },
);
const emit = defineEmits<{
  'update:modelValue': [value: string];
  'update:tokens': [tokens: SearchToken[]];
  search: [query: string];
  mediaIdSearch: [detected: DetectedMediaId];
  pickWork: [work: SuggestedWork];
  pickRecent: [query: Record<string, string>];
}>();

const { t } = useI18n();
const inputRef = ref<HTMLInputElement | null>(null);
const draft = ref(props.modelValue);
watch(
  () => props.modelValue,
  (v) => {
    if (v !== draft.value.trim()) draft.value = v;
  },
);

const kindLabel = (kind: SearchToken['kind']) => t(`search.tokens.${kind}`);

/* ── Ce que la saisie devient ─────────────────────────────────────────────── */
function commit(keepTail: boolean): { text: string; media: DetectedMediaId | null } {
  const value = draft.value;
  const words = value.split(/\s+/).filter(Boolean);
  const tail = keepTail && !/\s$/.test(value) ? words.pop() ?? '' : '';
  const { tokens, text } = parseSearchInput(words.join(' '));
  let media: DetectedMediaId | null = null;
  const chips: SearchToken[] = [];
  for (const tk of tokens) {
    if (tk.kind === 'imdb' || tk.kind === 'tmdb' || tk.kind === 'tvdb') {
      media = media ?? detectMediaId(tk.raw);
      continue;
    }
    chips.push(tk);
  }
  if (chips.length) emit('update:tokens', mergeTokens([...props.tokens, ...chips]));
  const rest = [text, tail].filter(Boolean).join(' ');
  draft.value = keepTail && /\s$/.test(value) && rest ? `${rest} ` : rest;
  emit('update:modelValue', rest.trim());
  return { text: rest.trim(), media };
}

function onInput(e: Event) {
  draft.value = (e.target as HTMLInputElement).value;
  active.value = -1;
  open.value = true;
  if (/\s$/.test(draft.value)) {
    // Un lien collé puis un espace : il part vers le filtre d'identifiant tout
    // de suite, sinon il disparaîtrait du champ sans rien filtrer.
    const { media } = commit(true);
    if (media) emit('mediaIdSearch', media);
    return;
  }
  emit('update:modelValue', draft.value.trim());
}

function onEnter() {
  if (open.value && active.value >= 0) {
    pick(active.value);
    return;
  }
  const { text, media } = commit(false);
  close();
  if (media) {
    emit('mediaIdSearch', media);
    return;
  }
  emit('search', text);
}

function onBackspace(e: KeyboardEvent) {
  if (draft.value !== '' || props.tokens.length === 0) return;
  e.preventDefault();
  emit('update:tokens', props.tokens.slice(0, -1));
}

function remove(index: number) {
  emit('update:tokens', props.tokens.filter((_, i) => i !== index));
  inputRef.value?.focus();
}

function clearAll() {
  draft.value = '';
  emit('update:modelValue', '');
  emit('update:tokens', []);
  inputRef.value?.focus();
}

function onGlobalKey(e: KeyboardEvent) {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
  const el = document.activeElement as HTMLElement | null;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
  e.preventDefault();
  inputRef.value?.focus();
}
onMounted(() => document.addEventListener('keydown', onGlobalKey));
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onGlobalKey);
  if (timer) clearTimeout(timer);
  aborter?.abort();
});

const hasContent = computed(() => props.tokens.length > 0 || draft.value.trim() !== '');

/* ── Les suggestions ──────────────────────────────────────────────────────── */
const open = ref(false);
const active = ref(-1);
const works = ref<SuggestedWork[]>([]);
const worksFor = ref('');
const loadingWorks = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;
let aborter: AbortController | null = null;
const listId = `ts-sugg-${Math.random().toString(36).slice(2, 8)}`;

/** Le texte cherché, sans les mots qui deviendront des puces. */
const searchText = computed(() => parseSearchInput(draft.value).text.trim());

async function fetchWorks(text: string) {
  aborter?.abort();
  const ctl = new AbortController();
  aborter = ctl;
  loadingWorks.value = true;
  try {
    const res = await $fetch<{
      groups: Array<{
        key: string;
        source: SuggestedWork['source'];
        externalId: string;
        leadName: string;
        releaseCount: number;
        work?: { title: string; year: number | null; posterUrl: string | null } | null;
      }>;
    }>('/api/torrents/groups', { query: { search: text, limit: 4, sources: 'local' }, signal: ctl.signal });
    if (ctl.signal.aborted) return;
    works.value = res.groups.map((g) => ({
      key: g.key,
      source: g.source,
      externalId: g.externalId,
      title: g.work?.title || g.leadName,
      year: g.work?.year ?? null,
      posterUrl: g.work?.posterUrl ?? null,
      releaseCount: g.releaseCount,
    }));
    worksFor.value = text;
  } catch {
    if (!ctl.signal.aborted) works.value = [];
  } finally {
    if (aborter === ctl) loadingWorks.value = false;
  }
}
watch(searchText, (text) => {
  if (timer) clearTimeout(timer);
  if (text.length < 2) {
    works.value = [];
    worksFor.value = '';
    aborter?.abort();
    loadingWorks.value = false;
    return;
  }
  timer = setTimeout(() => void fetchWorks(text), 250);
});

type Option =
  | { kind: 'work'; id: string; work: SuggestedWork }
  | { kind: 'recent'; id: string; recent: RecentSearch };
const options = computed<Option[]>(() => {
  const out: Option[] = [];
  if (searchText.value.length >= 2) {
    for (const w of works.value) out.push({ kind: 'work', id: `${listId}-w-${w.key}`, work: w });
  } else {
    props.recent.forEach((r, i) => out.push({ kind: 'recent', id: `${listId}-r-${i}`, recent: r }));
  }
  return out;
});
const showHints = computed(() => searchText.value.length < 2);
const panelVisible = computed(
  () => open.value && (options.value.length > 0 || showHints.value || loadingWorks.value || searchText.value.length >= 2),
);
const activeId = computed(() => (active.value >= 0 ? options.value[active.value]?.id : undefined));

function close() {
  open.value = false;
  active.value = -1;
}
function onFocus() {
  open.value = true;
}
function onBlur() {
  // Laisse le clic sur une option arriver avant de fermer.
  setTimeout(() => close(), 120);
}
function move(delta: number) {
  if (!options.value.length) return;
  open.value = true;
  const n = options.value.length;
  active.value = ((active.value + delta) % n + n) % n;
}
function pick(index: number) {
  const opt = options.value[index];
  if (!opt) return;
  close();
  if (opt.kind === 'work') {
    emit('pickWork', opt.work);
    draft.value = '';
    emit('update:modelValue', '');
  } else {
    emit('pickRecent', opt.recent.query);
  }
}
</script>

<template>
  <div class="ts">
    <div class="ts-field" @click="inputRef?.focus()">
      <Icon v-if="loading" name="ph:circle-notch" class="ts-ico ts-ico--spin" aria-hidden="true" />
      <Icon v-else name="ph:magnifying-glass" class="ts-ico" aria-hidden="true" />
      <ul v-if="tokens.length" class="ts-chips" :aria-label="t('search.tokens.active')">
        <li v-for="(tk, i) in tokens" :key="`${tk.kind}-${tk.value}`" class="ts-chip" :data-kind="tk.kind">
          <span class="ts-chip-k">{{ kindLabel(tk.kind) }}</span>
          <span class="ts-chip-v">{{ tokenLabel(tk) }}</span>
          <button
            type="button"
            class="ts-chip-x"
            :aria-label="t('search.tokens.remove', { label: kindLabel(tk.kind), value: tokenLabel(tk) })"
            @click.stop="remove(i)"
          >
            <Icon name="ph:x-bold" aria-hidden="true" />
          </button>
        </li>
      </ul>
      <input
        ref="inputRef"
        :value="draft"
        type="text"
        class="ts-input"
        autocomplete="off"
        spellcheck="false"
        role="combobox"
        aria-autocomplete="list"
        :aria-expanded="panelVisible"
        :aria-controls="listId"
        :aria-activedescendant="activeId"
        :aria-label="t('search.tokens.inputLabel')"
        :placeholder="tokens.length ? '' : placeholder || t('search.searchPlaceholder')"
        @input="onInput"
        @focus="onFocus"
        @blur="onBlur"
        @keydown.enter.prevent="onEnter"
        @keydown.backspace="onBackspace"
        @keydown.down.prevent="move(1)"
        @keydown.up.prevent="move(-1)"
        @keydown.esc="close"
      />
      <kbd v-if="!hasContent" class="ts-kbd" aria-hidden="true">/</kbd>
      <button
        v-else
        type="button"
        class="ts-clear"
        :aria-label="t('search.clear')"
        @click.stop="clearAll"
      >
        <Icon name="ph:x" aria-hidden="true" />
      </button>
    </div>

    <div v-show="panelVisible" class="ts-sugg" @mousedown.prevent>
      <template v-if="!showHints">
        <p class="ts-sugg-h">{{ t('search.suggest.understood') }}</p>
        <ul :id="listId" role="listbox" class="ts-sugg-list" :aria-label="t('search.suggest.understood')">
          <li
            v-for="(opt, i) in options"
            :id="opt.id"
            :key="opt.id"
            role="option"
            class="ts-sg"
            :class="{ 'ts-sg--active': i === active }"
            :aria-selected="i === active"
            @click="pick(i)"
            @mousemove="active = i"
          >
            <template v-if="opt.kind === 'work'">
              <TorrentPosterHover class="ts-sg-pst" :src="opt.work.posterUrl" :alt="opt.work.title" fallback-icon="ph:film-slate-bold" />
              <span class="ts-sg-main">
                <span class="ts-sg-title">{{ opt.work.title }}<span v-if="opt.work.year" class="ts-sg-year"> {{ opt.work.year }}</span></span>
                <span class="ts-sg-meta">{{ t('search.suggest.work', opt.work.releaseCount) }}</span>
              </span>
            </template>
          </li>
        </ul>
        <p v-if="loadingWorks && !options.length" class="ts-sugg-note">{{ t('search.suggest.loading') }}</p>
        <p v-else-if="!options.length && worksFor === searchText" class="ts-sugg-note">{{ t('search.suggest.none', { q: searchText }) }}</p>
      </template>
      <template v-else>
        <p class="ts-sugg-h">{{ t('search.suggest.howTitle') }}</p>
        <ul class="ts-hints" aria-hidden="true">
          <li><span class="ts-hint-tok"><b>{{ t('search.tokens.season') }}</b>1</span>{{ t('search.suggest.hints.unit') }}</li>
          <li><span class="ts-hint-tok"><b>{{ t('search.tokens.tmdb') }}</b>id</span>{{ t('search.suggest.hints.link') }}</li>
          <li><span class="ts-hint-tok"><b>{{ t('search.tokens.uploader') }}</b>@…</span>{{ t('search.suggest.hints.uploader') }}</li>
        </ul>
        <template v-if="options.length">
          <p class="ts-sugg-h">{{ t('search.suggest.recent') }}</p>
          <ul :id="listId" role="listbox" class="ts-sugg-list" :aria-label="t('search.suggest.recent')">
            <li
              v-for="(opt, i) in options"
              :id="opt.id"
              :key="opt.id"
              role="option"
              class="ts-sg ts-sg--recent"
              :class="{ 'ts-sg--active': i === active }"
              :aria-selected="i === active"
              @click="pick(i)"
              @mousemove="active = i"
            >
              <Icon name="ph:clock-counter-clockwise" class="ts-sg-ico" aria-hidden="true" />
              <span class="ts-sg-title">{{ opt.kind === 'recent' ? opt.recent.label : '' }}</span>
            </li>
          </ul>
        </template>
      </template>
    </div>

    <p class="ts-hint">{{ t('search.understands') }}</p>
  </div>
</template>

<style scoped>
.ts {
  position: relative;
  display: grid;
  gap: 0.45rem;
}
.ts-field {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.4rem;
  min-height: 3.5rem;
  padding: 0.5rem 0.75rem 0.5rem 0.95rem;
  border: 1px solid rgb(var(--line-field) / 1);
  border-radius: var(--radius-lg);
  background: rgb(var(--bg-surface) / 1);
  cursor: text;
  transition:
    border-color var(--dur-2) var(--ease-standard),
    box-shadow var(--dur-2) var(--ease-standard),
    background-color var(--dur-2) var(--ease-standard);
}
.ts-field:focus-within {
  border-color: rgb(var(--accent-warm) / 0.7);
  background: rgb(var(--bg-elevated) / 1);
  box-shadow: 0 0 0 4px rgb(var(--accent-warm) / 0.12);
}
.ts-ico {
  flex: none;
  width: 1.15rem;
  height: 1.15rem;
  color: rgb(var(--fg-muted) / 1);
}
.ts-field:focus-within .ts-ico {
  color: rgb(var(--accent-warm-text) / 1);
}
.ts-ico--spin {
  animation: ts-spin 0.9s linear infinite;
}
@keyframes ts-spin {
  to {
    transform: rotate(1turn);
  }
}
.ts-chips {
  display: contents;
  list-style: none;
  margin: 0;
  padding: 0;
}
.ts-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  height: 1.75rem;
  padding: 0 0.25rem 0 0.6rem;
  border-radius: var(--radius-pill);
  background: rgb(var(--accent-warm) / 0.12);
  border: 1px solid rgb(var(--accent-warm) / 0.35);
  color: rgb(var(--fg-strong) / 1);
  font-size: 0.8rem;
  line-height: 1;
  white-space: nowrap;
  animation: ts-chip-in var(--dur-3) var(--ease-emphasis) both;
}
@keyframes ts-chip-in {
  from {
    opacity: 0;
    transform: translateY(0.25rem) scale(0.96);
  }
}
.ts-chip-k {
  font-family: var(--font-mono);
  font-size: 0.62rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgb(var(--accent-warm-text) / 1);
}
.ts-chip-v {
  font-weight: 600;
}
.ts-chip-x {
  display: inline-grid;
  place-items: center;
  width: 1.35rem;
  height: 1.35rem;
  border-radius: 50%;
  color: rgb(var(--fg-muted) / 1);
  transition: background-color var(--dur-1) var(--ease-standard), color var(--dur-1) var(--ease-standard);
}
.ts-chip-x:hover {
  background: rgb(var(--accent-warm) / 0.25);
  color: rgb(var(--fg-strong) / 1);
}
.ts-chip-x :deep(svg) {
  width: 0.7rem;
  height: 0.7rem;
}
.ts-input {
  flex: 1 1 10rem;
  min-width: 8rem;
  height: 2.25rem;
  background: transparent;
  border: 0;
  outline: none;
  font-size: 1.05rem;
  color: rgb(var(--fg-strong) / 1);
}
.ts-input::placeholder {
  color: rgb(var(--fg-faint) / 1);
}
.ts-kbd {
  flex: none;
  padding: 0.15rem 0.5rem;
  border: 1px solid rgb(var(--line-default) / 1);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: rgb(var(--fg-muted) / 1);
  background: rgb(var(--bg-inset) / 1);
}
.ts-clear {
  flex: none;
  display: inline-grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  color: rgb(var(--fg-muted) / 1);
  transition: background-color var(--dur-1) var(--ease-standard), color var(--dur-1) var(--ease-standard);
}
.ts-clear:hover {
  background: rgb(var(--bg-hover) / 1);
  color: rgb(var(--fg-strong) / 1);
}
.ts-clear :deep(svg) {
  width: 1rem;
  height: 1rem;
}
.ts-hint {
  margin: 0;
  padding-left: 0.25rem;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  letter-spacing: 0.01em;
  color: rgb(var(--fg-muted) / 1);
}

/* ── Le panneau de suggestions ───────────────────────────────────────────── */
.ts-sugg {
  position: absolute;
  top: calc(100% - 1.4rem);
  left: 0;
  right: 0;
  z-index: 30;
  display: grid;
  gap: 0.25rem;
  padding: 0.6rem 0.5rem 0.5rem;
  border: 1px solid rgb(var(--line-default) / 1);
  border-radius: var(--radius-lg);
  background: rgb(var(--bg-elevated) / 1);
  box-shadow: 0 24px 48px -24px rgb(var(--shadow-color) / var(--shadow-strength));
  animation: ts-sugg-in var(--dur-3) var(--ease-emphasis) both;
}
@keyframes ts-sugg-in {
  from {
    opacity: 0;
    transform: translateY(-0.25rem);
  }
}
.ts-sugg-h {
  margin: 0.2rem 0.5rem 0;
  font-family: var(--font-mono);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted) / 1);
}
.ts-sugg-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
}
.ts-sg {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  min-height: 2.5rem;
  padding: 0.3rem 0.5rem;
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.ts-sg--active {
  background: rgb(var(--bg-hover) / 1);
}
.ts-sg-pst {
  flex: none;
  width: 32px;
  height: 48px;
  border-radius: var(--radius-xs);
  overflow: hidden;
}
.ts-sg-ico {
  flex: none;
  width: 0.9rem;
  height: 0.9rem;
  color: rgb(var(--fg-muted) / 1);
}
.ts-sg-main {
  display: grid;
  gap: 0.1rem;
  min-width: 0;
}
.ts-sg-title {
  font-weight: 600;
  color: rgb(var(--fg-strong) / 1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ts-sg-year {
  font-weight: 400;
  color: rgb(var(--fg-muted) / 1);
}
.ts-sg-meta {
  font-family: var(--font-mono);
  font-size: 0.66rem;
  color: rgb(var(--fg-muted) / 1);
}
.ts-sugg-note {
  margin: 0.2rem 0.5rem 0.3rem;
  font-size: 0.8rem;
  color: rgb(var(--fg-muted) / 1);
}
.ts-hints {
  list-style: none;
  margin: 0;
  padding: 0 0.25rem;
  display: grid;
  gap: 0.15rem;
}
.ts-hints li {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-height: 1.9rem;
  padding: 0 0.25rem;
  font-size: 0.8rem;
  color: rgb(var(--fg-default) / 1);
}
.ts-hint-tok {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  height: 1.5rem;
  padding: 0 0.55rem;
  border-radius: var(--radius-pill);
  border: 1px solid rgb(var(--accent-warm) / 0.35);
  background: rgb(var(--accent-warm) / 0.12);
  font-size: 0.74rem;
  font-weight: 600;
  white-space: nowrap;
}
.ts-hint-tok b {
  font-family: var(--font-mono);
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgb(var(--accent-warm-text) / 1);
}
@media (max-width: 40rem) {
  .ts-kbd {
    display: none;
  }
  .ts-hint {
    display: none;
  }
  /* Une puce et un mot doivent tenir sur la ligne du champ, avec la croix au bout. */
  .ts-input {
    flex-basis: 5rem;
    min-width: 5rem;
  }
  .ts-hints {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ts-chip,
  .ts-sugg {
    animation: none;
  }
  .ts-ico--spin {
    animation-duration: 2s;
  }
}
</style>
