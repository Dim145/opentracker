<template>
  <div class="card">
    <div class="card-header">
      <div class="queue-head">
        <div class="queue-head-left">
          <Icon name="ph:gavel" class="queue-head-icon" />
          <h3 class="queue-head-title">{{ $t('admin.pendingTorrents.title') }}</h3>
        </div>
        <div class="queue-segments" role="tablist">
          <button
            v-for="opt in STATUS_FILTERS"
            :key="opt.value"
            type="button"
            class="queue-segment"
            :class="[
              `queue-segment--${opt.value}`,
              { 'queue-segment--active': filter === opt.value },
            ]"
            @click="filter = opt.value"
          >
            <span v-if="opt.dot" class="queue-segment-dot" :class="`queue-segment-dot--${opt.value}`" />
            <span class="queue-segment-label">{{ opt.label }}</span>
            <span class="queue-segment-count">{{ counts[opt.value] }}</span>
          </button>
        </div>
      </div>
    </div>

    <div class="card-body">
      <p class="queue-intro">
        <i18n-t keypath="admin.pendingTorrents.intro.lead" tag="span">
          <template #accepted>
            <strong>{{ $t('admin.pendingTorrents.intro.accepted') }}</strong>
          </template>
        </i18n-t>
        <span class="queue-intro-pip queue-intro-pip--pending">{{ $t('admin.pendingTorrents.intro.pendingPip') }}</span>
        {{ $t('admin.pendingTorrents.intro.pendingSuffix') }}
        <span class="queue-intro-pip queue-intro-pip--changes">{{ $t('admin.pendingTorrents.intro.changesPip') }}</span>
        {{ $t('admin.pendingTorrents.intro.changesSuffix') }}
        <span class="queue-intro-pip queue-intro-pip--rejected">{{ $t('admin.pendingTorrents.intro.rejectedPip') }}</span>
        {{ $t('admin.pendingTorrents.intro.trail') }}
      </p>

      <div v-if="loading" class="queue-loading">
        <Icon name="ph:circle-notch" class="animate-spin" />
        {{ $t('admin.pendingTorrents.loading') }}
      </div>

      <div v-else-if="visibleTorrents.length === 0" class="queue-empty">
        <Icon name="ph:check-circle-fill" class="queue-empty-glyph" />
        <p class="queue-empty-text">{{ $t('admin.pendingTorrents.empty.headline') }}</p>
        <p class="queue-empty-help">
          {{ $t('admin.pendingTorrents.empty.help') }}
        </p>
      </div>

      <ul v-else class="queue-list">
        <li
          v-for="row in visibleTorrents"
          :key="row.id"
          class="queue-row"
          :class="`queue-row--${row.moderationStatus}`"
        >
          <button
            type="button"
            class="queue-row-name"
            :title="row.name"
            aria-haspopup="dialog"
            @click="openRow(row)"
          >
            {{ row.name }}
          </button>

          <TorrentModerationBadge :status="row.moderationStatus" />

          <!-- Pourquoi cette ligne est là où elle est. On montre les MOTIFS
               et non le score : un nombre nu n'apprendrait rien à personne. -->
          <div v-if="row.priority?.reasons?.length || row.claim" class="queue-flags">
            <span v-if="row.claim" class="queue-flag queue-flag--claim">
              <Icon name="ph:hand-grabbing" />
              {{ $t('mod.queue.claimedBy', { name: row.claim.by?.username ?? '—' }) }}
            </span>
            <span
              v-for="reason in row.priority?.reasons ?? []"
              :key="reason"
              class="queue-flag"
              :class="`queue-flag--${reason}`"
            >
              {{ $t(`mod.queue.why.${reason}`) }}
            </span>
          </div>

          <dl class="queue-row-meta">
            <div>
              <dt>{{ $t('admin.pendingTorrents.meta.uploadedBy') }}</dt>
              <dd>
                <NuxtLink
                  v-if="row.uploader"
                  :to="`/users/${row.uploader.id}`"
                  class="queue-link"
                >
                  @{{ row.uploader.username }}
                </NuxtLink>
                <span v-else>—</span>
              </dd>
            </div>
            <div v-if="row.category">
              <dt>{{ $t('admin.pendingTorrents.meta.category') }}</dt>
              <dd>{{ row.category.name }}</dd>
            </div>
            <div>
              <dt>{{ $t('admin.pendingTorrents.meta.cast') }}</dt>
              <dd>{{ formatDate(row.createdAt) }}</dd>
            </div>
            <div v-if="row.moderatedBy && row.moderatedAt">
              <dt>{{ $t('admin.pendingTorrents.meta.lastAction') }}</dt>
              <dd>
                <NuxtLink
                  :to="`/users/${row.moderatedBy.id}`"
                  class="queue-link"
                >
                  @{{ row.moderatedBy.username }}
                </NuxtLink>
                <span class="queue-meta-soft">·  {{ formatDate(row.moderatedAt) }}</span>
              </dd>
            </div>
          </dl>

          <NuxtLink
            :to="`/torrents/${row.infoHash}`"
            class="queue-row-cta"
            :title="$t('admin.pendingTorrents.openTitle')"
          >
            <Icon name="ph:arrow-right-bold" />
          </NuxtLink>
        </li>
      </ul>
    </div>

    <ModerationPanel
      :row="selected"
      :position="panelPosition"
      @close="selected = null"
      @decided="onDecided"
      @snoozed="onDecided"
      @warn="onWarn"
    />

    <WarningDialog
      v-model="warnFor"
      @issued="load"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue';
