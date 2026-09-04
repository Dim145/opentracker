<script setup lang="ts">
import { tagsBeyondChips } from '~/utils/chipTagOverlap';
/**
 * D'où vient cette publication, et sous quelles étiquettes.
 *
 * # Pourquoi ce n'est PAS dans la carte d'identité
 *
 * `IdentityCard` répond à « qu'est-ce que c'est, et de quelle release
 * parle-t-on » : l'œuvre, son affiche, ses fiches publiques, le nom de release
 * et l'infohash. Les deux informations d'ici sont d'une autre nature — ce sont
 * les seules de tout le haut de page qui pointent AILLEURS que vers ce
 * torrent : vers un profil, et vers le catalogue filtré. Elles répondent à
 * « qui l'a publiée, et par où continuer », pas à « qu'est-ce que c'est ».
 *
 * S'ajoutait le poids : la carte d'identité porte déjà trois états d'affiche,
 * un niveau de titre calculé, un nom de release découpé aux séparateurs et
 * cinq fournisseurs de fiches. Les deux blocs d'ici l'auraient menée près du
 * double, pour un composant qui aurait alors répondu à deux questions.
 *
 * # Ce composant POSSÈDE son fond, et c'est délibéré
 *
 * `IdentityCard` porte une note expliquant qu'elle s'interdit `--fg-subtle`
 * parce qu'elle ne sait pas sur quoi la page la pose. C'est exact, et la page
 * la pose en réalité à même `.release-page`, qui n'a pas de fond du tout —
 * donc sur `--bg-base`, et non sur `--bg-surface` comme cette note l'affirme.
 * En écrivant `--bg-surface` ici, chaque paire de ce fichier devient mesurable
 * une fois pour toutes, où que la page décide de coller le ruban.
 */

/** Une étiquette telle que l'API la sert. `color` est un hexadécimal libre. */
interface TorrentTag {
  id: string;
  name: string;
  slug: string;
  color: string;
}

const props = withDefaults(
  defineProps<{
    /**
     * Le nom de release, pour savoir ce que les pastilles disent déjà.
     *
     * Mesuré sur le catalogue : 72 % des tags répétaient mot pour mot une
     * pastille, et l'essentiel du reste était le même fait sous un autre nom.
     * Sans ce nom, tous les tags s'affichent — ne rien savoir n'est pas une
     * raison de cacher.
     */
    releaseName?: string | null;
    /** L'uploadeur, ou `null` — masqué OU compte supprimé, voir ci-dessous. */
    uploader?: { id: string; username: string } | null;
    /**
     * Ce qui sépare les deux formes d'absence.
     *
     * Un uploadeur MASQUÉ et un compte SUPPRIMÉ arrivent tous deux avec
     * `uploader: null` ; seul ce drapeau les distingue, et dire « compte
     * supprimé » d'un membre encore présent serait faux.
     */
    uploaderAnonymous?: boolean;
    tags?: TorrentTag[] | null;
  }>(),
  { releaseName: null, uploader: null, uploaderAnonymous: false, tags: null },
);

/*
 * Seulement ceux qu'aucune pastille ne dit déjà.
 *
 * La rangée cesse d'être un doublon permanent pour devenir une rangée
 * d'EXCEPTION : elle ne se rend que quand elle a quelque chose à ajouter — un
 * tag posé à la main par l'uploadeur (`anime`, `drm-free`), pas la résolution
 * qui s'affiche en couleur trente pixels plus haut.
 */
const tags = computed(() => tagsBeyondChips(props.releaseName, props.tags));

/**
 * La seule couleur de cette page qui vient légitimement de la base.
 *
 * L'exploitant choisit une teinte par étiquette (console d'admin, « choisis
 * une teinte par tag »), donc elle arrive en hexadécimal et ne peut pas être
 * un jeton. La question est alors : le texte reste-t-il lisible dessus ?
 *
 * La réponse tient dans la stratégie, pas dans un calcul. La teinte ne va
 * qu'au FOND, à ~10 % d'alpha, et à la bordure à ~40 % ; le texte est forcé
 * sur `--fg-default`. Le fond composité reste donc à un cheveu de celui de la
 * carte, et le contraste ne dépend presque plus de la couleur choisie —
 * mesuré sur `--bg-surface`, le pire cas est un tag blanc pur en thème sombre
 * à 13,39:1, et tous les autres essais (noir, rouge, jaune, bleu) tombent
 * entre 15,7 et 19,8:1. Aucune teinte ne peut faire passer ce texte sous le
 * seuil, ce qui est exactement ce qu'on veut d'une valeur qu'on ne contrôle
 * pas.
 *
 * Une couleur illisible ou absente retombe sur du neutre plutôt que de
 * produire un `background-color: #undefined1a` que le navigateur ignore en
 * silence.
 */
