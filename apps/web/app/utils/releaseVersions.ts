/**
 * Regrouper les versions d'un même contenu.
 *
 * Deux encodages du même épisode de la même œuvre sont deux lignes ; dans la
 * vue Releases, la première (dans l'ordre du tri — donc la mieux classée) fait
 * la tête, les autres se replient derrière « n autres versions ». Une release
 * sans œuvre connue ne se regroupe jamais : sans identifiant, deux noms
 * proches ne prouvent rien.
 */
export interface VersionRowLike {
  id: string;
  season?: number | null;
  episode?: number | null;
  work?: { source?: string; id?: string } | null;
}

export interface VersionGroup<T> {
  key: string;
  lead: T;
  others: T[];
}

export function versionKey(row: VersionRowLike): string | null {
  if (!row.work?.id) return null;
  return `${row.work.source ?? ''}:${row.work.id}|${row.season ?? ''}|${row.episode ?? ''}`;
}

export function groupVersions<T extends VersionRowLike>(rows: T[]): VersionGroup<T>[] {
  const byKey = new Map<string, VersionGroup<T>>();
  const out: VersionGroup<T>[] = [];
  for (const row of rows) {
    const key = versionKey(row) ?? `solo:${row.id}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.others.push(row);
      continue;
    }
    const group: VersionGroup<T> = { key, lead: row, others: [] };
    byKey.set(key, group);
    out.push(group);
  }
  return out;
}
