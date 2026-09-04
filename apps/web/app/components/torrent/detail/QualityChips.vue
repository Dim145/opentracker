<script setup lang="ts">
import { tagForChip } from '~/utils/chipTagOverlap';
import type { ReleaseChips } from '~/utils/releaseChips';

/**
 * La qualité d'une release, en emplacements fixes.
 *
 * # Ce que ce composant ne fait pas
 *
 * Il n'analyse rien. `utils/releaseChips.ts` sait déjà tirer la résolution, la
 * source, le format, le codec, l'audio, le HDR et la langue d'un nom de
 * release — et il n'avait qu'UN seul appelant, la ligne de groupe. Le même
 * vocabulaire de tags a donc failli être réécrit ici, avec ses propres listes
 * de priorité et sa propre idée de ce qu'est un `REMUX` ; c'est exactement
 * ainsi que deux pages du même site finissent par nommer différemment la même
 * release. Une seule table, deux rendus.
 *
 * # Emplacements, pas une liste
 *
 * L'ordre est figé et ne dépend pas de ce que la release contient : le HDR est
 * au même rang sur une release qui n'a pas d'audio parsé que sur une release
 * complète. C'est la raison d'être du module — un membre qui ne regarde que la
 * résolution regarde toujours la même position, jamais un texte.
 *
 * # Couleur : une pastille à deux tons, et pourquoi celui-là
 *
 * La version d'avant portait la teinte sur le TEXTE de la valeur — trois
 * pastilles colorées sur huit, et deux d'entre elles seulement dans un thème.
 * Le recensement de la page l'a chiffré : 82 % des instances d'élément
 * colorées de la fiche étaient en gris pur.
 *
 * Le motif est donc inversé, avec la mesure qui manquait. Ce qui échoue, ce
 * n'est pas « un fond teinté », c'est **un fond teinté sous un texte de la même
 * famille** : `--accent-warm-text` sur un voile d'or donne 4,13:1 en thème
 * clair. Une encre NEUTRE sur ce même voile ne descend jamais :
 * `--fg-muted` sur un voile à 16 % de n'importe laquelle des huit teintes, sur
 * n'importe lequel des trois fonds de carte, dans les deux thèmes, tient
 * **4,84:1** au pire ; `--fg-strong` tient 12,52:1.
 *
 * D'où : la clé porte le voile de la teinte, la valeur reste sur le fond neutre
 * en encre pleine — et les huit emplacements deviennent huit couleurs au lieu
 * de trois. La valeur GAGNE du contraste au passage (`--fg-strong` au lieu de
 * `--accent-warm-text`, 21:1 au lieu de 5,06:1 en clair).
 *
 * Deux teintes sont écartées et il faut le dire : `--chart-3` et `--chart-6`
 * tombent à 1,94:1 et 2,19:1 sur les surfaces du thème clair — sous les 3:1
 * d'un élément non textuel. Elles sont inutilisables ici, quoi qu'elles
 * donnent en sombre.
 */
const props = withDefaults(
  defineProps<{
    /** Le nom de release à analyser. Ignoré si `chips` est fourni. */
    name?: string | null;
    /**
     * Des chips déjà analysées, quand l'appelant en tient (une ligne de
     * groupe, un aperçu). Évite de repasser l'analyseur sur le même nom.
     */
    chips?: ReleaseChips | null;
    /** Resserre les pastilles, pour la barre basse ou une ligne dense. */
    compact?: boolean;
    /**
     * Les tags du torrent, pour rendre les pastilles CLIQUABLES.
     *
     * C'est la seule chose que la rangée de tags apportait et pas celle-ci :
     * un lien vers le catalogue filtré. Sans tag correspondant, la pastille
     * reste inerte — mieux vaut pas de lien qu'un lien vers un filtre qui ne
     * trouverait rien.
     */
    tags?: ReadonlyArray<{ name: string; slug?: string }> | null;
  }>(),
  { name: null, chips: null, compact: false, tags: null },
);

const { t } = useI18n();

const parsed = computed<ReleaseChips | null>(() => {
  if (props.chips) return props.chips;
  if (!props.name) return null;
  return releaseChips(props.name);
});

