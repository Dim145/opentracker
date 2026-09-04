<script setup lang="ts">
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
      <NuxtLink to="/torrents" class="back-link">
        <Icon name="ph:arrow-left" /> {{ $t('torrents.detail.back') }}
      </NuxtLink>

      <!-- En attente d'action : le panneau passe AU-DESSUS, sinon l'uploadeur
           découvre ce qu'on lui demande après avoir défilé toute la page. -->
      <TorrentModerationPanel
        v-if="moderationOnTop"
        :hash="hash"
        :status="torrent.moderationStatus"
        :uploader-id="torrent.uploaderId"
        @status-change="() => refreshTorrent()"
      />

      <!-- 1 · Qu'est-ce que c'est, et quelle release. -->
      <TorrentDetailIdentityCard
        :release-name="torrent.name"
        :media="metadata"
        :media-pending="metadataPending"
        :fallback-title="torrent.name"
        title-level="h1"
        :info-hash="torrent.infoHash"
        :imdb-id="torrent.imdbId"
        :tmdb-link="tmdbLink"
        :tvdb-id="torrent.tvdbId"
        :igdb-id="torrent.igdbId"
        :openlibrary-id="torrent.openlibraryId"
      />
      <TorrentDetailQualityChips :name="torrent.name" />
      <!-- Qui l'a publiée, et par où continuer. À part de la carte d'identité
           parce que ce sont les deux seuls blocs du haut de page qui pointent
           AILLEURS que vers ce torrent — un profil, un catalogue filtré. -->
      <TorrentDetailProvenanceRow
        :uploader="torrent.uploader"
        :uploader-anonymous="torrent.uploaderAnonymous"
        :tags="torrent.tags"
      />

      <!-- 2 · Puis-je la prendre, et devrais-je. Tout tient dans une carte. -->
      <TorrentDetailDecisionCard
        :size="torrent.size"
        :stats="torrent.stats ?? null"
        :cross-seed-stats="crossSeedStats"
        :buff="buff"
        :buff-pair="buffPair"
        :buff-ends-in="buffEndsIn"
        :obligation="obligation"
      >
        <template #cta>
          <TorrentDetailDownloadCta
            :hash="torrent.infoHash"
            :size="torrent.size"
            :seeders="torrent.stats?.seeders ?? null"
            :freeleech="buff?.kind === 'freeleech'"
          />
        </template>
        <template #actions>
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
            @click="toggleFavorite"
          >
            <Icon :name="favorited ? 'ph:star-fill' : 'ph:star'" />
            <!-- Libellé CONSTANT, état porté par `aria-pressed` : c'est le
                 motif d'un bouton bascule, et changer les deux à la fois est
                 contradictoire pour un lecteur d'écran (« Retirer des
                 favoris, activé »). L'action va sur `title`, pour la souris.
                 Accessoirement, la clé `unfavorite` que ce gabarit appelait
                 n'existait dans aucune locale : le bouton affichait
                 `torrents.detail.unfavorite` en clair dès qu'il était
                 activé. -->
            {{ $t('torrents.detail.favorite') }}
          </button>
          <!-- CTA conditionnel : proposer une relance n'a de sens qu'à zéro
               seeder. Un bouton toujours présent apprend à ignorer la zone. -->
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
            :to="`/torrents/${torrent.infoHash}/edit`"
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
        </template>
      </TorrentDetailDecisionCard>

      <!-- 3 · Laquelle de ces versions je prends. La question centrale. -->
      <TorrentDetailVersionsTable
        :group-key="groupKey"
        :current-info-hash="torrent.infoHash"
        :season="torrent.season ?? null"
        :episode="torrent.episode ?? null"
      />

      <TorrentDetailExpandAllToggle />

      <section v-if="torrent.description" class="section">
        <SectionHead :title="$t('torrents.detail.sections.note')" icon="ph:note" compact />
        <!-- Pas de `ClientOnly` : `DescriptionRender` passe par
             `isomorphic-dompurify`, qui assainit sous Node comme dans le
             navigateur — vérifié. L'enveloppe rendait un `<span>` vide au
             serveur et un `<div>` au client, donc « Hydration completed but
             contains mismatches » à chaque chargement, et la description
             absente du HTML servi. -->
        <DescriptionRender :source="torrent.description" />
      </section>

      <TorrentDetailNfoPanel :nfo="torrent.nfo" />
      <TorrentDetailTrackTables :nfo="torrent.nfo" :description="torrent.description" />

      <!-- 4 · Qu'en disent les autres. L'API les chargeait déjà. -->
      <TorrentDetailTorrentComments
        :hash="torrent.infoHash"
        :comments="comments"
        :uploader-id="torrent.uploaderId ?? null"
        @posted="() => refreshTorrent()"
      />

      <!-- 5 · Le reste. Trois listes qui répondaient à la même question sont
           devenues un composant à trois variantes. -->
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

      <!-- Regroupé par AUDIENCE et non par fonctionnalité : la page d'un membre
           n'a plus de trous là où les blocs de personnel se trouvaient, et le
           panneau de modération d'un uploadeur ne se retrouve plus SOUS la
           table des pairs de l'administrateur. -->
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

      <!-- Le dock : sous 1280 px le CTA du haut a défilé, et c'est exactement
           le défaut mesuré sur les deux trackers de référence — leur bouton
           devient inatteignable pour les 3000 px suivants. Un seul CTA
           focalisable existe à chaque largeur, l'autre est en `display:none`. -->
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
        @close="reportOpen = false"
        @submitted="reportOpen = false"
      />
    </template>
  </div>
