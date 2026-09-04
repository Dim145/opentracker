<script setup lang="ts">
import AdminSwarmTable from './AdminSwarmTable.vue';
import BuffsForm from './BuffsForm.vue';
import FederationSwarmToggle from './FederationSwarmToggle.vue';
import SupersedeForm from './SupersedeForm.vue';

/**
 * Tout ce qu'un exploitant voit et qu'un membre ne voit pas, au même endroit.
 *
 * # Pourquoi un seul bloc
 *
 * Les quatre outils étaient DISPERSÉS dans la page, entrelacés avec le contenu
 * public. Deux conséquences, toutes deux mesurées sur l'ancienne page :
 *
 *   1. La page d'un simple membre portait des TROUS là où les blocs de
 *      personnel se seraient trouvés — quatre `v-if` répartis sur 200 lignes de
 *      gabarit, donc quatre ruptures de rythme dans une page qui n'en montrait
 *      aucune raison.
 *   2. Le panneau de modération d'un UPLOADEUR se rendait SOUS la table des
 *      pairs d'un administrateur. Deux publics différents, une seule pile, dans
 *      l'ordre où le code avait été écrit.
 *
 * Regroupé par AUDIENCE plutôt que par fonctionnalité, il n'y a plus qu'une
 * frontière : au-dessus ce que tout le monde lit, ici ce que seul un exploitant
 * peut faire.
 *
 * # L'ordre à l'intérieur
 *
 * Du plus éditorial au plus technique : ce que la release COÛTE (les
 * multiplicateurs), ce qu'elle EST devenue (remplacée ou non), avec qui son
 * swarm est partagé, puis qui est dedans. Les trois premiers écrivent, le
 * dernier ne fait que lire.
 *
 * # Les gardes
 *
 * Chaque bloc porte la sienne, et elles ne se recouvrent pas : épingler et
 * remplacer sont des actes de modération ; l'interrupteur de fédération
 * appartient à qui peut éditer la release, donc aussi à son uploadeur ; la
 * liste des pairs est de la donnée d'exploitation, réservée aux
 * administrateurs. Quand aucune ne passe, la région entière ne se rend pas —
 * un cadre vide serait précisément le trou qu'on vient de supprimer.
 */
const props = withDefaults(
  defineProps<{
    /** Le hash de la release, tel qu'il est dans la route. */
    hash: string;
    /**
     * La ligne du torrent. Tous les champs sont optionnels : le détail arrive
     * en `Record<string, any>` et rien n'y est garanti présent.
     */
    torrent?: {
      infoHash?: string;
      federateSwarm?: boolean;
      downloadMultiplier?: number;
      uploadMultiplier?: number;
      multipliersUntil?: string | null;
      isSticky?: boolean;
      peers?: Array<{
        id: string;
        port: number;
        isSeeder: boolean;
        uploaded: number;
        downloaded: number;
        lastSeen: string;
      }>;
    } | null;
    /** Les deux sens du pointeur de remplacement ; seul l'aller sert ici. */
    supersessions?: { supersededBy?: { name?: string | null } | null } | null;
    /** Modérateur ou administrateur : buffs et remplacement. */
    isStaff?: boolean;
    /** Administrateur : les multiplicateurs, et la liste des pairs. */
    isAdmin?: boolean;
    /** Uploadeur ou personnel : l'interrupteur de fédération du swarm. */
    canEdit?: boolean;
    /** Sans partenaire, l'interrupteur de fédération n'a rien à commuter. */
    federationEnabled?: boolean;
  }>(),
  {
    torrent: null,
    supersessions: null,
    isStaff: false,
    isAdmin: false,
    canEdit: false,
    federationEnabled: false,
  },
);

const emit = defineEmits<{
  /**
   * Une écriture a abouti quelque part dans la région. La page recharge ce
   * qu'elle veut — la ligne, les supersessions, ou les deux.
   */
  (e: 'changed'): void;
}>();

/** L'interrupteur de fédération : le seul bloc ouvert à un uploadeur. */
const showFederation = computed(() => props.canEdit && props.federationEnabled);

/** Rien à montrer, rien à encadrer. */
const showArea = computed(
  () => props.isStaff || props.isAdmin || showFederation.value,
);

/**
 * `infoHash` de la ligne pour la route de fédération, `hash` de la route pour
 * les deux routes de modération. C'est ce que faisait la page, à la lettre :
 * l'un vient de la base en minuscules, l'autre de l'URL telle qu'elle a été
 * tapée, et les deux routes n'ont jamais été appelées avec la même source.
 */
const federationHash = computed(() => props.torrent?.infoHash || props.hash);