import TorrentModerationBadge from '~/components/torrent/TorrentModerationBadge.vue';
import ModerationPanel, { type PanelRow } from '~/components/admin/ModerationPanel.vue';
import WarningDialog from '~/components/admin/WarningDialog.vue';

const { t } = useI18n();

type Status = 'pending' | 'accepted' | 'changes_requested' | 'rejected';
type FilterValue = 'all' | 'pending' | 'changes_requested' | 'rejected';

interface QueueRow {
  id: string;
  infoHash: string;
  name: string;
  createdAt: string;
  moderationStatus: Status;
  moderatedAt: string | null;
  uploader: { id: string; username: string } | null;
  category: { id: string; name: string } | null;
  moderatedBy: { id: string; username: string } | null;
  // Calculés par l'API depuis des données qu'elle avait déjà : historique de
  // l'uploadeur, doublon, drapeaux, verdict des règles rejoué en consultatif.
  signals: PanelRow['signals'];
  priority: { score: number; reasons: string[] } | null;
  claim: { by: { id: string; username: string } | null; at: string } | null;
  snoozedUntil: string | null;
}

const STATUS_FILTERS = computed<{ value: FilterValue; label: string; dot: boolean }[]>(() => [
  { value: 'all', label: t('admin.pendingTorrents.filters.all'), dot: false },
  { value: 'pending', label: t('admin.pendingTorrents.filters.pending'), dot: true },
  { value: 'changes_requested', label: t('admin.pendingTorrents.filters.changes'), dot: true },
  { value: 'rejected', label: t('admin.pendingTorrents.filters.rejected'), dot: true },
]);

// Default to "pending" — the queue lands first on the active work.
// Moderators can flip to "all" or the closed states from the
// segmented control above.
const filter = ref<FilterValue>('pending');
const torrents = ref<QueueRow[]>([]);
const loading = ref(true);

