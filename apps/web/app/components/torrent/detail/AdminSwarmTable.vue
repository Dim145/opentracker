<script setup lang="ts">
import { formatAge, formatSize } from '~/utils/format';

/**
 * La liste des pairs, pour un administrateur.
 *
 * # Pourquoi une table
 *
 * C'est de la donnée d'exploitation : cinq colonnes homogènes qu'on parcourt
 * verticalement pour repérer l'anomalie. Rien ne scanne mieux qu'une table —
 * tant qu'il y a la largeur pour l'afficher.
 *
 * # Ce qui change en sortant de la page
 *
 * Sous 640 px, la table ne faisait que RÉTRÉCIR sa police à l'intérieur d'un
 * cadre `overflow-x: auto`. À cinq colonnes, cela donnait un défilement
 * horizontal dans une page qui défile déjà verticalement — le geste le plus
 * facile à rater sur un téléphone, et le seul moyen d'atteindre « vu il y a ».
 * Chaque ligne devient donc une carte : l'endpoint en tête, les quatre autres
 * valeurs en paires libellé / valeur, plus rien à faire défiler de côté.
 *
 * Les libellés de colonne deviennent les libellés des paires — via
 * `data-label`, pour que la table garde son `<thead>` sur grand écran et que le
 * lecteur d'écran garde ses en-têtes de colonne dans les deux cas.
 */
export interface SwarmPeer {
  id: string;
  port: number;
  isSeeder: boolean;
  uploaded: number;
  downloaded: number;
  lastSeen: string;
}

const props = withDefaults(
  defineProps<{
    /** Les pairs actifs, tels que les projette `/api/torrents/:hash`. */
    peers?: SwarmPeer[] | null;
  }>(),
  { peers: () => [] },
);

const rows = computed<SwarmPeer[]>(() => props.peers ?? []);

/** Les douze premiers caractères suffisent à distinguer deux pairs à l'œil. */
const ENDPOINT_CHARS = 12;
</script>

