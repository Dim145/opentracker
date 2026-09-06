<script setup lang="ts">
import { parseMediaInfoText } from '~/utils/mediainfo';
import { parseReleaseName } from '@trackarr/shared/releaseParse';
/**
 * La page d'un torrent.
 *
 * # Ce qu'elle était
 *
 * 3578 lignes dans un fichier, dont 51,9 % de CSS, pour rendre DEUX sections à
 * un membre regardant un torrent accepté sans NFO ni description ni cross-seed.
 * Neuf des onze sections étaient conditionnelles, gardées par 47 conditions.
 * Sept `await` bloquaient le premier octet. Trois sections quasi identiques
 * répondaient à la même question du lecteur. Et la chaîne `data-theme`
 * n'apparaissait pas une seule fois : rien n'y réagissait au thème clair.
 *
 * # L'ordre, et pourquoi celui-là
 *
 * Un membre arrive pour répondre à cinq questions, dans cet ordre : qu'est-ce
 * que c'est ; quelle release et est-ce la bonne pour moi ; puis-je la prendre
 * et devrais-je ; qu'en disent les autres ; le reste. La page suit cet ordre,
 * et tout ce qui sert à décider — identité, chips de qualité, taille, santé du
 * swarm, ce que je dois encore, le bouton — tient au-dessus de la ligne de
 * flottaison d'un écran de 900 px.
 *
 * Deux références mesurées consacrent 58 % et 71 % de leur page à une
 * description d'uploader qui REDIT ce que le site sait déjà. Ici la donnée
 * vérifiée prime : les chips viennent de `releaseChips.ts`, les pistes du
 * MediaInfo, et la note de l'uploadeur redevient une légende.
 *
 * # Ce que la page gagne, qui existait déjà sans porte d'entrée
 *
 * Les commentaires (l'API les charge à chaque requête, la route POST et la
 * notification existent, personne ne les affichait), les chips de qualité
 * (`releaseChips.ts` n'était utilisé que par la ligne de LISTE), le lien vers
 * la page de groupe (« toutes les versions de cette œuvre », déjà écrite,
 * jamais reliée) et l'obligation de seed du membre (`hnr_tracking` la connaît
 * depuis toujours).
 */
const route = useRoute();
const hash = computed(() => String(route.params.hash || ''));

const {
  torrent,
  comments,
  crossSeeds,
  supersessions,
  crossSeedStats,
  federatedCrossSeeds,
  obligation,
  metadata,
  metadataPending,
  ready,
  user,
  loggedIn,
  federationEnabled,
  isStaff,
  canEdit,
  canDelete,
  canReport,
  canFavorite,
  gated,
  buff,
  buffPair,
  buffEndsIn,
  tmdbLink,
  groupKey,
  moderationOnTop,
  canAskReseed,
  refreshTorrent,
  refreshSupersessions,
} = useTorrentDetail(hash.value);

/*
 * L'attente est ICI et pas dans le composable, et c'est structurel : le
 * compilateur de Vue enveloppe les `await` de premier niveau d'un
 * `<script setup>` dans `withAsyncContext()`, qui rétablit l'instance du
 * composant après la reprise. Un fichier `.ts` n'a pas ce filet — l'attendre
 * là-bas rendait `NUXT_E1001`, donc un 500, au rendu serveur seulement.
 */
await ready;

const { t } = useI18n();
const notifications = useNotificationStore();
const confirm = useConfirm();

/**
 * Un titre d'onglet, enfin.
 *
 * La page n'avait aucune gestion d'en-tête — ni `useHead`, ni `useSeoMeta`, ni
 * `definePageMeta`. Chaque torrent partageait le titre par défaut du site, et
 * un lien partagé ne disait pas ce qu'il pointait.
 */
useSeoMeta({
  title: () =>
    gated.value
      ? t('torrents.detail.adultGate.metaTitle')
      : (torrent.value?.name ?? t('torrents.detail.metaFallback')),
  description: () =>
    gated.value ? '' : (torrent.value?.description ?? '').slice(0, 160),
  robots: 'noindex',
});

/* ── Actions ─────────────────────────────────────────────────────────────── */

const favorited = ref(false);
const favoriteBusy = ref(false);
/*
 * `viewerFavorited` et non `favorited` : c'est le nom que la route projette
 * (`[hash].get.ts`), et lire l'autre laissait le drapeau à `false` à chaque
 * chargement. Conséquence visible : le favori était bien enregistré, mais au
 * rechargement l'étoile revenait vide et un clic RÉ-ajoutait ce qui y était
 * déjà. Rien ne pouvait l'attraper — un champ absent d'un `Record<string,
 * any>` est `undefined`, pas une erreur de type.
 *
 * Le garde `if (torrent.value)` n'est pas décoratif : pendant un
 * `refreshTorrent()`, `torrent.value` repasse brièvement à `undefined` et,
 * sans lui, cet effet écrasait l'état optimiste par `false`.
 */
