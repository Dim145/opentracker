import type { GroupScope, ScopeSummary } from '~/utils/groupScopes';

/**
 * La structure d'une œuvre dépliée : ses découpes et ses unités.
 *
 * Hors composant pour être testée : l'ordre des découpes, la découpe mise en
 * avant, la répartition des releases en unités (épisode, saison, intégrale)
 * selon la découpe ouverte — sans un mot de libellé, que le composant traduit.
 */
export const SCOPE_ORDER: readonly GroupScope[] = ['episode', 'season', 'integral', 'all'];

export function scopesOf(scopes: ScopeSummary[] | undefined): ScopeSummary[] {
  return (scopes ?? [])
    .filter((s) => s.units > 0)
    .sort((a, b) => SCOPE_ORDER.indexOf(a.scope) - SCOPE_ORDER.indexOf(b.scope));
}

/** La découpe mise en avant : celle du premier torrent du tri, sinon la plus récente, sinon la première qui existe. */
export function homeScope(g: { scopes?: ScopeSummary[]; firstScope?: GroupScope; defaultScope?: GroupScope }): GroupScope {
  const scopes = scopesOf(g.scopes);
  const wanted = g.firstScope ?? g.defaultScope ?? 'all';
  return scopes.some((s) => s.scope === wanted) ? wanted : scopes[0]?.scope ?? 'all';
}

export interface UnitRowLike {
  season?: number | null;
  episode?: number | null;
}
export type UnitKind = 'episode' | 'season' | 'integral' | 'all';
export interface Unit<T> {
  key: string;
  kind: UnitKind;
  season: number | null;
  episode: number | null;
  order: number;
  rows: T[];
}

/**
 * Les unités d'une découpe : les épisodes du plus récent au plus ancien, puis
 * les saisons, puis l'intégrale. La découpe « all » range chaque release
 * selon ce qu'elle est ; « integral » n'a qu'une unité.
 */
export function unitsOf<T extends UnitRowLike>(rows: T[], scope: GroupScope): Unit<T>[] {
  const map = new Map<string, Unit<T>>();
  for (const r of rows) {
    const hasSeason = typeof r.season === 'number';
    const hasEpisode = typeof r.episode === 'number';
    let unit: Omit<Unit<T>, 'rows'>;
    if (scope === 'episode' || (scope === 'all' && hasSeason && hasEpisode)) {
      const s = r.season ?? 0;
      const e = r.episode ?? 0;
      unit = { key: `e${s}-${e}`, kind: 'episode', season: s, episode: e, order: 3_000_000 - (s * 10_000 + e) };
    } else if (scope === 'season' || (scope === 'all' && hasSeason)) {
      const s = r.season ?? 0;
      unit = { key: `s${s}`, kind: 'season', season: s, episode: null, order: 5_000_000 - s };
    } else if (scope === 'integral') {
      unit = { key: 'integral', kind: 'integral', season: null, episode: null, order: 9_000_000 };
    } else {
      unit = { key: 'all', kind: 'all', season: null, episode: null, order: 9_000_000 };
    }
    const existing = map.get(unit.key);
    if (existing) existing.rows.push(r);
    else map.set(unit.key, { ...unit, rows: [r] });
  }
  return Array.from(map.values()).sort((a, b) => a.order - b.order);
}