<template>
  <section class="section">
    <SectionHead
      :title="$t('torrents.detail.sections.swarm')"
      :count="rows.length"
      icon="ph:users-three"
    >
      <template #action>
        <span class="swarm-tag" :title="$t('torrents.detail.swarm.adminOnlyTooltip')">
          {{ $t('torrents.detail.swarm.adminOnly') }}
        </span>
      </template>
    </SectionHead>

    <div class="swarm-frame">
      <table class="swarm-table">
        <thead>
          <tr>
            <th>{{ $t('torrents.detail.swarm.endpoint') }}</th>
            <th>{{ $t('torrents.detail.swarm.type') }}</th>
            <th>{{ $t('torrents.detail.swarm.uploaded') }}</th>
            <th>{{ $t('torrents.detail.swarm.downloaded') }}</th>
            <th class="swarm-col-last">{{ $t('torrents.detail.swarm.lastSeen') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="rows.length === 0" class="swarm-row--empty">
            <td colspan="5" class="swarm-empty">
              <span class="swarm-empty-plate" aria-hidden="true">
                <Icon name="ph:users-three" class="swarm-empty-icon" />
              </span>
              <span class="swarm-empty-text">{{ $t('torrents.detail.swarm.empty') }}</span>
            </td>
          </tr>
          <tr v-for="peer in rows" :key="peer.id">
            <td class="swarm-cell-endpoint" :data-label="$t('torrents.detail.swarm.endpoint')">
              <span class="swarm-endpoint">{{ peer.id.slice(0, ENDPOINT_CHARS) }}…</span>
              <span class="swarm-port">:{{ peer.port }}</span>
            </td>
            <td :data-label="$t('torrents.detail.swarm.type')">
              <span
                class="swarm-type"
                :class="peer.isSeeder ? 'swarm-type--seeder' : 'swarm-type--leecher'"
              >
                <Icon
                  :name="peer.isSeeder ? 'ph:arrow-up-bold' : 'ph:arrow-down-bold'"
                  class="swarm-type__icon"
                />
                {{
                  peer.isSeeder
                    ? $t('torrents.detail.swarm.seeder')
                    : $t('torrents.detail.swarm.leecher')
                }}
              </span>
            </td>
            <td class="swarm-num" :data-label="$t('torrents.detail.swarm.uploaded')">
              {{ formatSize(peer.uploaded) }}
            </td>
            <td class="swarm-num" :data-label="$t('torrents.detail.swarm.downloaded')">
              {{ formatSize(peer.downloaded) }}
            </td>
            <td
              class="swarm-num swarm-col-last"
              :data-label="$t('torrents.detail.swarm.lastSeen')"
            >
              {{ formatAge(peer.lastSeen) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
/* Copie locale : `.section` appartenait à la page, pas au CSS global. Les
   quatre copies (ici, `BuffsForm`, `SupersedeForm`, `FederationSwarmToggle`)
   restent identiques au caractère près — c'est déjà le piège que ce fichier
   documente, et le rail ci-dessous est ajouté aux quatre à l'identique.

   Le rail bleu est la marque de la famille « exploitation » : ce que l'ÉQUIPE
   fait de la release, par opposition à ce qu'elle vaut (or) ou à ce qu'elle
   contient (cyan). `--chart-1` était déclarée dans `main.css` et n'était
   utilisée nulle part. Non textuelle : 4,27:1 en sombre, 3,31:1 en clair sur
   ces surfaces, au-dessus des 3:1 de la 1.4.11. */
.section {
  --section-tone: var(--chart-1);
  padding: 1rem 1.1rem;
  border: 1px solid rgb(var(--line-default));
  border-left: 3px solid rgb(var(--chart-1) / 0.55);
  border-radius: var(--radius-lg);
  background: rgb(var(--bg-surface));
}

/* La pastille « administrateurs seulement ». Elle vit dans le slot d'action de
   `SectionHead`, donc dans CE fichier : le contenu d'un slot est compilé dans
   la portée de l'appelant, pas dans celle du composant qui l'accueille. */
.swarm-tag {
  flex-shrink: 0;
  padding: 0.18rem 0.45rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  background: rgb(var(--bg-elevated) / 0.55);
  font-family: var(--font-mono);
  font-size: 0.5625rem;
  font-weight: 700;
  letter-spacing: calc(0.22em * var(--tracking-scale));
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  cursor: help;
}

.swarm-frame {
  overflow-x: auto;
  border: 1px solid rgb(var(--chart-1) / 0.22);
  border-radius: var(--radius-lg);
  background: rgb(var(--bg-elevated));
  box-shadow: 0 6px 18px -10px
    rgb(var(--shadow-color) / calc(0.55 * var(--shadow-strength)));
}
.swarm-table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--font-mono);
  font-size: 0.6875rem;
}
/* Voile de la teinte de famille à 16 % sous encre NEUTRE — le motif mesuré
   (4,84:1 au pire pour `--fg-muted`, sur les huit teintes et les deux
   thèmes). Le fond d'avant était un voile de `--bg-base` à 40 %, donc gris. */
.swarm-table thead th {
  padding: 0.65rem 1rem;
  border-bottom: 1px solid rgb(var(--chart-1) / 0.3);
  background:
    linear-gradient(rgb(var(--chart-1) / 0.16), rgb(var(--chart-1) / 0.16)),
    rgb(var(--bg-inset));
  font-size: 0.5938rem;
  font-weight: 700;
  letter-spacing: calc(0.22em * var(--tracking-scale));
  text-align: left;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.swarm-table tbody td {
  padding: 0.6rem 1rem;
  border-bottom: 1px solid rgb(var(--line-default) / 0.55);
  color: rgb(var(--fg-default));
  vertical-align: middle;
}
.swarm-table tbody tr:last-child td {
  border-bottom: 0;
}
.swarm-table tbody tr:hover td {
  background: rgb(var(--bg-elevated) / 0.45);
}
.swarm-col-last {
  text-align: right;
}

.swarm-endpoint {
  color: rgb(var(--fg-muted));
}
.swarm-port {
  color: rgb(var(--fg-faint));
}
/* Des octets se comparent en colonne : sans chiffres de largeur fixe, deux
   tailles voisines ne s'alignent pas et l'œil ne peut plus les ranger. */
.swarm-num {
  font-size: 0.6563rem;
  font-variant-numeric: tabular-nums;
  color: rgb(var(--fg-default));
}

.swarm-type {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.18rem 0.5rem;
  border: 1px solid;
  border-radius: var(--radius-xs);
  font-size: 0.5625rem;
  font-weight: 700;
  letter-spacing: calc(0.18em * var(--tracking-scale));
  text-transform: uppercase;
}
/* `rem` et non le `text-[8px]` d'origine : `--ui-scale` n'est appliqué qu'une
   fois, sur `html { font-size }`, donc une taille en pixels rendait le réglage
   d'échelle de l'exploitant inerte sur cette flèche. */
.swarm-type__icon {
  font-size: 0.5rem;
}
/* Correctif de contraste, pas un choix esthétique.
   Ces deux pastilles posaient `color: --online` sur `background: --online/0.08`
   — une encre sur un voile d'ELLE-MÊME. Mesuré : **4,08:1 en thème clair** pour
   le seeder et **4,07:1** pour le leecher, sous les 4,5:1 requis d'un texte, et
   invisible en thème sombre où les mêmes paires donnent 6,04:1 et 6,98:1. C'est
   très exactement le défaut que la note de `--danger-fg` décrit dans
   `main.css` : la paire qui ne tient que dans un thème sur deux.
   Fond NEUTRE, encre pleine : `--online` sur `--bg-inset` donne 8,41:1 en
   sombre et 4,60:1 en clair, `--warning` 10,00:1 et 4,61:1. La flèche du
   gabarit porte déjà l'information sans couleur. */
.swarm-type--seeder {
  border-color: rgb(var(--online) / 0.45);
  background: rgb(var(--bg-inset));
  color: rgb(var(--online));
}
.swarm-type--leecher {
  border-color: rgb(var(--warning) / 0.45);
  background: rgb(var(--bg-inset));
  color: rgb(var(--warning));
}

/* L'absence de peers. Elle s'écrivait en capitales mono espacées de 0,22 em,
   à 10 px, en gris : la typographie d'une ligne de journal système, pour un
   état parfaitement normal. Elle se lit maintenant comme une phrase, sur la
   trame de fond du site et un voile de la teinte de famille — et « rien ici »
   cesse de ressembler à « quelque chose a cassé ». */
.swarm-empty {
  padding: 2.25rem 1rem;
  background:
    var(--bg-pattern-image),
    linear-gradient(rgb(var(--chart-1) / 0.05), rgb(var(--chart-1) / 0.05)),
    transparent;
  background-size: var(--bg-pattern-step) var(--bg-pattern-step), auto, auto;
  text-align: center;
}
.swarm-empty-plate {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  margin-bottom: 0.55rem;
  /* Plaque NEUTRE sous un glyphe teinté : `--chart-1` sur un voile d'elle-même
     tombe à 2,90:1 en clair, sous les 3:1. */
  background: rgb(var(--bg-inset));
  border: 1px solid rgb(var(--chart-1) / 0.4);
  border-radius: var(--radius-pill);
}
.swarm-empty-icon {
  font-size: 1.1rem;
  color: rgb(var(--chart-1));
}
.swarm-empty-text {
  display: block;
  margin: 0 auto;
  max-width: 32ch;
  font-family: var(--font-sans);
  font-size: 0.8125rem;
  font-weight: 500;
  letter-spacing: normal;
  line-height: 1.55;
  text-transform: none;
  color: rgb(var(--fg-muted));
}

/* ── Sous 640 px : des cartes, pas un défilement latéral ─────────────────── */
@media (max-width: 40rem) {
  .swarm-frame {
    /* Plus rien à faire défiler de côté : chaque ligne tient dans la largeur. */
    overflow-x: visible;
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
  }
  .swarm-table,
  .swarm-table tbody,
  .swarm-table tbody tr,
  .swarm-table tbody td {
    display: block;
    width: 100%;
  }
  /* Le `<thead>` sort de l'affichage sans sortir de l'arbre d'accessibilité :
     `clip` plutôt que `display: none`, pour que la table reste une table. */
  .swarm-table thead {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .swarm-table tbody tr {
    margin-bottom: 0.6rem;
    border: 1px solid rgb(var(--line-strong));
    border-radius: var(--radius-md);
    background: rgb(var(--bg-elevated));
    box-shadow: 0 4px 12px -8px
      rgb(var(--shadow-color) / calc(0.55 * var(--shadow-strength)));
  }
  .swarm-table tbody tr:last-child {
    margin-bottom: 0;
  }
  .swarm-table tbody tr:hover td {
    background: transparent;
  }
  .swarm-table tbody td {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.45rem 0.75rem;
    border-bottom: 1px solid rgb(var(--line-default) / 0.55);
    text-align: right;
  }
  /* Le libellé de colonne redevient le libellé de la paire. */
  .swarm-table tbody td::before {
    content: attr(data-label);
    flex: none;
    font-size: 0.5625rem;
    font-weight: 700;
    letter-spacing: calc(0.18em * var(--tracking-scale));
    text-align: left;
    text-transform: uppercase;
    color: rgb(var(--fg-muted));
  }
  /* L'endpoint est le titre de la carte : il prend la ligne entière, sans
     libellé — « endpoint » devant une adresse n'apprend rien. */
  .swarm-table tbody td.swarm-cell-endpoint {
    display: block;
    padding: 0.6rem 0.75rem 0.5rem;
    border-bottom: 1px solid rgb(var(--line-default));
    background: rgb(var(--bg-base) / 0.35);
    font-size: 0.75rem;
    text-align: left;
  }
  .swarm-table tbody td.swarm-cell-endpoint::before {
    content: none;
  }
  .swarm-table tbody tr td:last-child {
    border-bottom: 0;
  }
  .swarm-col-last {
    text-align: right;
  }
  /* La ligne vide n'est pas une carte : c'est l'absence de cartes. */
  .swarm-table tbody tr.swarm-row--empty {
    border: 1px dashed rgb(var(--line-default));
    background: transparent;
    box-shadow: none;
  }
  .swarm-table tbody tr.swarm-row--empty td {
    display: block;
    border-bottom: 0;
    text-align: center;
  }
  .swarm-table tbody tr.swarm-row--empty td::before {
    content: none;
  }
}
</style>
