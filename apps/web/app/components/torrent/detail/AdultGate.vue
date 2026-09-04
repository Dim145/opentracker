<script setup lang="ts">
/**
 * La page parallèle d'un membre qui a coupé le contenu adulte.
 *
 * # Pourquoi une page et non un bandeau
 *
 * Quand `/api/torrents/:hash` renvoie la forme caviardée, il n'y a RIEN à
 * afficher : ni le nom, ni la taille, ni le swarm. Un bandeau au-dessus d'une
 * page vide laisserait croire à une panne. Ici la page assume le filtre — elle
 * mime la position du titre par trois barres de censure, montre la route qu'on
 * a demandée avec le milieu du hash noirci, et pointe le réglage à un clic.
 *
 * Garder les quatre premiers et les quatre derniers caractères du hash suffit à
 * dire « oui, il y a bien un document là » sans permettre de le recopier
 * ailleurs.
 *
 * # Ce qui change en sortant de la page
 *
 * Les hachures de danger étaient écrites `rgba(229, 62, 62, .03)` — la valeur
 * de `--danger` du thème SOMBRE, figée en dur. Elles sont maintenant
 * `rgb(var(--danger) / .03)`, donc elles suivent le thème. Même correction sur
 * les deux rehauts blancs du tampon, qui supposaient un fond sombre : ils
 * prennent la couleur d'avant-plan du tampon (`--danger-fg`), qui bascule avec
 * lui.
 */
const props = withDefaults(
  defineProps<{
    /** Le hash demandé, tel qu'il est dans la route. Jamais montré en entier. */
    hash: string;
    /**
     * Le nom de la catégorie, si la charge caviardée en donne un. C'est la
     * seule chose que le serveur accepte de dire du torrent.
     */
    categoryName?: string | null;
  }>(),
  { categoryName: null },
);

const titleId = useId();

/** Le hash, milieu noirci. `abcd…7f0e` plutôt que rien ou tout. */
const redactedHash = computed(() => {
  const h = props.hash || '';
  if (h.length <= 8) return h;
  return `${h.slice(0, 4)}…${h.slice(-4)}`;
});

/** `XXX` quand le serveur n'a même pas donné la catégorie. */
const category = computed(() => props.categoryName || 'XXX');
</script>

<template>
  <section class="adult-gate" :aria-labelledby="titleId">
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
        <h1 :id="titleId" class="adult-gate__title">
          <span class="adult-gate__title-word">
            {{ $t('torrents.detail.adultGate.titleWord') }}
          </span>
          <span class="adult-gate__title-stamp" aria-hidden="true">
            <span class="adult-gate__title-stamp-inner">
              {{ $t('torrents.detail.adultGate.titleStamp') }}
            </span>
          </span>
        </h1>

        <!-- Trois barres à la place du titre : l'œil lit « il y a un titre
             ici », le lecteur d'écran ne lit rien du tout. -->
        <p class="adult-gate__redacted" aria-hidden="true">
          <span /><span /><span />
        </p>

        <dl class="adult-gate__meta">
          <div>
            <dt>{{ $t('common.category') }}</dt>
            <dd>{{ category }}</dd>
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
</template>

<style scoped>
.adult-gate {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  max-width: 45rem;
  margin: 1rem auto 4rem;
  padding: 0 0.25rem;
}

.adult-gate__back {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  width: max-content;
  font-family: var(--font-mono);
  font-size: var(--label-md, 0.625rem);
  font-weight: var(--label-weight, 700);
  letter-spacing: var(--label-tracking-wide, calc(0.16em * var(--tracking-scale)));
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  transition: color var(--dur-2) var(--ease-standard);
}
.adult-gate__back:hover {
  color: rgb(var(--fg-strong));
}

.adult-gate__panel {
  position: relative;
  overflow: hidden;
  border: 1px solid rgb(var(--line-default));
  border-left: 3px solid rgb(var(--danger));
  border-radius: var(--radius-lg);
  background: rgb(var(--bg-surface));
  /* Le hachuré de danger, à 3 % : la surface se lit comme un avertissement
     sans écraser ce qu'elle porte. Le jeton et non le triplet — la valeur
     écrite en dur était celle du thème sombre, sur fond clair elle virait. */
  background-image: repeating-linear-gradient(
    -45deg,
    transparent,
    transparent 1rem,
    rgb(var(--danger) / 0.03) 1rem,
    rgb(var(--danger) / 0.03) 1.125rem
  );
  animation: gate-rise calc(0.45s * var(--motion-scale)) var(--ease-standard) both;
}
@keyframes gate-rise {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
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
    rgb(var(--danger) / 0.18),
    rgb(var(--danger) / 0.18) 0.875rem,
    rgb(var(--danger) / 0.06) 0.875rem,
    rgb(var(--danger) / 0.06) 1.75rem
  );
  font-family: var(--font-mono);
  font-size: var(--label-md, 0.625rem);
  font-weight: 800;
  letter-spacing: var(--label-tracking-wide, calc(0.16em * var(--tracking-scale)));
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
  letter-spacing: calc(0.06em * var(--tracking-scale));
  text-transform: lowercase;
  color: rgb(var(--fg-muted));
}
/* Le milieu du hash : avant-plan et fond de la même couleur, donc une barre
   opaque dans les deux thèmes. Le texte reste dans le DOM. */
