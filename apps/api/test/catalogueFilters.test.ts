import { describe, it, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { filterConditions, tagGroupsCondition, YEAR_IN_NAME_RE, isFlag } from '../utils/torrentListing';
import { boundedTagGroups } from '../utils/schemas';

/**
 * Les prédicats du catalogue, rendus en SQL par le dialecte que la requête
 * emploie vraiment.
 *
 * Ces filtres décident ce qu'un membre voit ; ils étaient couverts par rien.
 * Ce qui compte ici n'est pas la forme du texte mais ce qui est PARAMÉTRÉ
 * (aucune valeur du membre concaténée), et l'accord entre le filtre et la
 * facette qui en annonce le compte.
 */
const dialect = new PgDialect();
const render = (chunk: SQL) => dialect.sqlToQuery(chunk);
const viewer = { id: 'viewer-1', isAdmin: false, isModerator: false };

describe('filterConditions', () => {
  it('cherche l’année dans le nom, jamais collée à une résolution', async () => {
    const [cond] = await filterConditions({ year: 2024 }, viewer);
    const q = render(cond!);
    // L'année part en PARAMÈTRE, et le motif est celui que la facette partage.
    expect(q.params).toContain('(?:^|[^0-9x])2024(?![0-9])(?!x[0-9])');
    expect(q.sql).not.toContain('2024');
    // Le motif partagé exclut bien `1920x1080` et accepte plusieurs années.
    expect(YEAR_IN_NAME_RE).toContain('(?!x[0-9])');
  });

  it('borne `since` à ses trois fenêtres et ignore tout le reste', async () => {
    for (const [key, interval] of [
      ['24h', "interval '24 hours'"],
      ['7d', "interval '7 days'"],
      ['30d', "interval '30 days'"],
    ] as const) {
      const conds = await filterConditions({ since: key }, viewer);
      expect(render(conds[0]!).sql).toContain(interval);
    }
    // Une clé inconnue ne filtre rien — et surtout n'atteint pas `sql.raw`.
    expect(await filterConditions({ since: 'evil' }, viewer)).toHaveLength(0);
    // Une propriété héritée d'Object n'est pas une fenêtre.
    expect(await filterConditions({ since: 'constructor' }, viewer)).toHaveLength(0);
  });

  it('rapporte les favoris et les prises au membre qui regarde, par paramètre', async () => {
    const [fav] = await filterConditions({ favorites: '1' }, viewer);
    expect(render(fav!).params).toContain('viewer-1');
    const [taken] = await filterConditions({ notTaken: 'true' }, viewer);
    expect(render(taken!).params).toContain('viewer-1');
    // Un drapeau n'est vrai que sous ces deux formes.
    expect(isFlag('1')).toBe(true);
    expect(isFlag('true')).toBe(true);
    expect(isFlag('yes')).toBe(false);
    expect(await filterConditions({ favorites: 'yes' }, viewer)).toHaveLength(0);
  });

  it('sélectionne les releases d’une œuvre par ses colonnes, pas par la clé calculée', async () => {
    const [cond] = await filterConditions({ groupKey: 'tmdb:tv/209867', groupScope: 'season' }, viewer);
    const q = render(cond!);
    // L'identifiant tel que la colonne le porte, en paramètre, et les autres
    // sources écartées : c'est ce qui rend le prédicat indexable.
    expect(q.params).toEqual(['tv/209867']);
    expect(q.sql).toContain('"igdb_id" IS NULL');
    // `groupKeySql` est un CASE : le voir ici voudrait dire qu'aucun index ne sert.
    expect(q.sql).not.toContain('CASE');
    // La découpe « saison » exige une saison sans épisode.
    expect(q.sql).toMatch(/season/);
  });

  it('n’ajoute rien pour une requête vide', async () => {
    expect(await filterConditions({}, viewer)).toHaveLength(0);
  });
});

describe('tagGroupsCondition', () => {
  it('lit « OU dans un groupe, ET entre les groupes »', () => {
    const q = render(tagGroupsCondition('hevc,x265;1080p')!);
    // Deux EXISTS liés par AND, et les slugs en paramètres.
    expect(q.sql.match(/EXISTS/g)).toHaveLength(2);
    expect(q.params).toEqual(expect.arrayContaining(['hevc', 'x265', '1080p']));
  });

  it('dédoublonne, ignore les vides, et ne rend rien quand il ne reste rien', () => {
    const q = render(tagGroupsCondition('hevc,hevc,;;')!);
    expect(q.sql.match(/EXISTS/g)).toHaveLength(1);
    expect(q.params.filter((p) => p === 'hevc')).toHaveLength(1);
    expect(tagGroupsCondition(';;')).toBeNull();
    expect(tagGroupsCondition('')).toBeNull();
  });
});

describe('boundedTagGroups', () => {
  it('accepte huit groupes de dix, refuse au-delà', () => {
    // Le coût est linéaire en groupes ET en synonymes : les facettes lancent
    // une requête par groupe, chacune portant les autres en EXISTS.
    expect(boundedTagGroups(Array(8).fill('a').join(';'))).toBe(true);
    expect(boundedTagGroups(Array(9).fill('a').join(';'))).toBe(false);
    expect(boundedTagGroups(Array(10).fill('a').join(','))).toBe(true);
    expect(boundedTagGroups(Array(11).fill('a').join(','))).toBe(false);
    // Les groupes vides ne comptent pas : `a;;;` reste un groupe.
    expect(boundedTagGroups('a;;;;;;;;;;;;')).toBe(true);
  });
});
