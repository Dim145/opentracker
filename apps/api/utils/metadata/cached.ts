import { redis } from '../server';
import { NEG_SENTINEL } from './types';
import { tmdbLocale } from './tmdb';

/**
 * Ce que le catalogue sait d'une œuvre SANS appeler personne.
 *
 * La fiche d'un torrent remplit le cache des métadonnées (`meta:v1:*`) à la
 * première visite ; le catalogue lit ce cache, et seulement lui. Une œuvre que
 * personne n'a encore ouverte n'a pas de titre ici — c'est voulu : vingt
 * recherches amont par page de résultats, c'est la rafale qui a mis toute une
 * page sans affiche pendant une heure (voir `META_TTL.ERR_S`).
 *
 * Un seul `MGET` pour toute la page : les clés candidates de chaque référence
 * sont énumérées (les fiches se cachent sous l'indice `tv`, `movie` ou `auto`,
 * avec l'identifiant préfixé ou nu, dans la langue du visiteur puis en anglais)
 * et la première valeur trouvée gagne.
 */
export interface WorkRef {
  source: 'tmdb' | 'igdb' | 'openlibrary';
  id: string;
}

export interface CachedWork {
  source: WorkRef['source'];
  id: string;
  title: string;
  year: number | null;
  posterUrl: string | null;
  type: string | null;
  /** « R G B », la couleur dominante de l'affiche telle que la fiche l'a déposée ; null tant qu'aucune fiche n'a été ouverte. */
  tint: string | null;
}

export function workRefKey(ref: WorkRef): string {
  return `${ref.source}:${ref.id}`;
}

/** La clé de la teinte déposée par la fiche (voir `routes/api/metadata/tint.post.ts`). */
export const tintKey = (ref: WorkRef) => `meta:v1:tint:${ref.source}:${ref.id}`;

export function candidateKeys(ref: WorkRef, language?: string): string[] {
  if (ref.source === 'igdb') return [`meta:v1:igdb:${ref.id}`];
  if (ref.source === 'openlibrary') return [`meta:v1:openlibrary:${ref.id}`];
  const locales = Array.from(new Set([tmdbLocale(language), tmdbLocale(undefined)]));
  const m = ref.id.match(/^(movie|tv)\/(\d+)$/);
  const ids = m ? [ref.id, m[2]!] : [ref.id];
  const hints = m ? [m[1]!, 'auto'] : ['movie', 'tv', 'auto'];
  const out: string[] = [];
  for (const locale of locales) for (const hint of hints) for (const id of ids) out.push(`meta:v1:tmdb:${locale}:${hint}:${id}`);
  return out;
}

export async function worksFromCache(
  refs: WorkRef[],
  language?: string,
): Promise<Map<string, CachedWork | null>> {
  const out = new Map<string, CachedWork | null>();
  const plan = refs.map((ref) => ({ ref, keys: candidateKeys(ref, language) }));
  const allKeys = Array.from(new Set([...plan.flatMap((p) => p.keys), ...plan.map((p) => tintKey(p.ref))]));
  if (allKeys.length === 0) return out;
  let values: (string | null)[] = [];
  try {
    values = await redis.mget(...allKeys);
  } catch {
    for (const { ref } of plan) out.set(workRefKey(ref), null);
    return out;
  }
  const byKey = new Map(allKeys.map((k, i) => [k, values[i] ?? null]));
  for (const { ref, keys } of plan) {
    let found: CachedWork | null = null;
    for (const k of keys) {
      const raw = byKey.get(k);
      if (!raw || raw === NEG_SENTINEL) continue;
      try {
        const m = JSON.parse(raw) as {
          title?: string;
          year?: number | null;
          releaseDate?: string | null;
          posterUrl?: string | null;
          type?: string | null;
        };
        if (!m?.title) continue;
        const year =
          typeof m.year === 'number'
            ? m.year
            : m.releaseDate && /^\d{4}/.test(m.releaseDate)
              ? Number(m.releaseDate.slice(0, 4))
              : null;
        const rawTint = byKey.get(tintKey(ref));
        const tint = rawTint && /^\d{1,3} \d{1,3} \d{1,3}$/.test(rawTint) ? rawTint : null;
        found = { source: ref.source, id: ref.id, title: m.title, year, posterUrl: m.posterUrl ?? null, type: m.type ?? null, tint };
        break;
      } catch {
        /* entrée illisible : on essaie la suivante */
      }
    }
    out.set(workRefKey(ref), found);
  }
  return out;
}