watchEffect(() => {
  if (torrent.value) favorited.value = Boolean(torrent.value.viewerFavorited);
});

async function toggleFavorite() {
  if (!torrent.value || favoriteBusy.value) return;
  favoriteBusy.value = true;
  const was = favorited.value;
  favorited.value = !was;
  try {
    await $fetch(`/api/torrents/${torrent.value.infoHash}/favorite`, {
      method: was ? 'DELETE' : 'POST',
    });
    notifications.success(
      t(was ? 'torrents.detail.toasts.unfavorited' : 'torrents.detail.toasts.favorited'),
    );
  } catch (err: any) {
    favorited.value = was;
    notifications.error(
      err?.data?.message || t('torrents.detail.toasts.favoriteFailed'),
    );
  } finally {
    favoriteBusy.value = false;
  }
}

const reseedBusy = ref(false);
const reseedResult = ref<'asked' | 'nobody' | 'already' | null>(null);

async function askReseed() {
  reseedBusy.value = true;
  try {
    const res = await $fetch<{ notified: number }>(
      `/api/torrents/${hash.value}/reseed-request`,
      { method: 'POST' },
    );
    // Zéro notifié n'est pas un succès : la demande a consommé le seul créneau
    // du jour et annonçait pourtant que c'était fait.
    if (res.notified === 0) {
      reseedResult.value = 'nobody';
      notifications.error(t('torrents.detail.reseed.nobody'));
    } else {
      reseedResult.value = 'asked';
      notifications.success(t('torrents.detail.reseed.done', res.notified));
    }
  } catch (err: any) {
    if (err?.statusCode === 429) reseedResult.value = 'already';
    notifications.error(err?.data?.message || t('torrents.detail.reseed.failed'));
  } finally {
    reseedBusy.value = false;
  }
}

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
    await $fetch(`/api/torrents/${torrent.value.infoHash}`, { method: 'DELETE' });
    notifications.success(t('torrents.detail.toasts.deleted'));
    await navigateTo('/torrents');
  } catch (err: any) {
    notifications.error(err?.data?.message || t('torrents.detail.toasts.deleteFailed'));
  }
}

const reportOpen = ref(false);
/** Le motif prérempli quand le signalement vient de « Mauvaise fiche ? ». */
const reportPreset = ref<string | null>(null);
function reportMetadata() {
  reportPreset.value = t('components.report.reasons.wrongMetadata');
  reportOpen.value = true;
}
function closeReport() {
  reportOpen.value = false;
  reportPreset.value = null;
}

/**
 * Le fil d'orientation : catégorie › œuvre › unité.
 *
 * L'œuvre n'y figure QUE si un fournisseur l'a nommée — sinon le titre du
 * héros la dit déjà — et elle mène à la page du groupe, c'est-à-dire à toutes
 * ses releases. L'unité reprend les libellés de la barre d'unité du tableau,
 * pour que « Saison 01 · Épisode 09 » s'écrive pareil aux deux endroits.
 */
const pad2 = (n: number) => String(n).padStart(2, '0');
const heroCrumbs = computed(() => {
  const tor = torrent.value;
  if (!tor) return [];
  const out: Array<{ label: string; to?: string | null; minor?: boolean }> = [];
  // Le catalogue filtre sur `?c=<id>` — pas sur le slug.
  const cat = tor.category as { id?: string; name?: string } | null | undefined;
  if (cat?.name) out.push({ label: cat.name, to: cat.id ? `/torrents?c=${encodeURIComponent(cat.id)}` : null });
  const work = metadata.value?.title;
  // `minor` : le héros le titre déjà — sur un téléphone, le fil s'en passe.
  if (work && groupKey.value) out.push({ label: work, to: `/torrents/group/${groupKey.value}`, minor: true });
  const parts: string[] = [];
  if (typeof tor.season === 'number') parts.push(t('search.group.season', { n: pad2(tor.season) }));
  if (typeof tor.episode === 'number') parts.push(t('torrents.detail.versions.unit.episodeValue', { n: pad2(tor.episode) }));
  if (parts.length) out.push({ label: parts.join(' · ') });
  return out;
});

/**
 * Deux raccourcis, annoncés dans la carte des actions : `D` télécharge, `F`
 * met en favori. Jamais quand on écrit (champ, zone de texte, éditeur), jamais
 * avec un modificateur — `Ctrl+F` reste la recherche du navigateur, qui est
 * précisément ce que la case « tout afficher » sert.
 */
function onShortcut(e: KeyboardEvent) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const el = e.target as HTMLElement | null;
  if (el && (el.matches('input, textarea, select, [contenteditable=""], [contenteditable="true"]') || el.isContentEditable)) return;
  if (e.key === 'd' || e.key === 'D') {
    const cta = document.querySelector<HTMLAnchorElement>('.release-aside .dlc');
    if (cta) { e.preventDefault(); cta.click(); }
  } else if ((e.key === 'f' || e.key === 'F') && canFavorite.value) {
    e.preventDefault();
    void toggleFavorite();
  }
}
onMounted(() => window.addEventListener('keydown', onShortcut));
onBeforeUnmount(() => window.removeEventListener('keydown', onShortcut));

