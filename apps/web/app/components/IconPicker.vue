<template>
  <!-- Phosphor icon picker — text input + popover grid.
       The preview icon on the left is the picker's trigger: clicking
       it toggles the popover. The text input stays editable for power
       users who want to paste an icon name we didn't curate. The
       popover is teleported to <body> in `position: fixed` so it
       escapes any parent `overflow: hidden` / modal stacking context
       and lands above everything else regardless of where the
       picker sits in the page. -->
  <div ref="rootRef" class="icon-picker" :class="{ 'is-open': open }">
    <div ref="anchorRef" class="icon-picker-control">
      <button
        type="button"
        class="icon-picker-preview"
        :title="previewName"
        :disabled="disabled"
        :aria-expanded="open"
        :aria-label="toggleAriaLabel"
        @click="toggle"
      >
        <Icon :name="previewName" />
      </button>
      <input
        :value="modelValue"
        type="text"
        :placeholder="placeholder"
        :disabled="disabled"
        :maxlength="maxlength"
        class="icon-picker-input"
        @input="onInput"
        @keydown.escape="open = false"
      />
    </div>

    <Teleport to="body">
      <Transition name="icon-picker-panel">
        <div
          v-if="open"
          ref="panelRef"
          class="icon-picker-panel"
          role="dialog"
          :style="panelStyle"
        >
          <input
            ref="searchRef"
            v-model="search"
            type="search"
            :placeholder="searchPlaceholder"
            class="icon-picker-search"
            @keydown.escape="open = false"
          />

          <div v-if="filtered.length === 0" class="icon-picker-empty">
            {{ emptyLabel }}
          </div>

          <ul v-else class="icon-picker-grid">
            <li v-for="entry in filtered" :key="entry.name">
              <button
                type="button"
                class="icon-picker-cell"
                :class="{ 'is-active': entry.name === modelValue }"
                :title="entry.name"
                @click="select(entry.name)"
              >
                <Icon :name="entry.name" class="icon-picker-cell-glyph" />
                <span class="icon-picker-cell-label">{{ entry.label }}</span>
              </button>
            </li>
          </ul>

          <footer class="icon-picker-foot">
            <span class="icon-picker-foot-hint">{{ footerHint }}</span>
            <button
              v-if="modelValue"
              type="button"
              class="icon-picker-clear"
              @click="select('')"
            >
              <Icon name="ph:x-bold" />
              {{ clearLabel }}
            </button>
          </footer>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
/* Curated Phosphor catalogue tuned for the kinds of categories a
   tracker tends to host. The `label` is a human-readable hint
   surfaced under each cell + used as a search alias so a French
   operator typing "musique" lands on `ph:music-notes-bold`. */
interface IconEntry {
  name: string;
  label: string;
}

