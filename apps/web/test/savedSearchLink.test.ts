import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  savedSearchLink,
  type SavedSearchCriteria,
} from '../app/utils/savedSearchLink';

/**
 * Une recherche enregistrée doit rejouer les critères qu'elle a stockés.
 *
 * La panne que ce fichier verrouille était muette. `alerts.vue` construisait
 * l'URL avec les noms du corps envoyé à l'API — `search`, `categoryId` — alors
 * que `pages/torrents/index.vue` lit `q` et `c`. La loupe menait donc à un
 * catalogue non filtré : pas d'erreur, pas de journal, rien qu'une recherche
 * qui ne s'applique pas. Quatre des six paramètres portaient déjà le bon nom,
 * ce qui achevait de rendre l'écart invisible.
 *
 * Le second bloc lit `torrents/index.vue` plutôt que de recopier une liste,
 * pour que la dérive soit détectée des DEUX côtés : renommer un paramètre dans
 * la page casse ce test, exactement comme se tromper de nom dans le lien.
 * `sfcImports.test.ts` établit déjà ce précédent de test qui lit la source.
 */
const PAGE = fileURLToPath(
  new URL('../app/pages/torrents/index.vue', import.meta.url)
);

/** Tous les `route.query.X` / `newQuery.X` que la page consulte. */
function paramsReadByCatalogue(): Set<string> {
  const src = readFileSync(PAGE, 'utf8');
  const found = new Set<string>();
  for (const m of src.matchAll(/\b(?:route\.query|newQuery|q)\.([a-zA-Z]+)\b/g)) {
    found.add(m[1]!);
  }
  return found;
}

/** Les paramètres que le lien émet, pour un jeu de critères complet. */
function paramsEmitted(): string[] {
  const full: SavedSearchCriteria = {
    query: 'dzed',
    categoryId: '84da00ba-240e-442a-8dae-33dd41bafb83',
    tags: ['x264', 'multi'],
    imdbId: 'tt0111161',
    tmdbId: '278',
    tvdbId: '81189',
  };
  const url = new URL(savedSearchLink(full), 'http://localhost');
  return [...url.searchParams.keys()];
}

describe('savedSearchLink', () => {
  it("émet les noms que la page catalogue lit, et pas ceux de l'API", () => {
    const url = savedSearchLink({
      query: 'dzed',
      categoryId: '84da00ba-240e-442a-8dae-33dd41bafb83',
    });
    // L'URL exacte signalée comme valide, moins `v` qui relève de l'affichage.
    expect(url).toBe(
      '/torrents?q=dzed&c=84da00ba-240e-442a-8dae-33dd41bafb83'
    );
    expect(url).not.toContain('search=');
    expect(url).not.toContain('categoryId=');
  });

  it('porte les six critères', () => {
    expect(paramsEmitted()).toEqual([
      'q',
      'c',
      'tag',
      'imdbid',
      'tmdbid',
      'tvdbid',
    ]);
  });

  it('joint les étiquettes par des virgules, comme la page les redécoupe', () => {
    const url = new URL(
      savedSearchLink({ tags: ['x264', 'multi'] }),
      'http://localhost'
    );
    expect(url.searchParams.get('tag')).toBe('x264,multi');
  });

  it('sans aucun critère, mène au catalogue nu', () => {
    expect(savedSearchLink({})).toBe('/torrents');
    expect(savedSearchLink({ query: '', categoryId: null })).toBe('/torrents');
  });

  it('chaque paramètre émis est effectivement lu par la page catalogue', () => {
    const read = paramsReadByCatalogue();
    // Garde-fou sur l'extraction elle-même : si la regex ne trouve plus rien,
    // le test passerait pour de mauvaises raisons.
    expect(read.size).toBeGreaterThan(3);
    for (const name of paramsEmitted()) {
      expect(read, `la page ne lit jamais « ${name} »`).toContain(name);
    }
  });
});

/**
 * Les critères que la branche s'est mise à STOCKER (saison, épisode, année,
 * uploadeur, familles d'étiquettes) — et que le lien oubliait.
 *
 * Une alerte enregistrée comme « frieren S02 @lou » ouvrait la série entière,
 * par tout le monde : le lien rejouait PLUS LARGE que ce que le membre avait
 * demandé. La même panne que les noms d'API, en plus discrète, puisqu'il
 * s'affichait bien des résultats.
 */
function paramsReadByTokens(): Set<string> {
  const src = readFileSync(new URL('../app/utils/searchTokens.ts', import.meta.url), 'utf8');
  const found = new Set<string>();
  for (const m of src.matchAll(/\bquery\.([a-zA-Z]+)\b/g)) found.add(m[1]!);
  return found;
}

describe('savedSearchLink — les critères de la barre', () => {
  it('rejoue la saison, l’épisode, l’année et les familles d’étiquettes', () => {
    const q = new URL(
      savedSearchLink({ query: 'frieren', tagGroups: 'hevc,x265;1080p', season: 2, episode: 4, year: 2024 }),
      'http://localhost',
    ).searchParams;
    // Un mot par famille, et ce mot EST la liste : la barre la relit telle quelle.
    expect(q.get('tk')).toBe('hevc,x265 1080p');
    expect(q.get('se')).toBe('2');
    expect(q.get('ep')).toBe('4');
    expect(q.get('y')).toBe('2024');
  });

  it('n’émet que ce qui est stocké', () => {
    expect(savedSearchLink({ season: 0 })).toBe('/torrents?se=0');
    const q = new URL(savedSearchLink({ query: 'x', tagGroups: ';;' }), 'http://localhost').searchParams;
    expect(q.has('tk')).toBe(false);
    expect(new URL(savedSearchLink({ query: 'x' }), 'http://localhost').searchParams.has('se')).toBe(false);
  });

  it('chacun de ces paramètres est lu au chargement de la page', () => {
    // `tk`/`se`/`ep`/`y` n'entrent pas par `route.query.X` mais par
    // `tokensFromQuery(route.query)` : c'est là qu'il faut les chercher.
    const read = paramsReadByTokens();
    expect(read.size).toBeGreaterThan(3);
    for (const name of ['tk', 'se', 'ep', 'y']) {
      expect(read, `la barre ne lit jamais « ${name} »`).toContain(name);
    }
  });
});