/**
 * Les actions secondaires ont leur propre carte dans la colonne épinglée.
 * Sans aucune — visiteur non connecté — la carte ne se rend pas.
 */
/**
 * Le compteur du membre, pour la bande « ce que ça vous coûte ». La session
 * porte déjà `uploaded`/`downloaded` — c'est ce que l'en-tête affiche — mais
 * rien ne garantit leur type d'un transport à l'autre, d'où `Number()`.
 */
const viewerStats = computed(() => {
  const u = user.value as { uploaded?: unknown; downloaded?: unknown } | null;
  if (!u) return null;
  return { uploaded: Number(u.uploaded ?? 0) || 0, downloaded: Number(u.downloaded ?? 0) || 0 };
});

/**
 * Le titre du héros quand aucun fournisseur n'a répondu.
 *
 * Le nom de release tel quel — « Radiohead - In Rainbows (2007) [FLAC 24-96
 * Vinyl] » — faisait un titre d'affiche de quatre lignes sur téléphone, puis se
 * répétait mot pour mot dans la bande d'identité. L'analyseur en tire un titre
 * (« Radiohead - In Rainbows », 2007) ; on ne s'en sert que s'il a RECONNU
 * quelque chose (une nature ou une année), sinon il rend le nom presque intact
 * en perdant ses points — « Baldur's Gate 3 v4 1 1 4667176 » — et le nom brut
 * dans la bande vaut mieux qu'un titre abîmé. Sans titre, la bande porte le
 * `<h1>` : la page n'en est jamais privée.
 */
const heroTitle = computed(() => {
  const tor = torrent.value;
  if (!tor) return null;
  const p = parseReleaseName(tor.name);
  const title = p.title?.trim();
  if (!title || title === tor.name) return null;
  return p.kind || p.year ? title : null;
});

/**
 * Une note de plus de 1 200 caractères se replie à ~26 rem avec un fondu et
 * un bouton ; décidé sur la LONGUEUR au rendu serveur, pas sur la hauteur au
 * montage — sinon la section se raccourcit après l'affichage et tout ce qui
 * suit remonte. La case « tout afficher » la déplie aussi : c'est son rôle.
 */
const noteLong = computed(() => (torrent.value?.description?.length ?? 0) > 1200);
const expandAll = useExpandAll();
/**
 * Une note longue se déplie par défaut, et le membre règle ce défaut : la
 * replier la replie sur TOUTES les fiches, la redéplier les redéplie toutes.
 * Un cookie plutôt que `localStorage`, parce que le rendu serveur le lit : la
 * page arrive déjà dans l'état choisi, au lieu d'une note qui se referme
 * après l'hydratation. Même durée et mêmes attributs que le thème.
 */
const noteFolded = useCookie<boolean>('trackarr-note-folded', {
  default: () => false,
  maxAge: 60 * 60 * 24 * 365,
  sameSite: 'lax',
  path: '/',
  httpOnly: false,
});
const noteClamped = computed(() => noteLong.value && noteFolded.value && !expandAll.value);

const hasActions = computed(
  () =>
    canFavorite.value ||
    canAskReseed.value ||
    canEdit.value ||
    canReport.value ||
    canDelete.value,
);

/**
 * Le sommaire de la colonne épinglée.
 *
 * Calculé depuis ce que la page SAIT au rendu serveur, pour que le HTML servi
 * et l'hydratation disent la même chose : la description et le NFO sont dans
 * la charge, les pistes se déduisent du même analyseur que `TrackTables`
 * emploie, les commentaires sont toujours là. Les versions dépendent d'une
 * requête que la table fait elle-même : l'entrée est listée, puis retirée au
 * montage si la section n'a rien rendu — voir `pruneToc`.
 */
const hasTracks = computed(() => {
  const t = torrent.value;
  if (!t) return false;
  for (const raw of [t.nfo, t.description]) {
    if (!raw) continue;
    const sheet = parseMediaInfoText(raw);
    if (sheet.video.length || sheet.audio.length || sheet.text.length) return true;
  }
  return false;
});
const tocEntries = computed(() => {
  // `tor`, pas `t` : `t` est la fonction d'i18n, et l'ombrager ici rendait
  // « This expression is not callable » cinq lignes plus bas.
  const tor = torrent.value;
  if (!tor) return [] as Array<{ id: string; label: string; count: number | null }>;
  const out: Array<{ id: string; label: string; count: number | null }> = [];
  out.push({ id: 'versions', label: t('torrents.detail.versions.title'), count: null });
  if (tor.description) out.push({ id: 'note', label: t('torrents.detail.sections.note'), count: null });
  if (hasTracks.value) out.push({ id: 'tracks', label: t('torrents.detail.tracks.title'), count: null });
  if (tor.nfo) out.push({ id: 'nfo', label: t('torrents.detail.sections.nfo'), count: null });
  out.push({
    id: 'comments',
    label: t('torrents.detail.comments.title'),
    count: comments.value?.length ?? 0,
  });
  return out;
});
const tocHidden = ref<Set<string>>(new Set());
const activeSection = ref<string>('versions');
onMounted(() => {
  // Ce qui n'a rien rendu sort du sommaire ; ce qui reste est suivi au
  // défilement. Tout ceci est côté client : le sommaire n'existe qu'à partir
  // de 1024 px, il n'a rien à annoncer au rendu serveur.
  const hidden = new Set<string>();
  const targets: HTMLElement[] = [];
  for (const e of tocEntries.value) {
    const el = document.getElementById(e.id);
    if (!el || el.children.length === 0) hidden.add(e.id);
    else targets.push(el);
  }
  tocHidden.value = hidden;
  if (typeof IntersectionObserver === 'undefined' || !targets.length) return;
  const io = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((en) => en.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible) activeSection.value = (visible.target as HTMLElement).id;
    },
    { rootMargin: '-80px 0px -55% 0px', threshold: 0 },
  );
  for (const el of targets) io.observe(el);
  onBeforeUnmount(() => io.disconnect());
});
</script>

