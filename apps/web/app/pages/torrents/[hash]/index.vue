<template>
  <!-- ─── Adult-content gate ────────────────────────────────────────
       Renders when /api/torrents/:hash returned the redacted shape
       because the torrent's category is flagged adult and the viewer
       hasn't opted in. We deliberately don't show the torrent name
       or any metadata — the redacted bar mimics the position of the
       title so the operator's filter is visibly working, and the CTA
       points at /settings#adult so a user who opted out by mistake
       can flip the switch in one click. -->
  <section
    v-if="torrent && torrent.gatedAdult"
    class="adult-gate"
    aria-labelledby="adult-gate-title"
  >
    <NuxtLink to="/torrents" class="adult-gate__back">
      <Icon name="ph:arrow-left-bold" />
      {{ $t('torrents.detail.backToIndex') }}
    </NuxtLink>

    <div class="adult-gate__panel">
      <header class="adult-gate__hatch">
        <span class="adult-gate__hatch-label">
          <Icon name="ph:eye-slash-fill" />
          {{ $t('torrents.detail.adultGate.filterActive') }}
        </span>
        <span class="adult-gate__hatch-route">
          /torrents/<span class="adult-gate__hash">{{ redactedHash }}</span>
        </span>
      </header>

      <div class="adult-gate__body">
        <p class="adult-gate__eyebrow">
          {{ $t('torrents.detail.adultGate.eyebrow') }}
        </p>
        <h1 id="adult-gate-title" class="adult-gate__title">
          <span class="adult-gate__title-word">{{ $t('torrents.detail.adultGate.titleWord') }}</span>
          <span class="adult-gate__title-stamp" aria-hidden="true">
            <span class="adult-gate__title-stamp-inner">{{ $t('torrents.detail.adultGate.titleStamp') }}</span>
          </span>
        </h1>

        <p class="adult-gate__redacted" aria-hidden="true">
          <span></span><span></span><span></span>
        </p>

        <dl class="adult-gate__meta">
          <div>
            <dt>{{ $t('common.category') }}</dt>
            <dd>{{ torrent.category?.name ?? 'XXX' }}</dd>
          </div>
          <div>
            <dt>{{ $t('torrents.detail.adultGate.reasonLabel') }}</dt>
            <dd>{{ $t('torrents.detail.adultGate.reasonValue') }}</dd>
          </div>
          <div>
            <dt>{{ $t('torrents.detail.adultGate.reachableIn') }}</dt>
            <dd>{{ $t('torrents.detail.adultGate.reachableValue') }}</dd>
          </div>
        </dl>

        <p class="adult-gate__copy">
          {{ $t('torrents.detail.adultGate.copy') }}
        </p>

        <div class="adult-gate__actions">
          <NuxtLink to="/settings" class="adult-gate__cta">
            <Icon name="ph:eye-bold" />
            <span>{{ $t('torrents.detail.adultGate.enable') }}</span>
          </NuxtLink>
          <NuxtLink to="/torrents" class="adult-gate__cta adult-gate__cta--ghost">
            <Icon name="ph:list-bold" />
            <span>{{ $t('torrents.detail.adultGate.browseSafe') }}</span>
          </NuxtLink>
        </div>
      </div>

      <footer class="adult-gate__foot">
        <span>{{ $t('torrents.detail.adultGate.footer') }}</span>
        <span class="adult-gate__foot-mono">/settings#adult</span>
      </footer>
    </div>
  </section>

  <div v-else-if="torrent" class="release-page">
    <!-- ── Decorative atmosphere ──────────────────────────────────
         Two soft gradient blobs (accent + warning hues) plus a grain
         overlay live behind the content. Same vocabulary as
         /reports so the app reads as one editorial product. -->
    <div class="release-aura" aria-hidden="true">
      <span class="aura-blob aura-blob--a" />
      <span class="aura-blob aura-blob--b" />
      <span class="aura-grain" />
    </div>

    <NuxtLink to="/torrents" class="release-back">
      <Icon name="ph:arrow-left-bold" />
      {{ $t('torrents.detail.backToIndex') }}
    </NuxtLink>

    <!-- ─── Moderation panel (top placement) ───────────────────
         When the torrent is in a non-final state (pending or
         changes_requested) we surface the panel above the fold so
         the uploader sees the moderator's instructions before any
         metadata. Final states (accepted / rejected) keep the panel
         at the bottom of the page so the conversation doesn't push
         the public-facing content down. -->
    <div v-if="moderationOnTop" class="mb-8">
      <TorrentModerationPanel
        :hash="torrent.infoHash"
        :status="(torrent.moderationStatus as 'pending' | 'accepted' | 'changes_requested' | 'rejected')"
        :uploader-id="torrent.uploaderId ?? null"
        @status-change="onModerationStatusChange"
      />
    </div>

    <!-- ╔══════════════════════════════════════════════════════════╗
         ║  HERO — release press-sheet                              ║
         ║  Eyebrow · big mono title · chips · primary CTA · meta   ║
         ║  Vertical status-coloured tab on the left edge gives the ║
         ║  card the feel of a physical document.                    ║
         ╚══════════════════════════════════════════════════════════╝ -->
    <section
      class="hero"
      :class="[`hero--status-${torrent.moderationStatus || 'accepted'}`]"
    >
      <header class="hero-eyebrow">
        <span class="hero-eyebrow-mark" aria-hidden="true">§</span>
        <!-- Category name doubles as the eyebrow label so the page
             opens with the most concrete "what is this" signal. Falls
             back to a generic "Dossier" only when the row carries no
             category at all (rare — uncategorised uploads are usually
             rejected before they reach a detail page). -->
        <span class="hero-eyebrow-label">{{
          torrent.category?.name || $t('torrents.detail.hero.case')
        }}</span>
        <span class="hero-eyebrow-sep">·</span>
        <time
          class="hero-eyebrow-date"
          :datetime="torrent.createdAt"
          :title="formatDate(torrent.createdAt)"
        >
          {{ formatAge(torrent.createdAt).toUpperCase() }}
        </time>
        <span
          v-if="torrent.moderationStatus && torrent.moderationStatus !== 'accepted'"
          class="hero-eyebrow-sep"
        >·</span>
        <TorrentModerationBadge
          v-if="torrent.moderationStatus && torrent.moderationStatus !== 'accepted'"
          :status="torrent.moderationStatus"
          size="sm"
        />
        <span class="hero-eyebrow-spacer" aria-hidden="true" />
        <!-- Report button parked in the top-right corner of the hero
             so it stays accessible (any authenticated user can flag)
             without sitting next to the destructive Delete in the
             main CTA row — flagging is cautionary, deletion is
             permanent, the two shouldn't live shoulder-to-shoulder. -->
        <button
          v-if="canReport"
          type="button"
          class="hero-eyebrow-report"
          @click="reportOpen = true"
        >
          <Icon name="ph:flag-bold" />
          <span>{{ $t('torrents.detail.report') }}</span>
        </button>
      </header>

      <h1
        class="hero-title"
        :data-len="heroTitleLen"
        :title="torrent.name"
      >
        {{ withWrapHints(torrent.name) }}
      </h1>

      <div
        v-if="
          torrent.tags?.length ||
          torrent.imdbId ||
          torrent.tmdbId ||
          torrent.tvdbId
        "
        class="hero-chips"
      >
        <NuxtLink
          v-for="tag in torrent.tags"
          :key="tag.id"
          :to="`/torrents?tag=${encodeURIComponent(tag.slug)}`"
          class="chip chip--tag"
          :style="tagBadgeStyle(tag)"
        >
          <span class="chip-dot" :style="{ backgroundColor: tag.color }" />
          {{ tag.name }}
        </NuxtLink>

        <a
          v-if="torrent.imdbId"
          :href="`https://www.imdb.com/title/${torrent.imdbId}/`"
          target="_blank"
          rel="noopener noreferrer"
          class="media-id-badge media-id-badge--imdb"
          :title="`IMDb · ${torrent.imdbId}`"
        >
          <span class="media-id-badge-tag">IMDb</span>
          <span class="media-id-badge-id">{{ torrent.imdbId }}</span>
          <Icon name="ph:arrow-up-right-bold" class="text-[10px]" />
        </a>
        <a
          v-if="tmdbLink"
          :href="tmdbLink.href"
          target="_blank"
          rel="noopener noreferrer"
          class="media-id-badge media-id-badge--tmdb"
          :title="`TMDb · ${tmdbLink.label}`"
        >
          <span class="media-id-badge-tag">TMDb</span>
          <span class="media-id-badge-id">{{ tmdbLink.label }}</span>
          <Icon name="ph:arrow-up-right-bold" class="text-[10px]" />
        </a>
        <a
          v-if="torrent.tvdbId"
          :href="`https://thetvdb.com/dereferrer/series/${torrent.tvdbId}`"
          target="_blank"
          rel="noopener noreferrer"
          class="media-id-badge media-id-badge--tvdb"
          :title="`TVDB · ${torrent.tvdbId}`"
        >
          <span class="media-id-badge-tag">TVDB</span>
          <span class="media-id-badge-id">{{ torrent.tvdbId }}</span>
          <Icon name="ph:arrow-up-right-bold" class="text-[10px]" />
        </a>
      </div>

      <!-- One bold primary action (Download) flanked by mono ghosts
           for the destructive / reporting paths. The size carries the
           weight of the file so a user can decide before clicking. -->
      <div class="hero-cta">
        <a
          :href="`/api/torrents/${torrent.infoHash}/download`"
          class="cta-primary"
          download
        >
          <Icon name="ph:download-simple-bold" class="cta-primary-icon" />
          <span class="cta-primary-stack">
            <span class="cta-primary-label">{{ $t('torrents.detail.download') }}</span>
            <span class="cta-primary-sub">{{ formatSize(torrent.size) }}</span>
          </span>
        </a>

        <div class="hero-cta-aux">
          <NuxtLink
            v-if="canEdit"
            :to="`/torrents/${torrent.infoHash}/edit`"
            class="cta-ghost"
          >
            <Icon name="ph:pencil-simple-bold" />
            <span>{{ $t('common.edit') }}</span>
          </NuxtLink>
          <button
            v-if="canDelete"
            type="button"
            class="cta-ghost cta-ghost--danger"
            @click="confirmDelete"
          >
            <Icon name="ph:trash-bold" />
            <span>{{ $t('common.delete') }}</span>
          </button>
        </div>
      </div>

      <!-- Inline meta ribbon: hash · uploader · age. Replaces the
           old three-card strip with a single horizontal data row,
           dividers between cells, monospace throughout. -->
      <dl class="hero-meta">
        <div class="hero-meta-cell hero-meta-cell--hash">
          <dt>{{ $t('torrents.detail.infoHash') }}</dt>
          <dd>
            <code class="hero-meta-hash">{{ torrent.infoHash }}</code>
          </dd>
        </div>
        <div class="hero-meta-cell hero-meta-cell--uploader">
          <dt>{{ $t('torrents.detail.uploadedBy') }}</dt>
          <dd>
            <NuxtLink
              v-if="torrent.uploader"
              :to="`/users/${torrent.uploader.id}`"
              class="hero-meta-user"
            >
              <Icon name="ph:user-bold" class="hero-meta-user-icon" />
              @{{ torrent.uploader.username }}
            </NuxtLink>
            <span
              v-else
              class="hero-meta-user hero-meta-user--gone"
              :title="$t('torrents.detail.uploaderGoneTooltip')"
            >
              <Icon name="ph:user-bold" class="hero-meta-user-icon" />
              {{ $t('torrents.detail.uploaderGone') }}
            </span>
          </dd>
        </div>
      </dl>
    </section>

    <!-- Rich metadata card. Picked by source so a game lands on the
         IGDB card, a book on Open Library / Google Books, and a
         movie/TV on TMDb. Silent no-op when the lookup missed. -->
    <GameMetadataCard
      v-if="metadata && metadata.source === 'igdb'"
      :metadata="metadata"
      class="release-metadata"
    />
    <BookMetadataCard
      v-else-if="metadata && metadata.source === 'openlibrary'"
      :metadata="metadata"
      class="release-metadata"
    />
    <MediaMetadataCard
      v-else-if="metadata"
      :metadata="metadata"
      class="release-metadata"
    />

    <!-- § NFO — sits right under the rich-metadata card so the technical
         summary is one click away without scrolling past the stats. The
         section uses the compact header variant: smaller `§` mark, a
         single-line bar, no editorial display weight. The NFO is a
         release-engineering artefact, not a piece of writing — it
         shouldn't compete visually with the description below. -->
    <section v-if="torrent.nfo" class="section section--compact section--nfo">
      <header class="section-head section-head--compact section-head--toggle">
        <button
          type="button"
          class="section-head-button"
          :aria-expanded="nfoExpanded"
          aria-controls="nfo-body"
          @click="nfoExpanded = !nfoExpanded"
        >
          <span class="section-head-mark" aria-hidden="true">§</span>
          <h2 class="section-head-title">{{ $t('torrents.detail.sections.nfo') }}</h2>
          <span class="section-head-meta">{{ nfoMeta }}</span>
          <Icon
            name="ph:caret-right-bold"
            class="section-head-caret"
            :class="{ 'is-expanded': nfoExpanded }"
          />
        </button>
        <button
          v-if="nfoExpanded"
          type="button"
          class="section-head-action"
          @click="copyNfo"
        >
          <Icon :name="nfoCopied ? 'ph:check-bold' : 'ph:copy-bold'" />
          {{ nfoCopied ? $t('common.copied') : $t('common.copy') }}
        </button>
      </header>
      <div v-show="nfoExpanded" id="nfo-body" class="nfo-frame">
        <pre class="nfo-body">{{ torrent.nfo }}</pre>
      </div>
    </section>

    <!-- ╔══════════════ § ACTIVITY ═══════════════╗
         Instrument cluster — one continuous strip with five (or four)
         metric cells, status-coloured numbers, inline x-seed sub
         lines. Replaces the previous five-card grid which read as
         five competing islands. -->
    <section class="section section--activity">
      <header class="section-head">
        <span class="section-head-mark" aria-hidden="true">§</span>
        <h2 class="section-head-title">{{ $t('torrents.detail.sections.activity') }}</h2>
        <span class="section-head-line" aria-hidden="true" />
      </header>
      <ul class="stats-cluster">
        <li class="stat stat--size">
          <Icon name="ph:database-bold" class="stat-icon" />
          <div class="stat-body">
            <span class="stat-num">{{ formatSize(torrent.size) }}</span>
            <span class="stat-label">{{ $t('torrents.detail.stats.totalSize') }}</span>
          </div>
        </li>
        <li class="stat stat--seeders" :class="{ 'is-zero': torrent.stats.seeders === 0 }">
          <Icon name="ph:arrow-up-bold" class="stat-icon" />
          <div class="stat-body">
            <span class="stat-num tabular-nums">{{ torrent.stats.seeders }}</span>
            <span class="stat-label">{{ $t('torrents.detail.stats.seeders') }}</span>
            <span v-if="xSeedSeederSub" class="stat-sub">{{ xSeedSeederSub }}</span>
          </div>
        </li>
        <li class="stat stat--leechers" :class="{ 'is-zero': torrent.stats.leechers === 0 }">
          <Icon name="ph:arrow-down-bold" class="stat-icon" />
          <div class="stat-body">
            <span class="stat-num tabular-nums">{{ torrent.stats.leechers }}</span>
            <span class="stat-label">{{ $t('torrents.detail.stats.leechers') }}</span>
            <span v-if="xSeedLeecherSub" class="stat-sub">{{ xSeedLeecherSub }}</span>
          </div>
        </li>
        <li class="stat stat--completed">
          <Icon name="ph:check-circle-bold" class="stat-icon" />
          <div class="stat-body">
            <span class="stat-num tabular-nums">{{ torrent.stats.completed }}</span>
            <span class="stat-label">{{ $t('torrents.detail.stats.completed') }}</span>
          </div>
        </li>
        <li v-if="showVolumeCard" class="stat stat--volume">
          <Icon name="ph:cloud-arrow-up-bold" class="stat-icon" />
          <div class="stat-body">
            <span class="stat-num">{{ totalUploadedDisplay }}</span>
            <span class="stat-label">{{ $t('torrents.detail.stats.exchanged') }}</span>
            <span v-if="xSeedVolumeSub" class="stat-sub">{{ xSeedVolumeSub }}</span>
          </div>
        </li>
      </ul>
    </section>

    <!-- § NOTE — uploader's description, when present. Treated as an
         editorial pull-block: serif italic opening character, generous
         line-height, no surrounding "card" frame. -->
    <section v-if="torrent.description" class="section section--note">
      <header class="section-head">
        <span class="section-head-mark" aria-hidden="true">§</span>
        <h2 class="section-head-title">{{ $t('torrents.detail.sections.note') }}</h2>
        <span class="section-head-line" aria-hidden="true" />
      </header>
      <article class="note-block">
        <div
          class="prose prose-invert prose-sm max-w-none description-content"
          v-html="renderedDescription"
        />
      </article>
    </section>

    <!-- § CROSS-SEEDS — sibling rips of the same content. Was a table,
         now a list of compact rows so it reads as "related releases"
         rather than tabular data. -->
    <section
      v-if="crossSeeds && crossSeeds.items.length > 0"
      class="section section--cross"
    >
      <header class="section-head">
        <span class="section-head-mark" aria-hidden="true">§</span>
        <h2 class="section-head-title">
          {{ $t('torrents.detail.sections.crossSeeds') }}
        </h2>
        <span class="section-head-count">{{ crossSeeds.items.length }}</span>
        <span class="section-head-line" aria-hidden="true" />
      </header>
      <ul class="cross-list">
        <li
          v-for="sib in crossSeeds.items"
          :key="sib.id"
          class="cross-item"
        >
          <NuxtLink :to="`/torrents/${sib.infoHash}`" class="cross-link">
            <Icon name="ph:arrows-left-right-bold" class="cross-icon" />
            <span class="cross-name">{{ sib.name }}</span>
            <span class="cross-meta">
              <span class="cross-meta-cat">{{ sib.category?.name ?? '—' }}</span>
              <span class="cross-meta-sep">·</span>
              <span class="cross-meta-size">{{ formatSize(sib.size) }}</span>
              <span class="cross-meta-sep">·</span>
              <span class="cross-meta-age">{{ formatAge(sib.createdAt) }}</span>
            </span>
            <Icon name="ph:arrow-right-bold" class="cross-arrow" />
          </NuxtLink>
        </li>
      </ul>
    </section>

    <!-- § SWARM — admin-only peer list. Operational data, kept as a
         table because that's the format that scans best. -->
    <section v-if="user?.isAdmin" class="section section--swarm">
      <header class="section-head">
        <span class="section-head-mark" aria-hidden="true">§</span>
        <h2 class="section-head-title">
          {{ $t('torrents.detail.sections.swarm') }}
        </h2>
        <span class="section-head-count">{{ torrent.peers.length }}</span>
        <span
          class="section-head-tag"
          :title="$t('torrents.detail.swarm.adminOnlyTooltip')"
        >
          {{ $t('torrents.detail.swarm.adminOnly') }}
        </span>
        <span class="section-head-line" aria-hidden="true" />
      </header>
      <div class="swarm-frame">
        <table class="swarm-table">
          <thead>
            <tr>
              <th>{{ $t('torrents.detail.swarm.endpoint') }}</th>
              <th>{{ $t('torrents.detail.swarm.type') }}</th>
              <th>{{ $t('torrents.detail.swarm.uploaded') }}</th>
              <th>{{ $t('torrents.detail.swarm.downloaded') }}</th>
              <th class="text-right">{{ $t('torrents.detail.swarm.lastSeen') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="torrent.peers.length === 0">
              <td colspan="5" class="swarm-empty">
                {{ $t('torrents.detail.swarm.empty') }}
              </td>
            </tr>
            <tr v-for="peer in torrent.peers" :key="peer.id">
              <td>
                <span class="swarm-endpoint">{{ peer.id.slice(0, 12) }}…</span>
                <span class="swarm-port">:{{ peer.port }}</span>
              </td>
              <td>
                <span
                  class="swarm-type"
                  :class="peer.isSeeder ? 'swarm-type--seeder' : 'swarm-type--leecher'"
                >
                  <Icon
                    :name="peer.isSeeder ? 'ph:arrow-up-bold' : 'ph:arrow-down-bold'"
                    class="text-[8px]"
                  />
                  {{ peer.isSeeder ? $t('torrents.detail.swarm.seeder') : $t('torrents.detail.swarm.leecher') }}
                </span>
              </td>
              <td class="swarm-num">{{ formatSize(peer.uploaded) }}</td>
              <td class="swarm-num">{{ formatSize(peer.downloaded) }}</td>
              <td class="swarm-num text-right">{{ formatAge(peer.lastSeen) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Moderation panel (bottom placement) — only when the row is
         in a final state. For pending / changes_requested rows the
         panel renders at the top instead, before the metadata. -->
    <div v-if="!moderationOnTop" class="mt-8">
      <TorrentModerationPanel
        :hash="torrent.infoHash"
        :status="(torrent.moderationStatus as 'pending' | 'accepted' | 'changes_requested' | 'rejected')"
        :uploader-id="torrent.uploaderId ?? null"
        @status-change="onModerationStatusChange"
      />
    </div>

    <!-- Report modal — opened from the action bar above. Renders
         only when the operator clicks the Report button (it's
         teleported to body so it doesn't matter where in the tree
         it sits). -->
    <ReportModal
      :is-open="reportOpen"
      target-type="torrent"
      :target-id="torrent.id"
      :target-label="torrent.name"
      @close="reportOpen = false"
      @submitted="reportOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import TorrentModerationBadge from '~/components/torrent/TorrentModerationBadge.vue';
import TorrentModerationPanel from '~/components/torrent/TorrentModerationPanel.vue';
import { withWrapHints } from '~/utils/displayTitle';

interface Peer {
  id: string;
  port: number;
  isSeeder: boolean;
  uploaded: number;
  downloaded: number;
  lastSeen: string;
}

interface Category {
  id: string;
  name: string;
  slug: string;
  newznabId?: number | null;
}

interface Tag {
  id: string;
  name: string;
  slug: string;
  color: string;
}

interface TorrentDetail {
  id: string;
  infoHash: string;
  name: string;
  size: number;
  description: string | null;
  nfo: string | null;
  uploaderId: string | null;
  // Eager-loaded by the detail endpoint, projected down to id +
  // username so the header strip can render an @-link without
  // leaking email / role bits onto the public payload.
  uploader: { id: string; username: string } | null;
  categoryId: string | null;
  category: Category | null;
  tags?: Tag[];
  imdbId?: string | null;
  tmdbId?: string | null;
  tvdbId?: string | null;
  igdbId?: string | null;
  openlibraryId?: string | null;
  createdAt: string;
  // Moderation pipeline status. Sent on every detail fetch so the
  // header badge + the inline panel can render without an extra
  // round-trip.
  moderationStatus?: 'pending' | 'accepted' | 'changes_requested' | 'rejected';
  stats: {
    seeders: number;
    leechers: number;
    completed: number;
  };
  peers: Peer[];
  // Server signals an adult-content gate by sending a minimal payload
  // with this flag set. The full TorrentDetail fields are absent in
  // that case — the template guards every dereference behind
  // `!torrent.gatedAdult`.
  gatedAdult?: boolean;
}

const { t } = useI18n();
const route = useRoute();
const hash = route.params.hash as string;

// Length-based size bucket for the hero title. Scene release names
// span a wide range (from "Cats.Eye.S02.MULTI.1080p..." at ~40 chars
// to "ReZERO.Starting.Life...HAPPYRAT" at 100+), and the same `clamp`
// value can't serve both. The bucket attribute drives a different
// `clamp` per length tier in the scoped CSS — short titles get the
// magazine treatment, long ones shrink so the line never overflows.

// Render the gate's faux file path with the middle of the hash blacked
// out. Showing the full hash would let a determined operator copy it
// elsewhere; showing nothing would feel like an opaque error. Keeping
// the first / last four hex chars preserves the impression of "yes,
// there is a real document here, you just don't get to see it".
const redactedHash = computed(() => {
  const h = hash || '';
  if (h.length <= 8) return h;
  return `${h.slice(0, 4)}…${h.slice(-4)}`;
});

const {
  data: torrent,
  error,
  refresh,
} = await useFetch<TorrentDetail>(`/api/torrents/${hash}`);

// Length bucket for the hero title's `data-len` attribute. Drives a
// different `clamp` per tier in the scoped CSS so scene names (which
// can run 100+ characters) shrink rather than overflow, while a tidy
// "Cat's Eye" gets the full magazine treatment.
const heroTitleLen = computed<'sm' | 'md' | 'lg' | 'xl'>(() => {
  const len = (torrent.value && !torrent.value.gatedAdult ? torrent.value.name : '').length;
  if (len >= 90) return 'xl';
  if (len >= 60) return 'lg';
  if (len >= 35) return 'md';
  return 'sm';
});

// Cross-seed companions — sibling torrents with the same canonical
// file list. Empty / 404 just means "no cross-seeds known" → the
// section hides itself. We do this in a side useFetch rather than
// embedding it into the main detail payload so a slow signature
// lookup never blocks the page render.
interface CrossSeedItem {
  id: string;
  infoHash: string;
  name: string;
  size: number;
  moderationStatus: string;
  createdAt: string;
  category: { id: string; name: string; slug: string; type: string | null } | null;
  uploader: { id: string; username: string } | null;
}
const { data: crossSeeds } = await useFetch<{
  items: CrossSeedItem[];
  total: number;
}>(`/api/torrents/${hash}/cross-seeds`, {
  default: () => ({ items: [], total: 0 }),
});

// Cross-seed KPIs (peer counts + volume share). Same side-fetch
// pattern as `crossSeeds` above — the qualifier chips on the stats
// row stay hidden until this resolves, no skeleton needed.
interface CrossSeedStats {
  otherTorrentCount: number;
  seederCount: number;
  leecherCount: number;
  uploadedShareBytes: string;
  totalUploadedBytes: string;
}
const { data: crossSeedStats } = await useFetch<CrossSeedStats>(
  `/api/torrents/${hash}/cross-seed-stats`,
  {
    default: () => ({
      otherTorrentCount: 0,
      seederCount: 0,
      leecherCount: 0,
      uploadedShareBytes: '0',
      totalUploadedBytes: '0',
    }),
  },
);

// Sub-text helpers — empty string → StatsCard renders no qualifier.
const xSeedSeederSub = computed(() => {
  const n = crossSeedStats.value?.seederCount ?? 0;
  return n > 0 ? `${n} x-seed` : '';
});
const xSeedLeecherSub = computed(() => {
  const n = crossSeedStats.value?.leecherCount ?? 0;
  return n > 0 ? `${n} x-seed` : '';
});
const totalUploadedDisplay = computed(() => {
  const raw = crossSeedStats.value?.totalUploadedBytes ?? '0';
  // BigInt round-trip preserves precision past 2^53 bytes.
  const bytes = Number(BigInt(raw));
  return formatSize(bytes);
});
const xSeedVolumeSub = computed(() => {
  const total = crossSeedStats.value?.totalUploadedBytes ?? '0';
  const share = crossSeedStats.value?.uploadedShareBytes ?? '0';
  const totalNum = Number(BigInt(total));
  const shareNum = Number(BigInt(share));
  if (totalNum === 0 || shareNum === 0) return '';
  const pct = (shareNum / totalNum) * 100;
  // Round to 1 decimal for sub-1% values, integer otherwise — keeps
  // the chip narrow while staying honest about tiny shares.
  const formatted = pct < 1 ? pct.toFixed(1) : Math.round(pct).toString();
  return `${formatted}% x-seed`;
});
const showVolumeCard = computed(() => {
  return Number(BigInt(crossSeedStats.value?.totalUploadedBytes ?? '0')) > 0;
});

/**
 * Sync the local torrent reactive when the moderation panel pushes a
 * status transition (approve / reject / etc.). Saves us from
 * re-fetching the whole detail payload just to refresh the badge.
 */
function onModerationStatusChange(
  next: 'pending' | 'accepted' | 'changes_requested' | 'rejected'
) {
  if (torrent.value && !torrent.value.gatedAdult) {
    torrent.value.moderationStatus = next;
  }
}

/**
 * Drives the placement of the moderation panel.
 *   - pending / changes_requested  → top of the page (the uploader
 *     has something to read or to do; we don't want them scrolling
 *     past every byte of metadata to find it)
 *   - accepted / rejected          → bottom of the page (the matter
 *     is closed; the conversation is reference material rather than
 *     a call to action)
 *
 * The component itself is rendered exactly once on either side of
 * the layout via mutually-exclusive v-ifs so the API call doesn't
 * fire twice.
 */
const moderationOnTop = computed(() => {
  const status = torrent.value && !torrent.value.gatedAdult
    ? torrent.value.moderationStatus
    : null;
  return status === 'pending' || status === 'changes_requested';
});

// Pick whichever external id the uploader supplied. TMDb's /find
// covers IMDb / TVDB; IGDB serves video games. Order in
// `lookupParams` matters: a movie/TV-hinted torrent prefers TMDb
// even when an IGDB id is also stored.
interface MediaMetadataResponse {
  enabled: boolean;
  found: boolean;
  metadata: {
    source?: 'tmdb' | 'imdb' | 'tvdb' | 'igdb' | 'openlibrary';
    type: 'movie' | 'tv' | 'game' | 'book';
    title: string;
    originalTitle: string | null;
    tagline: string | null;
    year: number | null;
    overview: string | null;
    posterUrl: string | null;
    backdropUrl: string | null;
    genres: string[];
    runtime: number | null;
    voteAverage: number | null;
    voteCount: number | null;
    imdbId: string | null;
    url: string;
    // IGDB-only fields. Optional so the existing TMDb shape is
    // unchanged; the GameMetadataCard reads them when present.
    igdbId?: number | null;
    platforms?: string[];
    gameModes?: string[];
    screenshots?: string[];
    firstReleaseDate?: string | null;
    // Open Library / Google Books fields. Optional so the existing
    // shapes are unchanged; BookMetadataCard reads them when set.
    openlibraryId?: string | null;
    authors?: string[];
    publisher?: string | null;
    pageCount?: number | null;
    isbn13?: string | null;
    isbn10?: string | null;
    bookProvider?: 'openlibrary' | 'googlebooks';
  } | null;
}

// Derive an external metadata hint from the torrent's category — a
// category mapped under the Newznab `Movies` parent (2xxx) implies
// a movie, `TV` (5xxx) implies a series, Console (1xxx) or PC games
// (4xxx) imply a video game. The hint stops the lookup from
// guessing the wrong namespace when the same numeric id exists in
// both. Falls back to a slug/name heuristic so custom French
// categories (`Films Français`, `Séries Françaises`, `Jeux`, …)
// stay classified even without a newznab_id.
function deriveTypeHint(
  cat:
    | { newznabId?: number | null; slug?: string; name?: string }
    | null
    | undefined
): 'movie' | 'tv' | 'game' | 'book' | undefined {
  const id = cat?.newznabId;
  if (typeof id === 'number') {
    if (id >= 5000 && id < 6000) return 'tv';
    if (id >= 2000 && id < 3000) return 'movie';
    // Newznab buckets 1xxx (Console games) and 4xxx (PC) both map
    // to IGDB. We treat them as the same `game` hint — IGDB indexes
    // every platform under one game id.
    if ((id >= 1000 && id < 2000) || (id >= 4000 && id < 5000)) return 'game';
    // 7xxx is the book/ebook/comic/magazine decade.
    if (id >= 7000 && id < 8000) return 'book';
  }
  const text = `${cat?.slug || ''} ${cat?.name || ''}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  if (/\b(?:tv|seri|episod|saison|season|show|anime)/.test(text)) return 'tv';
  if (/\b(?:movie|film|cinema|cine)/.test(text)) return 'movie';
  if (/\b(?:game|games|jeu|jeux|console|playstation|xbox|nintendo|switch|pc-?game)/.test(text)) return 'game';
  if (/\b(?:book|ebook|e-book|epub|mobi|azw3|livre|livres|comics?|bd|manga|magazine|revue)/.test(text)) return 'book';
  return undefined;
}

const lookupParams = computed(() => {
  const t = torrent.value;
  if (!t) return null;
  const type = deriveTypeHint(t.category);
  // Prefer the source that matches the category hint when we have
  // multiple ids stored — a TV box with both a TMDb and an IGDB id
  // should hit TMDb, a book box with both an Open Library and TMDb
  // id should hit Open Library, and so on.
  if (type === 'book' && t.openlibraryId) {
    return { source: 'openlibrary', id: t.openlibraryId, type };
  }
  if (type === 'game' && t.igdbId) {
    return { source: 'igdb', id: t.igdbId, type };
  }
  if (t.tmdbId) return { source: 'tmdb', id: t.tmdbId, type };
  if (t.imdbId) return { source: 'imdb', id: t.imdbId, type };
  if (t.tvdbId) return { source: 'tvdb', id: t.tvdbId, type };
  if (t.igdbId) return { source: 'igdb', id: t.igdbId, type };
  if (t.openlibraryId)
    return { source: 'openlibrary', id: t.openlibraryId, type };
  return null;
});

const { data: metadataResponse } = await useFetch<MediaMetadataResponse>(
  '/api/metadata/lookup',
  {
    // useFetch refetches when reactive query params change.
    query: computed(() => {
      const p = lookupParams.value;
      if (!p) return {};
      const out: Record<string, string> = { source: p.source, id: p.id };
      if (p.type) out.type = p.type;
      return out;
    }),
    // Skip the call entirely when there's nothing to look up — saves
    // the 503 response when the operator hasn't set TMDB_API_KEY.
    immediate: !!lookupParams.value,
    watch: [lookupParams],
    // Don't surface a 5xx to the page error boundary; the metadata
    // card just won't render and the rest of the page works.
    onResponseError({ response }) {
      if (response.status === 503) return;
    },
  }
);

const metadata = computed(
  () => metadataResponse.value?.metadata ?? null
);

// Get current user session
const { loggedIn, user } = useUserSession();
const notifications = useNotificationStore();
const confirm = useConfirm();

// Compute permissions
const canEdit = computed(() => {
  if (!loggedIn.value || !user.value) return false;
  const isOwner = torrent.value?.uploaderId === user.value.id;
  return isOwner || user.value.isAdmin || user.value.isModerator;
});

const canDelete = computed(() => {
  if (!loggedIn.value || !user.value) return false;
  const isOwner = torrent.value?.uploaderId === user.value.id;
  return isOwner || user.value.isAdmin || user.value.isModerator;
});

// Report a torrent — any authenticated user can file one. The
// uploader can technically report their own upload; moderators will
// dismiss the obvious self-reports. Keeping the gate that permissive
// avoids confusing edge cases ("why is the button hidden?") and
// trusts the moderation queue to filter noise.
const canReport = computed(() => loggedIn.value && !!user.value);

const reportOpen = ref(false);

/**
 * Build the badge target for a TMDb id.
 *
 * The stored value can be a bare integer ("121361") or a prefixed form
 * ("tv/121361" / "movie/121361") — see `normalizeTmdbId`. Without the
 * helper we used to hardcode `/movie/` in the URL, which produced
 * `https://www.themoviedb.org/movie/tv/57243` for prefixed ids and
 * landed on a broken page.
 */
const tmdbLink = computed(() => {
  const raw = torrent.value?.tmdbId;
  if (!raw) return null;
  const prefixed = raw.match(/^(movie|tv)\/(\d+)$/);
  if (prefixed) {
    const [, type, id] = prefixed;
    return {
      href: `https://www.themoviedb.org/${type}/${id}`,
      label: id,
    };
  }
  // Bare digits — fall back to the type the lookup hint resolves to,
  // otherwise `/movie/` (TMDb redirects to the right namespace anyway).
  const fallbackType = lookupParams.value?.type ?? 'movie';
  return {
    href: `https://www.themoviedb.org/${fallbackType}/${raw}`,
    label: raw,
  };
});

function tagBadgeStyle(tag: { color: string }) {
  // Tint the chip background with the tag's color while keeping the
  // foreground readable in either theme. Falls back to neutral on any
  // unparseable input.
  const hex = (tag.color || '').replace('#', '');
  const valid = /^[0-9a-f]{6}$/i.test(hex);
  if (!valid) {
    return {
      backgroundColor: 'rgb(var(--bg-elevated))',
      borderColor: 'rgb(var(--line-default))',
      color: 'rgb(var(--fg-default))',
    };
  }
  return {
    backgroundColor: `#${hex}1a`, // ~10% alpha
    borderColor: `#${hex}66`, // ~40% alpha
    color: 'rgb(var(--fg-default))',
  };
}

const renderedDescription = computed(() =>
  renderMarkdown(torrent.value?.description)
);

if (error.value || !torrent.value) {
  throw createError({ statusCode: 404, message: t('torrents.detail.notFound') });
}

const nfoCopied = ref(false);
const nfoExpanded = ref(false);
async function copyNfo() {
  if (!torrent.value?.nfo) return;
  await navigator.clipboard.writeText(torrent.value.nfo);
  nfoCopied.value = true;
  setTimeout(() => (nfoCopied.value = false), 1500);
}

const nfoMeta = computed(() => {
  const txt = torrent.value?.nfo;
  if (!txt) return '';
  const lines = txt.split('\n').length;
  const bytes = new Blob([txt]).size;
  const size =
    bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
  return `${t('torrents.detail.nfoMeta.lines', { n: lines })} · ${size}`;
});

async function confirmDelete() {
  if (!torrent.value) return;
  const ok = await confirm({
    title: t('torrents.detail.deleteConfirm.title'),
    message: t('torrents.detail.deleteConfirm.message', { name: torrent.value.name }),
    confirmText: t('common.delete'),
    destructive: true,
  });
  if (!ok) return;

  try {
    await $fetch(`/api/torrents/${torrent.value!.infoHash}`, {
      method: 'DELETE',
    });
    notifications.success(t('torrents.detail.toasts.deleted'));
    await navigateTo('/torrents');
  } catch (err: unknown) {
    const fetchError = err as { data?: { message?: string }; message?: string };
    notifications.error(
      fetchError.data?.message ||
        fetchError.message ||
        t('torrents.detail.errors.deleteFailed')
    );
  }
}

</script>

<style scoped>
/* ╔══════════════════════════════════════════════════════════════╗
   ║  RELEASE PRESS SHEET — torrent detail page                  ║
   ║  Type pairing: Source Serif 4 (display) + JetBrains Mono    ║
   ║                (every label / number / chip)                ║
   ║  Color discipline: --accent dominant, --online / --warning  ║
   ║                /--danger reserved for status semantics       ║
   ╚══════════════════════════════════════════════════════════════╝ */

.release-page {
  position: relative;
  max-width: 1180px;
  margin: 0 auto;
  padding: 2rem 1.5rem 5rem;
  isolation: isolate;
  /* Clip horizontal overflow on the wrapper itself — the aura blobs
     bleed past the page bounds at the top, and on mobile (where the
     page is the full viewport width) that bleed would otherwise
     cause a stray horizontal scroll-bar. `clip` is preferred over
     `hidden` so it doesn't create a scroll container. */
  overflow-x: clip;
  /* Local hue spectrum. The page distributes distinct colours so no
     two adjacent UI elements ever share a tint — the eye reads each
     chip/button as its own identity instead of "another blue".
     Violet / rose / teal are scoped here; the rest pull from the
     global semantic vars (online/warning/danger/info/accent). */
  --release-purple: 167 139 250;
  --release-cyan:   var(--info);
  --release-rose:   244 114 182;
  --release-teal:   45 212 191;
}

/* ── Atmospheric background ──────────────────────────────────────
   Three layers: a deep indigo ambient at the top of the page that
   tints the otherwise neutral --bg-base toward "night sky"; two
   coloured blobs picking up the accent + the violet metadata hue;
   and a faint dot-grid pattern for texture. The combination keeps
   the page dark (it stays a dark theme) but warms it enough to feel
   "rich" rather than just "operator console". */
.release-aura {
  position: absolute;
  /* Horizontal bleed kept to zero so the aura container never
     extends past the page wrapper — the blur on the blobs already
     softens the page-edge clip, so there's no visual cost. */
  inset: -2rem 0 auto 0;
  height: 70vh;
  z-index: -1;
  overflow: hidden;
  pointer-events: none;
}
.release-aura::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(
      ellipse 80% 60% at 30% 0%,
      rgba(56, 89, 178, 0.28),
      transparent 70%
    ),
    radial-gradient(
      ellipse 60% 50% at 80% 0%,
      rgb(var(--release-purple) / 0.18),
      transparent 70%
    );
}
.aura-blob {
  position: absolute;
  display: block;
  filter: blur(80px);
  opacity: 0.38;
  border-radius: 50%;
}
.aura-blob--a {
  width: 520px;
  height: 520px;
  top: -180px;
  left: -120px;
  background: radial-gradient(
    circle,
    rgb(var(--accent) / 0.55),
    transparent 65%
  );
}
.aura-blob--b {
  width: 420px;
  height: 420px;
  top: 60px;
  right: -160px;
  background: radial-gradient(
    circle,
    rgb(var(--release-purple) / 0.55),
    transparent 65%
  );
}
.aura-grain {
  position: absolute;
  inset: 0;
  background-image:
    radial-gradient(rgba(255, 255, 255, 0.035) 1px, transparent 1px);
  background-size: 3px 3px;
  opacity: 0.55;
  mix-blend-mode: overlay;
}

.release-back {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1.75rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  transition: color 0.15s ease, transform 0.2s cubic-bezier(0.22, 1, 0.36, 1);
}
.release-back:hover {
  color: rgb(var(--fg-strong));
  transform: translateX(-2px);
}

/* ╔═══════════════════════════════════════════════════════════════╗
   ║  HERO                                                          ║
   ╚═══════════════════════════════════════════════════════════════╝ */
.hero {
  position: relative;
  margin-bottom: 2.5rem;
  padding: 1.75rem 1.85rem 1.5rem;
  /* Layered background:
     1. solid elevated surface as the base — non-translucent so the
        hero unmistakably reads as its own card against the page (the
        previous translucent fill made card and page blend into the
        same dark plane);
     2. tinted indigo + violet radial washes on top, picking up the
        page's atmospheric blobs without losing the card identity. */
  background:
    radial-gradient(
      ellipse 90% 100% at 0% 0%,
      rgba(56, 89, 178, 0.22),
      transparent 60%
    ),
    radial-gradient(
      ellipse 70% 100% at 100% 100%,
      rgb(var(--release-purple) / 0.18),
      transparent 60%
    ),
    rgb(var(--bg-surface));
  border: 1px solid rgb(var(--line-strong));
  border-radius: 0.6rem;
  overflow: hidden;
  box-shadow:
    0 22px 60px -22px rgba(0, 0, 0, 0.7),
    0 4px 14px -8px rgba(0, 0, 0, 0.5),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
  animation: heroRise 0.65s cubic-bezier(0.22, 1, 0.36, 1) both;
}
@keyframes heroRise {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
/* Vertical status tab on the left edge — accent for accepted rows
   (the common case), warning amber for pending / changes_requested,
   danger red for rejected. Gives the hero the feel of a tabbed
   physical document. */
.hero::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 4px;
  background: rgb(var(--hero-tab, var(--accent)));
  opacity: 0.9;
}
.hero--status-pending,
.hero--status-changes_requested { --hero-tab: var(--warning); }
.hero--status-rejected { --hero-tab: var(--danger); }
.hero--status-accepted { --hero-tab: var(--accent); }

.hero-eyebrow {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  flex-wrap: wrap;
  margin-bottom: 1.1rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  animation: heroFadeIn 0.55s 0.05s ease-out both;
}
.hero-eyebrow-mark {
  font-family: 'Fraunces', 'Charter', Georgia, serif;
  font-style: italic;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 0;
  color: rgb(var(--release-cyan));
  line-height: 0;
  transform: translateY(2px);
  filter: drop-shadow(0 0 8px rgb(var(--release-cyan) / 0.4));
}
.hero-eyebrow-label {
  color: rgb(var(--release-cyan));
  font-weight: 800;
}
.hero-eyebrow-sep { opacity: 0.5; }
.hero-eyebrow-date {
  font-variant-numeric: tabular-nums;
  color: rgb(var(--fg-default));
  font-weight: 700;
}
.hero-eyebrow-spacer {
  flex: 1 1 auto;
  min-width: 1ch;
}
.hero-eyebrow-report {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.32rem 0.7rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgb(var(--warning));
  background: rgb(var(--warning) / 0.1);
  border: 1px solid rgb(var(--warning) / 0.5);
  border-radius: 0.3rem;
  cursor: pointer;
  transition:
    color 0.15s,
    background 0.15s,
    border-color 0.15s,
    transform 0.18s ease;
}
.hero-eyebrow-report:hover {
  color: rgb(var(--bg-base));
  background: rgb(var(--warning));
  border-color: rgb(var(--warning));
  transform: translateY(-1px);
}

.hero-title {
  margin: 0 0 1rem;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: rgb(var(--fg-strong));
  line-height: 1.12;
  overflow-wrap: anywhere;
  text-wrap: pretty;
  animation: heroFadeIn 0.55s 0.15s ease-out both;
  /* Length-based size buckets — scaled down from the previous
     "magazine hero" range so the title sits proportionate to the
     hero, not overpowering it. Short titles still get presence; long
     scene names shrink rather than wrap into walls. */
  font-size: clamp(1.4rem, 3.6vw, 2.25rem); /* default = sm bucket */
}
.hero-title[data-len='md'] { font-size: clamp(1.25rem, 2.8vw, 1.75rem); }
.hero-title[data-len='lg'] { font-size: clamp(1.1rem, 2.2vw, 1.45rem); }
.hero-title[data-len='xl'] { font-size: clamp(0.95rem, 1.8vw, 1.2rem); }

@keyframes heroFadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}

.hero-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1.4rem;
  animation: heroFadeIn 0.55s 0.22s ease-out both;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.7rem;
  border-radius: 0.3rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  border: 1px solid rgb(var(--line-default));
  color: rgb(var(--fg-default));
  background: rgb(var(--bg-elevated) / 0.45);
  transition: background 0.15s, border-color 0.15s, transform 0.2s;
}
.chip:hover {
  background: rgb(var(--bg-elevated) / 0.75);
  border-color: rgb(var(--fg-default) / 0.25);
}
.chip-icon {
  font-size: 11px;
  opacity: 0.75;
}
.chip--tag {
  text-decoration: none;
}
.chip--tag:hover {
  transform: translateY(-1px);
}
.chip-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  display: inline-block;
  flex-shrink: 0;
}

.hero-cta {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: 0.6rem 0.85rem;
  margin-bottom: 1.5rem;
  animation: heroFadeIn 0.55s 0.3s ease-out both;
}
.cta-primary {
  display: inline-flex;
  align-items: center;
  gap: 0.9rem;
  padding: 0.85rem 1.35rem 0.85rem 1.1rem;
  /* Green download — the colour reads as "go, available" the way a
     traffic-light green does, which matches the C411 / classic
     tracker convention. Diverges from the app's neutral accent on
     purpose: download is the one action everyone reaches for, so it
     gets the strongest visual signal on the page. */
  background: linear-gradient(
    135deg,
    rgb(var(--online)),
    rgb(var(--online) / 0.78)
  );
  color: #0a1610;
  border-radius: 0.45rem;
  text-decoration: none;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-weight: 800;
  letter-spacing: 0.06em;
  box-shadow:
    0 16px 42px -22px rgb(var(--online) / 0.85),
    inset 0 0 0 1px rgba(255, 255, 255, 0.12);
  transition:
    transform 0.22s cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 0.22s ease,
    filter 0.18s ease;
}
.cta-primary:hover {
  transform: translateY(-2px);
  filter: brightness(1.08);
  box-shadow:
    0 20px 50px -20px rgb(var(--online) / 1),
    inset 0 0 0 1px rgba(255, 255, 255, 0.18);
}
.cta-primary:active { transform: translateY(0); }
.cta-primary-icon { font-size: 1.45rem; }
.cta-primary-stack {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  line-height: 1.05;
}
.cta-primary-label {
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}
.cta-primary-sub {
  margin-top: 0.2rem;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  opacity: 0.78;
  font-variant-numeric: tabular-nums;
}

.hero-cta-aux {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
}
/* Edit takes violet so it doesn't repeat the cyan that already lives
   in the eyebrow § mark. The action palette is now one button per
   colour: green (Download), violet (Edit), red (Delete), amber
   (Report) — four distinct hues, no near-doubles. */
.cta-ghost {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.6rem 0.95rem;
  background: rgb(var(--release-purple) / 0.12);
  border: 1px solid rgb(var(--release-purple) / 0.5);
  border-radius: 0.35rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--release-purple));
  text-decoration: none;
  cursor: pointer;
  transition:
    color 0.15s,
    border-color 0.15s,
    background-color 0.15s,
    transform 0.2s;
}
.cta-ghost:hover {
  color: #fff;
  border-color: rgb(var(--release-purple));
  background: rgb(var(--release-purple));
  transform: translateY(-1px);
}
/* Destructive variants. Delete keeps the full red (it's irreversible);
   Report drops to warning amber because filing a flag is cautionary,
   not destructive — and the colour split breaks up the action row so
   the eye can tell the two apart at a glance. */
