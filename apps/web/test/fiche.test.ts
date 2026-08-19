import { describe, it, expect } from 'vitest';
import {
  audioLine,
  buildFiche,
  defaultOptions,
  languageLabel,
  subtitleLine,
  type FicheRelease,
  type FicheWork,
} from '../app/utils/ficheBbcode';
import {
  buildNfo,
  deriveReleaseParts,
  formatReleaseName,
  guessTeam,
} from '../app/utils/ficheRelease';
import { emptySheet, type TechnicalSheet } from '../app/utils/mediainfo';

// Générateur de fiche. Tout est pur : à partir d'un `TechnicalSheet` et de
// métadonnées, on produit du BBCode, un nom de release et un NFO. Rien ici ne
// touche au réseau ni au disque, ce qui rend la logique entièrement testable —
// et c'est utile, parce que trois défauts s'y sont déjà glissés sans qu'aucun
// ne provoque d'erreur visible : un code de langue régional affiché brut, une
// équipe amputée, et un codec incohérent entre la fiche et le nom de release.

function sheet(over: Partial<TechnicalSheet> = {}): TechnicalSheet {
  return {
    ...emptySheet(),
    fileName: 'Titre.2026.1080p.WEB-DL.x264-TeamName.mkv',
    container: 'Matroska',
    fileSize: 1_473_173_712,
    duration: '24 min 24 s',
    video: [
      {
        kind: 'video',
        format: 'AVC',
        width: 1920,
        height: 1080,
        bitRate: 8_000_000,
        bitRateUnit: 'Mbps',
        encoder: 'x264',
      },
    ],
    audio: [
      {
        kind: 'audio',
        format: 'AAC',
        channels: '2.0',
        bitRate: 192_000,
        bitRateUnit: 'Kbps',
        language: 'ja',
      },
    ],
    text: [{ kind: 'text', format: 'ASS', language: 'fr-FR' }],
    ...over,
  };
}

describe('languageLabel', () => {
  it('reconnaît les codes ISO courts', () => {
    expect(languageLabel('fr')).toEqual({ flag: '🇫🇷', name: 'Français' });
    expect(languageLabel('ja')).toEqual({ flag: '🇯🇵', name: 'Japonais' });
  });

  it('accepte les codes régionaux', () => {
    // Les motifs sont ancrés (`^fr$`) : sans repli sur la partie langue,
    // « fr-FR » ressortait tel quel sur la fiche, sans drapeau.
    expect(languageLabel('fr-FR').name).toBe('Français');
    expect(languageLabel('en-US').name).toBe('Anglais');
    expect(languageLabel('ja-JP').name).toBe('Japonais');
  });

  it('distingue les variantes qui méritent leur propre drapeau', () => {
    expect(languageLabel('pt-BR')).toEqual({ flag: '🇧🇷', name: 'Brésilien' });
    expect(languageLabel('pt').name).toBe('Portugais');
  });

  it('rend la valeur brute sans drapeau plutôt que d’inventer', () => {
    expect(languageLabel('klingon')).toEqual({ flag: '', name: 'klingon' });
    expect(languageLabel('')).toEqual({ flag: '', name: 'Inconnu' });
  });
});

describe('audioLine / subtitleLine', () => {
  it('compose la ligne audio avec drapeau, disposition, codec et débit', () => {
    const line = audioLine(sheet().audio[0]!);
    expect(line).toContain('🇯🇵');
    expect(line).toContain('Japonais');
    expect(line).toContain('[2.0]');
    expect(line).toContain('AAC');
    expect(line).toContain('192 Kbps');
  });

  it('n’affiche pas de débit quand il est inconnu', () => {
    const line = audioLine({ kind: 'audio', format: 'AAC', language: 'fr' });
    expect(line).not.toContain('@');
  });

  it('distingue les trois natures de sous-titre', () => {
    const base = { kind: 'text' as const, format: 'SRT', language: 'fr' };
    expect(subtitleLine(base)).toContain('complets');
    expect(subtitleLine({ ...base, isForced: true })).toContain('Forcé');
    expect(subtitleLine({ ...base, isSdh: true })).toContain('SDH');
  });

  it('le caractère forcé prime sur SDH quand les deux sont posés', () => {
    const line = subtitleLine({
      kind: 'text', format: 'SRT', language: 'fr', isForced: true, isSdh: true,
    });
    expect(line).toContain('Forcé');
    expect(line).not.toContain('SDH');
  });
});