<template>
  <div v-if="torrent" class="release-page">
    <!-- Le filtre adulte est une PAGE parallèle, pas une variante : un membre
         qui a désactivé ce contenu ne doit rien apprendre du torrent. -->
    <TorrentDetailAdultGate
      v-if="gated"
      :hash="hash"
      :category-name="torrent.categoryName ?? null"
    />

    <template v-else>
      <!-- Les deux commandes de la PAGE, par opposition à celles du torrent,
           qui vivent dans la colonne de droite. -->
      <div class="page-bar">
        <NuxtLink to="/torrents" class="back-link">
          <Icon name="ph:arrow-left" /> {{ $t('torrents.detail.back') }}
        </NuxtLink>
        <TorrentDetailExpandAllToggle />
      </div>

      <!-- 1 · Qu'est-ce que c'est, et quelle release. Le bandeau, l'affiche,
           le titre, puis la bande d'identité avec les pastilles de qualité :
           des faits sur cette release, donc à côté de son nom. -->
      <TorrentDetailIdentityCard
        :release-name="torrent.name"
        :media="metadata"
        :media-pending="metadataPending"
        :fallback-title="heroTitle"
        title-level="h1"
        :info-hash="torrent.infoHash"
        :imdb-id="torrent.imdbId"
        :tmdb-link="tmdbLink"
        :tvdb-id="torrent.tvdbId"
        :igdb-id="torrent.igdbId"
        :openlibrary-id="torrent.openlibraryId"
        :crumbs="heroCrumbs"
        :can-report="canReport"
        @report-metadata="reportMetadata"
      >
        <template #chips>
          <TorrentDetailQualityChips :name="torrent.name" :tags="torrent.tags" />
        </template>
        <!-- Qui l'a publiée : au bout de la ligne des pastilles. -->
        <template #provenance>
          <TorrentDetailProvenanceRow
            bare
            :release-name="torrent.name"
            :uploader="torrent.uploader"
            :uploader-anonymous="torrent.uploaderAnonymous"
            :tags="torrent.tags"
          />
        </template>
      </TorrentDetailIdentityCard>

      <!-- En attente d'action : le panneau passe AU-DESSUS, sinon l'uploadeur
           découvre ce qu'on lui demande après avoir défilé toute la page. -->
      <TorrentModerationPanel
        v-if="moderationOnTop"
        :hash="hash"
        :status="torrent.moderationStatus"
        :uploader-id="torrent.uploaderId"
        @status-change="() => refreshTorrent()"
      />

      <!-- Deux colonnes dès 1024 px. La colonne de DÉCISION est première dans
           le document : sur une colonne (téléphone) elle suit donc le bandeau,
           là où était la carte de décision ; sur deux, la grille la place à
           droite et l'épingle. Et le bouton de téléchargement reste tôt dans
           l'ordre de tabulation, comme avant. -->
      <div class="release-body">
        <aside class="release-aside" :aria-label="$t('torrents.detail.dock.label')">
          <!-- 2 · Puis-je la prendre, et devrais-je. -->
          <TorrentDetailDecisionCard
            :size="torrent.size"
            :stats="torrent.stats ?? null"
            :cross-seed-stats="crossSeedStats"
            :buff="buff"
            :buff-pair="buffPair"
            :buff-ends-in="buffEndsIn"
            :obligation="obligation"
            :viewer-stats="viewerStats"
            :hash="torrent.infoHash"
            :peers="torrent.peers ?? null"
          >
            <template #cta>
              <TorrentDetailDownloadCta
                :hash="torrent.infoHash"
                :size="torrent.size"
                :seeders="torrent.stats?.seeders ?? null"
                :freeleech="buff?.kind === 'freeleech'"
                aria-keyshortcuts="d"
              />
            </template>
          </TorrentDetailDecisionCard>

          <!-- Les actions secondaires, dans leur propre carte : le rouge de
               « Supprimer » ne voisine plus le bouton principal. -->
          <section v-if="hasActions" class="card acts" aria-labelledby="acts-title">
            <h2 id="acts-title" class="aside-title">{{ $t('torrents.detail.aside.actions') }}</h2>
            <div class="acts-list">
              <button
                v-if="canFavorite"
                type="button"
                class="btn btn-secondary btn-sm fav-toggle"
                :disabled="favoriteBusy"
                :aria-pressed="favorited"
                :title="
                  $t(
                    favorited
                      ? 'torrents.detail.favoriteRemove'
                      : 'torrents.detail.favoriteAdd',
                  )
                "
                aria-keyshortcuts="f"
                @click="toggleFavorite"
              >
                <Icon :name="favorited ? 'ph:star-fill' : 'ph:star'" />
                <!-- Libellé CONSTANT, état porté par `aria-pressed` : c'est le
                     motif d'un bouton bascule. L'action va sur `title`. -->
                {{ $t('torrents.detail.favorite') }}
              </button>
              <!-- Proposer une relance n'a de sens qu'à zéro seeder. -->
              <button
                v-if="canAskReseed && !reseedResult"
                type="button"
                class="btn btn-secondary btn-sm"
                :disabled="reseedBusy"
                @click="askReseed"
              >
                <Icon name="ph:megaphone" /> {{ $t('torrents.detail.reseed.ask') }}
              </button>
              <NuxtLink
                v-if="canEdit"
                :to="`/torrents/${torrent?.infoHash}/edit`"
                class="btn btn-secondary btn-sm"
              >
                <Icon name="ph:pencil-simple" /> {{ $t('common.edit') }}
              </NuxtLink>
              <button
                v-if="canReport"
                type="button"
                class="btn btn-ghost btn-sm"
                @click="reportOpen = true"
              >
                <Icon name="ph:flag" /> {{ $t('torrents.detail.report') }}
              </button>
              <button
                v-if="canDelete"
                type="button"
                class="btn btn-danger btn-sm"
                @click="confirmDelete"
              >
                <Icon name="ph:trash" /> {{ $t('common.delete') }}
              </button>
            </div>
            <!-- Un raccourci que personne ne connaît est un raccourci que
                 personne n'emploie : la touche est écrite là où sont les
                 actions. -->
            <p class="acts-keys">
              <span class="acts-keys-label">{{ $t('torrents.detail.aside.shortcuts') }}</span>
              <kbd>D</kbd> {{ $t('torrents.detail.aside.shortcutDownload') }}
              <template v-if="canFavorite">
                <span class="acts-keys-sep" aria-hidden="true">·</span>
                <kbd>F</kbd> {{ $t('torrents.detail.aside.shortcutFavorite') }}
              </template>
            </p>
          </section>

          <!-- Le sommaire : une page de 3 000 px devient navigable. Bureau
               seulement — sur une colonne il serait en bas de tout. -->
          <nav
            v-if="tocEntries.length > 1"
            class="card toc"
            :aria-label="$t('torrents.detail.aside.onThisPage')"
          >
            <h2 class="aside-title">{{ $t('torrents.detail.aside.onThisPage') }}</h2>
            <ul class="toc-list">
              <li v-for="e in tocEntries" :key="e.id" :hidden="tocHidden.has(e.id)">
                <a
                  class="toc-link"
                  :href="`#${e.id}`"
                  :aria-current="activeSection === e.id ? 'true' : undefined"
                >
                  <span>{{ e.label }}</span>
                  <span v-if="e.count !== null" class="toc-n">{{ e.count }}</span>
                </a>
              </li>
            </ul>
          </nav>
        </aside>

        <div class="release-main">
          <!-- 3 · Laquelle de ces versions je prends. La question centrale,
               donc la première de la colonne de lecture. -->
          <div id="versions" class="rsec">
            <TorrentDetailVersionsTable
              :group-key="groupKey"
              :current-info-hash="torrent.infoHash"
              :season="torrent.season ?? null"
              :episode="torrent.episode ?? null"
            />
          </div>

          <div v-if="torrent.description" id="note" class="rsec">
            <section class="section">
              <SectionHead :title="$t('torrents.detail.sections.note')" icon="ph:note" />
              <!-- Pas de `ClientOnly` : `DescriptionRender` assainit sous Node
                   comme dans le navigateur — vérifié. -->
              <div class="note-body" :class="{ 'note-body--clamped': noteClamped }" :id="noteLong ? 'note-body' : undefined">
                <DescriptionRender :source="torrent.description" :heading-offset="2" />
              </div>
              <button
                v-if="noteLong && !expandAll"
                type="button"
                class="btn btn-secondary btn-sm note-more"
                :aria-expanded="!noteFolded"
                aria-controls="note-body"
                @click="noteFolded = !noteFolded"
              >
                <Icon :name="noteFolded ? 'ph:caret-down-bold' : 'ph:caret-up-bold'" aria-hidden="true" />
                {{ $t(noteFolded ? 'torrents.detail.sections.noteExpand' : 'torrents.detail.sections.noteCollapse') }}
              </button>
            </section>
          </div>

          <!-- Les pistes avant le NFO : les faits compacts avant le bloc brut
               dont ils sont extraits. -->
          <div id="tracks" class="rsec">
            <TorrentDetailTrackTables :nfo="torrent.nfo" :description="torrent.description" />
          </div>
          <div id="nfo" class="rsec">
            <TorrentDetailNfoPanel :nfo="torrent.nfo" />
          </div>

          <!-- 4 · Qu'en disent les autres. -->
          <div id="comments" class="rsec">
            <TorrentDetailTorrentComments
              :hash="torrent.infoHash"
              :comments="comments"
              :uploader-id="torrent.uploaderId ?? null"
              @posted="() => refreshTorrent()"
            />
          </div>

          <!-- 5 · Le reste. -->
          <TorrentDetailRelatedReleases
            v-if="crossSeeds?.items?.length"
            variant="cross"
            :items="crossSeeds.items"
          />
          <TorrentDetailRelatedReleases
            v-if="supersessions?.supersedes?.length"
            variant="supersedes"
            :items="supersessions.supersedes"
          />
          <TorrentDetailRelatedReleases
            v-if="federationEnabled && federatedCrossSeeds?.items?.length"
            variant="federated"
            :items="federatedCrossSeeds.items"
            :mesh-seeders="federatedCrossSeeds.availability?.seeders ?? null"
          />

          <!-- Regroupé par AUDIENCE et non par fonctionnalité. -->
          <TorrentDetailOperatorArea
            v-if="isStaff || canEdit"
            :hash="hash"
            :torrent="torrent"
            :supersessions="supersessions"
            :is-staff="isStaff"
            :is-admin="!!user?.isAdmin"
            :can-edit="canEdit"
            :federation-enabled="federationEnabled"
            @changed="() => { refreshTorrent(); refreshSupersessions(); }"
          />

          <TorrentModerationPanel
            v-if="!moderationOnTop"
            :hash="hash"
            :status="torrent.moderationStatus"
            :uploader-id="torrent.uploaderId"
            @status-change="() => refreshTorrent()"
          />
        </div>
      </div>

      <!-- Le dock : sous 1024 px la colonne n'est plus épinglée et le bouton
           principal défile ; le dock reprend le geste tant qu'il est hors
           écran. Au-dessus, il est masqué par sa propre feuille. -->
      <TorrentDetailStickyDock
        :hash="torrent.infoHash"
        :size="torrent.size"
        :stats="torrent.stats ?? null"
        :obligation="obligation"
        :freeleech="buff?.kind === 'freeleech'"
      />

      <ReportModal
        :is-open="reportOpen"
        target-type="torrent"
        :target-id="torrent.id"
        :target-label="torrent.name"
        :preset-reason="reportPreset"
        @close="closeReport"
        @submitted="closeReport"
      />
    </template>
  </div>
