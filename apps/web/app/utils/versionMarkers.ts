/**
 * Ce qui distingue deux VERSIONS d'une même unité.
 *
 * # Le rang par taille racontait n'importe quoi
 *
 * La fiche classait les releases d'un groupe par taille et posait trois rangs
 * d'usage dessus : la plus grosse « Image max », la plus petite « Léger ». Deux
 * pannes, et la première est celle qui a déclenché ce fichier :
 *
 *   1. Entre UNITÉS, c'est un mensonge complet. La page de `Cats.Eye.S01`
 *      affichait `Cats.Eye.S02` étiquetée « Image max » et `S01` « Léger » : la
 *      saison 2 présentée comme une meilleure variante de la saison 1. Ce sont
 *      deux contenus différents. Le rang ne veut rien dire hors d'une unité, et
 *      c'est le composant qui borne l'unité — ce fichier suppose que la liste
 *      qu'on lui donne EST une seule unité.
 *   2. Même à l'intérieur d'une unité, la taille ne dit pas la qualité d'image.
 *      Mesuré sur le catalogue : `Sousou.no.Frieren.S01.VOSTFR.1080p.WEB-DL` pèse
 *      42,9 Gio et `Sousou.no.Frieren.S01.MULTi.1080p.BluRay.x265.FLAC` 22,4 Gio.
 *      Le rang par taille couronnait le WEB-DL et traitait le BluRay de
 *      « Léger ». Les deux sont en 1080p ; c'est la SOURCE qui les sépare.
 *
 * # Des repères qui sont des propriétés, pas un classement
 *
 * Chaque repère nomme un besoin et n'est posé que sur une ligne qui a
 * réellement la propriété correspondante :
 *
 *   · `imageMax`      — la meilleure image : résolution, puis HDR, puis source.
 *                       La taille n'entre PAS dans ce calcul, c'est tout l'objet
 *                       de la panne 2. Non attribué en cas d'égalité : si deux
 *                       versions sont identiques sur ces trois axes, rien ne les
 *                       sépare sur l'image et le prétendre serait inventer.
 *   · `audioOriginal` — une piste intacte : TrueHD, DTS-HD, FLAC, Atmos, ou un
 *                       REMUX (qui recopie les pistes du disque sans les
 *                       toucher, donc l'audio est d'origine par construction).
 *   · `compat`        — lit partout : H.264 et pas de piste lossless, en 1080p
 *                       au plus. C'est le repère du tracker de référence, et la
 *                       réponse à « ça passe sur ma télé / mon téléphone ? ».
 *   · `light`         — la plus compacte, et seulement quand l'écart avec la
 *                       suivante est réel (voir `LIGHT_MARGIN`).
 *
 * Un repère par ligne, une ligne par repère. Deux repères sur une même ligne
 * casseraient la fente de largeur fixe qui aligne les colonnes suivantes, et
 * c'est cet alignement qui permet de descendre une colonne sans lire un seul
 * nom de fichier.
 *
 * `imageMax` et `light` sont des EXTREMUMS : ils n'ont qu'un titulaire
 * possible, donc si celui-là porte déjà un repère, le repère saute — le donner
 * au deuxième serait faux (la deuxième plus petite n'est pas « la plus
 * compacte »). `audioOriginal` et `compat` sont des PROPRIÉTÉS : n'importe
 * quelle ligne qui les porte peut légitimement l'annoncer, donc on descend
 * jusqu'à la meilleure ligne encore libre : le REMUX 2160p prend `Image max`,
 * et `Son d'origine` descend au BluRay 1080p DTS-HD, qui l'a réellement,
 * plutôt que de disparaître avec la ligne déjà occupée.
 *
 * Enfin, un repère qui ne distingue rien ne s'affiche pas : si TOUTES les
 * versions de l'unité sont en H.264/AAC, « Compat » n'aide personne à choisir.
 * C'est ce qui arrive aux trois éditions de Dune du catalogue
 * (`tmdb:693134`) : les trois portent une piste intacte — TrueHD, DTS-HD,
 * DTS-HD — donc `Son d'origine` se TAIT, et seul `Image max` reste. Ne pas
 * chercher le repère audio sur cette œuvre : son absence est le comportement,
 * pas un manque.
 */