function tagStyle(tag: TorrentTag) {
  const hex = (tag.color || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) {
    return {
      backgroundColor: 'rgb(var(--bg-inset))',
      borderColor: 'rgb(var(--line-default))',
    };
  }
  return { backgroundColor: `#${hex}1a`, borderColor: `#${hex}66` };
}

/** La pastille de teinte pure — seule chose qui porte VRAIMENT la couleur. */
function dotStyle(tag: TorrentTag) {
  const hex = (tag.color || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return { backgroundColor: 'rgb(var(--fg-muted))' };
  return { backgroundColor: `#${hex}` };
}
</script>

<template>
  <dl class="prov">
    <div class="prov-cell">
      <dt class="prov-key">{{ $t('torrents.detail.uploadedBy') }}</dt>
      <dd class="prov-val">
        <NuxtLink
          v-if="uploader"
          :to="`/users/${uploader.id}`"
          class="prov-user"
        >
          <Icon name="ph:user-bold" class="prov-user-icon" aria-hidden="true" />
          @{{ uploader.username }}
        </NuxtLink>
        <!-- Les DEUX formes d'absence, jamais confondues : voir le prop
             `uploaderAnonymous`. -->
        <span
          v-else-if="uploaderAnonymous"
          class="prov-user prov-user--absent"
          :title="$t('torrents.detail.uploaderAnonymousTooltip')"
        >
          <Icon name="ph:user-bold" class="prov-user-icon" aria-hidden="true" />
          {{ $t('torrents.detail.uploaderAnonymous') }}
        </span>
        <span
          v-else
          class="prov-user prov-user--absent"
          :title="$t('torrents.detail.uploaderGoneTooltip')"
        >
          <Icon name="ph:user-minus-bold" class="prov-user-icon" aria-hidden="true" />
          {{ $t('torrents.detail.uploaderGone') }}
        </span>
      </dd>
    </div>

    <div v-if="tags.length" class="prov-cell prov-cell--tags">
      <dt class="prov-key">{{ $t('torrents.detail.provenance.tags') }}</dt>
      <dd class="prov-val">
        <ul class="prov-tags">
          <li v-for="tag in tags" :key="tag.id">
            <NuxtLink
              :to="`/torrents?tag=${encodeURIComponent(tag.slug)}`"
              class="prov-tag"
              :style="tagStyle(tag)"
              :title="$t('torrents.detail.provenance.tagLink', { name: tag.name })"
            >
              <span class="prov-tag-dot" :style="dotStyle(tag)" aria-hidden="true" />
              {{ tag.name }}
            </NuxtLink>
          </li>
        </ul>
      </dd>
    </div>
  </dl>
</template>

<style scoped>
.prov {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.5rem 1.4rem;
  margin: 0;
  padding: 0.55rem 0.85rem;
  background-color: rgb(var(--bg-surface));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
}

.prov-cell {
  display: flex;
  /* La valeur ne passe sous sa clé que si elle ne tient VRAIMENT pas. C'est
     au contenu de décider, pas à la largeur de la fenêtre : « @founder » fait
     un mot, et il tenait à côté de « UPLOADÉ PAR » sur toutes les largeurs où
     un point de rupture le renvoyait quand même à la ligne. */
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.5rem;
  min-width: 0;
}
/* Les étiquettes peuvent être nombreuses : elles prennent la place restante
   et passent à la ligne, alors que l'uploadeur tient toujours sur un mot. */
.prov-cell--tags {
  flex: 1 1 14rem;
}
/*
 * La base à ZÉRO, et c'est tout l'enjeu de ce bloc.
 *
 * Une cellule qui enveloppe décide de passer à la ligne d'après la taille
 * HYPOTHÉTIQUE de ses éléments, pas d'après ce à quoi ils pourraient se
 * réduire. Avec une base automatique, la liste de pastilles se présente à sa
 * largeur MAXIMALE — toutes bout à bout — donc elle ne tient pas à côté de
 * « TAGS » et bascule sous lui. Elle repart alors du bord GAUCHE DE LA
 * CELLULE, c'est-à-dire sous le mot « TAGS » lui-même, en laissant le vide à
 * sa gauche, sous le pseudonyme. C'est le décalage qu'on voyait : constaté
 * avec trois étiquettes à 501 px, reproduit avec douze à 768.
 *
 * Base zéro : la liste ne réclame plus rien, ne provoque donc aucun retour à
 * la ligne, prend la place restante et enveloppe À L'INTÉRIEUR. Le libellé
 * reste en regard de la première ligne de pastilles, et les suivantes
 * s'alignent dessous — un retrait pendant, ce qu'une liste de définitions
 * doit faire.
 */
.prov-cell--tags .prov-val {
  flex: 1 1 0;
  min-width: 0;
}

/* Le même petit capital mono que `.idc-relkey` dans la carte d'identité :
   ces deux blocs se lisent comme un seul ensemble. */
.prov-key {
  flex-shrink: 0;
  margin: 0;
  font-family: var(--font-mono);
  font-size: var(--label-sm, 0.5625rem);
  font-weight: var(--label-weight, 700);
  letter-spacing: var(--label-tracking, calc(0.08em * var(--tracking-scale)));
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.prov-val {
  margin: 0;
  min-width: 0;
}

.prov-user {
  /* WCAG 2.5.8 : 24 px CSS au minimum pour une cible de pointeur, et ceci
     n'est pas un lien DANS une phrase, donc la dérogation « inline » ne
     s'applique pas. Mesuré à 18 px avant. La hauteur seule change ; le texte
     reste où il est. */
  min-height: 1.5rem;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  font-weight: 700;
  text-decoration: none;
  /* `--accent-warm-text` et non `--accent-warm` : le second est la teinte de
     surface, le premier la variante assombrie pour du TEXTE — 8,23:1 en
     sombre et 5,06:1 en clair sur ce fond.
     L'ancienne page peignait ce lien en `--release-rose`, une propriété
     qu'elle DÉFINISSAIT elle-même (`244 114 182`), comme le font encore
     `me.vue` et `users/[id].vue`. Elle rendait donc bien du rose — mais un
     rose en dur, hors du système de thème : l'exploitant peut repeindre 47
     jetons et celui-là lui échappait. C'est la seule raison du changement. */
  color: rgb(var(--accent-warm-text));
  transition: color var(--dur-2) ease;
}
a.prov-user:hover {
  color: rgb(var(--fg-strong));
}
.prov-user-icon {
  font-size: 0.6875rem;
}
/* Ni lien ni nom : une mention d'absence. En italique et en neutre, pour
   qu'on ne cherche pas à cliquer — le `title` porte l'explication. */
.prov-user--absent {
  font-style: italic;
  font-weight: 500;
  color: rgb(var(--fg-muted));
  cursor: help;
}

.prov-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.prov-tag {
  /* WCAG 2.5.8 : 24 px CSS au minimum pour une cible de pointeur, et ceci
     n'est pas un lien DANS une phrase, donc la dérogation « inline » ne
     s'applique pas. Mesuré à 22 px avant. La hauteur seule change ; le texte
     reste où il est. */
  min-height: 1.5rem;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.1rem 0.4rem;
  font-size: 0.6875rem;
  font-weight: 600;
  text-decoration: none;
  /* Forcé, et c'est tout l'intérêt : voir `tagStyle()`. Le fond et la bordure
     portent la teinte de l'exploitant, le texte reste sur un jeton. */
  color: rgb(var(--fg-default));
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  transition: filter var(--dur-2) ease;
}
.prov-tag:hover {
  filter: brightness(1.25);
}
.prov-tag-dot {
  width: 0.4rem;
  height: 0.4rem;
  flex-shrink: 0;
  border-radius: 50%;
  /* Le contour n'est pas décoratif : une teinte proche du fond fait
     disparaître la pastille — un tag blanc mesure 1,00:1 sur la surface
     claire — et il ne reste qu'un trou dans la ligne. Le contour lui garde
     une forme quelle que soit la couleur choisie. */
  box-shadow: inset 0 0 0 1px rgb(var(--line-strong));
}

@media (max-width: 767px) {
  .prov {
    gap: 0.45rem 1rem;
    padding: 0.5rem 0.65rem;
  }
  /* Plus rien à empiler ici. La règle d'origine mettait TOUTES les cellules
     en colonne sous 768 px, ce qui renvoyait « @donator » sous son libellé
     avec 228 px de vide à sa droite ; la restreindre aux étiquettes ne faisait
     que déplacer le défaut, puisque la cellule empilée continuait de partager
     la rangée de l'uploadeur. La base zéro ci-dessus rend le point de rupture
     inutile : le même retrait pendant fonctionne à 390 comme à 1600. */
}
</style>
