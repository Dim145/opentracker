<script setup lang="ts">
/**
 * « Qu'est-ce que c'est d'autre ? » — une section, trois provenances.
 *
 * # Pourquoi une seule composante
 *
 * La page portait TROIS sections quasi identiques : les cross-seeds locaux
 * (l. 546), les releases remplacées (l. 591) et les cross-seeds fédérés
 * (l. 630). Elles partageaient déjà la même famille CSS `.cross-*` — un
 * commentaire du gabarit l'assumait, « reuses their markup so a reader scanning
 * the page meets one list format, not three » — mais en trois copies du
 * gabarit, donc trois occasions de dériver. Elles répondent à la même question
 * du lecteur, elles n'ont plus qu'un rendu.
 *
 * Le `variant` change quatre choses et rien d'autre : le titre, la note, l'icône
 * de ligne, et les métadonnées que la ligne a à dire. La géométrie est commune,
 * ce qui est précisément ce qu'on veut : la couleur sémantique dans des
 * conteneurs identiques se lit à la position.
 *
 * # Deux classes qui n'existaient pas
 *
 * `.cross-meta-size` et `.cross-meta-age` étaient posées dans le gabarit et
 * stylées NULLE PART — elles héritaient de `.cross-meta` et ne servaient à
 * rien. C'était visible : la taille et l'âge sortaient dans la même graisse et
 * la même couleur que le reste, alors que la taille est la seule colonne que
 * l'œil compare d'une ligne à l'autre. Elles ont maintenant un sens (chiffres
 * tabulaires pour la taille, encre discrète pour l'âge).
 *
 * # Deux champs que l'API renvoyait et que la page jetait
 *
 * `moderationStatus` et `uploader` arrivaient dans `/cross-seeds` et n'étaient
 * jamais affichés. Le premier explique pourquoi un cross-seed proposé peut être
 * invisible dans le catalogue ; le second dit à qui parler quand deux releases
 * du même contenu divergent. Les deux comptent avant de cliquer.
 */
import { formatAge, formatSize } from '~/utils/format';
import type { CrossSeedItem, FederatedCrossSeedItem } from '~/composables/useTorrentDetail';
import TorrentModerationBadge from '~/components/torrent/TorrentModerationBadge.vue';

/** Ce que `/supersessions` renvoie dans `supersedes` — un type local, faute d'un exporté. */
export interface SupersededItem {
  infoHash: string;
  name: string;
  size: number;
  supersedeReason: string | null;
}

type RelatedItem = CrossSeedItem | SupersededItem | FederatedCrossSeedItem;
type ModerationStatus = 'pending' | 'accepted' | 'changes_requested' | 'rejected';

const props = withDefaults(
  defineProps<{
    /**
     * D'où viennent ces releases :
     * - `cross` — le même contenu, ici, sous un autre `.torrent` ;
     * - `supersedes` — les releases que celle-ci remplace ;
     * - `federated` — le même contenu chez un partenaire.
     */
    variant: 'cross' | 'supersedes' | 'federated';
    /** Tel que le composable le renvoie ; la normalisation est interne. */
    items: RelatedItem[];
    /** `federated` seulement : les seeders du maillage, quand il y en a. */
    meshSeeders?: number | null;
  }>(),
  { meshSeeders: null },
);

const { locale } = useI18n();

/* ── Ce que le variant décide ──────────────────────────────────────────────── */

const title = computed(() => {
  switch (props.variant) {
    case 'cross':
      return 'torrents.detail.sections.crossSeeds';
    case 'supersedes':
      return 'torrents.detail.supersede.title';
    default:
      return 'torrents.detail.sections.crossSeedsFederated';
  }
});

const note = computed(() => {
  switch (props.variant) {
    case 'cross':
      return 'torrents.detail.crossSeedNote';
    case 'supersedes':
      return 'torrents.detail.supersede.replaces';
    default:
      return 'torrents.detail.crossSeedFederatedNote';
  }
});

const rowIcon = computed(() => {
  switch (props.variant) {
    case 'cross':
      return 'ph:arrows-left-right-bold';
    case 'supersedes':
      return 'ph:arrow-bend-left-down-bold';
    default:
      return 'ph:broadcast-bold';
  }
});

const sectionIcon = computed(() =>
  props.variant === 'federated' ? 'ph:broadcast-bold' : 'ph:arrows-left-right-bold',
);

/* ── Une ligne, quelle que soit la provenance ─────────────────────────────── */