</template>

<style scoped>
.release-page {
  /* L'échelle des libellés, déclarée ici : les composants la lisent, et une
     valeur unique vaut mieux que douze recopies. */
  --label-sm: 0.5625rem;
  --label-md: 0.625rem;
  --label-lg: 0.6875rem;
  --label-weight: 700;
  --label-tracking: calc(0.08em * var(--tracking-scale));
  --label-tracking-wide: calc(0.16em * var(--tracking-scale));
  max-width: var(--container-max);
  margin: 0 auto;
  /* Le bas : la hauteur du dock, qui est `sticky` donc en flux, et ne recouvre
     rien au repos. */
  padding: 1.25rem var(--container-pad) 4.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  /* Le repère de la barre de commandes, posée par-dessus le bandeau. */
  position: relative;
}

/* La barre de commandes FLOTTE sur le haut du bandeau au lieu d'occuper une
   rangée au-dessus de lui : une rangée laissait 53 px de fond nu entre
   l'en-tête et le décor, et le décor remontait quand même sous la moitié de
   la barre. Hors flux, elle ne pousse rien ; le bandeau touche l'en-tête.
   Elle reste PREMIÈRE dans le document — le lien de retour garde sa place en
   tête de l'ordre de tabulation. `wrap` : le libellé de la case est traduit. */
