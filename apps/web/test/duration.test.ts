import { describe, expect, it } from 'vitest';
import { formatDurationSeconds } from '../app/utils/duration';

/**
 * La durée d'une obligation de seed, telle qu'elle se lit.
 *
 * En heures sous quatre jours, parce que le site compte en heures (72 h) et
 * que « 2 j 13 h » demande une soustraction que « 61 h » ne demande pas.
 * Au-delà, les jours reprennent — et c'est là que l'arrondi mordait.
 */
describe('formatDurationSeconds', () => {
  it('reste en heures sous quatre jours', () => {
    expect(formatDurationSeconds(72 * 3600, 'fr')).toContain('72');
    expect(formatDurationSeconds(3600, 'fr')).toContain('1');
    // Sous l'heure, des minutes.
    expect(formatDurationSeconds(600, 'fr')).toContain('10');
  });

  it('ne rend jamais « 24 h » à côté des jours', () => {
    // 4 j 23 h 50 arrondissait l'heure à 24 : un jour de plus, pas une 24ᵉ heure.
    const s = formatDurationSeconds(4 * 86400 + 23 * 3600 + 50 * 60, 'fr');
    expect(s).not.toMatch(/\b24\b/);
    expect(s).toMatch(/\b5\b/);
    // Et l'heure disparaît quand elle vaut zéro.
    expect(formatDurationSeconds(5 * 86400, 'fr')).not.toMatch(/\b0\b/);
  });

  it('encaisse le zéro et le négatif sans rien inventer', () => {
    expect(formatDurationSeconds(0, 'fr')).toContain('0');
    expect(formatDurationSeconds(-500, 'fr')).toContain('0');
  });
});
