<script setup lang="ts">
/**
 * Le menu du catalogue, sous « Torrents » dans l'en-tête.
 *
 * Il s'ouvre au survol avec une intention (90 ms pour entrer, 220 ms de grâce
 * pour en sortir), au clavier par le chevron ou la flèche bas, et au doigt par
 * le chevron seul : le lien, lui, mène toujours au catalogue. Dedans, ce qui
 * fait gagner un clic : les raccourcis (tout, du jour, gratuits, favoris), les
 * recherches récentes de ce navigateur, puis les familles de catégories et
 * leurs sous-catégories, chacune un lien direct vers le catalogue filtré.
 *
 * Les catégories ne sont demandées qu'à la première ouverture : l'en-tête est
 * sur toutes les pages, le menu ne sert que sur certaines.
 */
import { getCategoryIcon } from '~/utils/categoryIcon';
import type { RecentSearch } from '~/components/search/TokenSearch.vue';

interface Category {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  icon?: string | null;
  type?: string | null;
  subcategories?: Category[];
}

defineProps<{ label: string; icon: string }>();
const { t } = useI18n();
const route = useRoute();

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const caret = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const panelId = useId();
/* Le panneau s'aligne à gauche du déclencheur ; s'il dépasse l'écran à droite, il recule d'autant. */
const shift = ref(0);

const isActive = computed(() => route.path === '/torrents' || route.path.startsWith('/torrents/'));

/* ── Les données : à la première ouverture seulement ─────────────────────── */
const {
  data: categories,
  execute: loadCategories,
  status,
} = useFetch<Category[]>('/api/categories', { immediate: false, server: false, lazy: true, default: () => [] });
const loading = computed(() => status.value === 'pending');
const families = computed(() => {
  const all = categories.value ?? [];
  const roots = all.filter((c) => !c.parentId);
  return roots.map((r) => ({
    ...r,
    subcategories: (r.subcategories ?? all.filter((c) => c.parentId === r.id)).slice().sort((a, b) => a.name.localeCompare(b.name)),
  }));
});
function hueOf(c: Category): number {
  let h = 0;
  for (const ch of c.slug || c.name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
const catLink = (id: string) => ({ path: '/torrents', query: { c: id } });

const quick = computed(() => [
  { key: 'all', icon: 'ph:squares-four-bold', label: t('nav.torrentsMenu.all'), hint: t('nav.torrentsMenu.allHint'), to: { path: '/torrents' } },
  { key: 'today', icon: 'ph:sun-bold', label: t('nav.torrentsMenu.today'), hint: t('nav.torrentsMenu.todayHint'), to: { path: '/torrents', query: { o: 'today', v: 'simple' } } },
  { key: 'free', icon: 'ph:gift-bold', label: t('nav.torrentsMenu.free'), hint: t('nav.torrentsMenu.freeHint'), to: { path: '/torrents', query: { o: 'free', v: 'simple' } } },
  { key: 'favorites', icon: 'ph:star-bold', label: t('nav.torrentsMenu.favorites'), hint: t('nav.torrentsMenu.favoritesHint'), to: { path: '/torrents', query: { o: 'favorites' } } },
]);

/* Les recherches récentes de ce navigateur : la même réserve que la barre du catalogue. */
const recent = ref<RecentSearch[]>([]);
function readRecent() {
  try {
    const raw = localStorage.getItem('trackarr.recentSearches');
    const parsed = raw ? (JSON.parse(raw) as RecentSearch[]) : [];
    recent.value = Array.isArray(parsed) ? parsed.filter((r) => r && typeof r.label === 'string' && r.query).slice(0, 4) : [];
  } catch {
    recent.value = [];
  }
}

/* ── Ouvrir, fermer, avec une intention ──────────────────────────────────── */
let openTimer: ReturnType<typeof setTimeout> | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
function clearTimers() {
  if (openTimer) clearTimeout(openTimer);
  if (closeTimer) clearTimeout(closeTimer);
  openTimer = closeTimer = null;
}
function show() {
  clearTimers();
  if (open.value) return;
  open.value = true;
  readRecent();
  if (!categories.value?.length && status.value !== 'pending') void loadCategories();
  nextTick(fit);
}
function hide() {
  clearTimers();
  open.value = false;
  shift.value = 0;
}
/* Le dernier pointeur vu sur le chevron : à la souris, le survol a déjà ouvert
   et un clic ne doit pas refermer ; au clavier (detail 0) et au doigt, il bascule. */
let lastPointerType = 'mouse';
function onCaretPointerDown(e: PointerEvent) {
  lastPointerType = e.pointerType || 'mouse';
}
function toggle(e?: MouseEvent) {
  if (!open.value) {
    show();
    return;
  }
  const keyboard = !e || e.detail === 0;
  if (keyboard || lastPointerType === 'touch') hide();
}
function onPointerEnter(e: PointerEvent) {
  if (e.pointerType === 'touch') return;
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  if (!open.value && !openTimer) openTimer = setTimeout(show, 90);
}
function onPointerLeave(e: PointerEvent) {
  if (e.pointerType === 'touch') return;
  if (openTimer) {
    clearTimeout(openTimer);
    openTimer = null;
  }
  if (open.value && !closeTimer) closeTimer = setTimeout(hide, 220);
}
function openFromKeyboard() {
  show();
  nextTick(() => panel.value?.querySelector<HTMLElement>('a')?.focus());
}
function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !open.value) return;
  e.preventDefault();
  hide();
  caret.value?.focus();
}
function onFocusOut() {
  // Le focus part ailleurs : on laisse le navigateur poser le nouveau focus avant de regarder où.
  requestAnimationFrame(() => {
    if (open.value && root.value && !root.value.contains(document.activeElement)) hide();
  });
}
function onDocumentDown(e: PointerEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) hide();
}
function fit() {
  const el = panel.value;
  if (!el) return;
  shift.value = 0;
  const r = el.getBoundingClientRect();
  const over = r.right - (window.innerWidth - 12);
  if (over > 0) shift.value = Math.min(over, r.left - 12);
}