.cta-ghost--danger {
  color: rgb(var(--danger));
  border-color: rgb(var(--danger) / 0.55);
  background: rgb(var(--danger) / 0.1);
}
.cta-ghost--danger:hover {
  color: #fff;
  border-color: rgb(var(--danger));
  background: rgb(var(--danger));
  transform: translateY(-1px);
}

/* ── Meta ribbon ────────────────────────────────────────────────
   Two chips on one horizontal row:
     - hash     → neutral     (the fingerprint is just text — a
                               coloured tint here read as semantic
                               weight it didn't deserve)
     - uploader → rose         (warm hue, identifies a person and
                                does not collide with any action
                                colour above)
   The created-at chip moved out: the eyebrow now carries that data
   as a relative duration ("6D AGO"), so a second copy in the
   ribbon was redundant chrome. */
.hero-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: 0.55rem;
  margin: 0;
  padding: 0;
  animation: heroFadeIn 0.55s 0.4s ease-out both;
}
.hero-meta-cell {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.55rem 0.85rem;
  background:
    linear-gradient(
      rgb(var(--rail, var(--fg-muted)) / 0.14),
      rgb(var(--rail, var(--fg-muted)) / 0.14)
    ),
    rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--rail, var(--fg-muted)) / 0.5);
  border-radius: 0.4rem;
  min-width: 0;
  transition: border-color 0.18s ease;
}
.hero-meta-cell:hover {
  border-color: rgb(var(--rail, var(--fg-muted)) / 0.75);
}
.hero-meta-cell--hash {
  /* Hash is a piece of pure data, not a status; treat it as neutral
     chrome — the chip is still framed and still selectable, just no
     colour signal beyond that. Sized to its content so it doesn't
     stretch and dominate the row. */
  --rail: var(--fg-muted);
  flex: 0 0 auto;
}
.hero-meta-cell--hash {
  background: rgb(var(--bg-elevated));
  border-color: rgb(var(--line-strong));
}
.hero-meta-cell--hash:hover {
  border-color: rgb(var(--fg-default) / 0.4);
}
.hero-meta-cell--uploader {
  --rail: var(--release-rose);
  /* Push to the right of the row so the hash (left) and the uploader
     (right) bookend the ribbon — leaves the gap in the middle as
     visual breathing room. Falls below on narrow viewports where the
     wrap pushes the cell to its own line. */
  margin-left: auto;
}
.hero-meta-cell dt {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--rail, var(--fg-muted)));
  margin: 0;
  flex-shrink: 0;
  opacity: 0.9;
}
.hero-meta-cell--hash dt { color: rgb(var(--fg-muted)); opacity: 1; }
.hero-meta-cell dd { margin: 0; min-width: 0; }
.hero-meta-hash {
  display: block;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  letter-spacing: 0.04em;
  color: rgb(var(--fg-default));
  word-break: break-all;
  user-select: all;
}
.hero-meta-user {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
  font-weight: 700;
  color: rgb(var(--release-rose));
  text-decoration: none;
  transition: filter 0.15s ease, transform 0.18s ease;
}
.hero-meta-user:hover {
  filter: brightness(1.15);
  transform: translateY(-1px);
}
.hero-meta-user-icon {
  font-size: 11px;
  color: rgb(var(--release-rose));
  opacity: 0.85;
}
.hero-meta-user--gone {
  color: rgb(var(--fg-faint));
  font-style: italic;
  cursor: help;
}
.hero-meta-user--gone .hero-meta-user-icon { color: rgb(var(--fg-faint)); }