describe('guessTeam', () => {
  it('prend ce qui suit le premier tiret du dernier segment', () => {
    expect(guessTeam('Titre.2026.1080p.WEB-DL.x264-NTb.mkv')).toBe('NTb');
  });

  it('garde un nom d’équipe composé', () => {
    // Découper au dernier tiret du nom entier amputait « Foo-Bar » en « Bar ».
    expect(guessTeam('Titre.2026.1080p.WEB-DL.x264-Foo-Bar.mkv')).toBe('Foo-Bar');
  });

  it('fonctionne aussi sur un nom séparé par des espaces', () => {
    expect(guessTeam('Titre 2026 1080p WEB-DL x264-Foo-Bar.mkv')).toBe('Foo-Bar');
  });

  it('refuse un fragment technique plutôt que de proposer n’importe quoi', () => {
    expect(guessTeam('Titre.2026.1080p.WEB-DL.mkv')).toBeUndefined();
    expect(guessTeam('Titre.2026.x264.mkv')).toBeUndefined();
    expect(guessTeam('')).toBeUndefined();
  });
});

describe('deriveReleaseParts / formatReleaseName', () => {
  it('déduit résolution, audio, codec et équipe', () => {
    const parts = deriveReleaseParts('Mon Titre', 2026, sheet(), 'WEB-DL');
    expect(parts.resolution).toBe('1080p');
    expect(parts.audio).toBe('AAC');
    expect(parts.video).toBe('x264');
    expect(parts.team).toBe('TeamName');
  });

  it('annonce VOSTFR pour une VO sous-titrée en français', () => {
    // Convention des trackers francophones : on décrit ce que l'utilisateur
    // va entendre et lire, pas la piste audio. « JAPANESE » serait exact et
    // inutile.
    expect(deriveReleaseParts('T', 2026, sheet(), 'WEB-DL').language).toBe('VOSTFR');
  });

  it('annonce FRENCH quand l’audio est française', () => {
    const s = sheet({ audio: [{ kind: 'audio', format: 'AC-3', language: 'fr' }] });
    expect(deriveReleaseParts('T', 2026, s, 'BluRay').language).toBe('FRENCH');
  });

  it('annonce MULTi dès deux langues audio', () => {
    const s = sheet({
      audio: [
        { kind: 'audio', format: 'AC-3', language: 'fr' },
        { kind: 'audio', format: 'AC-3', language: 'en' },
      ],
    });
    expect(deriveReleaseParts('T', 2026, s, 'BluRay').language).toBe('MULTi');
  });

  it('assemble le nom en omettant les segments absents', () => {
    expect(
      formatReleaseName({ title: 'Mon Titre', year: 2026, resolution: '1080p', team: 'NTb' }),
    ).toBe('Mon.Titre.2026.1080p-NTb');
    // Un nom incomplet reste utilisable ; un nom truffé d'« undefined » non.
    expect(formatReleaseName({ title: 'Seul' })).toBe('Seul');
  });

  it('sait basculer en espaces', () => {
    expect(
      formatReleaseName({ title: 'Mon Titre', year: 2026, resolution: '1080p' }, true),
    ).toBe('Mon Titre 2026 1080p');
  });

  it('le codec du nom s’accorde avec celui de la fiche', () => {
    // Les deux se fondent sur l'encodeur déclaré : la fiche disait « x264 »
    // pendant que le nom disait « H264 ».
    const parts = deriveReleaseParts('T', 2026, sheet(), 'WEB-DL');
    const s = sheet({ video: [{ ...sheet().video[0]!, encoder: undefined }] });
    expect(parts.video).toBe('x264');
    expect(deriveReleaseParts('T', 2026, s, 'WEB-DL').video).toBe('H264');
  });
});

