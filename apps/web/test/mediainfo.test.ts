import { describe, it, expect } from 'vitest';
import {
  channelsToLayout,
  formatBitRate,
  formatDuration,
  formatSize,
  layoutToChannels,
  parseBitRate,
  parseMediaInfoText,
  parseSize,
  prettyAudioFormat,
  prettyContainer,
  prettyVideoFormat,
  renderMediaInfo,
  resolutionLabel,
  sheetFromMediaInfoJson,
} from '../app/utils/mediainfo';

// Lecture MediaInfo → modèle de fiche.
//
// Deux pièges ont déjà coûté cher ici, et les deux sont figés par ces tests.
//
// Le premier est le typage : `mediainfo.js` en `format:'object'` rend les
// champs numériques comme des NOMBRES, là où la sortie texte ne donne que des
// chaînes. Un `.replace()` sur un nombre lève un TypeError dans un `computed`
// et vide la page entière — c'est arrivé.
//
// Le second est plus sournois : ce même mode n'émet AUCUN champ `_String`.
// Les lire naïvement laissait la taille et la durée vides, et affichait
// « Débit vidéo : 8000000 » sur la fiche.

describe('parseBitRate', () => {
  it('lit un nombre nu comme des bit/s, comme le rend mediainfo.js', () => {
    expect(parseBitRate(8_000_000)).toBe(8_000_000);
    expect(parseBitRate('8000000')).toBe(8_000_000);
  });

  it('lit les formes textuelles de MediaInfo', () => {
    expect(parseBitRate('192 kb/s')).toBe(192_000);
    expect(parseBitRate('8 000 kb/s')).toBe(8_000_000);
    expect(parseBitRate('8.05 Mbps')).toBe(8_050_000);
  });

  it('encaisse les espaces insécables que MediaInfo insère', () => {
    expect(parseBitRate('8 000 kb/s')).toBe(8_000_000);
  });

  it('rend undefined plutôt que zéro sur une valeur inutilisable', () => {
    for (const bad of [undefined, null, '', 'n/a', 0, -5]) {
      expect(parseBitRate(bad as never)).toBeUndefined();
    }
  });
});

describe('formatBitRate', () => {
  it('choisit Kbps sous le mégabit et Mbps au-dessus', () => {
    expect(formatBitRate(192_000)).toBe('192 Kbps');
    expect(formatBitRate(8_000_000)).toBe('8 Mbps');
  });

  it('respecte une unité imposée', () => {
    expect(formatBitRate(8_000_000, 'Kbps')).toBe('8000 Kbps');
    expect(formatBitRate(192_000, 'Mbps')).toBe('0.19 Mbps');
  });

  it('fait l’aller-retour sans dériver', () => {
    for (const bps of [192_000, 8_000_000, 4_500_000]) {
      expect(parseBitRate(formatBitRate(bps)!)).toBeCloseTo(bps, -3);
    }
  });
});

describe('parseSize / formatSize', () => {
  it('lit les octets nus et les formes suffixées', () => {
    expect(parseSize('1473173712')).toBe(1_473_173_712);
    expect(parseSize('1.37 GiB')).toBe(Math.round(1.37 * 1024 ** 3));
    expect(parseSize('700 MiB')).toBe(700 * 1024 ** 2);
  });

  it('bascule en GiB au-delà du gibioctet', () => {
    expect(formatSize(1_473_173_712)).toBe('1.37 GiB');
    expect(formatSize(700 * 1024 ** 2)).toBe('700 MiB');
  });
});

describe('formatDuration', () => {
  it('rend la forme MediaInfo', () => {
    expect(formatDuration(1464.08)).toBe('24 min 24 s');
    expect(formatDuration(6120)).toBe('1 h 42 min');
    expect(formatDuration(45)).toBe('45 s');
  });

  it('rend undefined sur une durée absente ou nulle', () => {
    expect(formatDuration(0)).toBeUndefined();
    expect(formatDuration(null)).toBeUndefined();
  });
});