/* ── Embedded metadata card spacing ───────────────────────────── */
.release-metadata { margin-bottom: 2rem; }

/* ╔═══════════════════════════════════════════════════════════════╗
   ║  SECTIONS                                                       ║
   ╚═══════════════════════════════════════════════════════════════╝ */
.section {
  margin-bottom: 2.25rem;
  animation: sectionRise 0.6s cubic-bezier(0.22, 1, 0.36, 1) both;
}
.section:nth-of-type(2) { animation-delay: 0.05s; }
.section:nth-of-type(3) { animation-delay: 0.1s; }
.section:nth-of-type(4) { animation-delay: 0.15s; }
.section:nth-of-type(5) { animation-delay: 0.2s; }
@keyframes sectionRise {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

.section-head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1.1rem;
  padding-bottom: 0.4rem;
}
.section-head-mark {
  font-family: 'Fraunces', 'Charter', Georgia, serif;
  font-style: italic;
  font-weight: 600;
  font-size: 1.85rem;
  line-height: 1;
  color: rgb(var(--section-tint, var(--accent)));
  transform: translateY(-2px);
  flex-shrink: 0;
  filter: drop-shadow(0 0 10px rgb(var(--section-tint, var(--accent)) / 0.35));
}
/* Per-section accent tint for the chapter mark + line. Each section
   borrows a hue that fits its content: green for the live activity
   metrics, amber for the technical NFO artefact, violet for the
   cross-seed family, red for the admin swarm console. */
