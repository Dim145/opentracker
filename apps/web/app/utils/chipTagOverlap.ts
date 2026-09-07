import { releaseChips, type ReleaseChips } from '~/utils/releaseChips';

/**
 * Les tags qu'aucune pastille de qualité ne dit déjà.
 *
 * # Pourquoi ce fichier existe
 *
 * La page de détail montrait deux rangées qui disent la même chose : les
 * pastilles, ANALYSÉES depuis le nom de release, et les tags, dont l'immense
 * majorité est INFÉRÉE du même nom à l'upload (`inferReleaseTags` le dit
 * lui-même : « resolution, codec, source, audio, language, HDR, extras »).
 * Deux rendus de la même extraction, l'un dérivé à l'affichage, l'autre
 * persisté en base.
 *
 * Mesuré sur les 49 torrents du catalogue de test : **149 tags, dont 107
 * (72 %) mot pour mot ce qu'une pastille disait déjà**. Et sur les 42
 * survivants, la plupart étaient le même fait sous un autre nom — `x264` neuf
 * fois pendant que la pastille affichait `AVC`, `VF`/`VFF`/`MULTI` six fois
 * pendant qu'elle affichait la langue.
 *
 * # Pourquoi une table d'équivalences, et pourquoi elle est courte
 *
 * `x264` et `AVC` sont le même fait : l'un est l'encodeur, l'autre la norme
 * qu'il produit. Les confondre est vrai. En revanche `MULTI` et `VOSTFR` ne
 * sont PAS la même chose — plusieurs pistes audio d'un côté, une piste
 * sous-titrée de l'autre — et la tentation de les rapprocher parce qu'ils
 * occupent la même fente ferait disparaître une information réelle.
 *
 * La règle retenue est donc conservatrice : dans le doute, on GARDE le tag.
 * Un tag de trop est du bruit ; un tag manquant est une information perdue.
 */

/**
 * Ce qu'un tag désigne quand la pastille l'appelle autrement.
 *
 * Uniquement des synonymes STRICTS — l'encodeur et sa norme. Rien qui relève
 * du jugement.
 */
const ALIASES: Record<string, string> = {
  x264: 'avc',
  h264: 'avc',
  avc1: 'avc',
  x265: 'hevc',
  h265: 'hevc',
  hvc1: 'hevc',
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]/g, '');

/**
 * Les « atomes » que les pastilles affichent.
 *
 * Une pastille peut porter deux valeurs dans une seule fente — `AAC 2.0` pour
 * l'audio, `MULTI.VFF` pour la langue. Comparer la chaîne entière laisserait
 * passer un tag `AAC` alors que la pastille le dit. On découpe donc sur
 * l'espace, et sur le point POUR LA LANGUE seulement : découper `2.0` sur le
 * point donnerait les atomes `2` et `0`, qui rendraient redondant n'importe
 * quel tag nommé « 2 ».
 */
export function chipAtoms(chips: ReleaseChips): Set<string> {
  const out = new Set<string>();
  const add = (v: string | null | undefined) => {
    if (!v) return;
    out.add(norm(v));
    for (const part of v.split(/\s+/)) if (part) out.add(norm(part));
  };
  add(chips.resolution);
  add(chips.source);
  add(chips.audio);
  add(chips.codec);
  add(chips.hdr);
  add(chips.platform);
  add(chips.format);
  for (const f of chips.flags) add(f);
  if (chips.language) {
    out.add(norm(chips.language));
    for (const part of chips.language.split(/[.\s]+/)) if (part) out.add(norm(part));
  }
  return out;
}

/** Un tag, tel que la charge du torrent le porte. */
export interface TorrentTag {
  id?: string;
  name: string;
  slug?: string;
  color?: string | null;
}

/**
 * Filtre une liste de tags contre les pastilles d'un nom de release.
 *
 * Renvoie les tags à AFFICHER — ceux qui apportent quelque chose. Sans nom de
 * release, ou si l'analyse ne donne rien, tous les tags reviennent : ne rien
 * savoir n'est pas une raison de cacher.
 */
export function tagsBeyondChips<T extends TorrentTag>(
  releaseName: string | null | undefined,
  tags: readonly T[] | null | undefined,
): T[] {
  if (!tags?.length) return [];
  if (!releaseName) return [...tags];
  const atoms = chipAtoms(releaseChips(releaseName));
  if (!atoms.size) return [...tags];
  return tags.filter((t) => {
    const n = norm(t.name);
    if (atoms.has(n)) return false;
    const alias = ALIASES[n];
    return !(alias && atoms.has(alias));
  });
}

/**
 * Le tag qui correspond à une valeur de pastille, s'il y en a un.
 *
 * C'est ce qui rend une pastille CLIQUABLE : les tags portent des slugs
 * exploitables (`web-dl`, `x264`, `2-0`) et sont la seule chose que la rangée
 * du bas apportait vraiment — un lien vers le catalogue filtré. La pastille
 * reprend cette fonction ; sans tag correspondant elle reste inerte, plutôt
 * que de fabriquer un lien vers un filtre qui ne trouverait rien.
 */
export function tagForChip<T extends TorrentTag>(
  value: string | null | undefined,
  tags: readonly T[] | null | undefined,
): T | null {
  if (!value || !tags?.length) return null;
  const wanted = new Set<string>([norm(value)]);
  for (const part of value.split(/[.\s]+/)) if (part) wanted.add(norm(part));
  for (const t of tags) {
    const n = norm(t.name);
    if (wanted.has(n)) return t;
    const alias = ALIASES[n];
    if (alias && wanted.has(alias)) return t;
  }
  return null;
}