const ICONS: IconEntry[] = [
  // ── Files / generic ─────────────────────────────────────────
  { name: 'ph:file-zip-bold', label: 'Archive' },
  { name: 'ph:file-bold', label: 'File' },
  { name: 'ph:files-bold', label: 'Files' },
  { name: 'ph:folder-bold', label: 'Folder' },
  { name: 'ph:folder-simple-bold', label: 'Folder simple' },
  { name: 'ph:package-bold', label: 'Package' },
  { name: 'ph:archive-bold', label: 'Archive box' },
  // ── Movies / cinema ─────────────────────────────────────────
  { name: 'ph:film-strip-bold', label: 'Film · cinéma' },
  { name: 'ph:film-reel-bold', label: 'Film reel · cinéma' },
  { name: 'ph:film-slate-bold', label: 'Clap · cinéma' },
  { name: 'ph:popcorn-bold', label: 'Popcorn · cinéma' },
  { name: 'ph:video-camera-bold', label: 'Caméra · video' },
  { name: 'ph:projector-screen-bold', label: 'Projection' },
  // ── TV / series ─────────────────────────────────────────────
  { name: 'ph:television-bold', label: 'Télévision · séries' },
  { name: 'ph:television-simple-bold', label: 'TV simple · séries' },
  { name: 'ph:monitor-bold', label: 'Moniteur' },
  { name: 'ph:monitor-play-bold', label: 'Lecture · stream' },
  // ── Anime / manga ───────────────────────────────────────────
  { name: 'ph:lightning-bold', label: 'Anime · action' },
  { name: 'ph:star-bold', label: 'Star · anime' },
  { name: 'ph:fire-bold', label: 'Fire · trending' },
  { name: 'ph:sparkle-bold', label: 'Sparkle · highlight' },
  { name: 'ph:ghost-bold', label: 'Ghost · horror · hentai' },
  // ── Games ───────────────────────────────────────────────────
  { name: 'ph:game-controller-bold', label: 'Jeux · gaming' },
  { name: 'ph:puzzle-piece-bold', label: 'Puzzle · jeux' },
  { name: 'ph:cards-bold', label: 'Cartes · jeux' },
  { name: 'ph:dice-five-bold', label: 'Dés · jeux' },
  { name: 'ph:trophy-bold', label: 'Trophy · achievements' },
  // ── Books / reading ─────────────────────────────────────────
  { name: 'ph:book-bold', label: 'Livre · ebook' },
  { name: 'ph:book-open-bold', label: 'Livre ouvert · livres' },
  { name: 'ph:books-bold', label: 'Bibliothèque' },
  { name: 'ph:newspaper-bold', label: 'Magazine · presse' },
  { name: 'ph:scroll-bold', label: 'Parchemin · livres' },
  // ── Music ───────────────────────────────────────────────────
  { name: 'ph:music-note-bold', label: 'Musique · note' },
  { name: 'ph:music-notes-bold', label: 'Musique · notes' },
  { name: 'ph:headphones-bold', label: 'Casque · audio' },
  { name: 'ph:vinyl-record-bold', label: 'Vinyle · musique' },
  { name: 'ph:speaker-high-bold', label: 'Speaker · audio' },
  { name: 'ph:microphone-bold', label: 'Micro · podcast' },
  // ── Software / OS / tech ────────────────────────────────────
  { name: 'ph:terminal-bold', label: 'Terminal · software' },
  { name: 'ph:code-bold', label: 'Code · software' },
  { name: 'ph:cube-bold', label: 'Cube · 3D · software' },
  { name: 'ph:apple-logo-bold', label: 'Apple · macOS · iOS' },
  { name: 'ph:windows-logo-bold', label: 'Windows · PC' },
  { name: 'ph:linux-logo-bold', label: 'Linux' },
  { name: 'ph:android-logo-bold', label: 'Android' },
  // ── Photos / images ─────────────────────────────────────────
  { name: 'ph:image-bold', label: 'Image' },
  { name: 'ph:image-square-bold', label: 'Image square' },
  { name: 'ph:images-bold', label: 'Images · photos' },
  { name: 'ph:camera-bold', label: 'Caméra · photo' },
  // ── Adult / mature ──────────────────────────────────────────
  { name: 'ph:heart-bold', label: 'Coeur · adult' },
  { name: 'ph:eye-slash-bold', label: 'Eye-slash · adult' },
  { name: 'ph:flame-bold', label: 'Flame · adult · hot' },
  // ── Sports ──────────────────────────────────────────────────
  { name: 'ph:soccer-ball-bold', label: 'Football' },
  { name: 'ph:football-bold', label: 'Foot américain' },
  { name: 'ph:basketball-bold', label: 'Basket' },
  { name: 'ph:tennis-ball-bold', label: 'Tennis' },
  // ── Education / docs ────────────────────────────────────────
  { name: 'ph:graduation-cap-bold', label: 'Diplôme · éducation' },
  { name: 'ph:student-bold', label: 'Étudiant' },
  { name: 'ph:file-pdf-bold', label: 'PDF' },
  { name: 'ph:file-text-bold', label: 'Texte · doc' },
  // ── Lifestyle / misc ────────────────────────────────────────
  { name: 'ph:cooking-pot-bold', label: 'Cuisine' },
  { name: 'ph:coffee-bold', label: 'Café' },
  { name: 'ph:hammer-bold', label: 'Bricolage · outils' },
  { name: 'ph:rocket-bold', label: 'Rocket · sci-fi' },
  { name: 'ph:planet-bold', label: 'Planète · sci-fi · espace' },
  { name: 'ph:globe-bold', label: 'Globe · monde' },
];