import { parseReleaseName } from '@trackarr/shared/releaseParse';

export type VersionMarker = 'imageMax' | 'audioOriginal' | 'compat' | 'light';

export interface VersionFacts {
  /** Taille en octets ; 0 quand elle est inconnue. */
  size: number;
  /** Les jetons du nom de release, tels que `parseReleaseName` les rend. */
  tags: readonly string[];
}

/**
 * Les jetons d'un nom de release, ou aucun.
 *
 * Le même analyseur que le formulaire d'upload et que `releaseChips`, donc ce
 * qui est comparé ici est exactement ce que la ligne affiche. Un nom qui le
 * fait tomber rend une ligne sans repère — honnête — plutôt qu'un tableau cassé.
 */
export function releaseTags(name: string): string[] {
  try {
    return parseReleaseName(name).tags;
  } catch {
    return [];
  }
}

// Les échelles. Volontairement grossières : elles ne servent qu'à ORDONNER des
// releases d'une même unité, pas à noter une release dans l'absolu.
const RESOLUTION_RANK: Record<string, number> = {
  '2160p': 5,
  '1440p': 4,
  '1080p': 3,
  '720p': 2,
  '480p': 1,
};

/** Au-delà de ce rang, « lit partout » cesse d'être vrai. */
const COMPAT_MAX_RESOLUTION = RESOLUTION_RANK['1080p']!;

const SOURCE_RANK: Record<string, number> = {
  REMUX: 6,
  BluRay: 5,
  UHD: 5,
  'WEB-DL': 4,
  WEB: 3,
  WEBRip: 3,
  HDRip: 2,
  HDTV: 2,
  DVDRip: 1,
  DVD: 1,
};

// `10bit` et `SDR` sont absents exprès : le premier est une profondeur de
// codage, le second l'absence de HDR. Ni l'un ni l'autre n'est une plage
// dynamique étendue.
const HDR_RANK: Record<string, number> = {
  'Dolby Vision': 2,
  'HDR10+': 2,
  HDR10: 1,
  HDR: 1,
};

/**
 * Les pistes qu'un encodage ne retouche pas. `DTS` simple en est absent : le
 * cœur DTS est compressé avec perte, contrairement à `DTS-HD` (MA).
 */
const AUDIO_ORIGINAL_RANK: Record<string, number> = {
  Atmos: 4,
  TrueHD: 3,
  'DTS-HD': 2,
  FLAC: 1,
};

/**
 * L'écart minimal qui rend « Léger » informatif.
 *
 * Mesuré : les deux éditions 1080p de Dune du catalogue pèsent 18,254 Gio et
 * 18,253 Gio. Coller « Léger » sur la seconde n'aide personne à choisir et
 * suggère un écart qui n'existe pas. Le seuil se compare à la DEUXIÈME plus
 * petite, pas à la plus grosse : c'est le voisin immédiat qui dit si l'écart
 * est réel.
 */
const LIGHT_MARGIN = 0.9;

function maxRank(
  tags: readonly string[],
  table: Record<string, number>,
): number {
  let best = 0;
  for (const tag of tags) {
    const rank = table[tag];
    if (rank !== undefined && rank > best) best = rank;
  }
  return best;
}

interface Ranked {
  at: number;
  size: number;
  resolution: number;
  hdr: number;
  source: number;
  /** Rang de la piste d'origine ; 0 quand il n'y en a pas. */
  audio: number;
  /** H.264 explicitement annoncé. */
  avc: boolean;
}

function rank(facts: VersionFacts, at: number): Ranked {
  const tags = facts.tags;
  const remux = tags.includes('REMUX');
  return {
    at,
    size: facts.size,
    resolution: maxRank(tags, RESOLUTION_RANK),
    hdr: maxRank(tags, HDR_RANK),
    source: maxRank(tags, SOURCE_RANK),
    // Un REMUX sans jeton audio reconnu garde quand même les pistes du disque.
    audio: maxRank(tags, AUDIO_ORIGINAL_RANK) || (remux ? 1 : 0),
    avc: tags.includes('AVC'),
  };
}