watch(open, (v) => {
  if (!import.meta.client) return;
  if (v) document.addEventListener('pointerdown', onDocumentDown, { capture: true });
  else document.removeEventListener('pointerdown', onDocumentDown, { capture: true });
});
// Une navigation ferme le menu : le lien cliqué a fait son travail.
watch(() => route.fullPath, hide);
onBeforeUnmount(() => {
  clearTimers();
  if (import.meta.client) document.removeEventListener('pointerdown', onDocumentDown, { capture: true });
});
</script>

<template>
  <div
    ref="root"
    class="tm"
    :class="{ 'tm--open': open }"
    @pointerenter="onPointerEnter"
    @pointerleave="onPointerLeave"
    @keydown="onKeydown"
    @focusout="onFocusOut"
  >
    <div class="tm-trigger" :class="{ 'tm-trigger--active': isActive }">
      <NuxtLink to="/torrents" class="tm-link" :title="label" @keydown.down.prevent="openFromKeyboard">
        <Icon :name="icon" class="tm-link-ico" aria-hidden="true" />
        <span class="tm-label">{{ label }}</span>
      </NuxtLink>
      <button
        ref="caret"
        type="button"
        class="tm-caret"
        :aria-expanded="open"
        :aria-controls="open ? panelId : undefined"
        :aria-label="t('nav.torrentsMenu.toggle')"
        @pointerdown="onCaretPointerDown"
        @click="toggle($event)"
        @keydown.down.prevent="openFromKeyboard"
      >
        <Icon name="ph:caret-down-bold" class="tm-caret-ico" aria-hidden="true" />
      </button>
    </div>

    <Transition name="tm">
      <div
        v-if="open"
        :id="panelId"
        ref="panel"
        class="tm-panel"
        role="group"
        :style="{ '--tm-shift': `${shift}px` }"
        :aria-label="t('nav.torrentsMenu.title')"
      >
        <div class="tm-quick">
          <p class="tm-eyebrow">{{ t('nav.torrentsMenu.quick') }}</p>
          <ul class="tm-list">
            <li v-for="q in quick" :key="q.key">
              <NuxtLink :to="q.to" class="tm-q">
                <span class="tm-q-ico"><Icon :name="q.icon" aria-hidden="true" /></span>
                <span class="tm-q-txt">
                  <span class="tm-q-l">{{ q.label }}</span>
                  <span class="tm-q-h">{{ q.hint }}</span>
                </span>
              </NuxtLink>
            </li>
          </ul>
          <template v-if="recent.length">
            <p class="tm-eyebrow tm-eyebrow--gap">{{ t('nav.torrentsMenu.recent') }}</p>
            <ul class="tm-recent">
              <li v-for="r in recent" :key="r.label">
                <NuxtLink :to="{ path: '/torrents', query: r.query }" class="tm-pill" :title="r.label">
                  <Icon name="ph:clock-counter-clockwise-bold" aria-hidden="true" />
                  <span class="tm-pill-l">{{ r.label }}</span>
                </NuxtLink>
              </li>
            </ul>
          </template>
        </div>

        <div class="tm-fams">
          <template v-if="loading && !families.length">
            <div v-for="i in 4" :key="i" class="tm-skel" aria-hidden="true">
              <span class="tm-skel-h" />
              <span class="tm-skel-l" />
              <span class="tm-skel-l" />
              <span class="tm-skel-l tm-skel-l--short" />
            </div>
            <p class="sr-only" role="status">{{ t('nav.torrentsMenu.loading') }}</p>
          </template>
          <section v-for="fam in families" :key="fam.id" class="tm-fam">
            <NuxtLink :to="catLink(fam.id)" class="tm-fam-h">
              <span class="tm-fam-ico" :style="{ '--hue': hueOf(fam) }"><Icon :name="getCategoryIcon(fam)" aria-hidden="true" /></span>
              <span class="tm-fam-name">{{ fam.name }}</span>
            </NuxtLink>
            <ul v-if="fam.subcategories.length" class="tm-kids">
              <li v-for="kid in fam.subcategories" :key="kid.id">
                <NuxtLink :to="catLink(kid.id)" class="tm-kid">{{ kid.name }}</NuxtLink>
              </li>
            </ul>
          </section>
          <p v-if="!loading && !families.length" class="tm-empty">
            {{ status === 'error' ? t('nav.torrentsMenu.error') : t('nav.torrentsMenu.empty') }}
          </p>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* ── Le déclencheur : le lien de la barre, et un chevron qui lui est collé ── */