async function load() {
  loading.value = true;
  try {
    const res = await $fetch<QueueRow[]>('/api/mod/torrents/pending');
    torrents.value = Array.isArray(res) ? res : [];
  } catch (err) {
    console.error('[admin/queue] load failed:', err);
    torrents.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(load);

const visibleTorrents = computed(() => {
  if (filter.value === 'all') return torrents.value;
  return torrents.value.filter((t) => t.moderationStatus === filter.value);
});

const counts = computed(() => {
  const result: Record<FilterValue, number> = {
    all: torrents.value.length,
    pending: 0,
    changes_requested: 0,
    rejected: 0,
  };
  for (const t of torrents.value) {
    if (t.moderationStatus in result) {
      result[t.moderationStatus as FilterValue]++;
    }
  }
  return result;
});

/* ── Le plan de travail ───────────────────────────────────────────────────
 *
 * `selected` est la ligne ouverte dans le panneau. Après une décision on
 * n'appelle pas simplement `load()` : on avance au SUIVANT de la file avant
 * de recharger, parce que le point de tout ceci est d'enchaîner. Un modérateur
 * qui traite douze envois ne doit pas retrouver douze fois la liste au début.
 */
const selected = ref<QueueRow | null>(null);
const warnFor = ref<PanelRow | null>(null);

const panelPosition = computed(() => {
  if (!selected.value) return null;
  const list = visibleTorrents.value;
  const i = list.findIndex((r) => r.id === selected.value!.id);
  return i === -1 ? null : `${i + 1} / ${list.length}`;
});

function openRow(row: QueueRow) {
  selected.value = row;
}

function onWarn(row: PanelRow) {
  warnFor.value = row;
}

async function onDecided(id: string) {
  // Quel est le suivant ? Question posée AVANT le rechargement : après, la
  // ligne décidée aura quitté la file et l'index ne voudrait plus rien dire.
  const list = visibleTorrents.value;
  const i = list.findIndex((r) => r.id === id);
  const nextId = i >= 0 ? (list[i + 1]?.id ?? null) : null;

  await load();

  const next = nextId ? torrents.value.find((r) => r.id === nextId) : null;
  // On n'enchaîne que sur ce qui attend encore une décision : tomber sur une
  // ligne déjà tranchée serait une impasse silencieuse.
  selected.value = next && next.moderationStatus === 'pending' ? next : null;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
</script>

<style scoped>
/*
 * Moderation queue — a "triage" surface. Each filter segment is
 * coloured by its status hue (amber / sky / red) so the moderator
 * can pick a lane at a glance, and the rows themselves carry the
 * same hue on a thick left rail + a tinted background.
 */

.queue-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.875rem;
  width: 100%;
}
.queue-head-left {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
}
.queue-head-icon {
  font-size: 1.15rem;
  color: rgb(var(--fg-strong));
}
.queue-head-title {
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: calc(0.18em * var(--tracking-scale));
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
  margin: 0;
  font-family: var(--font-mono);
}

/* ── Segmented filter ─────────────────────────────────── */
.queue-segments {
  display: inline-flex;
  /* Un contrôle segmenté n'est pas un titre : sur un téléphone il
     s'enroule au lieu de pousser la page hors du cadre. */
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-lg);
}
.queue-segment {
  --s: var(--fg-muted);
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  background: transparent;
  border: 1px solid transparent;
  padding: 0.4rem 0.7rem;
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: calc(0.1em * var(--tracking-scale));
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  font-family: var(--font-mono);
  transition:
    background var(--dur-2) ease,
    color var(--dur-2) ease,
    border-color var(--dur-2) ease;
}
.queue-segment--pending           { --s: var(--warning); }
.queue-segment--changes_requested { --s: var(--info); }
.queue-segment--rejected          { --s: var(--danger); }
.queue-segment--all               { --s: 250 250 250; }

.queue-segment:hover {
  color: rgb(var(--fg-strong));
  background: rgb(var(--s) / 0.08);
}
.queue-segment--active {
  background: rgb(var(--s) / 0.18);
  border-color: rgb(var(--s) / 0.6);
  /* Le libellé prend l'avant-plan fort, pas la teinte : sur son propre fond
     teinté à 18 %, la teinte mesurait 3,91:1 en thème clair — sous le seuil
     de 4,5:1 pour ce corps (10 px). L'état actif reste lisible sans elle : il
     porte déjà la pastille colorée, la bordure et le fond. */
  color: rgb(var(--fg-strong));
}
.queue-segment-dot {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-pill);
  background: rgb(var(--s));
  box-shadow: 0 0 0 3px rgb(var(--s) / 0.2);
}
.queue-segment-count {
  font-family: var(--font-mono);
  font-size: 0.625rem;
  background: rgb(var(--s) / 0.18);
  /* Même raison que le libellé au-dessus : la teinte sur son propre fond
     teinté mesurait 3,14:1 en thème clair. Le chiffre se lit en avant-plan,
     la teinte reste portée par le fond et la bordure. */
  color: rgb(var(--fg-strong));
  padding: 0.05rem 0.4rem;
  border-radius: var(--radius-pill);
  border: 1px solid rgb(var(--s) / 0.5);
  font-weight: 700;
  min-width: 20px;
  text-align: center;
}
.queue-segment:not(.queue-segment--active) .queue-segment-count {
  background: rgb(var(--bg-base));
  color: rgb(var(--fg-muted));
  border-color: rgb(var(--line-default));
}

