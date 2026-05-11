<template>
  <!--
    /admin/tags — palette / nuancier.

    Each tag carries a colour. So instead of rendering them as
    pills on a grey list (the previous shape), this page treats
    them like a designer's swatch book: full-colour cards stacked
    in a grid, with the tag's hex as the dominant visual element.
    Foreground text picks black or white via a YIQ luma test so
    every swatch stays legible.

    The page belongs to the admin gold-thread family (rail, mono
    numbered blocks, hairline accents) but it inevitably reads
    differently — the dominant tone here is whatever palette the
    operator has built, not the gold from the other surfaces.
  -->
  <div class="adm">
    <p class="adm-intro">{{ $t('admin.tags.intro') }}</p>

    <!-- ── Palette ribbon ─────────────────────────────────────── -->
    <!--
      A horizontal strip of every tag's colour, used as both a
      snapshot AND an at-a-glance preview of the palette. Each
      swatch animates in with a quick stagger so opening the page
      "paints" the row left-to-right.
    -->
    <section v-if="tags && tags.length > 0" class="ribbon">
      <span class="ribbon-eyebrow">
        <span class="ribbon-eyebrow-rule" aria-hidden="true" />
        {{ $t('admin.tags.snapshot.palette') }}
      </span>
      <div class="ribbon-swatches" :aria-label="$t('admin.tags.snapshot.palette')">
        <span
          v-for="(tag, i) in tags"
          :key="tag.id"
          class="ribbon-swatch"
          :style="{
            background: tag.color,
            /* Cap the stagger index at 60 so the ribbon finishes
               its reveal in under a second even with hundreds of
               tags — beyond that they all pop in together. */
            '--stagger': `${Math.min(i, 60) * 12}ms`,
          }"
          :title="`${tag.name} · ${tag.color}`"
        />
      </div>
      <span class="ribbon-count tabular-nums">
        <strong>{{ tags.length }}</strong>
        {{ $t('admin.tags.snapshot.tags', tags.length, { n: tags.length }) }}
      </span>
    </section>

    <!-- ── Section 01 — Forge a new tag ──────────────────────── -->
    <section class="block">
      <header class="block-head">
        <span class="block-num">01</span>
        <div class="block-id">
          <h2>{{ $t('admin.tags.forge.title') }}</h2>
          <p>{{ $t('admin.tags.forge.intro') }}</p>
        </div>
      </header>

      <form class="forge" @submit.prevent="createTag">
        <label class="forge-field">
          <span class="forge-label">{{ $t('admin.tags.name') }}</span>
          <input
            v-model="draft.name"
            type="text"
            class="forge-input"
            :placeholder="$t('admin.tags.namePlaceholder')"
            maxlength="32"
            required
          />
        </label>

        <label class="forge-field">
          <span class="forge-label">{{ $t('admin.tags.slug') }}</span>
          <input
            v-model="draft.slug"
            type="text"
            class="forge-input forge-input--mono"
            :placeholder="$t('admin.tags.slugPlaceholder')"
            maxlength="32"
            required
          />
        </label>

        <label class="forge-field forge-field--colour">
          <span class="forge-label">{{ $t('admin.tags.color') }}</span>
          <div class="forge-colour">
            <!-- The browser's native colour picker, but styled so
                 only the swatch shows (the surrounding chrome is
                 hidden). Clicking the swatch pops the OS picker.
                 The swatch doubles as the live preview — it's the
                 only colour preview the row needs. -->
            <label class="forge-colour-swatch" :style="{ background: draft.color }">
              <input
                v-model="draft.color"
                type="color"
                class="forge-colour-input"
                :aria-label="$t('admin.tags.color')"
              />
            </label>
            <input
              v-model="draft.color"
              type="text"
              class="forge-input forge-input--mono"
              :placeholder="$t('admin.tags.colorPlaceholder')"
              pattern="#[0-9a-fA-F]{6}"
            />
          </div>
        </label>

        <button
          type="submit"
          class="forge-submit"
          :disabled="!draft.name || !draft.slug || isCreating"
        >
          <Icon
            :name="isCreating ? 'ph:circle-notch' : 'ph:plus-bold'"
            :class="isCreating ? 'spin' : ''"
          />
          <span>{{ $t('admin.tags.create') }}</span>
        </button>
      </form>
    </section>

    <!-- ── Section 02 — Palette ─────────────────────────────── -->
    <section class="block">
      <header class="block-head">
        <span class="block-num">02</span>
        <div class="block-id">
          <h2>{{ $t('admin.tags.palette.title') }}</h2>
          <p>{{ $t('admin.tags.palette.intro') }}</p>
        </div>
        <span v-if="tags && tags.length > 0" class="block-meta">
          <strong>{{ filteredTags.length }}</strong>
          <template v-if="filterText && filteredTags.length !== tags.length">
            / {{ tags.length }}
          </template>
          {{ $t('admin.tags.snapshot.tags', tags.length, { n: tags.length }) }}
        </span>
      </header>

      <!--
        Search bar — local filter on name + slug + hex. Tags can
        grow into the hundreds, so even a single text input is
        more useful than scrolling a flat palette. We also expose
        an "Aa" toggle that flips name-only vs name+slug matching
        so the operator can disambiguate when names overlap.
      -->
      <div v-if="tags && tags.length > 0" class="palette-toolbar">
        <div class="palette-search">
          <Icon name="ph:magnifying-glass" />
          <input
            v-model="filterText"
            type="text"
            :placeholder="$t('admin.tags.searchPlaceholder')"
          />
          <button
            v-if="filterText"
            type="button"
            class="palette-search-clear"
            :title="$t('common.clear')"
            @click="filterText = ''"
          >
            <Icon name="ph:x-bold" />
          </button>
        </div>
      </div>

      <ul v-if="filteredTags.length > 0" class="palette">
        <li
          v-for="(tag, i) in filteredTags"
          :key="tag.id"
          class="chip"
          :style="{
            background: tag.color,
            color: contrastColor(tag.color),
            '--chip-shadow': hexToRgba(tag.color, 0.4),
            '--stagger': `${Math.min(i, 30) * 18}ms`,
          }"
        >
          <span class="chip-body" :title="`${tag.name} · ${tag.slug} · ${tag.color}`">
            <strong class="chip-name">{{ tag.name }}</strong>
            <span class="chip-slug">{{ tag.slug }}</span>
          </span>
          <button
            type="button"
            class="chip-strike"
            :title="$t('admin.tags.deleteAction')"
            :style="{
              color: contrastColor(tag.color),
              '--strike-bg': contrastColor(tag.color) === '#0a0a0a'
                ? 'rgba(0, 0, 0, 0.18)'
                : 'rgba(255, 255, 255, 0.24)',
            }"
            @click="deleteTag(tag)"
          >
            <Icon name="ph:x-bold" />
          </button>
        </li>
      </ul>

      <div v-else-if="tags && tags.length > 0" class="palette-empty palette-empty--filter">
        <Icon name="ph:magnifying-glass-minus-bold" class="palette-empty-icon" />
        <p class="palette-empty-text">{{ $t('admin.tags.noMatch') }}</p>
        <button type="button" class="palette-empty-clear" @click="filterText = ''">
          {{ $t('common.clear') }}
        </button>
      </div>

      <div v-else class="palette-empty">
        <Icon name="ph:palette-bold" class="palette-empty-icon" />
        <p class="palette-empty-text">{{ $t('admin.tags.empty') }}</p>
        <p class="palette-empty-hint">{{ $t('admin.tags.emptyHint') }}</p>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
