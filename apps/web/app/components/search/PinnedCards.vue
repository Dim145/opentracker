<script setup lang="ts">
/**
 * Les épinglés en cartes.
 *
 * Un tableau qui répétait la structure des résultats disait « encore des
 * lignes » ; une carte avec l'affiche dit « l'équipe met ceci en avant », et
 * se reconnaît d'un coup d'œil. Ce que la carte porte tient en une ligne :
 * l'unité, la résolution et la source, la taille, et « gratuit » quand c'est
 * le moment de la prendre.
 */
import { formatSize } from '~/utils/format';
import { kindOfSlug } from '~/utils/searchTokens';
import type { CatalogueRow } from './ReleaseRows.vue';

defineProps<{ torrents: CatalogueRow[] }>();
const { t } = useI18n();

const titleOf = (row: CatalogueRow) => row.work?.title || row.name;
const unit = (row: CatalogueRow) => {
  const parts: string[] = [];
  if (typeof row.season === 'number') parts.push(`S${String(row.season).padStart(2, '0')}`);
  if (typeof row.episode === 'number') parts.push(`E${String(row.episode).padStart(2, '0')}`);
  return parts.join('');
};
function meta(row: CatalogueRow): string[] {
  const out: string[] = [];
  const u = unit(row);
  if (u) out.push(u);
  const tags = row.tags ?? [];
  const pick = (kind: string) => tags.find((tg) => kindOfSlug(tg.slug) === kind)?.name;
  const res = pick('resolution');
  const src = pick('source');
  if (res || src) out.push([res, src].filter(Boolean).join(' '));
  const hdr = pick('hdr');
  if (hdr) out.push(hdr);
  out.push(formatSize(row.size));
  return out;
}
</script>

<template>
  <section class="pins" :aria-label="t('search.pinned.title')">
    <span class="pins-eyebrow">
      <Icon name="ph:push-pin-fill" aria-hidden="true" />
      {{ t('search.pinned.title') }}
    </span>
    <NuxtLink v-for="row in torrents" :key="row.id" class="pcard" :to="`/torrents/${row.infoHash}`">
      <TorrentPosterHover
        class="pcard-pst"
        :src="row.work?.posterUrl ?? null"
        :large="row.work?.posterUrl?.replace('/w342/', '/w500/') ?? null"
        :alt="titleOf(row)"
        fallback-icon="ph:push-pin-bold"
      />
      <span class="pcard-body">
        <span class="pcard-title" :class="{ 'pcard-title--mono': !row.work?.title }" :title="row.name">
          {{ titleOf(row) }}<span v-if="row.work?.year" class="pcard-year"> {{ row.work.year }}</span>
        </span>
        <span class="pcard-meta">
          <template v-for="(m, i) in meta(row)" :key="i">
            <span v-if="i > 0" aria-hidden="true"> · </span>{{ m }}
          </template>
          <template v-if="row.freeleech">
            <span aria-hidden="true"> · </span><span class="pcard-free">{{ t('search.pinned.free') }}</span>
          </template>
        </span>
      </span>
    </NuxtLink>
  </section>
</template>

<style scoped>
/* Le repère au-dessus, horizontal comme tous ceux de la page ; les cartes en
   colonnes de 18rem au moins, jamais une seule étirée sur toute la largeur. */
.pins {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
  gap: 0.5rem 0.6rem;
  margin: 0 0 1rem;
}
.pins-eyebrow {
  grid-column: 1 / -1;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-family: var(--font-mono);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgb(var(--accent-warm-text) / 1);
}
.pins-eyebrow :deep(svg) {
  width: 0.7rem;
  height: 0.7rem;
}
.pcard {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
  padding: 0.55rem 0.75rem 0.55rem 0.55rem;
  border: 1px solid rgb(var(--accent-warm) / 0.4);
  border-radius: var(--radius-lg);
  background:
    linear-gradient(90deg, rgb(var(--accent-warm) / 0.08), transparent 60%),
    rgb(var(--bg-surface) / 1);
  color: inherit;
  text-decoration: none;
  transition: border-color var(--dur-1) var(--ease-standard), transform var(--dur-2) var(--ease-standard);
}
.pcard:hover {
  border-color: rgb(var(--accent-warm) / 0.8);
  transform: translateY(-1px);
}
.pcard-pst {
  flex: none;
  width: 40px;
  height: 60px;
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.pcard-body {
  display: grid;
  gap: 0.15rem;
  min-width: 0;
}
.pcard-title {
  display: block;
  font-family: var(--font-display);
  font-style: italic;
  font-weight: 500;
  font-size: 1rem;
  line-height: 1.15;
  color: rgb(var(--fg-strong) / 1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pcard-title--mono {
  font-family: var(--font-mono);
  font-style: normal;
  font-size: 0.75rem;
}
.pcard-year {
  font-weight: 400;
  color: rgb(var(--fg-muted) / 1);
}
.pcard-meta {
  display: block;
  font-family: var(--font-mono);
  font-size: 0.625rem;
  font-weight: 500;
  line-height: 1.5;
  color: rgb(var(--fg-muted) / 1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pcard-free {
  color: rgb(var(--accent-warm-text) / 1);
  font-weight: 700;
}
/* Étroit : la ligne méta passe sur deux lignes plutôt que de couper « gratuit ». */
@media (max-width: 40rem) {
  .pcard-meta {
    white-space: normal;
    overflow-wrap: anywhere;
  }
}
@media (prefers-reduced-motion: reduce) {
  .pcard {
    transition: none;
  }
}
</style>