.page-bar {
  position: absolute;
  z-index: 2;
  top: 0.75rem;
  left: var(--container-pad);
  right: var(--container-pad);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem 1rem;
  pointer-events: none;
}
.page-bar > * {
  pointer-events: auto;
}
/* Sur un décor, un lien nu n'a pas de contraste garanti — le ciel de Frieren
   est blanc. La même pilule que la case « tout afficher » à sa droite : les
   deux commandes se lisent comme une seule barre, sur n'importe quel pixel. */
.back-link {
  min-height: 2rem;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0 0.7rem 0 0.55rem;
  font-size: 0.8125rem;
  font-weight: 600;
  color: rgb(var(--fg-default));
  background: rgb(var(--bg-elevated) / 0.82);
  backdrop-filter: blur(8px);
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-pill);
  transition:
    color var(--dur-1) var(--ease-standard),
    background-color var(--dur-2) ease;
}
.back-link:hover {
  color: rgb(var(--fg-strong));
  background: rgb(var(--bg-hover));
}

/* ── Deux colonnes ────────────────────────────────────────────────────────
 *
 * La colonne de LECTURE (versions, note, pistes, NFO, commentaires) et la
 * colonne de DÉCISION (télécharger, provenance, actions, sommaire). Sur une
 * seule colonne, l'ordre du document fait foi : la décision d'abord, comme
 * la carte de décision l'était avant. À partir de 1024 px la grille place la
 * décision à droite et l'épingle sous l'en-tête.
 */
