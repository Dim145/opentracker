<script setup lang="ts">
import type { SeedObligation } from '~/composables/useTorrentDetail';

/**
 * Ce que le membre doit encore à CETTE release.
 *
 * # La donnée existait et n'atteignait pas la page
 *
 * `/api/torrents/:hash/my-obligation` répond depuis toujours ; la page de
 * détail ne l'appelait pas. Un membre voyait donc « seeders 47 » sans jamais
 * voir « et il vous reste 61 h à tenir sur celle-ci » — la seule des deux
 * informations qui le concerne personnellement, et la seule qui répond à
 * « devrais-je la prendre ».
 *
 * # Une phrase, pas un ratio
 *
 * « 0,15 » ne dit rien. « 11 h / 72 h » demande une soustraction. « Il reste
 * 61 h avant de vous libérer » dit exactement ce qu'il y a à faire, et c'est
 * la formulation que porte ce composant. La jauge et les chiffres restent —
 * pour l'œil qui vérifie — mais ils viennent APRÈS la phrase, jamais à sa
 * place.
 *
 * # Couleur
 *
 * L'état colore le TEXTE et la jauge sur un fond neutre. Le motif inverse — un
 * voile de la couleur d'état en fond — fait tomber la paire sous 4,5:1 en
 * thème clair, et l'état est précisément ce qu'il ne faut pas rendre illisible.
 */
const props = withDefaults(
  defineProps<{
    /**
     * L'obligation, telle que la renvoie `useTorrentDetail`. `null` quand le
     * visiteur n'est pas connecté — le composant ne rend alors rien.
     */
    obligation?: SeedObligation | null;
    /** Ajoute le cadre de carte, pour un usage hors de `DecisionCard`. */
    boxed?: boolean;
  }>(),
  { obligation: null, boxed: false },
);

const { t, locale } = useI18n();

const view = computed(() => obligationView(props.obligation));

/**
 * Quand l'état change pendant que la carte est affichée — « pas encore
 * téléchargée » qui devient « en cours » une seconde après le clic — un
 * balayage de la teinte traverse la carte : c'est la conséquence du geste qui
 * descend dans la page. Jamais au premier rendu.
 */
const changed = ref(false);
let changedTimer: ReturnType<typeof setTimeout> | null = null;
watch(() => view.value?.state, (next, prev) => {
  if (prev === undefined || next === prev) return;
  changed.value = false;
  requestAnimationFrame(() => { changed.value = true; });
  if (changedTimer) clearTimeout(changedTimer);
  changedTimer = setTimeout(() => (changed.value = false), 800);
});
onBeforeUnmount(() => { if (changedTimer) clearTimeout(changedTimer); });

const stateLabel = computed(() => {
  switch (view.value?.state) {
    case 'exempt':
      return t('torrents.detail.obligation.state.exempt');
    case 'pending':
      return t('torrents.detail.obligation.state.pending');
    case 'hnr':
      return t('torrents.detail.obligation.state.hnr');
    case 'met':
      return t('torrents.detail.obligation.state.met');
    default:
      return t('torrents.detail.obligation.state.running');
  }
});

/** La phrase. C'est elle qui porte l'information, pas la jauge. */
const note = computed(() => {
  const v = view.value;
  if (!v) return '';
  const remaining = formatDurationSeconds(v.remaining, locale.value);
  const required = formatDurationSeconds(v.requiredSeedTime, locale.value);
  switch (v.state) {
    case 'exempt':
      return t('torrents.detail.obligation.exemptNote');
    case 'pending':
      return t('torrents.detail.obligation.pendingNote', { time: required });
    case 'hnr':
      return t('torrents.detail.obligation.hnrNote', { time: remaining });
    case 'met':
      return t('torrents.detail.obligation.metNote');
    default:
      return t('torrents.detail.obligation.remaining', { time: remaining });
  }
});

const doneText = computed(() =>
  view.value ? formatDurationSeconds(view.value.seedTime, locale.value) : '',
);
const requiredText = computed(() =>
  view.value ? formatDurationSeconds(view.value.requiredSeedTime, locale.value) : '',
);
const percentText = computed(() =>
  view.value
    ? (view.value.percent / 100).toLocaleString(locale.value, {
        style: 'percent',
        maximumFractionDigits: 0,
      })
    : '',
);

/**
 * La jauge n'existe que quand il y a une progression à montrer.
 *
 * Un membre exempté n'a pas de compteur, et un membre qui n'a pas pris la
 * release a un compteur à zéro qui ne veut pas dire « en retard » — dessiner
 * une barre vide dirait exactement le contraire de la phrase au-dessus.
 */
const showMeter = computed(
  () => view.value !== null && view.value.state !== 'exempt' && view.value.state !== 'pending',
);
</script>

<template>
  <div
    v-if="view"
    class="sob"
    :class="[`sob--${view.state}`, { 'card sob--boxed': boxed, 'sob--changed': changed }]"
  >
    <div class="sob-head">
      <span class="eyebrow-mono sob-key">{{ $t('torrents.detail.obligation.title') }}</span>
      <Transition name="sob-t" mode="out-in">
        <span :key="view.state" class="sob-state">{{ stateLabel }}</span>
      </Transition>
    </div>

    <div
      v-if="showMeter"
      class="sob-meter"
      role="progressbar"
      :aria-label="$t('torrents.detail.obligation.meterLabel')"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="view.percent"
      :aria-valuetext="
        $t('torrents.detail.obligation.progress', {
          done: doneText,
          required: requiredText,
        })
      "
    >
      <span class="sob-fill" :style="{ width: `${view.percent}%` }" />
    </div>

    <p v-if="showMeter" class="sob-legend">
      <span class="sob-done">{{ doneText }} · {{ percentText }}</span>
      <span class="sob-required">{{
        $t('torrents.detail.obligation.requiredShort', { time: requiredText })
      }}</span>
    </p>

    <p class="sob-note">{{ note }}</p>
  </div>