.section--activity { --section-tint: var(--online); }
.section--note     { --section-tint: var(--accent); }
.section--nfo      { --section-tint: var(--warning); }
.section--cross    { --section-tint: var(--release-purple); }
.section--swarm    { --section-tint: var(--danger); }
.section--activity .section-head-line,
.section--nfo .section-head-line,
.section--cross .section-head-line,
.section--swarm .section-head-line,
.section--note .section-head-line {
  background: linear-gradient(
    90deg,
    rgb(var(--section-tint) / 0.45),
    transparent 75%
  );
}
.section-head-title {
  margin: 0;
  font-family: 'Fraunces', 'Charter', Georgia, serif;
  font-style: italic;
  font-weight: 500;
  font-size: clamp(1.15rem, 2.2vw, 1.6rem);
  letter-spacing: -0.01em;
  color: rgb(var(--fg-strong));
}
.section-head-count {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.16em;
  color: rgb(var(--fg-muted));
  padding: 0.18rem 0.5rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 999px;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
.section-head-tag {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  padding: 0.18rem 0.45rem;
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-elevated) / 0.55);
  border-radius: 0.25rem;
  cursor: help;
  flex-shrink: 0;
}
.section-head-meta {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  font-variant-numeric: tabular-nums;
}
.section-head-line {
  flex: 1 1 auto;
  height: 1px;
  background: linear-gradient(
    90deg,
    rgb(var(--line-default)),
    transparent 75%
  );
  min-width: 1rem;
}
.section-head--toggle {
  padding-bottom: 0;
}
/* Compact variant — used by the NFO row. Smaller mark, smaller
   title, tighter margin: the NFO is a release-engineering artefact
   that ships with most uploads, and rendering it at the full
   editorial chapter scale gives it visual parity with the
   description (which is more important to read). */
