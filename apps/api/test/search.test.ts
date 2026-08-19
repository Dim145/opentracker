import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SEARCH_FIELDS,
  SEARCH_FIELDS,
  fuzzyTerm,
  parseSearchFields,
  parseSearchFuzzy,
  toPrefixTsQuery,
} from '../utils/search';

// Helpers de la recherche plein-texte. Deux d'entre eux gardent une frontière
// de sécurité : `toPrefixTsQuery` assemble une expression que Postgres va
// *parser* — `to_tsquery` interprète `&`, `|`, `!`, `:` et les parenthèses,
// donc une saisie brute y produirait au mieux une erreur 500 sur une simple
// parenthèse, au pire une requête que l'utilisateur n'a pas demandée. Et
// `parseSearchFields` décide ce que la recherche lit : le désarmer ou
// l'élargir par accident change ce que voient les membres.

describe('parseSearchFields', () => {
  it('retombe sur le défaut quand le réglage est absent', () => {
    expect(parseSearchFields(null)).toEqual(DEFAULT_SEARCH_FIELDS);
    expect(parseSearchFields(undefined)).toEqual(DEFAULT_SEARCH_FIELDS);
  });

  it('lit une liste CSV et ignore la casse et les espaces', () => {
    expect(parseSearchFields(' Name , DESCRIPTION ')).toEqual([
      'name',
      'description',
    ]);
  });

  it('accepte les quatre champs connus', () => {
    expect(parseSearchFields(SEARCH_FIELDS.join(','))).toEqual([
      ...SEARCH_FIELDS,
    ]);
  });

  it('écarte les champs inconnus sans faire échouer le reste', () => {
    expect(parseSearchFields('name,uploader,description')).toEqual([
      'name',
      'description',
    ]);
  });

  it('distingue « rien coché » de « valeur illisible »', () => {
    // La chaîne vide est un choix délibéré de l'opérateur : ne rien
    // chercher en texte libre. Une valeur qui ne contient aucun champ
    // valide est en revanche une corruption du réglage, et désarmer la
    // recherche sur cette base serait pire que de revenir au défaut.
    expect(parseSearchFields('')).toEqual([]);
    expect(parseSearchFields('   ')).toEqual([]);
    expect(parseSearchFields('nawak,bidon')).toEqual(DEFAULT_SEARCH_FIELDS);
  });

  it('ne met pas le NFO dans le défaut', () => {
    // Texte long et bruyant : l'activer par défaut noierait les résultats
    // pertinents sans que personne comprenne pourquoi.
    expect(DEFAULT_SEARCH_FIELDS).not.toContain('nfo');
  });
});

describe('parseSearchFuzzy', () => {
  it('est actif par défaut', () => {
    expect(parseSearchFuzzy(null)).toBe(true);
    expect(parseSearchFuzzy(undefined)).toBe(true);
  });

  it('ne se désactive que sur « false » explicite', () => {
    expect(parseSearchFuzzy('false')).toBe(false);
    expect(parseSearchFuzzy(' FALSE ')).toBe(false);
    expect(parseSearchFuzzy('true')).toBe(true);
    // Une valeur inattendue laisse la tolérance active : perdre la
    // correction de frappe se voit tout de suite, la garder ne casse rien.
    expect(parseSearchFuzzy('0')).toBe(true);
    expect(parseSearchFuzzy('nawak')).toBe(true);
  });
});

describe('toPrefixTsQuery', () => {
  it('préfixe le dernier terme et lie les autres par ET', () => {
    expect(toPrefixTsQuery('crimson')).toBe('crimson:*');
    expect(toPrefixTsQuery('crimson vault')).toBe('crimson & vault:*');
    expect(toPrefixTsQuery('a b c')).toBe('a & b & c:*');
  });

  it('replie la casse', () => {
    expect(toPrefixTsQuery('CrimSON')).toBe('crimson:*');
  });

  it('garde les lettres accentuées', () => {
    expect(toPrefixTsQuery('intégrale')).toBe('intégrale:*');
    expect(toPrefixTsQuery('日本語')).toBe('日本語:*');
  });

  it('neutralise les opérateurs tsquery au lieu de les transmettre', () => {
    // Sans ce nettoyage, `to_tsquery` lèverait une erreur de syntaxe sur la
    // moindre parenthèse et la recherche renverrait un 500.
    for (const input of [
      'a & b',
      'a | b',
      '!a',
      '(a)',
      "a:b",
      'a <-> b',
      "'; DROP TABLE torrents; --",
    ]) {
      const out = toPrefixTsQuery(input);
      expect(out).not.toBeNull();
      // Seul le `:*` final est un opérateur ; le reste est du texte et des
      // conjonctions que nous avons nous-mêmes posées.
      expect(out!.replace(/ & /g, ' ').replace(/:\*$/, '')).toMatch(
        /^[\p{L}\p{N} ]*$/u,
      );
    }
  });

  it('découpe sur la ponctuation d’un nom de release', () => {
    expect(toPrefixTsQuery('Crimson.Vault.1994.1080p')).toBe(
      'crimson & vault & 1994 & 1080p:*',
    );
    expect(toPrefixTsQuery('WEB-DL')).toBe('web & dl:*');
  });

  it('rend null quand il ne reste rien d’exploitable', () => {
    // L'appelant doit alors s'abstenir de filtrer, et non renvoyer une
    // page vide.
    for (const input of ['', '   ', '***', '&&&', '()']) {
      expect(toPrefixTsQuery(input)).toBeNull();
    }
  });
});

describe('fuzzyTerm', () => {
  it('accepte un mot unique d’au moins trois caractères', () => {
    expect(fuzzyTerm('crimsen')).toBe('crimsen');
    expect(fuzzyTerm('ABC')).toBe('abc');
  });

  it('refuse en dessous de trois caractères', () => {
    // En dessous de trois caractères il n'existe aucun trigramme, donc
    // l'index ne peut rien faire et le repli ferait un parcours complet.
    expect(fuzzyTerm('ab')).toBeNull();
    expect(fuzzyTerm('a')).toBeNull();
  });

  it('refuse dès qu’il y a plusieurs mots', () => {
    // `word_similarity` compare mot à mot et ne rend pas la main sur la
    // combinaison : sur plusieurs termes le repli serait à la fois cher et
    // faux.
    expect(fuzzyTerm('crimsen vault')).toBeNull();
    expect(fuzzyTerm('crimson.vault')).toBeNull();
  });

  it('refuse une saisie vide ou sans caractère utile', () => {
    expect(fuzzyTerm('')).toBeNull();
    expect(fuzzyTerm('***')).toBeNull();
  });
});