interface Row {
  key: string;
  to: string;
  name: string;
  size: number;
  category: string | null;
  createdAt: string | null;
  uploader: { id: string; username: string } | null;
  moderationStatus: ModerationStatus | null;
  peerName: string | null;
  seeders: number | null;
  matchType: string | null;
  reason: string | null;
}

/**
 * Le statut de modération, seulement quand il dit quelque chose.
 *
 * `accepted` est le cas ordinaire : l'afficher mettrait un tampon sur chaque
 * ligne et le tampon ne voudrait plus rien dire. Une valeur inconnue est
 * écartée plutôt que rendue — la colonne est un `text` en base.
 */
function moderationOf(raw: unknown): ModerationStatus | null {
  return raw === 'pending' || raw === 'changes_requested' || raw === 'rejected'
    ? raw
    : null;
}

const rows = computed<Row[]>(() =>
  props.items.map((raw) => {
    const it = raw as Partial<CrossSeedItem & SupersededItem & FederatedCrossSeedItem>;
    const federated = props.variant === 'federated';
    return {
      key: it.id ?? it.infoHash ?? it.name ?? '',
      // Un partenaire se lit sur notre miroir (`/federated/{id}`), jamais sur
      // son URL brute : c'est la page qui applique le masque local.
      to: federated ? `/federated/${it.id}` : `/torrents/${it.infoHash}`,
      name: it.name ?? '',
      size: it.size ?? 0,
      category: it.category?.name ?? null,
      createdAt: it.createdAt ?? null,
      uploader: it.uploader ?? null,
      moderationStatus: moderationOf(it.moderationStatus),
      peerName: it.peerName ?? null,
      seeders: typeof it.seeders === 'number' ? it.seeders : null,
      matchType: it.matchType ?? null,
      reason: it.supersedeReason ?? null,
    };
  }),
);

/*
 * Le compte est celui des lignes RENDUES, jamais un `total` d'API. Les deux
 * diffèrent dès qu'une réponse est tronquée, et une pastille qui annonce 50
 * au-dessus de 10 lignes envoie chercher les 40 autres.
 */
const count = computed(() => rows.value.length);

/** `Intl` plutôt que `String(n)` : un compteur de seeders s'écrit 1 234 en fr. */
const nf = computed(() => new Intl.NumberFormat(locale.value));
</script>