.section--compact { margin-bottom: 1.5rem; }
.section-head--compact { margin-bottom: 0.4rem; gap: 0.55rem; }
.section-head--compact .section-head-mark {
  font-size: 1.2rem;
  transform: translateY(-1px);
}
.section-head--compact .section-head-title {
  font-size: 0.95rem;
  font-style: italic;
  font-weight: 500;
}
.section-head--compact .section-head-meta {
  font-size: 9px;
  letter-spacing: 0.18em;
}
.section-head--compact .section-head-caret { font-size: 9px; }
.section-head--compact .section-head-button {
  padding: 0.15rem 0.05rem;
}
.section-head-button {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex: 1 1 auto;
  background: transparent;
  border: 0;
  padding: 0.2rem 0.1rem;
  cursor: pointer;
  text-align: left;
  color: inherit;
  font: inherit;
  transition: color 0.15s ease;
}
.section-head-button:hover .section-head-title {
  color: rgb(var(--accent));
}
.section-head-caret {
  margin-left: auto;
  font-size: 10px;
  color: rgb(var(--fg-muted));
  transition: transform 0.2s ease;
  flex-shrink: 0;
}
.section-head-caret.is-expanded { transform: rotate(90deg); }
.section-head-action {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.4rem 0.7rem;
  background: transparent;
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.25rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}
.section-head-action:hover {
  color: rgb(var(--fg-strong));
  border-color: rgb(var(--fg-default) / 0.35);
  background: rgb(var(--bg-elevated) / 0.4);
}