/** Meilleure image en premier. Zéro quand rien ne les sépare sur l'image. */
function byPicture(a: Ranked, b: Ranked): number {
  return b.resolution - a.resolution || b.hdr - a.hdr || b.source - a.source;
}

/**
 * Le repère de chaque version, dans l'ordre reçu.
 *
 * La liste doit être UNE unité — un épisode, une saison, une intégrale, une
 * œuvre sans découpe. Deux unités mélangées donnent des repères qui comparent
 * des contenus différents, ce qui est précisément la panne que ce fichier
 * remplace.
 */
export function assignVersionMarkers(
  items: readonly VersionFacts[],
): (VersionMarker | null)[] {
  const out: (VersionMarker | null)[] = items.map(() => null);
  // Une seule version n'est pas un choix : il n'y a rien à arbitrer, et un
  // repère posé sur une ligne unique se lirait comme un jugement sur la
  // release elle-même.
  if (items.length < 2) return out;

  const ranked = items.map(rank);

  // 1 · L'image. Extremum : sauté en cas d'égalité, jamais reporté.
  const picture = [...ranked].sort(byPicture);
  if (byPicture(picture[0]!, picture[1]!) !== 0) {
    out[picture[0]!.at] = 'imageMax';
  }

  // 2 · La piste d'origine. Propriété : reportée à la meilleure ligne libre.
  const original = ranked.filter((r) => r.audio > 0);
  if (original.length > 0 && original.length < ranked.length) {
    const winner = original
      .sort((a, b) => b.audio - a.audio || b.size - a.size)
      .find((r) => out[r.at] === null);
    if (winner) out[winner.at] = 'audioOriginal';
  }

  // 3 · La compatibilité. Propriété, même règle.
  const compatible = ranked.filter(
    (r) => r.avc && r.audio === 0 && r.resolution <= COMPAT_MAX_RESOLUTION,
  );
  if (compatible.length > 0 && compatible.length < ranked.length) {
    const winner = compatible
      .sort((a, b) => b.resolution - a.resolution || b.size - a.size)
      .find((r) => out[r.at] === null);
    if (winner) out[winner.at] = 'compat';
  }

  // 4 · La plus compacte. Extremum, comme l'image.
  const bySize = [...ranked].sort((a, b) => a.size - b.size);
  const smallest = bySize[0]!;
  const second = bySize[1]!;
  if (
    smallest.size > 0 &&
    smallest.size <= second.size * LIGHT_MARGIN &&
    out[smallest.at] === null
  ) {
    out[smallest.at] = 'light';
  }

  return out;
}

/**
 * Le groupe de release, ou `null`.
 *
 * `parseReleaseName` le RETIRE (`stripGroup`) sans jamais le rendre, donc ni
 * `releaseChips` ni les jetons ne le portent — et c'est pourtant la colonne
 * qui départage deux versions que tout le reste égalise. Mesuré sur l'unité
 * `Sousou.no.Frieren.S01E09` : deux des quatre versions sont
 * `VOSTFR/1080p/WEB-DL`, seules `TsundereRaws` et `NOTAG` les distinguent.
 *
 * Le motif est celui de `stripGroup`, à un garde-fou près. Le suffixe nu
 * `-([A-Za-z0-9_]+)$` attrape aussi la queue d'un titre (`Movie.Part-2`), donc
 * on exige au moins une lettre et deux caractères. Un nom sans suffixe rend
 * `null` plutôt qu'une chaîne vide : la colonne affiche alors son tiret, ce
 * qui est honnête.
 */
export function releaseGroup(name: string): string | null {
  const m = /-([A-Za-z0-9_]{2,24})$/.exec(name.trim());
  const tag = m?.[1];
  return tag && /[A-Za-z]{2}/.test(tag) ? tag : null;
}