.tm {
  position: relative;
  display: inline-flex;
}
.tm-trigger {
  display: inline-flex;
  align-items: center;
  border-radius: 0.25rem;
  color: rgb(var(--fg-muted) / 1);
  transition:
    background-color var(--dur-1) var(--ease-standard),
    color var(--dur-1) var(--ease-standard);
}
.tm-trigger:hover,
.tm--open .tm-trigger {
  background: rgb(var(--fg-default) / 0.05);
  color: rgb(var(--fg-default) / 1);
}
.tm-trigger--active {
  background: rgb(var(--fg-default) / 0.1);
  color: rgb(var(--fg-strong) / 1);
}
.tm-link {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.25rem 0.375rem 0.625rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: inherit;
  text-decoration: none;
  border-radius: 0.25rem;
}
.tm-link-ico {
  width: 1rem;
  height: 1rem;
}
.tm-label {
  display: none;
}
@media (min-width: 96rem) {
  .tm-label {
    display: inline;
  }
}
.tm-caret {
  display: inline-grid;
  place-items: center;
  width: 1.5rem;
  height: 1.75rem;
  margin-right: 0.125rem;
  border-radius: 0.25rem;
  color: inherit;
}
.tm-caret-ico {
  width: 0.6rem;
  height: 0.6rem;
  transition: transform var(--dur-2) var(--ease-standard);
}
.tm--open .tm-caret-ico {
  transform: rotate(180deg);
}