interface Slot {
  /** L'emplacement, pour la clé de boucle. */
  id: string;
  /**
   * Le micro-libellé, DÉJÀ traduit.
   *
   * Traduit ici et non dans le gabarit : une clé construite —
   * `$t('…chipKeys.' + slot.id)` — n'est trouvable par aucune recherche
   * textuelle, donc une clé retirée du fichier de langue ne casse rien
   * jusqu'au rendu. Écrites en clair, les sept clés se grepent.
   */
  label: string;
  value: string;
  /**
   * L'emplacement de la clé de couleur — une teinte par NATURE de valeur, pas
   * par valeur. La résolution est toujours or, la source toujours cyan : c'est
   * ce qui permet de sauter à la bonne pastille sans lire le micro-libellé.
   */
  tone?: 'lang' | 'res' | 'src' | 'fmt' | 'codec' | 'audio' | 'hdr' | 'flag';
}

/**
 * Les emplacements dans leur ordre d'affichage, les vides retirés.
 *
 * Retirés et non rendus vides : une pastille « SRC — » sur chaque release dont
 * la source n'a pas été reconnue ajoute une colonne de bruit à la seule chose
 * que cette bande existe pour rendre lisible.
 */
/*
 * `resolveComponent` et non la chaîne `'NuxtLink'`.
 *
 * `<component :is="'NuxtLink'">` ne résout que les composants enregistrés
 * LOCALEMENT : avec l'auto-import de Nuxt, la chaîne est sortie telle quelle et
 * le navigateur a reçu `<nuxtlink to="/torrents?tag=vostfr">` — un élément
 * inconnu, donc ni lien, ni clic, ni tabulation. Vérifié dans le DOM avant
 * correction : `tagName === 'NUXTLINK'`.
 */
const NuxtLinkComponent = resolveComponent('NuxtLink');

/** Le catalogue filtré sur ce tag, quand il en existe un pour cette valeur. */
function chipHref(value: string | null): string | null {
  const t = tagForChip(value, props.tags);
  return t?.slug ? `/torrents?tag=${encodeURIComponent(t.slug)}` : null;
}

const slots = computed<Slot[]>(() => {
  const c = parsed.value;
  if (!c) return [];
  const out: Slot[] = [];
  if (c.language) {
    out.push({
      id: 'language',
      label: t('torrents.detail.chipKeys.language'),
      value: c.language,
      tone: 'lang',
    });
  }
  if (c.resolution) {
    out.push({
      id: 'resolution',
      label: t('torrents.detail.chipKeys.resolution'),
      value: c.resolution,
      tone: 'res',
    });
  }
  if (c.source) {
    out.push({
      id: 'source',
      label: t('torrents.detail.chipKeys.source'),
      value: c.source,
      tone: 'src',
    });
  }
  if (c.format) {
    out.push({
      id: 'format',
      label: t('torrents.detail.chipKeys.format'),
      value: c.format,
      tone: 'fmt',
    });
  }
  if (c.codec) {
    out.push({
      id: 'codec',
      label: t('torrents.detail.chipKeys.codec'),
      value: c.codec,
      tone: 'codec',
    });
  }
  if (c.audio) {
    out.push({
      id: 'audio',
      label: t('torrents.detail.chipKeys.audio'),
      value: c.audio,
      tone: 'audio',
    });
  }
  if (c.hdr) {
    out.push({
      id: 'hdr',
      label: t('torrents.detail.chipKeys.hdr'),
      value: c.hdr,
      tone: 'hdr',
    });
  }
  if (c.platform) {
    out.push({
      id: 'platform',
      label: t('torrents.detail.chipKeys.platform'),
      value: c.platform,
      tone: 'src',
    });
  }
  for (const flag of c.flags) {
    out.push({
      id: `flag:${flag}`,
      label: t('torrents.detail.chipKeys.flag'),
      value: flag,
      tone: 'flag',
    });
  }
  return out;
});

const label = computed(() => t('torrents.detail.quality.label'));
</script>

<template>
  <!--
    Une liste, pas une rangée de `<span>`. Chaque pastille est un couple
    « nature : valeur », et c'est ce couple qu'un lecteur d'écran doit
    annoncer — « source, WEB-DL » plutôt que « WEB-DL » seul, qui ne dit pas
    de quoi c'est la valeur.
  -->
  <ul
    v-if="slots.length"
    class="qc"
    :class="{ 'qc--compact': compact }"
    :aria-label="label"
  >
    <li v-for="slot in slots" :key="slot.id" class="qc-item">
      <component
        :is="chipHref(slot.value) ? NuxtLinkComponent : 'span'"
        :to="chipHref(slot.value) || undefined"
        class="qc-chip"
        :class="[
          slot.tone ? `qc-chip--${slot.tone}` : null,
          chipHref(slot.value) ? 'qc-chip--link' : null,
        ]"
      >
        <span class="qc-k">{{ slot.label }}</span>
        <span class="qc-v">{{ slot.value }}</span>
      </component>
    </li>
  </ul>
