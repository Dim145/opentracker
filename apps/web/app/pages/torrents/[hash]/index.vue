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

  <div v-else-if="torrent">
    <NuxtLink
      to="/torrents"
      class="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-text-muted hover:text-text-strong mb-6 transition-colors"
    >
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
    <div v-if="moderationOnTop" class="mb-6">
      <TorrentModerationPanel
        :hash="torrent.infoHash"
        :status="(torrent.moderationStatus as 'pending' | 'accepted' | 'changes_requested' | 'rejected')"
        :uploader-id="torrent.uploaderId ?? null"
        @status-change="onModerationStatusChange"
      />
    </div>

    <!-- Torrent Header -->
    <div class="card mb-6 overflow-hidden">
      <div class="card-body !p-6">
        <div
          class="flex flex-col md:flex-row md:items-center justify-between gap-4"
        >
          <div>
            <!-- Surfaced for the uploader and any staff member: the
                 row's moderation state. The badge itself returns nothing
                 when the row is `accepted`, so the wrapper only shows
                 when it actually carries information. -->
            <div
              v-if="torrent.moderationStatus && torrent.moderationStatus !== 'accepted'"
              class="mb-1"
            >
              <TorrentModerationBadge :status="torrent.moderationStatus" />
            </div>
            <h2
              class="font-bold text-text-primary tracking-tight break-words [overflow-wrap:anywhere] [text-wrap:pretty]"
              :class="titleSizeClass(torrent.name)"
              :title="torrent.name"
            >
              {{ withWrapHints(torrent.name) }}
            </h2>
            <!-- Category + Tag + Media-id Badges -->
            <div
              v-if="
                torrent.category ||
                torrent.tags?.length ||
                torrent.imdbId ||
                torrent.tmdbId ||
                torrent.tvdbId
              "
              class="mt-2 flex flex-wrap items-center gap-2"
            >
              <span
                v-if="torrent.category"
                class="text-[10px] font-bold bg-bg-tertiary border border-border px-2 py-1 rounded-sm text-text-secondary uppercase tracking-wider"
              >
                {{ torrent.category.name }}
              </span>
              <NuxtLink
                v-for="tag in torrent.tags"
                :key="tag.id"
                :to="`/torrents?tag=${encodeURIComponent(tag.slug)}`"
                class="text-[10px] font-bold border px-2 py-1 rounded-sm uppercase tracking-wider hover:opacity-80 transition-opacity flex items-center gap-1.5"
                :style="tagBadgeStyle(tag)"
              >
                <span
                  class="inline-block w-2 h-2 rounded-full"
                  :style="{ backgroundColor: tag.color }"
                />
                {{ tag.name }}
              </NuxtLink>

              <!-- Media-database links — clickable badges that open the
                   official IMDb / TMDb / TVDB page in a new tab. -->
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
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <!-- Edit Button (owner/mod/admin only) -->
            <NuxtLink
              v-if="canEdit"
              :to="`/torrents/${torrent.infoHash}/edit`"
              class="btn btn-secondary flex items-center gap-2 !py-2 text-xs font-bold uppercase tracking-wider"
            >
              <Icon name="ph:pencil-simple-bold" />
              <span>{{ $t('common.edit') }}</span>
            </NuxtLink>
            <!-- Delete Button (owner/mod/admin only) -->
            <button
              v-if="canDelete"
              class="btn btn-secondary flex items-center gap-2 !py-2 text-xs font-bold uppercase tracking-wider text-error hover:bg-error/10"
              @click="confirmDelete"
            >
              <Icon name="ph:trash-bold" />
              <span>{{ $t('common.delete') }}</span>
            </button>
            <!-- Report Button (any authenticated user). Mods/admins
                 and even uploaders can file — the moderation queue
                 will sort it. -->
            <button
              v-if="canReport"
              class="btn btn-secondary flex items-center gap-2 !py-2 text-xs font-bold uppercase tracking-wider !text-error/85 hover:!bg-error/10 hover:!border-error/40"
              @click="reportOpen = true"
            >
              <Icon name="ph:flag-bold" />
              <span>{{ $t('torrents.detail.report') }}</span>
            </button>
            <a
              :href="`/api/torrents/${torrent.infoHash}/download`"
              class="btn btn-primary flex items-center gap-2 !py-2 text-xs font-bold uppercase tracking-wider"
              download
            >
              <Icon name="ph:download-simple-bold" />
              <span>{{ $t('torrents.detail.download') }}</span>
            </a>
          </div>
        </div>

        <div class="mt-6 pt-6 border-t border-border/50 flex flex-wrap gap-6">
          <div class="flex flex-col">
            <span
              class="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1"
              >{{ $t('torrents.detail.infoHash') }}</span
            >
            <code
              class="text-xs font-mono text-text-secondary bg-bg-tertiary/50 px-2 py-1 rounded border border-border/50"
            >
              {{ torrent.infoHash }}
            </code>
          </div>
          <div class="flex flex-col">
            <span
              class="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1"
              >{{ $t('torrents.detail.createdAt') }}</span
            >
            <div class="flex items-center gap-2">
              <span class="text-xs font-mono text-text-secondary">{{
                formatDate(torrent.createdAt)
              }}</span>
              <span
                class="text-[10px] bg-bg-tertiary border border-border px-1.5 py-0.5 rounded-sm text-text-muted font-bold"
              >
                {{ formatAge(torrent.createdAt) }}
              </span>
            </div>
          </div>
          <div class="flex flex-col">
            <span
              class="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1"
              >{{ $t('torrents.detail.uploadedBy') }}</span
            >
            <NuxtLink
              v-if="torrent.uploader"
              :to="`/users/${torrent.uploader.id}`"
              class="inline-flex items-center gap-1.5 text-xs font-mono text-text-secondary hover:text-accent transition-colors"
            >
              <Icon name="ph:user-bold" class="text-[11px] text-text-muted" />
              <span>@{{ torrent.uploader.username }}</span>
            </NuxtLink>
            <span
              v-else
              class="inline-flex items-center gap-1.5 text-xs font-mono text-text-faint italic"
              :title="$t('torrents.detail.uploaderGoneTooltip')"
            >
              <Icon name="ph:user-bold" class="text-[11px]" />
              {{ $t('torrents.detail.uploaderGone') }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Rich metadata card. We pick the renderer by source so a
         game lands on the IGDB-specific card (cover + platforms +
         modes), a book on the Open Library / Google Books card
         (authors + publisher + pages) and a movie/TV on the TMDb
         one. Silent no-op when integration is disabled or the
         lookup missed. -->
    <GameMetadataCard
      v-if="metadata && metadata.source === 'igdb'"
      :metadata="metadata"
      class="mb-6"
    />
    <BookMetadataCard
      v-else-if="metadata && metadata.source === 'openlibrary'"
      :metadata="metadata"
      class="mb-6"
    />
    <MediaMetadataCard
      v-else-if="metadata"
      :metadata="metadata"
      class="mb-6"
    />

    <!-- Stats Grid — 4 base KPIs + an optional 5th `volume exchanged`
         card that appears only once swarm activity has produced
         actual byte transfers (otherwise it's just "0 echanged",
         which adds noise without value). The seeders + leechers
         tiles carry a small accent chip ("· N x-seed") whenever
         a chunk of the swarm is also active on a cross-seed of
         the same content. -->
    <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4 mb-6">
      <StatsCard
        :title="$t('torrents.detail.stats.seeders')"
        :value="torrent.stats.seeders"
        icon="ph:arrow-up-bold"
        variant="success"
        :sub="xSeedSeederSub"
      />
      <StatsCard
        :title="$t('torrents.detail.stats.leechers')"
        :value="torrent.stats.leechers"
        icon="ph:arrow-down-bold"
        variant="warning"
        :sub="xSeedLeecherSub"
      />
      <StatsCard
        :title="$t('torrents.detail.stats.completed')"
        :value="torrent.stats.completed"
        icon="ph:check-circle-bold"
      />
      <StatsCard
        :title="$t('torrents.detail.stats.totalSize')"
        :value="formatSize(torrent.size)"
        icon="ph:database-bold"
      />
      <StatsCard
        v-if="showVolumeCard"
        :title="$t('torrents.detail.stats.exchanged')"
        :value="totalUploadedDisplay"
        icon="ph:cloud-arrow-up-bold"
        :sub="xSeedVolumeSub"
      />
    </div>

    <!-- Description -->
    <div v-if="torrent.description" class="card mb-6">
      <div class="card-header">
        <div class="flex items-center gap-2">
          <Icon name="ph:article-bold" class="text-text-muted" />
          <h3
            class="text-xs font-bold uppercase tracking-wider text-text-primary"
          >
            {{ $t('torrents.detail.description') }}
          </h3>
        </div>
      </div>
      <div class="card-body !p-6">
        <div
          class="prose prose-invert prose-xs max-w-none description-content"
          v-html="renderedDescription"
        ></div>
      </div>
    </div>

    <!-- NFO (collapsed by default — releases can be huge) -->
    <div v-if="torrent.nfo" class="card mb-6">
      <div class="card-header flex items-stretch gap-0 !p-0">
        <button
          type="button"
          class="flex-1 flex items-center gap-2 text-left px-4 py-3 hover:bg-fg-default/5 transition-colors min-w-0"
          :aria-expanded="nfoExpanded"
          aria-controls="nfo-body"
          @click="nfoExpanded = !nfoExpanded"
        >
          <Icon
            name="ph:caret-right-bold"
            class="text-text-muted text-[10px] transition-transform shrink-0"
            :class="{ 'rotate-90': nfoExpanded }"
          />
          <Icon name="ph:scroll-bold" class="text-text-muted shrink-0" />
          <h3
            class="text-xs font-bold uppercase tracking-wider text-text-primary shrink-0"
          >
            NFO
          </h3>
          <span
            class="text-[10px] text-text-muted font-mono uppercase tracking-widest truncate"
          >
            · {{ nfoMeta }}
          </span>
        </button>
        <button
          v-if="nfoExpanded"
          type="button"
          class="px-4 py-3 border-l border-border text-[10px] font-bold uppercase tracking-widest text-text-muted hover:text-text-strong hover:bg-fg-default/5 transition-colors flex items-center gap-1 shrink-0"
          @click="copyNfo"
        >
          <Icon :name="nfoCopied ? 'ph:check-bold' : 'ph:copy-bold'" />
          {{ nfoCopied ? $t('common.copied') : $t('common.copy') }}
        </button>
      </div>
      <div v-show="nfoExpanded" id="nfo-body" class="nfo-frame">
        <pre class="nfo-body">{{ torrent.nfo }}</pre>
      </div>
    </div>

    <!-- Peer List — admin-only.
         The raw peer list (anonymised endpoints, port, byte counts,
         last-seen timestamps) is operational data: useful to debug a
         peer that's mis-reporting, not to a regular member. We hide
         the whole card from non-admins to keep the public detail
         page focused on the release itself. -->
    <div v-if="user?.isAdmin" class="card">
      <div class="card-header">
        <div class="flex items-center gap-2">
          <Icon name="ph:users-bold" class="text-text-muted" />
          <h3
            class="text-xs font-bold uppercase tracking-wider text-text-primary"
          >
            {{ $t('torrents.detail.swarm.title', { n: torrent.peers.length }) }}
          </h3>
          <span
            class="ml-auto text-[9px] font-mono uppercase tracking-widest text-text-muted px-1.5 py-0.5 rounded border border-border bg-bg-tertiary"
            :title="$t('torrents.detail.swarm.adminOnlyTooltip')"
          >
            {{ $t('torrents.detail.swarm.adminOnly') }}
          </span>
        </div>
      </div>
      <div class="overflow-x-auto">
        <table class="data-table">
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
              <td
                colspan="5"
                class="text-center text-text-muted py-12 font-mono text-xs uppercase tracking-widest"
              >
                {{ $t('torrents.detail.swarm.empty') }}
              </td>
            </tr>
            <tr v-for="peer in torrent.peers" :key="peer.id">
              <td class="font-mono text-xs">
                <span class="text-text-muted"
                  >{{ peer.id.slice(0, 12) }}...</span
                >
                <span class="text-text-muted">:{{ peer.port }}</span>
              </td>
              <td>
                <span
                  class="stat-badge"
                  :class="peer.isSeeder ? 'stat-seeders' : 'stat-leechers'"
                >
                  <Icon
                    :name="
                      peer.isSeeder ? 'ph:arrow-up-bold' : 'ph:arrow-down-bold'
                    "
                    class="text-[8px]"
                  />
                  {{ peer.isSeeder ? $t('torrents.detail.swarm.seeder') : $t('torrents.detail.swarm.leecher') }}
                </span>
              </td>
              <td class="text-text-secondary font-mono text-[10px]">
                {{ formatSize(peer.uploaded) }}
              </td>
              <td class="text-text-secondary font-mono text-[10px]">
                {{ formatSize(peer.downloaded) }}
              </td>
              <td class="text-text-muted font-mono text-[10px] text-right">
                {{ formatAge(peer.lastSeen) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Cross-seeds — sibling torrents that ship the same files
         under a different info_hash (different piece size, different
         private flag, different announce list). Hidden when the
         backend hasn't found any siblings; visible to everyone so a
         member can swap to a different `.torrent` of the same
         content if their current one is sparse. -->
    <div v-if="crossSeeds && crossSeeds.items.length > 0" class="card">
      <div class="card-header">
        <div class="flex items-center gap-2">
          <Icon name="ph:arrows-left-right-bold" class="text-text-muted" />
          <h3
            class="text-xs font-bold uppercase tracking-wider text-text-primary"
          >
            {{ $t('torrents.detail.crossSeeds.title', { n: crossSeeds.items.length }) }}
          </h3>
        </div>
      </div>
      <div class="overflow-x-auto">
        <table class="data-table">
          <thead>
            <tr>
              <th>{{ $t('torrents.detail.crossSeeds.name') }}</th>
              <th>{{ $t('torrents.detail.crossSeeds.category') }}</th>
              <th class="text-right">{{ $t('torrents.detail.crossSeeds.size') }}</th>
              <th class="text-right">{{ $t('torrents.detail.crossSeeds.uploaded') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="sibling in crossSeeds.items" :key="sibling.id">
              <td>
                <NuxtLink
                  :to="`/torrents/${sibling.infoHash}`"
                  class="text-text-primary hover:text-accent transition-colors"
                >
                  {{ sibling.name }}
                </NuxtLink>
              </td>
              <td class="text-text-muted">
                {{ sibling.category?.name ?? '—' }}
              </td>
              <td class="text-right">{{ formatSize(sibling.size) }}</td>
              <td class="text-right text-text-muted">{{ formatAge(sibling.createdAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Moderation panel (bottom placement) — only when the row is
         in a final state. For pending / changes_requested rows the
         panel renders at the top instead, before the metadata. -->
    <div v-if="!moderationOnTop" class="mt-6">
      <TorrentModerationPanel
        :hash="torrent.infoHash"
        :status="(torrent.moderationStatus as 'pending' | 'accepted' | 'changes_requested' | 'rejected')"
        :uploader-id="torrent.uploaderId ?? null"
        @status-change="onModerationStatusChange"
      />
    </div>

    <!-- Delete confirmation now handled by the shared <ConfirmHost /> via
         useConfirm() — see confirmDelete() below. -->

    <!-- Report modal — opened from the action bar above. Renders only
         when the operator clicks the Report button (it's teleported to
         body so it doesn't matter where in the tree it sits). -->
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
import { withWrapHints, titleSizeClass } from '~/utils/displayTitle';

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
  background: rgb(var(--bg-inset));
  border-top: 1px solid rgb(var(--line-default));
  padding: 1rem;
  overflow: auto;
  max-height: 70vh;
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