const { t } = useI18n();

interface Tag {
  id: string;
  name: string;
  slug: string;
  color: string;
}

const { data: tags, refresh } = await useFetch<Tag[]>('/api/tags');
const notifications = useNotificationStore();
const confirm = useConfirm();

// ── Search ───────────────────────────────────────────────────
// Local filter — `/api/tags` already returns the full list, so
// there's nothing to gain from a server round-trip. Match on
// name + slug + hex so the operator can find a tag by colour
// too (e.g. typing `#d4` to find the gold-ish swatches).
const filterText = ref('');
const filteredTags = computed(() => {
  const list = tags.value ?? [];
  const q = filterText.value.trim().toLowerCase();
  if (!q) return list;
  return list.filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      t.slug.toLowerCase().includes(q) ||
      t.color.toLowerCase().includes(q),
  );
});

// ── Forge state ───────────────────────────────────────────────
const isCreating = ref(false);
const draft = reactive({
  name: '',
  slug: '',
  color: '#d4a734',
});

// Auto-derive the slug from the name while the user is typing,
// but stop the moment they edit the slug field by hand. We track
// "is the slug dirty?" via a flag rather than diffing strings so
// editing back to the auto-derived value doesn't re-arm the
// derivation.
const slugDirty = ref(false);
watch(
  () => draft.name,
  (name) => {
    if (slugDirty.value) return;
    draft.slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  },
);
watch(
  () => draft.slug,
  (slug, prev) => {
    // Heuristic: if the slug changes to something that isn't the
    // auto-derived form of the current name, the user is editing
    // it manually.
    const derived = draft.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (slug !== derived && slug !== prev) slugDirty.value = true;
    if (slug === '') slugDirty.value = false;
  },
);