/* ╔═══════════════════════════════════════════════════════════════╗
   ║  STATS CLUSTER — tinted pill cards                              ║
   ║  Each metric carries its own semantic colour (online/warning/   ║
   ║  info/violet), tinted lightly enough to keep the page dark but  ║
   ║  vivid enough to read as separate "chips" rather than one neutr-║
   ║  al strip.                                                      ║
   ╚═══════════════════════════════════════════════════════════════╝ */
.stats-cluster {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 0.65rem;
}
.stat {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding: 0.85rem 1rem;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.04), transparent 60%),
    linear-gradient(
      rgb(var(--rail, var(--fg-muted)) / 0.16),
      rgb(var(--rail, var(--fg-muted)) / 0.16)
    ),
    rgb(var(--bg-surface));
  border: 1px solid rgb(var(--rail, var(--fg-muted)) / 0.55);
  border-radius: 0.55rem;
  box-shadow:
    0 6px 16px -10px rgba(0, 0, 0, 0.55),
    inset 0 0 0 1px rgba(255, 255, 255, 0.025);
  transition:
    background 0.2s ease,
    border-color 0.2s ease,
    transform 0.25s cubic-bezier(0.22, 1, 0.36, 1);
  isolation: isolate;
  overflow: hidden;
}
.stat::before {
  /* Faint diagonal sheen so each chip feels like a soft-lit panel
     rather than a flat colour swatch — same trick a glass UI uses. */
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.04),
    transparent 55%
  );
  pointer-events: none;
  z-index: -1;
}
.stat:hover {
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.06), transparent 60%),
    linear-gradient(
      rgb(var(--rail, var(--fg-muted)) / 0.24),
      rgb(var(--rail, var(--fg-muted)) / 0.24)
    ),
    rgb(var(--bg-surface));
  border-color: rgb(var(--rail, var(--fg-muted)) / 0.8);
  transform: translateY(-1px);
}
.stat-icon {
  font-size: 1.1rem;
  color: rgb(var(--rail, var(--fg-muted)));
  flex-shrink: 0;
  filter: drop-shadow(0 0 8px rgb(var(--rail, var(--fg-muted)) / 0.45));
}
.stat-num {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: clamp(1.35rem, 2.4vw, 1.7rem);
  font-weight: 800;
  line-height: 1;
  color: rgb(var(--rail, var(--fg-strong)));
  letter-spacing: -0.025em;
  word-break: break-word;
}
.stat-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  margin-top: 0.2rem;
}
.stat-body {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-width: 0;
}
.stat-sub {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 8.5px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--release-purple));
  padding: 0.08rem 0.35rem;
  border: 1px solid rgb(var(--release-purple) / 0.45);
  background: rgb(var(--release-purple) / 0.12);
  border-radius: 999px;
  margin-top: 0.3rem;
  font-variant-numeric: tabular-nums;
  align-self: flex-start;
}