describe('channelsToLayout / layoutToChannels', () => {
  it('traduit un compte de canaux en disposition', () => {
    expect(channelsToLayout('2')).toBe('2.0');
    expect(channelsToLayout('6')).toBe('5.1');
    expect(channelsToLayout('8 channels')).toBe('7.1');
  });

  it('est idempotent — une disposition déjà normalisée ressort intacte', () => {
    // Sans ce garde-fou, « 5.1 » repassait par le parseur et devenait
    // « 51.0 », parce que les non-chiffres étaient simplement retirés.
    for (const layout of ['1.0', '2.0', '5.1', '7.1']) {
      expect(channelsToLayout(layout)).toBe(layout);
    }
  });

  it('retrouve le compte depuis la disposition', () => {
    expect(layoutToChannels('5.1')).toBe(6);
    expect(layoutToChannels('2.0')).toBe(2);
    expect(layoutToChannels('7.1')).toBe(8);
  });
});

describe('resolutionLabel', () => {
  it('nomme les paliers courants', () => {
    expect(resolutionLabel(1920, 1080)).toBe('1080p');
    expect(resolutionLabel(3840, 2160)).toBe('2160p');
    expect(resolutionLabel(1280, 720)).toBe('720p');
  });

  it('ne déclasse pas un master cinéma rogné en hauteur', () => {
    // 1920×800, c'est du 1080p. Se fier à la seule hauteur le rendait 720p —
    // le défaut que cette fonction a été réécrite pour corriger.
    expect(resolutionLabel(1920, 800)).toBe('1080p');
    expect(resolutionLabel(3840, 1600)).toBe('2160p');
  });

  it('ne déclasse pas non plus un master anamorphique rogné en largeur', () => {
    expect(resolutionLabel(1440, 1080)).toBe('1080p');
  });

  it('rend undefined quand rien n’est connu', () => {
    expect(resolutionLabel(undefined, undefined)).toBeUndefined();
  });
});

describe('noms commerciaux', () => {
  it('distingue un ré-encodage d’un flux d’origine par l’encodeur', () => {
    // x264 signale un ré-encodage, H.264 un flux non retouché. C'est la
    // distinction qu'attend une fiche, et elle ne tient qu'à `Encoded_Library`.
    expect(prettyVideoFormat('AVC', 'x264')).toBe('x264');
    expect(prettyVideoFormat('AVC', undefined)).toBe('H.264');
    expect(prettyVideoFormat('HEVC', 'x265')).toBe('x265');
    expect(prettyVideoFormat('HEVC', '')).toBe('H.265');
  });

  it('reconnaît les familles audio à partir du format et du profil', () => {
    expect(prettyAudioFormat('DTS', 'DTS-HD MA')).toBe('DTS-HD MA');
    expect(prettyAudioFormat('AAC', 'LC')).toBe('AAC');
    expect(prettyAudioFormat('E-AC-3', undefined)).toBe('E-AC3');
    expect(prettyAudioFormat('', '')).toBe('Inconnu');
  });

  it('traduit le conteneur sous son nom d’usage', () => {
    expect(prettyContainer('Matroska')).toBe('MKV');
    expect(prettyContainer('MPEG-4')).toBe('MP4');
    expect(prettyContainer('')).toBe('');
  });
});