<template>
  <section v-if="rows.length" class="related" :class="`related--${variant}`">
    <SectionHead :title="$t(title)" :count="count" :icon="sectionIcon" />

    <p class="related-note">
      <Icon name="ph:info-bold" class="related-note-icon" aria-hidden="true" />
      <span>
        {{ $t(note) }}
        <!-- Conteneur neutre plus un point coloré, et non un texte teinté sur
             un voile de sa propre couleur : cette dernière paire tombe sous
             4,5:1 en thème clair. -->
        <span v-if="variant === 'federated' && meshSeeders" class="related-mesh">
          <span class="related-mesh-dot" aria-hidden="true" />
          {{ $t('torrents.detail.crossSeedMeshSeeders', { n: meshSeeders }) }}
        </span>
      </span>
    </p>

    <ul class="related-list">
      <li v-for="row in rows" :key="row.key" class="related-item">
        <NuxtLink :to="row.to" class="related-link">
          <Icon :name="rowIcon" class="related-icon" aria-hidden="true" />

          <span class="related-body">
            <span class="related-name">{{ row.name }}</span>

            <span class="related-meta">
              <!-- Chez un partenaire, l'instance remplace la catégorie : c'est
                   la première chose à savoir avant de cliquer. -->
              <span v-if="row.peerName" class="related-meta-peer">{{ row.peerName }}</span>
              <template v-else-if="row.category">
                <span class="related-meta-cat">{{ row.category }}</span>
              </template>

              <template v-if="row.seeders !== null">
                <span class="related-meta-sep" aria-hidden="true">·</span>
                <span
                  class="related-meta-seed"
                  :title="$t('torrents.detail.related.seedersTitle', { n: row.seeders })"
                >
                  <!-- Le même chevron que partout sur la fiche ; l'infobulle
                       nomme la valeur, le mot reste pour le lecteur d'écran. -->
                  <Icon name="ph:caret-up-fill" class="related-meta-seed-i" aria-hidden="true" />
                  {{ nf.format(row.seeders) }}
                  <span class="sr-only">{{ $t('torrents.detail.stats.seeders') }}</span>
                </span>
              </template>

              <span class="related-meta-sep" aria-hidden="true">·</span>
              <span class="related-meta-size">{{ formatSize(row.size) }}</span>

              <template v-if="row.createdAt">
                <span class="related-meta-sep" aria-hidden="true">·</span>
                <span class="related-meta-age">{{ formatAge(row.createdAt) }}</span>
              </template>

              <!-- L'uploadeur : à qui parler quand deux releases du même
                   contenu divergent. L'API le renvoyait déjà. -->
              <template v-if="row.uploader">
                <span class="related-meta-sep" aria-hidden="true">·</span>
                <span class="related-meta-up">{{ row.uploader.username }}</span>
              </template>

              <template v-if="row.reason">
                <span class="related-meta-sep" aria-hidden="true">·</span>
                <span class="related-meta-reason">{{ row.reason }}</span>
              </template>

              <!-- « racine v2 », pas « vérifié » : la racine est une valeur que
                   le partenaire publie sur ses propres octets, et rien ici ne
                   l'a recalculée. C'est une clé de correspondance forte, et ça
                   reste sa déclaration. -->
              <span
                v-if="row.matchType"
                class="related-match"
                :class="row.matchType === 'v2' ? 'related-match--root' : 'related-match--hint'"
                :title="row.matchType === 'v2'
                  ? $t('torrents.detail.crossMatchV2Title')
                  : $t('torrents.detail.crossMatchHintTitle')"
              >
                <span class="related-match-dot" aria-hidden="true" />
                {{ row.matchType === 'v2'
                  ? $t('torrents.detail.crossMatchVerified')
                  : $t('torrents.detail.crossMatchHint') }}
              </span>
            </span>
          </span>

          <!-- Pourquoi un cross-seed proposé peut rester introuvable dans le
               catalogue. `moderationStatus` arrivait dans la charge utile et la
               page le jetait. -->
          <TorrentModerationBadge
            v-if="row.moderationStatus"
            :status="row.moderationStatus"
            size="sm"
            class="related-mod"
          />

          <Icon name="ph:arrow-right-bold" class="related-arrow" aria-hidden="true" />
        </NuxtLink>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.related {
  /* Une teinte par provenance, consommée par le filet de tête de ligne. Locale
     à la composante : `--release-purple` n'est déclarée que sur la page, et une
     composante qui l'emprunte rend gris partout ailleurs.

     `--section-tone` suit la même teinte, pour que l'en-tête de section, le
     filet et les lignes disent tous la même chose — c'est l'intérêt d'une
     propriété héritée : une seule déclaration par variante. */
  --related-tint: var(--chart-4);
  --section-tone: var(--related-tint);
}
/* Le remplacement est un fait administratif : il prend le bleu de l'équipe. */
.related--supersedes { --related-tint: var(--chart-1); }
.related--federated { --related-tint: var(--info); }

.related-note {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  margin: 0 0 0.7rem;
  padding: 0.45rem 0.6rem;
  background-color: rgb(var(--related-tint) / 0.06);
  border-left: 2px solid rgb(var(--related-tint) / 0.45);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  font-size: 0.78125rem;
  line-height: 1.5;
  color: rgb(var(--fg-muted));
}
.related-note-icon {
  flex: none;
  margin-top: 0.15rem;
  color: rgb(var(--related-tint));
}

.related-mesh {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin-left: 0.4rem;
  padding: 0.05rem 0.5rem;
  border-radius: var(--radius-pill);
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-inset));
  font-weight: 600;
  color: rgb(var(--fg-default));
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.related-mesh-dot {
  flex: none;
  width: 0.4rem;
  height: 0.4rem;
  border-radius: var(--radius-pill);
  background: rgb(var(--online));
}

.related-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.related-item { display: block; }

/* La ligne prend un voile de sa teinte de provenance à 6 %, sous une encre
   entièrement NEUTRE (`--fg-strong` pour le nom, `--fg-muted` pour la méta) :
   mesuré, `--fg-default` sur un voile à 6 % de n'importe laquelle des quatre
   teintes décoratives donne 15,01:1 au pire en sombre et 16,96:1 en clair, et
   `--fg-muted` 6,06:1 et 6,39:1. Le survol monte le voile à 11 % au lieu de
   basculer sur le gris de survol : la couleur de la famille reste, elle
   s'affirme. Les courbes viennent des jetons, `ease` nu ayant été remplacé —
   `--ease-standard` est la courbe du site et n'était presque jamais demandée. */