/* ── Le panneau ──────────────────────────────────────────────────────────── */
.tm-panel {
  position: absolute;
  top: calc(100% + 0.4rem);
  left: 0;
  z-index: 40;
  display: grid;
  grid-template-columns: 15rem minmax(0, 1fr);
  gap: 0 1.25rem;
  width: min(62rem, calc(100vw - 1.5rem));
  margin-left: calc(-1 * var(--tm-shift, 0px));
  padding: 1rem 1.25rem 1.1rem;
  border: 1px solid rgb(var(--line-strong) / 1);
  border-radius: var(--radius-lg);
  background: rgb(var(--bg-elevated) / 0.97);
  backdrop-filter: blur(12px);
  box-shadow: var(--shadow-overlay);
  color: rgb(var(--fg-default) / 1);
  text-align: left;
  cursor: default;
}
/* Le pont : la bande entre le déclencheur et le panneau reste « dedans » pour le survol. */
.tm-panel::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: -0.5rem;
  height: 0.5rem;
}
/* Le repère doré au bord haut, sous le déclencheur : d'où vient ce panneau. */
.tm-panel::after {
  content: '';
  position: absolute;
  top: -1px;
  left: calc(var(--tm-shift, 0px) + 0.75rem);
  width: 2.5rem;
  height: 2px;
  border-radius: 1px;
  background: rgb(var(--accent-warm) / 1);
}
.tm-eyebrow {
  margin: 0 0 0.5rem;
  font-family: var(--font-mono);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted) / 1);
}
.tm-eyebrow--gap {
  margin-top: 1rem;
}
.tm-list,
.tm-kids,
.tm-recent {
  list-style: none;
  margin: 0;
  padding: 0;
}