/* One hue per metric — each chip carries its own semantic colour so
   the row reads as five distinct readings, not five almost-identical
   panels. Stats share the convention green=seeders / red=leechers /
   cyan=completed with most tracker UIs, which is intentional:
   breaking it would cost more in recognition than it would buy us in
   palette dispersion. */
.stat--seeders   { --rail: var(--online); }
.stat--leechers  { --rail: var(--danger); }
.stat--completed { --rail: var(--info); }
.stat--size      { --rail: var(--release-teal); }
.stat--volume    { --rail: var(--release-purple); }

/* Zero-value variant: keep the rail tint on the chip frame so the
   reader still parses "seeders, currently 0" rather than five
   identical grey panels, but mute only the icon glow + the number
   so the "no activity" signal still lands. */
.stat.is-zero .stat-icon {
  opacity: 0.55;
  filter: none;
}
.stat.is-zero .stat-num {
  color: rgb(var(--fg-faint));
  font-weight: 700;
}

/* ╔═══════════════════════════════════════════════════════════════╗
   ║  NOTE — uploader description editorial block                   ║
   ╚═══════════════════════════════════════════════════════════════╝ */
.note-block {
  position: relative;
  /* Top padding clears the decorative quotation watermark so the first
     line of description text never slides under the glyph. */
  padding: 3rem 1.6rem 1.3rem 2.4rem;
  background:
    linear-gradient(
      135deg,
      rgb(var(--accent) / 0.04),
      transparent 60%
    ),
    rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-strong));
  border-left: 3px solid rgb(var(--accent));
  border-radius: 0 0.35rem 0.35rem 0;
  font-size: 14px;
  line-height: 1.65;
  color: rgb(var(--fg-default));
  box-shadow: 0 6px 16px -10px rgba(0, 0, 0, 0.55);
}
.note-block::before {
  content: '“';
  position: absolute;
  top: 0.2rem;
  left: 0.85rem;
  font-family: 'Fraunces', 'Charter', Georgia, serif;
  font-size: 2.6rem;
  line-height: 1;
  font-weight: 600;
  color: rgb(var(--accent) / 0.32);
  pointer-events: none;
}

/* ╔═══════════════════════════════════════════════════════════════╗
   ║  CROSS-SEEDS LIST                                              ║
   ╚═══════════════════════════════════════════════════════════════╝ */
