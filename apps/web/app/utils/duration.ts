/**
 * Des durées lisibles, dans la langue du lecteur, sans une seule chaîne à
 * traduire.
 *
 * `format.ts` sait dire « il y a 3 jours » et « dans 3 jours » — un instant
 * relatif à maintenant. Il ne sait pas dire une durée ABSOLUE : « 72 h »,
 * « 2 h 46 ». La page de détail en demande deux, et ni l'une ni l'autre n'est
 * un âge : le temps de seed qu'un membre doit encore, et la durée d'un film.
 *
 * `Intl.NumberFormat` avec `style: 'unit'` plutôt qu'un gabarit i18n par
 * unité : l'unité, son abréviation et sa place par rapport au nombre sont des
 * données de locale, pas des décisions de produit. « 2h 46m » en anglais et
 * « 2 h 46 min » en français sortent de la même ligne de code, et une
 * troisième langue n'aura rien à ajouter.
 */

/**
 * L'abréviation d'une unité, dans la langue demandée.
 *
 * `short` et non `narrow` : `narrow` colle le nombre à l'unité — « 61h »,
 * « 2h 46min » — alors que la typographie française demande une espace, et
 * c'est « 61 h » que porte la maquette de référence. `short` la met, et met
 * une espace insécable étroite (U+202F), donc la valeur ne peut pas se couper
 * en fin de ligne. Le coût est deux caractères en anglais (« 61 hr »).
 */
function unit(
  value: number,
  u: 'day' | 'hour' | 'minute',
  locale: string,
): string {
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: u,
    unitDisplay: 'short',
    maximumFractionDigits: 0,
  }).format(value);
}

/** Quatre jours. Au-delà, on passe aux jours ; en dessous, on reste en heures. */
const DAYS_THRESHOLD = 96 * 3600;

/**
 * Une durée en secondes, telle qu'on l'annonce sur la page.
 *
 * Volontairement en HEURES tant que la valeur reste sous quatre jours, parce
 * que l'obligation de seed du site se compte en heures (72 h) et que
 * « 2 j 13 h » demande une soustraction mentale que « 61 h » ne demande pas.
 * Au-delà, la lecture s'inverse et les jours reprennent la main.
 */
export function formatDurationSeconds(seconds: number, locale: string): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 3600) return unit(Math.round(total / 60), 'minute', locale);
  if (total < DAYS_THRESHOLD) return unit(Math.round(total / 3600), 'hour', locale);
  let days = Math.floor(total / 86400);
  let hours = Math.round((total % 86400) / 3600);
  // 4 j 23 h 50 arrondit à « 24 h » : c'est un jour de plus, pas une 24ᵉ heure.
  if (hours === 24) {
    days += 1;
    hours = 0;
  }
  if (hours === 0) return unit(days, 'day', locale);
  return `${unit(days, 'day', locale)} ${unit(hours, 'hour', locale)}`;
}

/**
 * La durée d'une œuvre, en minutes — ce que renvoie chaque fournisseur de
 * métadonnées.
 *
 * Ne PAS passer par `formatDurationSeconds` : elle arrondit à l'heure sous
 * quatre jours, et un film de 166 minutes y devient « 3h ». La minute est
 * précisément ce qui distingue deux montages du même film.
 */
export function formatRuntimeMinutes(minutes: number, locale: string): string {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return unit(total, 'minute', locale);
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (rest === 0) return unit(hours, 'hour', locale);
  return `${unit(hours, 'hour', locale)} ${unit(rest, 'minute', locale)}`;
}
