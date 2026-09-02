import { describe, expect, it } from 'vitest';
import { naiveTimestampToIso } from '../utils/naiveTimestamp';

/**
 * `db.execute()` rend les colonnes `timestamp` en chaîne brute, sans fuseau.
 *
 * Le défaut que ce fichier verrouille se voyait sur le forum : « il y a
 * 2 heures » pour un message publié depuis douze minutes, plus un défaut
 * d'hydratation, parce que `"2026-09-02 16:41:33.779157"` partait tel quel
 * dans le JSON et que `new Date()` le lit dans le fuseau LOCAL. Deux heures
 * d'écart en France, treize en Nouvelle-Zélande, zéro sur un poste en UTC —
 * c'est-à-dire invisible pour qui développe en UTC.
 */
describe('naiveTimestampToIso', () => {
  it('déclare UTC la forme que rend Postgres', () => {
    expect(naiveTimestampToIso('2026-09-02 16:41:33.779157')).toBe(
      '2026-09-02T16:41:33.779Z'
    );
  });

  it('laisse intact un instant déjà daté', () => {
    expect(naiveTimestampToIso('2026-09-02T16:41:33.779Z')).toBe(
      '2026-09-02T16:41:33.779Z'
    );
    // Un décalage explicite est un instant : on le convertit sans le déplacer.
    expect(naiveTimestampToIso('2026-09-02T18:41:33.779+02:00')).toBe(
      '2026-09-02T16:41:33.779Z'
    );
  });

  it('accepte un Date, que `db.select()` rend déjà correctement', () => {
    const d = new Date('2026-09-02T16:41:33.779Z');
    expect(naiveTimestampToIso(d)).toBe('2026-09-02T16:41:33.779Z');
  });

  it('rend null plutôt que « Invalid Date »', () => {
    expect(naiveTimestampToIso(null)).toBeNull();
    expect(naiveTimestampToIso(undefined)).toBeNull();
    expect(naiveTimestampToIso('pas une date')).toBeNull();
  });

  it("ne dépend pas du fuseau du processus", () => {
    // La suite tourne en Europe/Paris (voir `vitest.config.ts` du web pour le
    // même choix). Si la conversion lisait l'heure locale, on obtiendrait
    // 14:41Z au lieu de 16:41Z — l'écart exact qu'affichait le forum.
    const iso = naiveTimestampToIso('2026-09-02 16:41:33.779157');
    expect(iso).not.toBe('2026-09-02T14:41:33.779Z');
    expect(new Date(iso!).getUTCHours()).toBe(16);
  });
});