.related-link {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.85rem 1rem;
  background:
    linear-gradient(rgb(var(--related-tint) / 0.06), rgb(var(--related-tint) / 0.06)),
    rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--related-tint) / 0.22);
  border-left: 3px solid rgb(var(--related-tint) / 0.6);
  border-radius: var(--radius-md);
  text-decoration: none;
  color: rgb(var(--fg-default));
  transition:
    background-color var(--dur-3) var(--ease-standard),
    border-color var(--dur-3) var(--ease-standard),
    transform var(--dur-4) var(--ease-emphasis);
}
.related-link:hover {
  background:
    linear-gradient(rgb(var(--related-tint) / 0.11), rgb(var(--related-tint) / 0.11)),
    rgb(var(--bg-elevated));
  border-color: rgb(var(--related-tint) / 0.4);
  border-left-color: rgb(var(--related-tint));
  transform: translateX(2px);
}
@media (prefers-reduced-motion: reduce) {
  .related-link:hover {
    transform: none;
  }
}

/* L'icône de provenance porte la teinte — élément non textuel, donc 3:1 et
   non 4,5:1 : la pire des quatre est `--chart-4` à 3,71:1 en sombre et
   `--accent-warm` à 3,05:1 en clair. */
.related-icon {
  flex: none;
  font-size: 1.05rem;
  color: rgb(var(--related-tint));
}

.related-body {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.related-name {
  flex: 1 1 auto;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  font-weight: 600;
  color: rgb(var(--fg-strong));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.related-link:hover .related-name { color: rgb(var(--fg-strong)); }

.related-meta {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  flex: none;
  font-family: var(--font-mono);
  font-size: var(--label-md, 0.625rem);
  letter-spacing: var(--label-tracking, calc(0.08em * var(--tracking-scale)));
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  font-variant-numeric: tabular-nums;
}
.related-meta-sep { opacity: 0.45; }
.related-meta-cat,
.related-meta-peer {
  font-weight: 700;
  color: rgb(var(--fg-default));
}

/* Les deux classes que le gabarit posait et que la feuille ne connaissait pas.
   La taille est la seule valeur que l'œil compare d'une ligne à l'autre : elle
   prend les chiffres tabulaires et l'encre pleine. L'âge, jamais comparé, passe
   en encre discrète — et reste sur `--fg-muted`, pas sur `--fg-subtle`, qui ne
   tient pas 4,5:1 sur le fond de survol en thème sombre. */
.related-meta-size {
  font-weight: 700;
  color: rgb(var(--fg-default));
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.related-meta-age {
  color: rgb(var(--fg-muted));
  white-space: nowrap;
}
.related-meta-up {
  color: rgb(var(--fg-muted));
  text-transform: none;
  letter-spacing: normal;
  max-width: 9rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.related-meta-reason {
  color: rgb(var(--fg-muted));
  text-transform: none;
  letter-spacing: normal;
}

.related-meta-seed {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-weight: 700;
  color: rgb(var(--fg-default));
  white-space: nowrap;
}
.related-meta-seed-i {
  font-size: 0.6rem;
  margin-right: 0.1rem;
  color: rgb(var(--online));
}

.related-match {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.05rem 0.4rem;
  border-radius: var(--radius-pill);
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-inset));
  font-weight: 600;
  color: rgb(var(--fg-default));
  white-space: nowrap;
}
.related-match-dot {
  width: 0.35rem;
  height: 0.35rem;
  border-radius: var(--radius-pill);
  background: rgb(var(--fg-faint));
}
.related-match--root .related-match-dot { background: rgb(var(--online)); }
.related-match--hint .related-match-dot { background: rgb(var(--fg-faint)); }

.related-mod { flex: none; }

.related-arrow {
  flex: none;
  font-size: 0.85rem;
  color: rgb(var(--fg-muted));
  transition:
    transform var(--dur-3) var(--ease-standard),
    color var(--dur-3) var(--ease-standard);
}
.related-link:hover .related-arrow {
  color: rgb(var(--related-tint));
  transform: translateX(2px);
}

@media (max-width: 900px) {
  .related-body {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.35rem;
  }
  .related-name { white-space: normal; overflow-wrap: anywhere; }
  .related-meta { flex-wrap: wrap; }
}
@media (max-width: 720px) {
  .related-link {
    flex-wrap: wrap;
    align-items: flex-start;
    padding: 0.7rem 0.85rem;
  }
  .related-arrow { display: none; }
}
</style>