/* Les raccourcis : une tuile, un libellé, un mot d'explication. */
.tm-quick {
  padding-right: 1.25rem;
  border-right: 1px solid rgb(var(--line-default) / 1);
}
.tm-list {
  display: grid;
  gap: 0.15rem;
}
.tm-q {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.35rem 0.5rem 0.35rem 0.35rem;
  border-radius: var(--radius-sm);
  color: inherit;
  text-decoration: none;
  transition: background-color var(--dur-1) var(--ease-standard);
}
.tm-q:hover {
  background: rgb(var(--bg-hover) / 1);
}
.tm-q-ico {
  flex: none;
  display: inline-grid;
  place-items: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: var(--radius-sm);
  background: rgb(var(--bg-inset) / 1);
  color: rgb(var(--fg-muted) / 1);
  transition: color var(--dur-1) var(--ease-standard);
}
.tm-q-ico :deep(svg) {
  width: 0.9rem;
  height: 0.9rem;
}
.tm-q:hover .tm-q-ico {
  color: rgb(var(--accent-warm-text) / 1);
}
.tm-q-txt {
  display: grid;
  min-width: 0;
}
.tm-q-l {
  font-size: 0.8125rem;
  font-weight: 600;
  line-height: 1.25;
  color: rgb(var(--fg-strong) / 1);
}
.tm-q-h {
  font-size: 0.6875rem;
  line-height: 1.3;
  color: rgb(var(--fg-muted) / 1);
}
.tm-recent {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.tm-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  max-width: 100%;
  height: 1.6rem;
  padding: 0 0.55rem 0 0.45rem;
  border: 1px solid rgb(var(--line-default) / 1);
  border-radius: var(--radius-pill);
  background: rgb(var(--bg-inset) / 1);
  font-size: 0.75rem;
  color: rgb(var(--fg-default) / 1);
  text-decoration: none;
  transition: border-color var(--dur-1) var(--ease-standard);
}
.tm-pill:hover {
  border-color: rgb(var(--fg-muted) / 1);
}
.tm-pill :deep(svg) {
  flex: none;
  width: 0.7rem;
  height: 0.7rem;
  color: rgb(var(--fg-muted) / 1);
}
.tm-pill-l {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Les familles : en colonnes, chaque famille d'un bloc, ses enfants alignés sous son nom. */
.tm-fams {
  columns: 3 11rem;
  column-gap: 1.5rem;
}
.tm-fam {
  break-inside: avoid;
  margin-bottom: 0.9rem;
}
.tm-fam-h {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.2rem 0.35rem 0.2rem 0.2rem;
  border-radius: var(--radius-sm);
  color: rgb(var(--fg-strong) / 1);
  text-decoration: none;
}
.tm-fam-h:hover .tm-fam-name {
  text-decoration: underline;
  text-decoration-color: rgb(var(--accent-warm) / 1);
  text-underline-offset: 0.2em;
}
.tm-fam-ico {
  flex: none;
  display: inline-grid;
  place-items: center;
  width: 1.6rem;
  height: 1.6rem;
  border-radius: var(--radius-sm);
  background: hsl(var(--hue, 40) 40% 50% / 0.16);
  color: rgb(var(--fg-default) / 1);
}
.tm-fam-ico :deep(svg) {
  width: 0.85rem;
  height: 0.85rem;
}
.tm-fam-name {
  font-size: 0.8125rem;
  font-weight: 600;
  line-height: 1.3;
}
.tm-kids {
  margin-top: 0.15rem;
  padding-left: 2.15rem;
}
.tm-kid {
  display: block;
  padding: 0.25rem 0.4rem;
  margin-left: -0.4rem;
  border-radius: var(--radius-xs);
  font-size: 0.8125rem;
  line-height: 1.3;
  color: rgb(var(--fg-muted) / 1);
  text-decoration: none;
  transition:
    color var(--dur-1) var(--ease-standard),
    background-color var(--dur-1) var(--ease-standard);
}
.tm-kid:hover {
  color: rgb(var(--fg-strong) / 1);
  background: rgb(var(--bg-hover) / 1);
}
.tm-empty {
  margin: 0;
  font-size: 0.8125rem;
  color: rgb(var(--fg-muted) / 1);
}

/* Le squelette du premier chargement : la forme des familles, sans les mots. */
.tm-skel {
  display: grid;
  gap: 0.4rem;
  break-inside: avoid;
  margin-bottom: 1rem;
}
.tm-skel-h,
.tm-skel-l {
  display: block;
  height: 0.75rem;
  border-radius: var(--radius-xs);
  background: rgb(var(--fg-default) / 0.08);
  animation: tm-pulse 1.2s ease-in-out infinite;
}
.tm-skel-h {
  width: 60%;
  height: 1rem;
}
.tm-skel-l {
  width: 80%;
  margin-left: 2.15rem;
}
.tm-skel-l--short {
  width: 50%;
}
@keyframes tm-pulse {
  50% {
    opacity: 0.45;
  }
}

/* ── L'entrée ────────────────────────────────────────────────────────────── */
.tm-enter-active {
  transition:
    opacity var(--dur-2) var(--ease-emphasis),
    transform var(--dur-2) var(--ease-emphasis);
}
.tm-leave-active {
  transition:
    opacity var(--dur-1) var(--ease-standard),
    transform var(--dur-1) var(--ease-standard);
}
.tm-enter-from,
.tm-leave-to {
  opacity: 0;
  transform: translateY(-0.3rem);
}
@media (prefers-reduced-motion: reduce) {
  .tm-enter-active,
  .tm-leave-active,
  .tm-trigger,
  .tm-caret-ico,
  .tm-q,
  .tm-q-ico,
  .tm-pill,
  .tm-kid {
    transition: none;
  }
  .tm-skel-h,
  .tm-skel-l {
    animation: none;
  }
}
</style>