const props = withDefaults(
  defineProps<{
    modelValue: string;
    placeholder?: string;
    searchPlaceholder?: string;
    emptyLabel?: string;
    clearLabel?: string;
    footerHint?: string;
    toggleAriaLabel?: string;
    disabled?: boolean;
    maxlength?: number;
    /** Icon shown in the preview box when `modelValue` is empty. */
    fallbackIcon?: string;
  }>(),
  {
    placeholder: 'ph:film-strip-bold',
    searchPlaceholder: 'Rechercher…',
    emptyLabel: 'Aucune icône.',
    clearLabel: 'Effacer',
    footerHint: 'Ou tapez un nom Phosphor.',
    toggleAriaLabel: 'Ouvrir le sélecteur d\'icônes',
    disabled: false,
    maxlength: 64,
    fallbackIcon: 'ph:dots-three-bold',
  }
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const open = ref(false);
const search = ref('');
const rootRef = ref<HTMLElement | null>(null);
const anchorRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const searchRef = ref<HTMLInputElement | null>(null);

const previewName = computed(
  () => props.modelValue?.trim() || props.fallbackIcon
);

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return ICONS;
  return ICONS.filter(
    (e) =>
      e.name.toLowerCase().includes(q) || e.label.toLowerCase().includes(q)
  );
});

function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement).value);
}

function toggle() {
  if (props.disabled) return;
  open.value = !open.value;
  if (open.value) {
    nextTick(() => {
      updatePanelPosition();
      searchRef.value?.focus();
    });
  }
}

function select(icon: string) {
  emit('update:modelValue', icon);
  open.value = false;
  search.value = '';
}

// ── Panel positioning ────────────────────────────────────────
// The panel is teleported to <body> so it doesn't get clipped by
// any parent `overflow: hidden` (the admin modal is the worst
// offender here — its `overflow-y: auto` would otherwise clip the
// dropdown to the modal body). Position is recomputed on open,
// scroll, resize, and when the input value changes — the latter
// because typing might shift the anchor inside a wrapping form.
const panelStyle = ref<Record<string, string>>({});

function updatePanelPosition() {
  const anchor = anchorRef.value;
  const panel = panelRef.value;
  if (!anchor) return;

  const rect = anchor.getBoundingClientRect();
  const gap = 6;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const panelW = panel?.offsetWidth ?? 340;
  const panelH = panel?.offsetHeight ?? 320;

  // Default: open below the anchor. Flip above when the panel
  // would overflow the bottom of the viewport.
  const fitsBelow = rect.bottom + gap + panelH <= vh;
  const top = fitsBelow
    ? rect.bottom + gap
    : Math.max(8, rect.top - gap - panelH);

  // Width: prefer matching the anchor's width so the panel feels
  // anchored to it; clamp upward so it never gets too narrow on
  // small inputs, and clamp downward so it never overflows the
  // viewport on wide ones.
  const minWidth = Math.min(320, vw - 16);
  const maxWidth = Math.min(440, vw - 16);
  const width = Math.max(minWidth, Math.min(maxWidth, rect.width));

  // Left: align with the anchor, then clamp to keep the panel on
  // screen (8 px breathing room on each side).
  let left = rect.left;
  if (left + width > vw - 8) left = vw - 8 - width;
  if (left < 8) left = 8;

  panelStyle.value = {
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
    width: `${Math.round(width)}px`,
  };
}

watch(open, (v) => {
  if (v) {
    nextTick(updatePanelPosition);
    window.addEventListener('scroll', updatePanelPosition, true);
    window.addEventListener('resize', updatePanelPosition);
  } else {
    window.removeEventListener('scroll', updatePanelPosition, true);
    window.removeEventListener('resize', updatePanelPosition);
    search.value = '';
  }
});

// Click outside to close. Listens to `mousedown` so the popover
// dismisses before any click handler inside the parent form has a
// chance to mis-fire. The panel lives in <body> via Teleport so we
// have to check both the root AND the panel ref — neither alone
// contains the other in the DOM tree.
function onDocPointer(e: MouseEvent) {
  if (!open.value) return;
  const target = e.target as Node;
  if (rootRef.value?.contains(target)) return;
  if (panelRef.value?.contains(target)) return;
  open.value = false;
}
onMounted(() => document.addEventListener('mousedown', onDocPointer));
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocPointer);
  window.removeEventListener('scroll', updatePanelPosition, true);
  window.removeEventListener('resize', updatePanelPosition);
});
</script>

<style scoped>
.icon-picker {
  position: relative;
}