/* Le titre de la région est désigné par `aria-labelledby`, donc il lui faut un
   `id` unique : `useFieldIds` est ce qui garantit l'unicité quand deux
   instances du composant coexistent. */
const fid = useFieldIds();
</script>

<template>
  <section
    v-if="showArea"
    class="operator-area"
    :aria-labelledby="fid('operator-area')"
  >
    <!-- Le nom de la région devient VISIBLE.
         Il n'existait qu'en `aria-label` : un lecteur d'écran savait qu'il
         entrait dans « Outils d'exploitation », l'œil ne le savait pas — et à
         l'écran, quatre cartes au conteneur identique à celui des sections
         publiques défilaient sans que rien ne dise « à partir d'ici, c'est
         l'équipe ». `aria-labelledby` pointant sur un texte affiché est en
         outre préférable à un `aria-label` invisible : les deux publics lisent
         alors la même chose, et la traduction ne peut plus dériver d'un côté
         sans l'autre. La chaîne est celle qui servait déjà. -->
    <p :id="fid('operator-area')" class="operator-area__label">
      <span class="operator-area__plate" aria-hidden="true">
        <Icon name="ph:wrench-bold" class="operator-area__icon" />
      </span>
      {{ $t('torrents.detail.operator.area') }}
    </p>

    <BuffsForm
      v-if="isStaff"
      :hash="hash"
      :torrent="torrent"
      :is-admin="isAdmin"
      @changed="emit('changed')"
    />

    <SupersedeForm
      v-if="isStaff"
      :hash="hash"
      :superseded-by="supersessions?.supersededBy ?? null"
      @changed="emit('changed')"
    />

    <FederationSwarmToggle
      v-if="showFederation"
      :hash="federationHash"
      :enabled="!!torrent?.federateSwarm"
    />

    <AdminSwarmTable v-if="isAdmin" :peers="torrent?.peers ?? []" />
  </section>
</template>

<style scoped>
/* La région est un regroupement, pas une carte — mais elle doit se VOIR comme
   un regroupement. Elle ne portait ni fond, ni filet, ni titre : ses quatre
   cartes se lisaient donc comme quatre sections publiques de plus, dans un
   document de 3 830 px où treize conteneurs étaient rigoureusement identiques.

   Elle porte maintenant, en plus du titre visible : un filet de tête en
   dégradé, un très léger voile de la teinte de famille, et un retrait à
   gauche. Le voile est à 4 % et ne porte que des cartes opaques — aucune
   paire texte/fond n'y repose. */
.operator-area {
  --section-tone: var(--chart-1);
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding: 1rem 0 0.25rem 0.9rem;
  border-top: 1px solid rgb(var(--line-default));
  border-left: 1px solid rgb(var(--chart-1) / 0.28);
  border-radius: var(--radius-lg) 0 0 var(--radius-lg);
  background:
    linear-gradient(
      to bottom,
      rgb(var(--chart-1) / 0.05),
      rgb(var(--chart-1) / 0)
    ),
    transparent;
  background-size: 100% 12rem, auto;
  background-repeat: no-repeat;
}
/* Le filet de tête reprend le dégradé de `SectionHead` : la teinte à gauche,
   le gris de filet ensuite, l'extinction. Non textuel. */
.operator-area::before {
  content: '';
  display: block;
  height: 2px;
  margin: -1rem 0 0.25rem -0.9rem;
  background: linear-gradient(
    to right,
    rgb(var(--chart-1) / 0.7),
    rgb(var(--line-default)) 10rem,
    rgb(var(--line-default) / 0)
  );
}

.operator-area__label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  /* `rem` et non `px` : `--ui-scale` n'agit qu'une fois, sur
     `html { font-size }`. */
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: calc(0.16em * var(--tracking-scale));
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
/* Plaque NEUTRE, glyphe teinté — une teinte sur un voile d'elle-même tombe
   sous 3:1 en thème clair. */
.operator-area__plate {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 1.35rem;
  height: 1.35rem;
  background: rgb(var(--bg-inset));
  border: 1px solid rgb(var(--chart-1) / 0.45);
  border-radius: var(--radius-xs);
}
.operator-area__icon {
  font-size: 0.75rem;
  color: rgb(var(--chart-1));
}

@media (max-width: 767px) {
  .operator-area {
    /* Le retrait mange une largeur qu'un téléphone n'a pas : le filet de tête
       et le titre suffisent à marquer la frontière. */
    padding-left: 0;
    border-left: 0;
    border-radius: 0;
  }
  .operator-area::before {
    margin-left: 0;
  }
}
</style>