</template>

<style scoped>
.sob {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  /* La teinte de l'état, choisie une fois et consommée par le texte et la
     jauge. Un `--tone` plutôt que six règles dupliquées. */
  --tone: var(--warning);
}
.sob--changed {
  background-image: linear-gradient(100deg, transparent 30%, rgb(var(--tone) / 0.18) 50%, transparent 70%);
  background-size: 250% 100%;
  background-repeat: no-repeat;
  animation: sob-sweep calc(600ms * var(--motion-scale)) var(--ease-standard) both;
}
@keyframes sob-sweep {
  from { background-position: 120% 0; }
  to { background-position: -120% 0; }
}
.sob-t-enter-active,
.sob-t-leave-active {
  transition: opacity var(--dur-2) var(--ease-standard), transform var(--dur-2) var(--ease-standard);
}
.sob-t-enter-from { opacity: 0; transform: translateY(0.3em); }
.sob-t-leave-to { opacity: 0; transform: translateY(-0.3em); }
.sob--hnr {
  --tone: var(--danger);
}
.sob--met,
.sob--exempt {
  --tone: var(--online);
}
.sob--pending {
  --tone: var(--fg-muted);
}

/* Hors de `DecisionCard`, la carte porte son propre cadre — et un voile de sa
   teinte d'état à 8 %. Les trois textes qu'elle porte sont NEUTRES ou de la
   teinte sur fond neutre… sauf `.sob-state`, qui est de la teinte : il repasse
   donc en encre neutre forte quand le voile est là (voir sa règle). Mesuré :
   `--fg-default` sur un voile à 8 % des quatre teintes d'état donne 12,82:1 au
   pire, `--fg-muted` 5,18:1. */
.sob--boxed {
  padding: 0.7rem 0.85rem;
  background:
    linear-gradient(rgb(var(--tone) / 0.08), rgb(var(--tone) / 0.08)),
    rgb(var(--bg-surface));
  border-left: 3px solid rgb(var(--tone));
}

.sob-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.sob-key {
  /* `.eyebrow-mono` porte la casse, la graisse et l'interlettrage ; seule la
     couleur change ici, parce que le motif a treize copies dans le dépôt et
     qu'une quatorzième ne servirait personne. */
  color: rgb(var(--fg-muted));
}
.sob-state {
  /* Texte teinté sur fond NEUTRE : c'est la paire qui tient dans les deux
     thèmes. Le fond teinté sous le même texte ne tient pas en clair —
     `--online` sur un voile d'elle-même tombe à 4,08:1, `--warning` à 4,07:1.
     D'où la ligne suivante : dès que la variante encadrée pose son voile, ce
     texte-ci renonce à la teinte. La pastille de gauche la garde, elle n'est
     pas du texte. */
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.8125rem;
  font-weight: 700;
  color: rgb(var(--tone));
}
.sob--boxed .sob-state {
  color: rgb(var(--fg-strong));
}
.sob-state::before {
  content: '';
  flex: none;
  width: 0.45rem;
  height: 0.45rem;
  border-radius: var(--radius-pill);
  background: rgb(var(--tone));
  /* Un halo pour que le point se voie sur les deux thèmes sans grossir. */
  box-shadow: 0 0 0 2px rgb(var(--tone) / 0.22);
}

/* La jauge. Elle était un rectangle plat de 8 px dans un rectangle plat ; elle
   a maintenant un creux (l'ombre intérieure) et un remplissage qui a un haut et
   un bas. Ce n'est pas de la décoration : une jauge de 8 px sans relief ne se
   distingue pas d'un filet, et c'est le seul objet de la carte qu'on lit d'un
   coup d'œil au lieu de le lire. La rampe reste dans la MÊME teinte — un
   dégradé de deux couleurs sur une jauge fait croire à deux seuils. */
.sob-meter {
  height: 0.6rem;
  background-color: rgb(var(--bg-inset));
  border: 1px solid rgb(var(--tone) / 0.3);
  border-radius: var(--radius-pill);
  overflow: hidden;
  box-shadow: inset 0 1px 2px rgb(var(--shadow-color) / calc(0.35 * var(--shadow-strength)));
}
.sob-fill {
  display: block;
  height: 100%;
  background-image: linear-gradient(
    to bottom,
    rgb(var(--tone)),
    rgb(var(--tone) / 0.78)
  );
  background-color: rgb(var(--tone));
  border-radius: var(--radius-pill);
  transition: width var(--dur-slow) var(--ease-standard);
}

.sob-legend {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
  color: rgb(var(--fg-default));
}
.sob-required {
  color: rgb(var(--fg-muted));
}

.sob-note {
  margin: 0;
  font-size: 0.75rem;
  line-height: 1.5;
  color: rgb(var(--fg-muted));
  font-variant-numeric: tabular-nums;
}

@media (prefers-reduced-motion: reduce) {
  .sob-fill {
    transition: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .sob--changed { animation: none; background-image: none; }
  .sob-t-enter-active,
  .sob-t-leave-active { transition: none; }
}
</style>
