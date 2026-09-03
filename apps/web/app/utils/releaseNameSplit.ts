/**
 * Split a release name into the part a reader can ignore and the part they
 * cannot.
 *
 * Inside a group every release is the same work, so the words naming that work
 * are repeated on every row and carry no information — the group heading has
 * already said them. What distinguishes one row from the next is the platform
 * tag and the technical tail: `[PS5]` against `[XBOX]`, `2160p.REMUX` against
 * `720p.WEB-DL`. Dimming the shared half and leaving the rest bright turns a
 * column of near-identical filenames into a column of differences.
 *
 * Returned in three parts because they are typeset differently:
 *
 * - `tag`  — a leading `[...]`, accented. On a game group this is often the
 *            ONLY difference between rows, so it must never be dimmed.
 * - `lead` — the work's name, dimmed.
 * - `tail` — everything from the first technical token or bracket, bright.
 *
 * A name that matches nothing comes back entirely as `tail`: better an
 * undimmed row than one that hides its only content behind a bad guess.
 */
/**
 * Les trois tronçons d'un nom de release à l'affichage : le crochet de tête, le
 * titre, la queue technique.
 *
 * Renommée depuis `ReleaseNameParts`, qui était aussi le nom de l'interface de
 * `ficheRelease.ts` — un type entièrement différent (titre, année, résolution,
 * équipe). Nuxt auto-importe les deux, n'en garde qu'un, et gardait celui-ci :
 * une déclaration `ReleaseNameParts` écrite sans import explicite compilait
 * contre `{ tag, lead, tail }` en croyant décrire des métadonnées.
 */
export interface ReleaseNameSegments {
  tag: string;
  lead: string;
  tail: string;
}

/**
 * Where the technical description starts. The same stop tokens the release
 * parser uses to find the end of a title — resolution, source, codec,
 * language.
 */
const STOP =
  /\b(?:2160p|1440p|1080p|720p|480p|4k|uhd|web-?dl|webrip|web|blu-?ray|bdrip|brrip|hdtv|hdrip|dvdrip|remux|x26[45]|h\.?26[45]|hevc|avc|av1|multi|vostfr|french|truefrench)\b/i;

/**
 * A leading bracket is a platform or a scope, never part of the work's name.
 * Capped at 24 characters so a title that merely opens with a bracket does not
 * disappear into the tag.
 */
const LEADING_TAG = /^\s*\[[^\]]{1,24}\]\s*/;

export function splitReleaseName(name: string): ReleaseNameSegments {
  const tag = name.match(LEADING_TAG)?.[0] ?? '';
  const rest = name.slice(tag.length);

  // Any further bracket is metadata too — region, language, edition — so the
  // cut happens at whichever comes first, the bracket or a technical token.
  const bracket = rest.indexOf('[');
  const stop = rest.match(STOP)?.index ?? -1;
  const candidates = [bracket, stop].filter((i) => i > 0);
  if (candidates.length === 0) return { tag, lead: '', tail: rest };

  const cut = Math.min(...candidates);
  return { tag, lead: rest.slice(0, cut), tail: rest.slice(cut) };
}