/* ── Intro paragraph ──────────────────────────────────── */
.queue-intro {
  font-size: 0.7813rem;
  color: rgb(var(--fg-muted));
  line-height: 1.65;
  margin: 0 0 1.25rem;
}
.queue-intro strong {
  color: rgb(var(--online));
  font-weight: 700;
}
.queue-intro-pip {
  display: inline-flex;
  align-items: center;
  font-family: var(--font-mono);
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: calc(0.06em * var(--tracking-scale));
  padding: 0.05rem 0.45rem;
  border-radius: var(--radius-sm);
  border: 1px solid;
}
.queue-intro-pip--pending {
  color: rgb(var(--warning));
  background: rgb(var(--warning) / 0.12);
  border-color: rgb(var(--warning) / 0.4);
}
.queue-intro-pip--changes {
  color: rgb(var(--info));
  background: rgb(var(--info) / 0.12);
  border-color: rgb(var(--info) / 0.4);
}
.queue-intro-pip--rejected {
  color: rgb(var(--danger));
  background: rgb(var(--danger) / 0.12);
  border-color: rgb(var(--danger) / 0.4);
}

/* ── States ───────────────────────────────────────────── */
.queue-loading,
.queue-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 3rem 1rem;
  color: rgb(var(--fg-muted));
  font-size: 0.8125rem;
}
.queue-empty-glyph { font-size: 2rem; color: rgb(var(--online)); }
.queue-empty-text {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  letter-spacing: calc(0.22em * var(--tracking-scale));
  text-transform: uppercase;
  font-weight: 700;
  color: rgb(var(--fg-strong));
  margin: 0;
}
.queue-empty-help { font-size: 0.75rem; color: rgb(var(--fg-muted)); margin: 0; }

/* ── Rows ─────────────────────────────────────────────── */
.queue-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.5rem;
}
.queue-row {
  --r: var(--fg-muted);
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  gap: 0.5rem 0.875rem;
  padding: 0.95rem 1.1rem 0.95rem 1.25rem;
  border: 1px solid rgb(var(--line-default));
  background:
    linear-gradient(90deg, rgb(var(--r) / 0.06) 0%, transparent 30%),
    rgb(var(--bg-elevated));
  border-left: 4px solid rgb(var(--r));
  border-radius: var(--radius-lg);
  position: relative;
  transition: background var(--dur-2) ease, border-color var(--dur-2) ease, transform var(--dur-2) ease;
}
.queue-row:hover {
  border-color: rgb(var(--r) / 0.5);
  background:
    linear-gradient(90deg, rgb(var(--r) / 0.12) 0%, transparent 50%),
    rgb(var(--bg-hover));
  transform: translateX(2px);
}
.queue-row--pending           { --r: var(--warning); }
.queue-row--changes_requested { --r: var(--info); }
.queue-row--rejected          { --r: var(--danger); }

/* Le nom de release ouvre le panneau de décision : c'est l'action primaire de
 * la file. Il est donc un bouton, pas un lien — et il faut lui retirer
 * l'apparence native qu'un <button> traîne. La page complète reste
 * atteignable par la flèche en bout de ligne. */
.queue-row-name {
  appearance: none;
  border: 0;
  background: none;
  padding: 0;
  text-align: left;
  cursor: pointer;
  font: inherit;
  /* En devenant un bouton, le nom a perdu la seule marque qui disait qu'on
     pouvait cliquer dessus. Un changement de couleur au survol ne suffit pas
     (WCAG 1.4.1) : le soulignement est permanent et discret. */
  text-decoration: underline;
  text-decoration-color: rgb(var(--fg-default) / 0.3);
  text-underline-offset: 3px;

  grid-row: 1;
  grid-column: 1;
  font-family: var(--font-mono);
  font-size: 0.8438rem;
  font-weight: 700;
  color: rgb(var(--fg-strong));
  text-decoration: none;
  word-break: break-all;
  line-height: 1.35;
}
.queue-row-name:hover {
  color: rgb(var(--r));
}

/* The badge sits at the top-right of the row, aligned to the title. */
.queue-row > :deep(.mod-badge) {
  grid-row: 1;
  grid-column: 2;
  align-self: start;
}