</template>

<style scoped>
/**
 * Ce qu'il reste de CSS ici : la mise en page de la page, et rien d'autre.
 * Chaque composant porte la sienne — c'est ce qui empêche une classe d'être
 * définie dans un fichier et utilisée par cinq, le piège dans lequel
 * `.tool-btn` est déjà tombée sur ce projet.
 */
.release-page {
  max-width: var(--container-max);
  margin: 0 auto;
  padding: 1.25rem var(--container-pad) 6rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.back-link {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
  color: rgb(var(--fg-muted));
  transition: color var(--dur-1) var(--ease-standard);
}
.back-link:hover {
  /* `--fg-default` et non `--fg-subtle` : au survol le fond devient
     `--bg-hover`, sur lequel `--fg-subtle` mesure 3,93:1 en thème sombre. */
  color: rgb(var(--fg-default));
}

.section {
  padding: 1rem 1.1rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-lg);
  background: rgb(var(--bg-surface));
}

/* L'état « en favoris », peint depuis `aria-pressed` et non depuis une classe
   jumelle : l'attribut ARIA est déjà la source de vérité pour le lecteur
   d'écran, en dériver le style évite qu'un jour l'un dise oui et l'autre non.
   Sans cette règle, l'étoile pleine était le SEUL signe de l'état — lisible,
   mais léger pour une bascule dont le libellé, lui, ne change plus. */
.fav-toggle[aria-pressed='true'] {
  /* Encre NEUTRE sur le voile chaud, et non l'encre chaude : mesuré, la paire
     `--accent-warm-text` sur 12 % de `--accent-warm` tombe à 4,45:1 en thème
     CLAIR — sous le seuil, de justesse, et pour la troisième fois sur ce
     projet. Peindre un fond de la couleur du texte qu'il porte les rapproche ;
     c'est toujours le thème clair qui le paie. Avec `--fg-strong` : 15,07:1 en
     sombre, 18,49:1 en clair.
     Bordure à pleine opacité et non à 55 % : la teinte chaude n'atteint 3:1
     contre la surface qu'à 1,0 en clair (3,38:1 ; 1,86:1 à 55 %). C'est une
     bordure d'ÉTAT, pas une décoration. */
  border-color: rgb(var(--accent-warm));
  background: rgb(var(--accent-warm) / 0.12);
  color: rgb(var(--fg-strong));
}

/* Le dock occupe le bas de l'écran sous 1280 px : sans cette réserve, la
   dernière section passe dessous et devient illisible. */
@media (max-width: 1279px) {
  .release-page {
    padding-bottom: 8.5rem;
  }
}
</style>