describe('sheetFromMediaInfoJson — la sortie réelle de mediainfo.js', () => {
  // Extrait fidèle d'une analyse réelle : champs numériques non typés en
  // chaîne, et surtout AUCUN champ `_String`.
  const brut = {
    media: {
      track: [
        {
          '@type': 'General',
          Format: 'Matroska',
          FileSize: '1473173712',
          Duration: 1464.08,
          OverallBitRate: 8049690,
        },
        {
          '@type': 'Video',
          Format: 'AVC',
          Format_Profile: 'High',
          Width: 1920,
          Height: 1080,
          FrameRate: 23.976,
          BitDepth: 8,
          BitRate: 8000000,
          Encoded_Library_Name: 'x264',
        },
        {
          '@type': 'Audio',
          Format: 'AAC',
          Channels: 2,
          BitRate: 192000,
          Language: 'ja',
          Default: 'Yes',
        },
        { '@type': 'Text', Format: 'ASS', Language: 'fr-FR', Default: 'Yes' },
      ],
    },
  };

  it('remplit la taille, la durée et le débit global malgré l’absence des champs _String', () => {
    const s = sheetFromMediaInfoJson(brut);
    expect(s.fileSize).toBe(1_473_173_712);
    expect(s.duration).toBe('24 min 24 s');
    expect(s.overallBitRate).toBe(8_049_690);
  });

  it('convertit les champs numériques en chaînes sûres', () => {
    // Le cœur du plantage historique : `frameRate` arrivait en nombre et le
    // premier `.replace()` en aval vidait la page.
    const s = sheetFromMediaInfoJson(brut);
    expect(typeof s.video[0]!.frameRate).toBe('string');
    expect(s.video[0]!.frameRate).toBe('23.976');
    expect(s.video[0]!.bitDepth).toBe('8');
  });

  it('normalise les canaux et retient l’encodeur', () => {
    const s = sheetFromMediaInfoJson(brut);
    expect(s.audio[0]!.channels).toBe('2.0');
    expect(s.video[0]!.encoder).toBe('x264');
  });

  it('conserve le code de langue régional tel quel', () => {
    const s = sheetFromMediaInfoJson(brut);
    expect(s.text[0]!.language).toBe('fr-FR');
  });
});

describe('aller-retour renderMediaInfo → parseMediaInfoText', () => {
  it('ne perd ni la largeur ni la hauteur', () => {
    // La raison d'être de `renderMediaInfo` : l'ancien résumé maison écrivait
    // « Resolution : 1080p », que le parseur ignorait, et la géométrie
    // disparaissait dès le premier aller-retour — ce qui vidait les specs.
    const avant = sheetFromMediaInfoJson({
      media: {
        track: [
          { '@type': 'General', Format: 'Matroska', FileSize: '1073741824' },
          {
            '@type': 'Video',
            Format: 'AVC',
            Width: 1920,
            Height: 1080,
            BitRate: 8000000,
            Encoded_Library_Name: 'x264',
          },
          { '@type': 'Audio', Format: 'DTS', Channels: 6, BitRate: 1509000, Language: 'fr' },
        ],
      },
    });

    const apres = parseMediaInfoText(renderMediaInfo(avant));

    expect(apres.video[0]!.width).toBe(1920);
    expect(apres.video[0]!.height).toBe(1080);
    expect(apres.video[0]!.encoder).toBe('x264');
    expect(apres.audio[0]!.channels).toBe('5.1');
    expect(apres.container).toBe('Matroska');
  });

  it('est stable : une seconde passe ne change plus rien', () => {
    const s1 = parseMediaInfoText(
      renderMediaInfo(
        sheetFromMediaInfoJson({
          media: {
            track: [
              { '@type': 'General', Format: 'Matroska', FileSize: '1073741824' },
              { '@type': 'Video', Format: 'AVC', Width: 1920, Height: 1080 },
            ],
          },
        }),
      ),
    );
    const s2 = parseMediaInfoText(renderMediaInfo(s1));
    expect(s2.video[0]).toEqual(s1.video[0]);
    expect(s2.fileSize).toBe(s1.fileSize);
  });
});

describe('parseMediaInfoText — détection SDH', () => {
  it('repère un sous-titre SDH depuis son titre, faute de drapeau dans le conteneur', () => {
    const sheet = parseMediaInfoText(
      ['Text', 'Format : PGS', 'Language : en', 'Title : English SDH'].join('\n'),
    );
    expect(sheet.text[0]!.isSdh).toBe(true);
  });

  it('ne marque pas SDH un sous-titre ordinaire', () => {
    const sheet = parseMediaInfoText(
      ['Text', 'Format : SRT', 'Language : fr', 'Title : Complet'].join('\n'),
    );
    expect(sheet.text[0]!.isSdh).toBe(false);
  });
});