describe('buildNfo', () => {
  it('place le nom de release en tête, puis le bloc MediaInfo', () => {
    const nfo = buildNfo('Mon.Titre.2026.1080p-NTb', sheet());
    expect(nfo.startsWith('Mon.Titre.2026.1080p-NTb')).toBe(true);
    expect(nfo).toContain('General');
    expect(nfo).toContain('Video');
    expect(nfo).toContain('Audio');
  });

  it('rend le modèle et non la sortie brute conservée', () => {
    // Le NFO se calcule depuis `TechnicalSheet`, pour qu'une piste corrigée
    // à l'étape technique s'y retrouve.
    const s = sheet({ raw: 'CECI EST UNE ANCIENNE SORTIE COLLÉE' });
    const nfo = buildNfo('Nom', s);
    expect(nfo).not.toContain('ANCIENNE SORTIE');
    expect(nfo).toContain('1920 pixels');
  });
});

describe('buildFiche', () => {
  const work: FicheWork = {
    type: 'tv',
    title: 'Mon Titre',
    year: 2026,
    genres: ['Animation'],
    countries: ['Japon'],
    overview: 'Un synopsis.',
    posterUrl: 'https://example.org/p.jpg',
  };
  const release: FicheRelease = {
    source: 'WEB-DL',
    quality: '1080p',
    container: 'MKV',
    videoCodec: 'x264',
    videoBitRate: 8_000_000,
    videoBitRateUnit: 'Mbps',
    totalSize: 1_473_173_712,
    totalSizeUnit: 'GiB',
    fileCount: 1,
    releaseName: 'Mon.Titre.2026.1080p-NTb',
  };

  it('produit un bloc centré équilibré', () => {
    const bb = buildFiche(work, release, sheet(), defaultOptions());
    expect(bb.startsWith('[center]')).toBe(true);
    // Autant d'ouvertures que de fermetures, sinon l'aperçu déborde.
    for (const tag of ['center', 'font', 'size']) {
      const open = (bb.match(new RegExp(`\\[${tag}[=\\]]`, 'g')) ?? []).length;
      const close = (bb.match(new RegExp(`\\[/${tag}\\]`, 'g')) ?? []).length;
      expect(open).toBe(close);
    }
  });

  it('met en forme les grandeurs plutôt que d’afficher les valeurs brutes', () => {
    const bb = buildFiche(work, release, sheet(), defaultOptions());
    expect(bb).toContain('8 Mbps');
    expect(bb).toContain('1.37 GiB');
    // Le défaut d'origine : « Débit vidéo : 8000000 ».
    expect(bb).not.toContain('8000000');
    expect(bb).not.toContain('1473173712');
  });

  it('affiche les langues avec leur drapeau, code régional compris', () => {
    const bb = buildFiche(work, release, sheet(), defaultOptions());
    expect(bb).toContain('🇯🇵');
    expect(bb).toContain('🇫🇷');
    expect(bb).not.toContain('fr-FR');
  });

  it('respecte les options de composition', () => {
    const sans = buildFiche(work, release, sheet(), {
      ...defaultOptions(),
      includeSynopsis: false,
      includePoster: false,
      includeTechnical: false,
    });
    expect(sans).not.toContain('Un synopsis.');
    expect(sans).not.toContain('example.org/p.jpg');
    expect(sans).not.toContain('Qualité vidéo');
  });

  it('n’insère que des captures en http(s)', () => {
    const bb = buildFiche(work, release, sheet(), {
      ...defaultOptions(),
      screenshots: 'https://ok.example/1.png\njavascript:alert(1)\nftp://non.example/2.png',
    });
    expect(bb).toContain('https://ok.example/1.png');
    expect(bb).not.toContain('javascript:');
    expect(bb).not.toContain('ftp://');
  });

  it('supporte une fiche sans aucune métadonnée', () => {
    // L'utilisateur peut n'avoir aucun tmdbId : la fiche doit sortir quand
    // même, sans « undefined » ni plantage.
    const bb = buildFiche(
      { type: 'movie', title: 'Sans métadonnées' },
      {},
      emptySheet(),
      defaultOptions(),
    );
    expect(bb).toContain('Sans métadonnées');
    expect(bb).not.toContain('undefined');
    expect(bb).not.toContain('NaN');
  });
});