.queue-row-meta {
  grid-row: 3;
  grid-column: 1 / 3;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 1.25rem;
  margin: 0;
  font-size: 0.6875rem;
}
.queue-row-meta > div {
  display: inline-flex;
  align-items: baseline;
  gap: 0.4rem;
}
.queue-row-meta dt {
  font-family: var(--font-mono);
  font-size: 0.5625rem;
  letter-spacing: calc(0.18em * var(--tracking-scale));
  text-transform: uppercase;
  color: rgb(var(--fg-subtle));
  font-weight: 700;
}
.queue-row-meta dd {
  margin: 0;
  color: rgb(var(--fg-default));
  font-size: 0.7188rem;
}
.queue-meta-soft { color: rgb(var(--fg-subtle)); }
.queue-link {
  /* WCAG 2.5.8 : 24 px de cible au minimum. Mesuré à 15 px avant. */
  padding-block: 0.35rem;
  color: rgb(var(--r));
  text-decoration: none;
  border-bottom: 1px solid rgb(var(--r) / 0.4);
  font-weight: 600;
}
.queue-link:hover { border-color: rgb(var(--r)); }

.queue-row-cta {
  grid-row: 1;
  grid-column: 2;
  display: none; /* badge takes that slot; CTA is hidden — name link covers the action */
}
@media (min-width: 720px) {
  .queue-row {
    grid-template-columns: 1fr auto 32px;
    grid-template-rows: auto auto;
    gap: 0.5rem 0.75rem;
  }
  .queue-row > :deep(.mod-badge) {
    grid-row: 1;
    grid-column: 2;
  }
  .queue-row-cta {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    grid-row: 1 / 3;
    grid-column: 3;
    width: 32px;
    height: 32px;
    align-self: center;
    border-radius: var(--radius-md);
    background: rgb(var(--bg-base));
    color: rgb(var(--r));
    border: 1px solid rgb(var(--r) / 0.3);
    text-decoration: none;
    transition:
      background var(--dur-2) ease,
      transform var(--dur-2) ease,
      color var(--dur-2) ease,
      border-color var(--dur-2) ease;
  }
  .queue-row-cta:hover {
    background: rgb(var(--r) / 0.16);
    border-color: rgb(var(--r));
    color: rgb(var(--r));
    transform: translateX(2px);
  }
  .queue-row-meta {
    grid-column: 1 / 3;
  }
}
/* ── Pourquoi cette ligne est là où elle est ──────────────────────────────
 *
 * Des MOTIFS, pas un score. « en attente depuis 4 jours » se comprend ;
 * « 85 » ne veut rien dire sans le barème, et personne ne lira le barème.
 * La couleur double toujours un mot : un daltonien lit la même chose.
 */
.queue-flags {
  /* `grid-row` explicite : sans elle, le placement automatique renvoyait les
     puces en ligne 3, SOUS les métadonnées qui réclament la ligne 2 — alors
     que le DOM les place avant. L'ordre visuel contredisait l'ordre de lecture
     (WCAG 1.3.2). */
  grid-row: 2;
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin-top: 0.15rem;
}
.queue-flag {
  --f: var(--fg-muted);
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.08rem 0.4rem;
  border: 1px solid rgb(var(--f) / 0.45);
  border-radius: var(--radius-pill);
  /* Pas de fond teinté : mesuré, une teinte de la MÊME couleur que le texte
     rapproche les deux et fait tomber le contraste sous 4,5:1 — 4,20 pour le
     rouge en sombre, 4,38 pour l'ambre en clair. Sans elle, le pire cas
     remonte à 4,62 et tous les autres dépassent 5. La puce se lit alors comme
     un contour, ce qui calme aussi une ligne qui en porte plusieurs. */
  background: transparent;
  color: rgb(var(--f));
  font-family: var(--font-mono);
  font-size: 0.5938rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: calc(0.08em * var(--tracking-scale));
}
.queue-flag--aging {
  --f: var(--warning);
}
.queue-flag--first_upload {
  --f: var(--info);
}
.queue-flag--flagged {
  --f: var(--danger);
}
/* Une règle qui ne passerait pas n'est pas une faute : c'est une réserve.
   L'ambre le dit mieux que le rouge, et se lit plus confortablement. */
.queue-flag--rules_failed {
  --f: var(--warning);
}
.queue-flag--claim {
  --f: var(--accent-warm-text);
}

</style>