.release-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 1.25rem 1.75rem;
}
.release-main,
.release-aside {
  display: grid;
  /* `minmax(0, 1fr)` et non la piste implicite `auto` : `auto` se dimensionne
     sur le contenu le plus large, et un bandeau de modération dont le texte
     tient sur une ligne de 885 px imposait 1 025 px à une colonne de 580 —
     mesuré à 1024 px de fenêtre, 41 px de défilement horizontal. La piste
     bornée force le texte à se replier, ce qu'il sait faire. */
  grid-template-columns: minmax(0, 1fr);
  gap: 1.25rem;
  min-width: 0;
  align-content: start;
}
.release-aside {
  gap: 1rem;
}
@media (min-width: 1024px) {
  .release-body {
    grid-template-columns: minmax(0, 1fr) 21.5rem;
    grid-template-areas: 'main aside';
    align-items: start;
  }
  .release-main { grid-area: main; }
  .release-aside {
    grid-area: aside;
    position: sticky;
    top: calc(var(--header-h) + 1rem);
    /* Plus haute que la fenêtre — obligation, bonus, cinq actions — elle
       défile DANS sa boîte au lieu de laisser son bas inaccessible jusqu'à la
       fin de la colonne de lecture. */
    max-height: calc(100vh - var(--header-h) - 2rem);
    overflow-y: auto;
    scrollbar-width: thin;
  }
}

/* Une section de lecture : un conteneur nommé pour le sommaire, sans boîte.
   Vide (le composant n'a rien rendu, il ne reste qu'un commentaire), il
   disparaît pour ne pas laisser un écart de grille orphelin. */
.rsec:empty {
  display: none;
}

/* ── Une seule coquille pour la colonne de lecture ───────────────────────
 *
 * La recette de `.panel` dans `me.vue` : surface, filet d'un pixel,
 * `--radius-xl`. Posée ICI et non dans les composants : un style scopé atteint
 * la racine d'un enfant, donc la page tient le rythme de sa pile pendant que
 * chaque composant garde son intérieur. Hors coquille, délibérément : le
 * bandeau d'identité (il a la sienne), la barre de commandes et le dock.
 */
.release-main .versions,
.release-main .section,
.release-main .nfo-panel,
.release-main .tracks,
.release-main .cm,
.release-main > .related,
.release-main > .operator-area,
.release-main > .mod {
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-xl);
  background: rgb(var(--bg-surface));
}
.release-main .versions,
.release-main .nfo-panel,
.release-main .tracks,
.release-main .cm,
.release-main > .related,
.release-main > .operator-area {
  padding: 1rem 1rem 1.25rem;
}
.section {
  padding: 1rem 1.1rem;
}
/* La note repliée : une hauteur bornée et un fondu vers la surface, comme le
   NFO. Le texte reste dans le document — rien n'est retiré, seulement caché à
   l'œil jusqu'au clic ou à « tout afficher ». */
.note-body--clamped {
  position: relative;
  max-height: 26rem;
  overflow: hidden;
}
.note-body--clamped::after {
  content: '';
  position: absolute;
  inset: auto 0 0 0;
  height: 6rem;
  background: linear-gradient(to bottom, transparent, rgb(var(--bg-surface)));
  pointer-events: none;
}
.note-more {
  margin-top: 0.6rem;
}

/* Un doigt plutôt qu'une souris : les petites commandes passent à 36 px.
   WCAG 2.5.8 se contente de 24 ; un pouce non. Mesuré à 390 px : pastilles
   de fiche, puces de qualité, « +16 autres », les boutons de la carte
   d'actions — tous à 24. */
@media (pointer: coarse) {
  .acts-list .btn,
  .note-more,
  .release-page :deep(.qc-chip),
  .release-page :deep(.prov-user),
  .release-page :deep(.idc-id),
  .release-page :deep(.idc-crumb-link),
  .release-page :deep(.versions-all),
  .release-page :deep(.tsum-btn),
  .release-page :deep(.idc .tool-btn--sm) {
    min-height: 2.25rem;
  }
  .release-page :deep(.idc .tool-btn--sm) { min-width: 2.25rem; }
}