.cross-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.cross-item { display: block; }
.cross-link {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.85rem 1rem;
  background:
    linear-gradient(
      rgb(var(--release-purple) / 0.06),
      rgb(var(--release-purple) / 0.06)
    ),
    rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-strong));
  border-radius: 0.4rem;
  text-decoration: none;
  color: rgb(var(--fg-default));
  box-shadow: 0 4px 12px -8px rgba(0, 0, 0, 0.5);
  transition:
    background 0.18s ease,
    border-color 0.18s ease,
    transform 0.22s cubic-bezier(0.22, 1, 0.36, 1);
}
.cross-link:hover {
  background:
    linear-gradient(
      rgb(var(--release-purple) / 0.14),
      rgb(var(--release-purple) / 0.14)
    ),
    rgb(var(--bg-elevated));
  border-color: rgb(var(--release-purple) / 0.6);
  transform: translateX(2px);
}
.cross-icon {
  flex-shrink: 0;
  color: rgb(var(--fg-muted));
  font-size: 1rem;
}
.cross-name {
  flex: 1 1 auto;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
  font-weight: 600;
  color: rgb(var(--fg-strong));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.cross-link:hover .cross-name { color: rgb(var(--accent)); }
.cross-meta {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  flex-shrink: 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  font-variant-numeric: tabular-nums;
}
.cross-meta-sep { opacity: 0.45; }
.cross-meta-cat { color: rgb(var(--fg-default)); font-weight: 700; }
.cross-arrow {
  flex-shrink: 0;
  color: rgb(var(--fg-faint));
  font-size: 0.85rem;
  transition: transform 0.18s, color 0.18s;
}
.cross-link:hover .cross-arrow {
  color: rgb(var(--accent));
  transform: translateX(2px);
}
@media (max-width: 720px) {
  .cross-link {
    flex-wrap: wrap;
    align-items: flex-start;
  }
  .cross-name { white-space: normal; }
  .cross-arrow { display: none; }
}

/* ╔═══════════════════════════════════════════════════════════════╗
   ║  SWARM TABLE                                                    ║
   ╚═══════════════════════════════════════════════════════════════╝ */
.swarm-frame {
  border: 1px solid rgb(var(--line-strong));
  border-radius: 0.45rem;
  overflow-x: auto;
  background: rgb(var(--bg-elevated));
  box-shadow: 0 6px 18px -10px rgba(0, 0, 0, 0.55);
}
.swarm-table {
  width: 100%;
  border-collapse: collapse;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
}
.swarm-table thead th {
  text-align: left;
  padding: 0.65rem 1rem;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  background: rgb(var(--bg-base) / 0.4);
  border-bottom: 1px solid rgb(var(--line-default));
}
.swarm-table tbody td {
  padding: 0.6rem 1rem;
  border-bottom: 1px solid rgb(var(--line-default) / 0.55);
  color: rgb(var(--fg-default));
  vertical-align: middle;
}
.swarm-table tbody tr:last-child td { border-bottom: 0; }
.swarm-table tbody tr:hover td { background: rgb(var(--bg-elevated) / 0.45); }
.swarm-endpoint { color: rgb(var(--fg-muted)); }
.swarm-port { color: rgb(var(--fg-faint)); }
.swarm-num {
  color: rgb(var(--fg-default));
  font-variant-numeric: tabular-nums;
  font-size: 10.5px;
}
.swarm-type {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.18rem 0.5rem;
  border: 1px solid;
  border-radius: 0.2rem;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}
.swarm-type--seeder {
  color: rgb(var(--online));
  border-color: rgb(var(--online) / 0.4);
  background: rgb(var(--online) / 0.08);
}
.swarm-type--leecher {
  color: rgb(var(--warning));
  border-color: rgb(var(--warning) / 0.4);
  background: rgb(var(--warning) / 0.08);
}
.swarm-empty {
  text-align: center;
  padding: 2.5rem 1rem;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}

/* ── Tabular numerals utility (matches reports.vue) ───────────── */
.tabular-nums { font-variant-numeric: tabular-nums; }

/* Media-id badges. Each one carries a subtle tint of the database's
   brand colour so the user can scan the trio at a glance: yellow for
   IMDb, teal for TMDb, blue for TVDB. The tint is applied with low
   alpha so the chip still reads on the light theme. */
.media-id-badge {
  @apply inline-flex items-center gap-1.5 text-[10px] font-bold uppercase
         tracking-wider px-2 py-1 rounded-sm border transition-colors
         text-text-primary;
}
.media-id-badge:hover {
  filter: brightness(1.15);
}
.media-id-badge .media-id-badge-tag {
  @apply font-extrabold;
}
.media-id-badge .media-id-badge-id {
  @apply font-mono normal-case tracking-tight text-text-secondary;
}

.media-id-badge--imdb {
  background: rgba(245, 197, 24, 0.12);
  border-color: rgba(245, 197, 24, 0.45);
}
.media-id-badge--imdb .media-id-badge-tag {
  color: #f5c518;
}
.media-id-badge--tmdb {
  background: rgba(1, 180, 228, 0.12);
  border-color: rgba(1, 180, 228, 0.45);
}
.media-id-badge--tmdb .media-id-badge-tag {
  color: #01b4e4;
}
.media-id-badge--tvdb {
  background: rgba(108, 209, 97, 0.12);
  border-color: rgba(108, 209, 97, 0.45);
}
.media-id-badge--tvdb .media-id-badge-tag {
  color: #6cd161;
}

.description-content :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.description-content :deep(p) {
  margin-bottom: 1rem;
}

.description-content :deep(p:last-child) {
  margin-bottom: 0;
}

.description-content :deep(a) {
  color: #fff;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.description-content :deep(ul),
.description-content :deep(ol) {
  margin-bottom: 1rem;
  padding-left: 1.5rem;
}

.description-content :deep(li) {
  margin-bottom: 0.25rem;
}

.nfo-frame {
  position: relative;
  background: rgb(var(--bg-inset, var(--bg-base)));
  border: 1px solid rgb(var(--line-strong));
  border-radius: 0.45rem;
  padding: 1.05rem 1.1rem;
  overflow: auto;
  max-height: 70vh;
  box-shadow: 0 6px 18px -10px rgba(0, 0, 0, 0.55);
  /* Faint scanline pattern — vintage terminal flavour without going
     overboard. Almost imperceptible on dark themes, vanishes on light. */
  background-image: repeating-linear-gradient(
    180deg,
    transparent 0,
    transparent 2px,
    rgba(255, 255, 255, 0.014) 2px,
    rgba(255, 255, 255, 0.014) 3px
  );
  animation: nfoOpen 0.35s cubic-bezier(0.22, 1, 0.36, 1) both;
}
@keyframes nfoOpen {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}

.nfo-body {
  font-family: 'IBM Plex Mono', 'Cascadia Code', Menlo, ui-monospace, monospace;
  font-size: 12px;
  line-height: 1.35;
  color: rgb(var(--fg-default));
  white-space: pre;
  margin: 0;
  tab-size: 4;
  /* NFO ASCII art is visually centered when read in a fixed-width
     terminal — keeping the natural width prevents reflow. */
  width: max-content;
  min-width: 100%;
}

/* ─── Adult-content gate ────────────────────────────────────────────
   The "you opted out, so we redacted this page" treatment. Built on
   the same operator-console primitives used elsewhere in the app
   (mono eyebrows, hatched warning band, sharp danger borders) so it
   reads as a deliberate filter rather than an error. */
.adult-gate {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  max-width: 720px;
  margin: 1rem auto 4rem;
  padding: 0 0.25rem;
}
.adult-gate__back {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  transition: color 0.15s;
  width: max-content;
}
.adult-gate__back:hover {
  color: rgb(var(--fg-strong));
}
.adult-gate__panel {
  position: relative;
  border: 1px solid rgb(var(--line-default));
  border-left: 3px solid rgb(var(--danger));
  background: rgb(var(--bg-secondary));
  /* Subtle danger hatching tints the whole document so it reads as
     "warning surface" without overwhelming the actual content. */
  background-image: repeating-linear-gradient(
    -45deg,
    transparent,
    transparent 16px,
    rgba(229, 62, 62, 0.03) 16px,
    rgba(229, 62, 62, 0.03) 18px
  );
  border-radius: 0.5rem;
  overflow: hidden;
  animation: gate-rise 0.45s cubic-bezier(0.2, 0.7, 0.2, 1) both;
}
@keyframes gate-rise {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.adult-gate__hatch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.7rem 1.1rem;
  border-bottom: 1px solid rgb(var(--line-default));
  background: repeating-linear-gradient(
    -45deg,
    rgba(229, 62, 62, 0.18),
    rgba(229, 62, 62, 0.18) 14px,
    rgba(229, 62, 62, 0.06) 14px,
    rgba(229, 62, 62, 0.06) 28px
  );
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
}
.adult-gate__hatch-label {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  color: rgb(var(--danger));
}
.adult-gate__hatch-route {
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: lowercase;
  color: rgb(var(--fg-muted));
}
.adult-gate__hash {
  color: rgb(var(--fg-strong));
  background: rgb(var(--fg-strong));
  /* The middle of the hash is rendered as an opaque bar by giving the
     foreground the same colour as the background. The text is still
     in the DOM (so screen readers ignore it via aria-hidden on the
     wrapping span only when needed) but visually censored. */
}

.adult-gate__body {
  position: relative;
  padding: 2rem 1.6rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}
.adult-gate__eyebrow {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.adult-gate__title {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
  font-size: clamp(2rem, 6vw, 3.4rem);
  font-weight: 900;
  letter-spacing: -0.025em;
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
  line-height: 1;
}
.adult-gate__title-word {
  font-style: italic;
}
.adult-gate__title-stamp {
  position: relative;
  display: inline-flex;
  padding: 0.2em 0.6em 0.25em;
  background: rgb(var(--danger));
  color: #fff;
  letter-spacing: 0.05em;
  /* A faint, off-axis tilt to feel like an actual rubber-stamp impression. */
  transform: rotate(-1.5deg);
  box-shadow:
    inset 0 0 0 2px rgba(255, 255, 255, 0.08),
    0 1px 0 rgba(0, 0, 0, 0.4);
}
.adult-gate__title-stamp::after {
  content: '';
  position: absolute;
  inset: -2px;
  border: 2px dashed rgba(255, 255, 255, 0.18);
  pointer-events: none;
}
.adult-gate__title-stamp-inner {
  position: relative;
  display: inline-block;
}

.adult-gate__redacted {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  margin: 0.5rem 0 0.25rem;
}
.adult-gate__redacted span {
  display: block;
  height: 0.95rem;
  background: rgb(var(--fg-strong));
  border-radius: 1px;
  /* Three censorship bars approximating the title block — the eye
     reads "there's a title here, you just don't see it". */
  animation: gate-bar 1.2s cubic-bezier(0.2, 0.6, 0.2, 1) both;
}
.adult-gate__redacted span:nth-child(1) { width: 78%; animation-delay: 0.05s; }
.adult-gate__redacted span:nth-child(2) { width: 64%; animation-delay: 0.12s; }
.adult-gate__redacted span:nth-child(3) { width: 42%; animation-delay: 0.19s; }
@keyframes gate-bar {
  0% { transform: scaleX(0.05); transform-origin: left; opacity: 0.2; }
  60% { transform: scaleX(1.04); opacity: 1; }
  100% { transform: scaleX(1); opacity: 1; }
}

.adult-gate__meta {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.65rem;
  margin: 0.4rem 0 0.5rem;
  padding: 0.85rem 1rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.4rem;
  background: rgb(var(--bg-elevated) / 0.6);
}
@media (max-width: 540px) {
  .adult-gate__meta {
    grid-template-columns: 1fr;
  }
}

/* ╔═══════════════════════════════════════════════════════════════╗
   ║  MOBILE LAYOUT — keep every chip / button / data row usable    ║
   ║  on a 360-420 px viewport. The fix-list is mostly about not    ║
   ║  letting flex content overflow its parent (the InfoHash was    ║
   ║  the worst offender — 40 hex chars in mono push past any 360-  ║
   ║  px hero), and about giving touch targets enough room.         ║
   ╚═══════════════════════════════════════════════════════════════╝ */
@media (max-width: 640px) {
  .release-page {
    padding: 1.25rem 0.9rem 4rem;
  }

  /* ── Hero ────────────────────────────────────────────────── */
  .hero {
    padding: 1.25rem 1.1rem 1.2rem;
    border-radius: 0.5rem;
  }
  .hero-eyebrow {
    font-size: 9.5px;
    letter-spacing: 0.18em;
    gap: 0.4rem;
  }
  /* Report parks on its own line on mobile so the eyebrow doesn't
     compete with the touch target on narrow screens. */
  .hero-eyebrow-report {
    margin-left: 0;
    margin-top: 0.4rem;
    flex-basis: 100%;
    justify-content: center;
  }
  .hero-eyebrow-spacer { display: none; }

  /* CTAs go vertical on mobile: Download stays the dominant signal
     at full width, then Edit + Delete share the row below it. */
  .hero-cta {
    flex-direction: column;
    align-items: stretch;
    gap: 0.5rem;
  }
  .cta-primary {
    justify-content: center;
    padding: 0.9rem 1rem;
  }
  .cta-primary-stack { align-items: center; }
  .hero-cta-aux {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem;
  }
  .cta-ghost {
    justify-content: center;
    padding: 0.7rem 0.6rem;
  }

  /* Meta ribbon — the InfoHash overflow killer. On mobile the hash
     cell takes the full row and the 40-hex string wraps onto a
     second line. The uploader sits below, no `margin-left: auto`
     so it doesn't try to push off the right edge. */
  .hero-meta-cell--hash {
    flex: 1 1 100%;
    width: 100%;
    flex-wrap: wrap;
    gap: 0.4rem 0.65rem;
  }
  .hero-meta-cell--hash dd { flex: 1 1 100%; }
  .hero-meta-hash {
    font-size: 10.5px;
    line-height: 1.45;
  }
  .hero-meta-cell--uploader {
    margin-left: 0;
    flex: 1 1 auto;
  }

  /* ── Section heads ───────────────────────────────────────── */
  .section { margin-bottom: 1.75rem; }
  .section-head {
    gap: 0.5rem;
    margin-bottom: 0.85rem;
  }
  .section-head-mark { font-size: 1.5rem; }
  .section-head-title { font-size: 1.1rem; }

  /* ── Stats cluster — two columns on mobile so a 5-metric row
        doesn't become a 5-row stack that pushes the next section
        below the fold. ──────────────────────────────────────── */
  .stats-cluster {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem;
  }
  .stat {
    padding: 0.7rem 0.75rem;
    gap: 0.6rem;
  }
  .stat-icon { font-size: 0.95rem; }
  .stat-num { font-size: clamp(1.05rem, 4.5vw, 1.4rem); }
  .stat-label {
    font-size: 8.5px;
    letter-spacing: 0.18em;
  }

  /* ── Note block ──────────────────────────────────────────── */
  .note-block {
    padding: 2.4rem 1.1rem 1rem 1.6rem;
    font-size: 13.5px;
    line-height: 1.6;
  }
  .note-block::before {
    font-size: 2.1rem;
    left: 0.55rem;
    top: 0.3rem;
  }

  /* ── Cross-seed rows ─────────────────────────────────────── */
  .cross-link { padding: 0.7rem 0.85rem; }
  .cross-name { font-size: 11.5px; }
  .cross-meta {
    font-size: 9.5px;
    letter-spacing: 0.08em;
    width: 100%;
    margin-top: 0.25rem;
  }

  /* ── Swarm table — already wraps in horizontal scroll, just
        tighten the inner padding so we can see more on screen. */
  .swarm-table thead th,
  .swarm-table tbody td {
    padding: 0.5rem 0.65rem;
    font-size: 10px;
  }
  .swarm-table thead th { font-size: 9px; letter-spacing: 0.16em; }
}
.adult-gate__meta div {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.adult-gate__meta dt {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  margin: 0;
}
.adult-gate__meta dd {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 12.5px;
  font-weight: 700;
  color: rgb(var(--fg-strong));
}

.adult-gate__copy {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: rgb(var(--fg-default));
  max-width: 56ch;
}

.adult-gate__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  margin-top: 0.4rem;
}
.adult-gate__cta {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.7rem 1.05rem;
  border: 1px solid rgb(var(--danger));
  background: rgb(var(--danger));
  color: #fff;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  border-radius: 9999px;
  transition: filter 0.15s;
}
.adult-gate__cta:hover {
  filter: brightness(1.1);
}
.adult-gate__cta--ghost {
  background: transparent;
  color: rgb(var(--fg-strong));
  border-color: rgb(var(--line-default));
}
.adult-gate__cta--ghost:hover {
  border-color: rgb(var(--fg-default) / 0.4);
  filter: none;
}

.adult-gate__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.65rem 1.1rem;
  border-top: 1px dashed rgb(var(--line-default));
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  background: rgb(var(--bg-secondary));
}
.adult-gate__foot-mono {
  text-transform: lowercase;
  letter-spacing: 0.04em;
  color: rgb(var(--fg-default));
}
</style>