</template>

<style scoped>
.qc {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.qc-chip {
  /* Le repli est le gris de filet : une pastille sans teinte déclarée garde
     exactement l'apparence d'avant. */
  --chip-tone: var(--line-strong);
  display: inline-flex;
  align-items: stretch;
  overflow: hidden;
  min-height: 1.6rem;
  /* `rem` et jamais `px` : `--ui-scale` n'est appliqué qu'une fois, sur
     `html { font-size }`, donc une taille en pixels rend inerte le réglage
     d'échelle de l'exploitant. */
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: calc(0.015em * var(--tracking-scale));
  white-space: nowrap;
  background-color: rgb(var(--bg-inset));
  border: 1px solid rgb(var(--chip-tone) / 0.45);
  border-radius: var(--radius-sm);
  color: rgb(var(--fg-strong));
  transition: border-color var(--dur-2) var(--ease-standard);
}

/* La clé de couleur, emplacement par emplacement. Toutes les valeurs sont
   au-dessus des 3:1 exigés d'un élément non textuel sur les fonds de la fiche,
   dans les DEUX thèmes — pire cas mesuré : `--accent-warm` à 3,05:1 en clair
   sur `--bg-hover`, `--chart-4` à 3,71:1 en sombre sur `--bg-hover`. */
.qc-chip--lang { --chip-tone: var(--online); }
.qc-chip--res { --chip-tone: var(--accent-warm); }
.qc-chip--src { --chip-tone: var(--info); }
.qc-chip--fmt { --chip-tone: var(--chart-1); }
.qc-chip--codec { --chip-tone: var(--chart-4); }
.qc-chip--audio { --chip-tone: var(--accent-cool); }
.qc-chip--hdr { --chip-tone: var(--warning); }
/* Un drapeau qualifie, il n'identifie pas : contour pointillé, aucune teinte —
   c'est ce qui l'empêche de se lire comme un neuvième emplacement. */
.qc-chip--flag {
  --chip-tone: var(--line-strong);
  border-style: dashed;
  color: rgb(var(--fg-muted));
}

.qc--compact .qc-chip {
  min-height: 1.4rem;
  font-size: 0.625rem;
}

/* ── La clé : la plaque teintée, encre neutre ───────────────────────────────
   16 % de la teinte, et `--fg-muted` dessus. Voir l'en-tête : c'est la seule
   combinaison que le contraste autorise sur les huit teintes et les deux
   thèmes (4,84:1 au pire). Le filet de droite sépare la plaque de la valeur
   sans ajouter de couleur. */
.qc-k {
  display: inline-flex;
  align-items: center;
  padding: 0 0.35rem;
  background: rgb(var(--chip-tone) / 0.16);
  border-right: 1px solid rgb(var(--chip-tone) / 0.3);
  font-family: var(--font-mono);
  font-size: var(--label-sm, 0.5625rem);
  font-weight: var(--label-weight, 700);
  letter-spacing: var(--label-tracking, calc(0.08em * var(--tracking-scale)));
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.qc-chip--flag .qc-k {
  /* Pas de plaque sur un drapeau : il n'a pas de nature à nommer. */
  background: transparent;
  border-right-style: dashed;
}

/* ── La valeur : fond neutre, encre pleine ──────────────────────────────── */
.qc-v {
  display: inline-flex;
  align-items: center;
  padding: 0 0.4rem;
  font-variant-numeric: tabular-nums;
}
.qc--compact .qc-k,
.qc--compact .qc-v {
  padding-inline: 0.3rem;
}
/* Le `<li>` n'est plus la pastille : c'est son enveloppe, parce que la
   pastille est tantôt un lien, tantôt un `<span>`. */
.qc-item {
  display: flex;
}
/* Une pastille cliquable le montre : elle réagit, et elle est plus haute que
   les 24 px de WCAG 2.5.8 puisqu'elle devient une cible de pointeur. */
.qc-chip--link {
  cursor: pointer;
  min-height: 1.5rem;
  transition:
    border-color var(--dur-2) var(--ease-standard),
    transform var(--dur-2) var(--ease-standard);
}
.qc-chip--link:hover {
  border-color: rgb(var(--accent));
  transform: translateY(-1px);
}
</style>