/* ── La colonne de décision ─────────────────────────────────────────────── */
.release-aside > .card {
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-xl);
  background: rgb(var(--bg-surface));
}
/* La carte de décision porte le seul geste de la page. Elle est SOULEVÉE —
   ombre, bordure chaude — pour que l'œil sache où revenir. C'est le seul
   panneau qui reçoit ce traitement, sinon ce n'en est plus un. */
.release-aside > .dc {
  border-color: rgb(var(--accent-warm) / 0.55);
  box-shadow: var(--shadow-overlay);
}
.aside-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.6rem;
  font-family: var(--font-mono);
  font-size: var(--label-lg);
  font-weight: var(--label-weight);
  letter-spacing: var(--label-tracking);
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.aside-title::after {
  content: '';
  flex: 1;
  height: 1px;
  background: rgb(var(--line-default));
}
.acts {
  padding: 0.85rem 0.9rem 0.9rem;
}
/* Une rangée qui s'enroule : cinq boutons tiennent sur deux lignes, là où une
   liste d'un bouton par ligne montait à 250 px et faisait déborder la colonne
   épinglée de la fenêtre. */
.acts-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.acts-keys {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem 0.4rem;
  margin: 0.75rem 0 0;
  font-size: 0.6875rem;
  color: rgb(var(--fg-muted));
}
.acts-keys-label {
  font-family: var(--font-mono);
  font-size: var(--label-sm);
  font-weight: var(--label-weight);
  letter-spacing: var(--label-tracking);
  text-transform: uppercase;
  margin-right: 0.2rem;
}
.acts-keys kbd {
  display: inline-grid;
  place-items: center;
  min-width: 1.3rem;
  height: 1.3rem;
  padding: 0 0.3rem;
  border: 1px solid rgb(var(--line-strong));
  border-bottom-width: 2px;
  border-radius: var(--radius-sm);
  background: rgb(var(--bg-elevated));
  font-family: var(--font-mono);
  font-size: 0.625rem;
  font-weight: 700;
  color: rgb(var(--fg-default));
}
.acts-keys-sep { color: rgb(var(--fg-subtle)); }

.fav-toggle[aria-pressed='true'] {
  /* `--fg-strong` et non `--accent-warm-text` sur le voile chaud : peindre un
     fond de la couleur du texte qu'il porte tombe sous 4,5:1 en thème clair.
     Bordure à pleine opacité : c'est une bordure d'ÉTAT. */
  border-color: rgb(var(--accent-warm));
  background: rgb(var(--accent-warm) / 0.12);
  color: rgb(var(--fg-strong));
}

.toc {
  display: none;
  padding: 0.85rem 0.9rem 0.9rem;
}
/* Le sommaire est une commodité : sur un écran bas (portable en 768 px de
   haut), il ferait déborder la colonne épinglée de la fenêtre, et un sommaire
   qu'il faut faire défiler pour voir n'en est plus un. */
@media (min-width: 1024px) and (min-height: 821px) {
  .toc { display: block; }
}
.toc-list {
  display: grid;
  gap: 0.15rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.toc-link {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-height: 1.75rem;
  padding: 0 0.6rem;
  border-left: 2px solid transparent;
  border-radius: var(--radius-md);
  font-size: 0.8125rem;
  color: rgb(var(--fg-muted));
  transition: color var(--dur-1) var(--ease-standard), background-color var(--dur-1) var(--ease-standard);
}
.toc-link:hover {
  color: rgb(var(--fg-strong));
  background: rgb(var(--bg-hover));
}
.toc-link[aria-current='true'] {
  color: rgb(var(--fg-strong));
  border-left-color: rgb(var(--accent-warm));
  background: rgb(var(--fg-default) / 0.04);
}
.toc-n {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 600;
  color: rgb(var(--fg-subtle));
  font-variant-numeric: tabular-nums;
}

/* ── L'entrée en scène ─────────────────────────────────────────────────── */
@keyframes release-rise {
  from {
    opacity: 0;
    transform: translateY(0.375rem);
  }
}
.release-page > *,
.release-main > *,
.release-aside > * {
  animation: release-rise calc(var(--dur-slow) + 60ms) var(--ease-emphasis) both;
}
.release-page > :nth-child(1) { animation-delay: 0ms; }
.release-page > :nth-child(2) { animation-delay: calc(40ms * var(--motion-scale)); }
.release-page > :nth-child(n + 3) { animation-delay: calc(80ms * var(--motion-scale)); }
.release-main > :nth-child(1),
.release-aside > :nth-child(1) { animation-delay: calc(120ms * var(--motion-scale)); }
.release-main > :nth-child(2),
.release-aside > :nth-child(2) { animation-delay: calc(160ms * var(--motion-scale)); }
.release-main > :nth-child(n + 3),
.release-aside > :nth-child(n + 3) { animation-delay: calc(200ms * var(--motion-scale)); }
/* Le dock apparaît à la sortie d'écran du bouton principal, pas à l'ouverture :
   le faire monter la ferait clignoter avant même d'être utile. */
.release-page > .sd {
  animation: none;
}
</style>