/* ── Control row (preview button + input) ────────────────────── */
.icon-picker-control {
  display: flex;
  align-items: stretch;
  gap: 0;
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.35rem;
  background: rgb(var(--bg-inset, var(--bg-elevated)));
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.icon-picker.is-open .icon-picker-control,
.icon-picker-control:focus-within {
  border-color: rgb(var(--fg-default) / 0.4);
  box-shadow: 0 0 0 3px rgba(212, 167, 52, 0.12);
}
/* Preview is the picker's primary trigger now — styled as an
   interactive button rather than a passive box so the cursor and
   hover state telegraph "click me". */
.icon-picker-preview {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  flex-shrink: 0;
  border: 0;
  border-right: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-default));
  font-size: 1.25rem;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.icon-picker-preview:hover:not(:disabled) {
  background: rgb(var(--bg-hover, var(--bg-elevated)));
  color: rgb(var(--fg-strong));
}
.icon-picker.is-open .icon-picker-preview {
  background: rgba(212, 167, 52, 0.12);
  color: #d4a734;
}
.icon-picker-preview:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.icon-picker-input {
  flex: 1 1 auto;
  min-width: 0;
  background: transparent;
  border: 0;
  outline: 0;
  padding: 0.55rem 0.7rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.875rem;
  letter-spacing: 0.04em;
  color: rgb(var(--fg-default));
}
.icon-picker-input:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.icon-picker-input::placeholder {
  color: rgb(var(--fg-faint));
}
</style>

<!-- ── Teleported panel styles ──────────────────────────────────
     Lives outside the scoped block because the panel is teleported
     to <body>, where scoped attribute selectors don't reach. The
     class names are unique enough (`icon-picker-panel`, etc.) that
     they don't collide with anything else. -->
<style>
.icon-picker-panel {
  position: fixed;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  padding: 0.7rem;
  background: rgb(var(--bg-surface));
  border: 1px solid rgb(var(--line-strong));
  border-radius: 0.5rem;
  box-shadow:
    0 24px 60px -20px rgba(0, 0, 0, 0.7),
    0 6px 16px -8px rgba(0, 0, 0, 0.5),
    inset 0 1px 0 rgba(255, 255, 255, 0.04);
  max-height: 24rem;
}
.icon-picker-panel-enter-active,
.icon-picker-panel-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.2s cubic-bezier(0.22, 1, 0.36, 1);
}
.icon-picker-panel-enter-from,
.icon-picker-panel-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.icon-picker-search {
  width: 100%;
  background: rgb(var(--bg-inset, var(--bg-elevated)));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.35rem;
  padding: 0.45rem 0.7rem;
  font-size: 0.85rem;
  color: rgb(var(--fg-default));
  outline: 0;
  transition: border-color 0.15s ease;
}
.icon-picker-search:focus {
  border-color: rgb(var(--fg-default) / 0.4);
}
.icon-picker-search::placeholder {
  color: rgb(var(--fg-faint));
}

.icon-picker-empty {
  text-align: center;
  padding: 2rem 1rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}

.icon-picker-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
  gap: 0.4rem;
  overflow-y: auto;
  max-height: 15rem;
  scrollbar-width: thin;
  scrollbar-color: rgb(var(--line-strong)) transparent;
}
.icon-picker-grid::-webkit-scrollbar {
  width: 8px;
}
.icon-picker-grid::-webkit-scrollbar-thumb {
  background: rgb(var(--line-strong));
  border-radius: 4px;
}

.icon-picker-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.2rem;
  padding: 0.55rem 0.4rem 0.4rem;
  width: 100%;
  border: 1px solid transparent;
  border-radius: 0.35rem;
  background: transparent;
  color: rgb(var(--fg-default));
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease,
    transform 0.18s ease;
  text-align: center;
}
.icon-picker-cell:hover {
  background: rgb(var(--bg-elevated));
  border-color: rgb(var(--line-default));
  transform: translateY(-1px);
}
.icon-picker-cell.is-active {
  background: rgba(212, 167, 52, 0.12);
  border-color: rgba(212, 167, 52, 0.45);
  color: #d4a734;
}
.icon-picker-cell-glyph {
  font-size: 1.4rem;
}
.icon-picker-cell-label {
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 8.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  max-width: 100%;
}

.icon-picker-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px dashed rgb(var(--line-default));
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.icon-picker-foot-hint {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.icon-picker-clear {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  background: transparent;
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.25rem;
  color: rgb(var(--fg-muted));
  padding: 0.25rem 0.55rem;
  font-family: inherit;
  font-size: 9.5px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  cursor: pointer;
  transition:
    color 0.15s ease,
    border-color 0.15s ease,
    background 0.15s ease;
}
.icon-picker-clear:hover {
  color: rgb(var(--danger));
  border-color: rgb(var(--danger) / 0.55);
  background: rgb(var(--danger) / 0.1);
}
</style>