.adult-gate__hash {
  color: rgb(var(--fg-strong));
  background: rgb(var(--fg-strong));
}

.adult-gate__body {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  padding: 2rem 1.6rem 1.5rem;
}
.adult-gate__eyebrow {
  margin: 0;
  font-family: var(--font-mono);
  font-size: var(--label-md, 0.625rem);
  font-weight: var(--label-weight, 700);
  letter-spacing: var(--label-tracking-wide, calc(0.16em * var(--tracking-scale)));
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.adult-gate__title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
  margin: 0;
  font-size: clamp(2rem, 6vw, 3.4rem);
  font-weight: 900;
  line-height: 1;
  letter-spacing: calc(-0.025em * var(--tracking-scale));
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
}
.adult-gate__title-word {
  font-style: italic;
}
.adult-gate__title-stamp {
  position: relative;
  display: inline-flex;
  padding: 0.2em 0.6em 0.25em;
  background: rgb(var(--danger));
  color: rgb(var(--danger-fg));
  letter-spacing: calc(0.05em * var(--tracking-scale));
  /* Une inclinaison hors axe : une vraie empreinte de tampon n'est pas droite. */
  transform: rotate(-1.5deg);
  /* Le rehaut prend l'avant-plan DU TAMPON. Écrit en blanc, il supposait un
     fond sombre et disparaissait en thème clair. */
  box-shadow:
    inset 0 0 0 2px rgb(var(--danger-fg) / 0.18),
    0 1px 0 rgb(var(--shadow-color) / calc(0.4 * var(--shadow-strength)));
}
.adult-gate__title-stamp::after {
  content: '';
  position: absolute;
  inset: -2px;
  border: 2px dashed rgb(var(--danger-fg) / 0.35);
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
  border-radius: 1px;
  background: rgb(var(--fg-strong));
  animation: gate-bar calc(1.2s * var(--motion-scale)) cubic-bezier(0.2, 0.6, 0.2, 1) both;
}
.adult-gate__redacted span:nth-child(1) { width: 78%; animation-delay: calc(0.05s * var(--motion-scale)); }
.adult-gate__redacted span:nth-child(2) { width: 64%; animation-delay: var(--dur-1); }
.adult-gate__redacted span:nth-child(3) { width: 42%; animation-delay: calc(0.19s * var(--motion-scale)); }
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
  border-radius: var(--radius-md);
  background: rgb(var(--bg-elevated) / 0.6);
}
.adult-gate__meta div {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.adult-gate__meta dt {
  margin: 0;
  font-family: var(--font-mono);
  font-size: var(--label-sm, 0.5625rem);
  font-weight: var(--label-weight, 700);
  letter-spacing: var(--label-tracking-wide, calc(0.16em * var(--tracking-scale)));
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.adult-gate__meta dd {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.78125rem;
  font-weight: 700;
  color: rgb(var(--fg-strong));
}

.adult-gate__copy {
  max-width: 56ch;
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.55;
  color: rgb(var(--fg-default));
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
  border-radius: var(--radius-pill);
  background: rgb(var(--danger));
  color: rgb(var(--danger-fg));
  font-family: var(--font-mono);
  font-size: var(--label-lg, 0.6875rem);
  font-weight: 800;
  letter-spacing: var(--label-tracking-wide, calc(0.16em * var(--tracking-scale)));
  text-transform: uppercase;
  transition: filter var(--dur-2) var(--ease-standard);
}
.adult-gate__cta:hover {
  filter: brightness(1.1);
}
.adult-gate__cta--ghost {
  border-color: rgb(var(--line-default));
  background: transparent;
  color: rgb(var(--fg-strong));
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
  background: rgb(var(--bg-surface));
  font-family: var(--font-mono);
  font-size: var(--label-sm, 0.5625rem);
  letter-spacing: var(--label-tracking-wide, calc(0.16em * var(--tracking-scale)));
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.adult-gate__foot-mono {
  text-transform: lowercase;
  letter-spacing: calc(0.04em * var(--tracking-scale));
  color: rgb(var(--fg-default));
}

/* 33.75rem = les 540px d'origine. En requête de média, `rem` vaut toujours la
   taille INITIALE de la racine, donc le point de bascule ne bouge pas avec
   `--ui-scale` — c'est la seule unité qui garde ici le sens de la valeur en
   pixels qu'elle remplace. */
@media (max-width: 33.75rem) {
  .adult-gate__meta {
    grid-template-columns: 1fr;
  }
}
</style>