async function createTag() {
  if (!draft.name || !draft.slug) return;
  isCreating.value = true;
  try {
    await $fetch('/api/admin/tags', {
      method: 'POST',
      body: { ...draft },
    });
    notifications.success(t('admin.tags.created', { name: draft.name }));
    await refresh();
    draft.name = '';
    draft.slug = '';
    draft.color = '#d4a734';
    slugDirty.value = false;
  } catch (err: unknown) {
    notifications.error(
      (err as { data?: { message?: string } })?.data?.message ??
        t('admin.tags.createFailed'),
    );
  } finally {
    isCreating.value = false;
  }
}

// ── Delete ───────────────────────────────────────────────────
async function deleteTag(tag: Tag) {
  const ok = await confirm({
    title: t('admin.tags.deleteConfirmTitle'),
    message: t('admin.tags.deleteConfirmNamed', { name: tag.name }),
    confirmText: t('admin.tags.deleteAction'),
    destructive: true,
  });
  if (!ok) return;
  try {
    await $fetch(`/api/admin/tags/${tag.id}`, { method: 'DELETE' });
    notifications.success(t('admin.tags.deleted'));
    await refresh();
  } catch (err: unknown) {
    notifications.error(
      (err as { data?: { message?: string } })?.data?.message ??
        t('admin.tags.deleteFailed'),
    );
  }
}

// ── Colour helpers ────────────────────────────────────────────

/**
 * Pick black or white text for a given hex background, using the
 * YIQ luminance formula. Cheaper than full WCAG contrast checks
 * and good enough for the swatch labels we render — the brand
 * palette here doesn't have many edge-case greys around 50% luma.
 */
function contrastColor(hex: string): string {
  if (!hex || !hex.startsWith('#')) return '#fff';
  const c = hex.length === 4
    ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    : hex;
  const r = parseInt(c.slice(1, 3), 16);
  const g = parseInt(c.slice(3, 5), 16);
  const b = parseInt(c.slice(5, 7), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 145 ? '#0a0a0a' : '#fafafa';
}

/** Convert `#RRGGBB` to `rgba(r, g, b, alpha)` — used for the
 *  hover shadow that picks up the tag's own colour. */
function hexToRgba(hex: string, alpha: number): string {
  if (!hex || !hex.startsWith('#')) return `rgba(255, 255, 255, ${alpha})`;
  const c = hex.length === 4
    ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    : hex;
  const r = parseInt(c.slice(1, 3), 16);
  const g = parseInt(c.slice(3, 5), 16);
  const b = parseInt(c.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
</script>

<style scoped>
/* ── Page shell ─────────────────────────────────────────────── */
.adm {
  display: flex;
  flex-direction: column;
  gap: 2.25rem;
  position: relative;
}
.adm::before {
  content: '';
  position: absolute;
  left: -0.75rem;
  top: 0;
  bottom: 0;
  width: 1px;
  background: linear-gradient(
    to bottom,
    rgba(212, 167, 52, 0) 0%,
    rgba(212, 167, 52, 0.35) 12%,
    rgba(212, 167, 52, 0.35) 88%,
    rgba(212, 167, 52, 0) 100%
  );
  pointer-events: none;
}

.adm-intro {
  margin: 0;
  font-size: 0.82rem;
  line-height: 1.6;
  color: rgb(var(--fg-muted));
  max-width: 64ch;
}

/* ── Palette ribbon ────────────────────────────────────────── */
.ribbon {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 1rem;
  padding: 0.85rem 1.1rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  position: relative;
}
.ribbon::before {
  content: '';
  position: absolute;
  inset-inline: 1rem;
  top: 0;
  height: 1px;
  background: linear-gradient(
    to right,
    rgba(212, 167, 52, 0.55) 0%,
    rgba(212, 167, 52, 0.15) 70%,
    rgba(212, 167, 52, 0) 100%
  );
}
.ribbon-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  white-space: nowrap;
}
.ribbon-eyebrow-rule {
  display: inline-block;
  width: 14px;
  height: 1px;
  background: #d4a734;
}
.ribbon-swatches {
  display: flex;
  gap: 3px;
  flex-wrap: wrap;
  min-width: 0;
  max-height: 60px;
  overflow: hidden;
  /* Tag counts can climb into the hundreds; capping the ribbon
     at ~3 rows keeps it a snapshot rather than a wall. The
     overflow is silent — the full palette lives in the search-
     filtered list below. */
}
.ribbon-swatch {
  display: inline-block;
  width: 14px;
  height: 14px;
  border-radius: 3px;
  cursor: default;
  /* Staggered fade-in — the row "paints" left to right on first
     load. Cap the stagger index so the 200th tag doesn't take
     6 s to fade in. */
  animation: ribbon-paint 0.28s cubic-bezier(0.2, 0.7, 0.2, 1) backwards;
  animation-delay: var(--stagger, 0ms);
  transition: transform 0.18s ease, box-shadow 0.18s ease;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.25);
}
.ribbon-swatch:hover {
  transform: scale(1.4);
  box-shadow: 0 4px 10px -2px currentColor;
}
@keyframes ribbon-paint {
  from { opacity: 0; transform: scale(0.4) translateY(-4px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}
.ribbon-count {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  white-space: nowrap;
}
.ribbon-count strong {
  color: rgb(var(--fg-strong));
  font-size: 1.05rem;
  letter-spacing: -0.02em;
  margin-right: 0.35rem;
}

/* ── Block scaffold ────────────────────────────────────────── */
.block {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.block-head {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.85rem;
  padding-bottom: 0.85rem;
  border-bottom: 1px solid rgb(var(--line-default));
  position: relative;
}
.block-head::after {
  content: '';
  position: absolute;
  left: 0;
  bottom: -1px;
  width: 40px;
  height: 1px;
  background: #d4a734;
}
.block-num {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.2em;
  color: #d4a734;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgba(212, 167, 52, 0.35);
  padding: 0.3rem 0.55rem;
  border-radius: var(--radius-sm);
}
.block-id h2 {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
}
.block-id p {
  margin: 0.2rem 0 0;
  font-size: 0.78rem;
  color: rgb(var(--fg-muted));
  line-height: 1.5;
}
.block-meta {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  letter-spacing: 0.1em;
  color: rgb(var(--fg-muted));
  text-transform: uppercase;
}
.block-meta strong {
  color: rgb(var(--fg-strong));
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

/* ── Forge form ────────────────────────────────────────────── */
.forge {
  display: grid;
  grid-template-columns: minmax(140px, 1fr) minmax(140px, 1fr) minmax(160px, auto) auto;
  gap: 0.85rem;
  align-items: end;
  padding: 1.1rem 1.2rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  background: rgb(var(--bg-elevated));
}
@media (max-width: 880px) {
  .forge {
    grid-template-columns: 1fr 1fr;
  }
  .forge-field--colour { grid-column: 1 / -1; }
  .forge-submit { grid-column: 1 / -1; justify-self: stretch; }
}
@media (max-width: 520px) {
  .forge {
    grid-template-columns: 1fr;
  }
  .forge-field--colour,
  .forge-submit {
    grid-column: 1;
  }
}

.forge-field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
}
.forge-label {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.forge-input {
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  padding: 0.5rem 0.7rem;
  color: rgb(var(--fg-strong));
  font-size: 0.88rem;
  font-family: inherit;
  width: 100%;
  min-width: 0;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}
.forge-input:focus {
  outline: none;
  border-color: rgba(212, 167, 52, 0.6);
  box-shadow: 0 0 0 3px rgba(212, 167, 52, 0.12);
}
.forge-input--mono {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.82rem;
}
.forge-input::placeholder {
  color: rgb(var(--fg-faint));
  font-style: italic;
}

.forge-colour {
  display: flex;
  align-items: stretch;
  gap: 0.5rem;
}
.forge-colour-swatch {
  position: relative;
  display: inline-block;
  width: 38px;
  height: 38px;
  border-radius: var(--radius-sm);
  border: 1px solid rgb(var(--line-default));
  cursor: pointer;
  overflow: hidden;
  flex-shrink: 0;
  /* Soft outer glow that picks up the swatch colour. */
  box-shadow: 0 0 0 0 currentColor;
  transition: transform 0.18s ease, box-shadow 0.22s ease;
}
.forge-colour-swatch:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 14px -4px rgba(0, 0, 0, 0.5);
}
.forge-colour-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.forge-submit {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  padding: 0.6rem 1rem;
  background: #d4a734;
  border: 1px solid #d4a734;
  color: #1a1a1a;
  border-radius: var(--radius-sm);
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.15s ease;
  height: 38px;
}
.forge-submit:hover:not(:disabled) {
  background: #e8b94e;
  border-color: #e8b94e;
}
.forge-submit:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* ── Palette toolbar (search) ───────────────────────────────── */
.palette-toolbar {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.palette-search {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0 0.7rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}
.palette-search:focus-within {
  border-color: rgba(212, 167, 52, 0.55);
  box-shadow: 0 0 0 3px rgba(212, 167, 52, 0.1);
}
.palette-search > svg {
  color: rgb(var(--fg-muted));
  flex-shrink: 0;
}
.palette-search input {
  flex: 1;
  border: 0;
  background: transparent;
  padding: 0.55rem 0;
  color: rgb(var(--fg-strong));
  font-size: 0.86rem;
  outline: none;
  font-family: inherit;
  min-width: 0;
}
.palette-search input::placeholder {
  color: rgb(var(--fg-faint));
  font-style: italic;
}
.palette-search-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 0;
  color: rgb(var(--fg-muted));
  cursor: pointer;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-sm);
  transition: all 0.15s ease;
}
.palette-search-clear:hover {
  color: rgb(var(--fg-strong));
  background: rgb(var(--bg-hover) / 0.5);
}

/* ── Palette pills ─────────────────────────────────────────── */
/*
 * Compact chip layout — flex-wrap so hundreds of tags wrap
 * naturally without the page turning into a 4-column grid that
 * scrolls forever. Each chip is ~32 px tall, sized to its own
 * content (name + slug), with the delete icon inline rather
 * than overlapping the colour block. Scales gracefully from a
 * dozen tags up to several hundred.
 */
.palette {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.chip {
  display: inline-flex;
  align-items: stretch;
  height: 32px;
  border-radius: 999px;
  overflow: hidden;
  font-family: ui-monospace, SFMono-Regular, monospace;
  cursor: default;
  transition: transform 0.18s cubic-bezier(0.2, 0.7, 0.2, 1),
    box-shadow 0.22s ease;
  animation: chip-in 0.34s cubic-bezier(0.2, 0.7, 0.2, 1) backwards;
  animation-delay: var(--stagger, 0ms);
  /* The chip carries its own coloured shadow on hover, picking
     up the tag's hex — gives the palette some life without
     hammering CPU on hundreds of swatches. */
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.18);
}
@keyframes chip-in {
  from { opacity: 0; transform: translateY(4px) scale(0.92); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.chip:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px -4px var(--chip-shadow, rgba(0, 0, 0, 0.5)),
    inset 0 0 0 1px rgba(0, 0, 0, 0.2);
}

.chip-body {
  display: inline-flex;
  align-items: baseline;
  gap: 0.4rem;
  padding: 0 0.65rem 0 0.85rem;
  height: 100%;
  min-width: 0;
}
.chip-name {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  line-height: 32px;
  white-space: nowrap;
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.12);
}
.chip-slug {
  font-size: 10px;
  letter-spacing: 0.02em;
  opacity: 0.7;
  line-height: 32px;
  white-space: nowrap;
}

.chip-strike {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 100%;
  background: var(--strike-bg, rgba(0, 0, 0, 0.18));
  border: 0;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.16s ease, background 0.16s ease, width 0.18s ease;
  font-size: 0.75rem;
  flex-shrink: 0;
}
.chip:hover .chip-strike,
.chip:focus-within .chip-strike {
  opacity: 1;
}
.chip-strike:hover {
  /* Boost the strike alpha on hover so the destructive intent
     reads clearly without re-tinting the chip. */
  filter: brightness(1.25) contrast(1.1);
}
.chip-strike:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: -2px;
  opacity: 1;
}

/* On touch devices / narrow viewports, the hover-to-reveal
   strike is unusable. Always show it (with reduced opacity) so
   the operator can still tap-delete on mobile. */
@media (hover: none), (max-width: 720px) {
  .chip-strike {
    opacity: 0.55;
  }
  .chip:hover .chip-strike {
    opacity: 1;
  }
}

/* ── Empty states ──────────────────────────────────────────── */
.palette-empty {
  display: grid;
  place-items: center;
  gap: 0.45rem;
  padding: 3rem 1rem;
  border: 1px dashed rgb(var(--line-default));
  border-radius: var(--radius-md);
  background: rgb(var(--bg-elevated) / 0.5);
  text-align: center;
}
.palette-empty--filter {
  padding: 1.5rem 1rem;
}
.palette-empty-icon {
  font-size: 2.4rem;
  color: rgb(var(--fg-faint));
  margin-bottom: 0.4rem;
}
.palette-empty--filter .palette-empty-icon {
  font-size: 1.6rem;
  margin-bottom: 0.15rem;
}
.palette-empty-text {
  margin: 0;
  font-size: 0.92rem;
  font-weight: 700;
  color: rgb(var(--fg-strong));
}
.palette-empty--filter .palette-empty-text {
  font-size: 0.82rem;
  font-weight: 600;
}
.palette-empty-hint {
  margin: 0;
  max-width: 36ch;
  font-size: 0.78rem;
  color: rgb(var(--fg-muted));
  font-style: italic;
}
.palette-empty-clear {
  margin-top: 0.45rem;
  background: transparent;
  border: 1px solid rgb(var(--line-default));
  color: rgb(var(--fg-muted));
  padding: 0.3rem 0.7rem;
  border-radius: var(--radius-sm);
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.15s ease;
}
.palette-empty-clear:hover {
  border-color: rgba(212, 167, 52, 0.5);
  color: #d4a734;
}

.spin {
  animation: tag-spin 1s linear infinite;
}
@keyframes tag-spin {
  to { transform: rotate(360deg); }
}
</style>
