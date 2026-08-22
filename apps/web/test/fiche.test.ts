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

// The listing generator. Everything is pure: from a `TechnicalSheet` and some
// metadata it produces BBCode, a release name and an NFO. Nothing here touches
// the network or the disk, which makes the logic entirely testable — and that
// is useful, because three defects have already slipped in without any of them
// raising an error: a regional language code printed raw, a truncated team
// name, and a codec that disagreed between the listing and the release name.

function sheet(over: Partial<TechnicalSheet> = {}): TechnicalSheet {
  return {
    ...emptySheet(),
    fileName: 'Title.2026.1080p.WEB-DL.x264-TeamName.mkv',
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
  it('recognises short ISO codes', () => {
    expect(languageLabel('fr')).toEqual({ flag: '🇫🇷', name: 'Français' });
    expect(languageLabel('ja')).toEqual({ flag: '🇯🇵', name: 'Japonais' });
  });

  it('accepts regional codes', () => {
    // The patterns are anchored (`^fr$`): with no fallback onto the language
    // part, "fr-FR" came out verbatim on the listing, with no flag.
    expect(languageLabel('fr-FR').name).toBe('Français');
    expect(languageLabel('en-US').name).toBe('Anglais');
    expect(languageLabel('ja-JP').name).toBe('Japonais');
  });

  it('keeps the variants that deserve their own flag apart', () => {
    expect(languageLabel('pt-BR')).toEqual({ flag: '🇧🇷', name: 'Brésilien' });
    expect(languageLabel('pt').name).toBe('Portugais');
  });

  it('returns the raw value with no flag rather than inventing one', () => {
    expect(languageLabel('klingon')).toEqual({ flag: '', name: 'klingon' });
    expect(languageLabel('')).toEqual({ flag: '', name: 'Inconnu' });
  });
});

describe('audioLine / subtitleLine', () => {
  it('composes the audio line with flag, layout, codec and bitrate', () => {
    const line = audioLine(sheet().audio[0]!);
    expect(line).toContain('🇯🇵');
    expect(line).toContain('Japonais');
    expect(line).toContain('[2.0]');
    expect(line).toContain('AAC');
    expect(line).toContain('192 Kbps');
  });

  it('shows no bitrate when it is unknown', () => {
    const line = audioLine({ kind: 'audio', format: 'AAC', language: 'fr' });
    expect(line).not.toContain('@');
  });

  it('tells the three kinds of subtitle apart', () => {
    const base = { kind: 'text' as const, format: 'SRT', language: 'fr' };
    expect(subtitleLine(base)).toContain('complets');
    expect(subtitleLine({ ...base, isForced: true })).toContain('Forcé');
    expect(subtitleLine({ ...base, isSdh: true })).toContain('SDH');
  });

  it('lets forced win over SDH when both flags are set', () => {
    const line = subtitleLine({
      kind: 'text', format: 'SRT', language: 'fr', isForced: true, isSdh: true,
    });
    expect(line).toContain('Forcé');
    expect(line).not.toContain('SDH');
  });
});

describe('guessTeam', () => {
  it('takes what follows the first hyphen of the last segment', () => {
    expect(guessTeam('Title.2026.1080p.WEB-DL.x264-NTb.mkv')).toBe('NTb');
  });

  it('keeps a compound team name', () => {
    // Splitting on the last hyphen of the whole name truncated "Foo-Bar" to
    // "Bar".
    expect(guessTeam('Title.2026.1080p.WEB-DL.x264-Foo-Bar.mkv')).toBe('Foo-Bar');
  });

  it('works on a space-separated name too', () => {
    expect(guessTeam('Title 2026 1080p WEB-DL x264-Foo-Bar.mkv')).toBe('Foo-Bar');
  });

  it('refuses a technical fragment rather than proposing anything', () => {
    expect(guessTeam('Title.2026.1080p.WEB-DL.mkv')).toBeUndefined();
    expect(guessTeam('Title.2026.x264.mkv')).toBeUndefined();
    expect(guessTeam('')).toBeUndefined();
  });
});

describe('deriveReleaseParts / formatReleaseName', () => {
  it('derives resolution, audio, codec and team', () => {
    const parts = deriveReleaseParts('My Title', 2026, sheet(), 'WEB-DL');
    expect(parts.resolution).toBe('1080p');
    expect(parts.audio).toBe('AAC');
    expect(parts.video).toBe('x264');
    expect(parts.team).toBe('TeamName');
  });

  it('announces VOSTFR for an original version subtitled in French', () => {
    // French tracker convention: describe what the user will hear and read,
    // not the audio track. "JAPANESE" would be accurate and useless.
    expect(deriveReleaseParts('T', 2026, sheet(), 'WEB-DL').language).toBe('VOSTFR');
  });

  it('announces FRENCH when the audio is French', () => {
    const s = sheet({ audio: [{ kind: 'audio', format: 'AC-3', language: 'fr' }] });
    expect(deriveReleaseParts('T', 2026, s, 'BluRay').language).toBe('FRENCH');
  });

  it('announces MULTi from two audio languages onwards', () => {
    const s = sheet({
      audio: [
        { kind: 'audio', format: 'AC-3', language: 'fr' },
        { kind: 'audio', format: 'AC-3', language: 'en' },
      ],
    });
    expect(deriveReleaseParts('T', 2026, s, 'BluRay').language).toBe('MULTi');
  });

  it('assembles the name, omitting the absent segments', () => {
    expect(
      formatReleaseName({ title: 'My Title', year: 2026, resolution: '1080p', team: 'NTb' }),
    ).toBe('My.Title.2026.1080p-NTb');
    // An incomplete name is still usable; one riddled with "undefined" is not.
    expect(formatReleaseName({ title: 'Alone' })).toBe('Alone');
  });

  it('can switch to spaces', () => {
    expect(
      formatReleaseName({ title: 'My Title', year: 2026, resolution: '1080p' }, true),
    ).toBe('My Title 2026 1080p');
  });

  it('keeps the name codec in step with the listing codec', () => {
    // Both derive from the declared encoder: the listing said "x264" while the
    // name said "H264".
    const parts = deriveReleaseParts('T', 2026, sheet(), 'WEB-DL');
    const s = sheet({ video: [{ ...sheet().video[0]!, encoder: undefined }] });
    expect(parts.video).toBe('x264');
    expect(deriveReleaseParts('T', 2026, s, 'WEB-DL').video).toBe('H264');
  });
});

describe('buildNfo', () => {
  it('puts the release name first, then the MediaInfo block', () => {
    const nfo = buildNfo('My.Title.2026.1080p-NTb', sheet());
    expect(nfo.startsWith('My.Title.2026.1080p-NTb')).toBe(true);
    expect(nfo).toContain('General');
    expect(nfo).toContain('Video');
    expect(nfo).toContain('Audio');
  });

  it('renders the model, not the raw output that was kept', () => {
    // The NFO is computed from `TechnicalSheet`, so that a track corrected at
    // the technical step shows up in it.
    const s = sheet({ raw: 'THIS IS AN OLD PASTED OUTPUT' });
    const nfo = buildNfo('Name', s);
    expect(nfo).not.toContain('OLD PASTED');
    expect(nfo).toContain('1920 pixels');
  });
});

describe('buildFiche', () => {
  const work: FicheWork = {
    type: 'tv',
    title: 'My Title',
    year: 2026,
    genres: ['Animation'],
    countries: ['Japon'],
    overview: 'A synopsis.',
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
    releaseName: 'My.Title.2026.1080p-NTb',
  };

  it('produces a balanced centred block', () => {
    const bb = buildFiche(work, release, sheet(), defaultOptions());
    expect(bb.startsWith('[center]')).toBe(true);
    // As many openings as closings, otherwise the preview overflows.
    for (const tag of ['center', 'font', 'size']) {
      const open = (bb.match(new RegExp(`\\[${tag}[=\\]]`, 'g')) ?? []).length;
      const close = (bb.match(new RegExp(`\\[/${tag}\\]`, 'g')) ?? []).length;
      expect(open).toBe(close);
    }
  });

  it('formats quantities rather than printing raw values', () => {
    const bb = buildFiche(work, release, sheet(), defaultOptions());
    expect(bb).toContain('8 Mbps');
    expect(bb).toContain('1.37 GiB');
    // The original defect: "Video bitrate: 8000000".
    expect(bb).not.toContain('8000000');
    expect(bb).not.toContain('1473173712');
  });

  it('shows languages with their flag, regional codes included', () => {
    const bb = buildFiche(work, release, sheet(), defaultOptions());
    expect(bb).toContain('🇯🇵');
    expect(bb).toContain('🇫🇷');
    expect(bb).not.toContain('fr-FR');
  });

  it('honours the composition options', () => {
    const without = buildFiche(work, release, sheet(), {
      ...defaultOptions(),
      includeSynopsis: false,
      includePoster: false,
      includeTechnical: false,
    });
    expect(without).not.toContain('A synopsis.');
    expect(without).not.toContain('example.org/p.jpg');
    expect(without).not.toContain('Qualité vidéo');
  });

  it('inserts http(s) screenshots only', () => {
    const bb = buildFiche(work, release, sheet(), {
      ...defaultOptions(),
      screenshots: 'https://ok.example/1.png\njavascript:alert(1)\nftp://no.example/2.png',
    });
    expect(bb).toContain('https://ok.example/1.png');
    expect(bb).not.toContain('javascript:');
    expect(bb).not.toContain('ftp://');
  });

  it('supports a listing with no metadata at all', () => {
    // The user may have no tmdbId: the listing must still come out, with
    // neither "undefined" nor a crash.
    const bb = buildFiche(
      { type: 'movie', title: 'No metadata' },
      {},
      emptySheet(),
      defaultOptions(),
    );
    expect(bb).toContain('No metadata');
    expect(bb).not.toContain('undefined');
    expect(bb).not.toContain('NaN');
  });
});

// The listing's byte contract.
//
// Everything above pins a behaviour; nothing pinned the bytes, and the bytes
// are the product: the four spaces before the year, the space "Audio :" has
// and "Sous-titres :" has not, the two size labels left un-italicised, the ⭐
// and the │. Each of them was copied from the listing the original tool
// produced and each is invisible to a behavioural assertion — a refactor can
// drop any of them with every test above still green.
//
// One maximal fixture and one empty fixture is enough to cover the scaffolding
// in both directions, and they are the reference `test/ficheTemplate.test.ts`
// compares the template engine against: the equality it asserts is only worth
// something because these two pin the target.
//
// If the date ever comes out as "2026-03-07" here, the runtime is missing its
// ICU data rather than the generator being wrong — and every listing it emits
// is wrong with it, which is exactly why the date stays in the fixture.
const GOLDEN_MAXIMAL = `[center][font=Verdana][color=#3d85c6][size=29][b]My Title[/b]
    (2026)[/size][/color][/font]

[img]https://example.org/p.jpg[/img]

[img]https://i.imgur.com/u3WEe1w.png[/img]

[font=Verdana][size=13][b][color=#3d85c6]Pays :[/color][/b] [i]Japon, France[/i]
[b][color=#3d85c6]Genres :[/color][/b] [i]Animation, Drame[/i]
[b][color=#3d85c6]Date de sortie :[/color][/b] [i]7 mars 2026[/i]
[b][color=#3d85c6]Titre original :[/color][/b] [i]Mon Titre[/i]
[b][color=#3d85c6]Durée :[/color][/b] [i]2h 22min[/i]
[b][color=#3d85c6]Nombre de saisons :[/color][/b] [i]2[/i]
[b][color=#3d85c6]Nombre d’épisodes :[/color][/b] [i]24[/i]
[b][color=#3d85c6]Créateur(s) :[/color][/b] [i]A. Réal[/i]
[b][color=#3d85c6]Acteurs :[/color][/b] [i]Actor One, Actor Two, Actor Three[/i]
[img width=75]https://img.example/1.jpg[/img][img width=75]https://img.example/2.jpg[/img]

⭐ [i]8.23 (1234)[/i]

 [url=https://www.themoviedb.org/tv/999][img]https://i.imgur.com/mxI05s2.png[/img][/url] │

[img]https://i.imgur.com/W3pvv6q.png[/img]

A synopsis.


[img]https://i.imgur.com/KMZsqZn.png[/img]
[b][color=#3d85c6]Release source :[/color][/b] [i]WEB-DL[/i]
[b][color=#3d85c6]Qualité vidéo :[/color][/b] [i]1080p[/i]
[b][color=#3d85c6]Format vidéo :[/color][/b] [i]MKV[/i]
[b][color=#3d85c6]Codec vidéo :[/color][/b] [i]x264[/i]
[b][color=#3d85c6]Débit vidéo :[/color][/b] [i]8 Mbps[/i]

[b][color=#3d85c6] Audio :[/color][/b]
 🇯🇵 Japonais [2.0] AAC @ 192 Kbps
 🇫🇷 Français [5.1] DTS-HD MA @ 1.5 Mbps
[b][color=#3d85c6]Sous-titres :[/color][/b]
🇫🇷 Français (ASS - complets)
🇬🇧 Anglais (SRT - Forcé)

[img]https://i.imgur.com/KFsABlN.png[/img]
[b][color=#3d85c6]Taille totale :[/color][/b] 1.37 GiB
[b][color=#3d85c6]Nombre de fichier :[/color][/b] 3
[/size][/font][/center]

[center][img]https://s.example/a.png[/img]
[img]https://s.example/b.png[/img][/center]

[left][size=13][b][color=#3d85c6]Nom release :[/color][/b] My.Title.2026.1080p-NTb[/size][/left]

[right][size=10][i] Propulsé par Trackarr[/i][/size][/right]`;

const GOLDEN_MINIMAL = `[center][font=Verdana][color=#3d85c6][size=29][b]No metadata[/b][/size][/color][/font]

[img]https://i.imgur.com/EXBOmiU.png[/img]

[font=Verdana][size=13]
[b][color=#3d85c6]Sous-titres :[/color][/b]
Aucun
[/size][/font][/center]

[right][size=10][i] Propulsé par Trackarr[/i][/size][/right]`;

describe('buildFiche byte contract', () => {
  const work: FicheWork = {
    type: 'tv',
    title: 'My Title',
    originalTitle: 'Mon Titre',
    year: 2026,
    releaseDate: '2026-03-07',
    runtime: 142,
    genres: ['Animation', 'Drame'],
    countries: ['Japon', 'France'],
    directors: ['A. Réal'],
    cast: [
      { name: 'Actor One', photoUrl: 'https://img.example/1.jpg' },
      { name: 'Actor Two', photoUrl: 'https://img.example/2.jpg' },
      { name: 'Actor Three' },
    ],
    seasonCount: 2,
    episodeCount: 24,
    overview: 'A synopsis.',
    posterUrl: 'https://example.org/p.jpg',
    voteAverage: 8.23,
    voteCount: 1234,
    tmdbId: 999,
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
    fileCount: 3,
    releaseName: 'My.Title.2026.1080p-NTb',
  };
  const full = sheet({
    audio: [
      {
        kind: 'audio',
        format: 'AAC',
        channels: '2.0',
        bitRate: 192_000,
        bitRateUnit: 'Kbps',
        language: 'ja',
      },
      {
        kind: 'audio',
        format: 'DTS',
        profile: 'MA',
        channels: '5.1',
        bitRate: 1_500_000,
        bitRateUnit: 'Mbps',
        language: 'fr',
      },
    ],
    text: [
      { kind: 'text', format: 'ASS', language: 'fr-FR' },
      { kind: 'text', format: 'SRT', language: 'en', isForced: true },
    ],
  });

  it('emits the maximal listing byte for byte', () => {
    const bb = buildFiche(work, release, full, {
      ...defaultOptions(),
      screenshots: 'https://s.example/a.png\nhttps://s.example/b.png',
    });
    expect(bb).toBe(GOLDEN_MAXIMAL);
  });

  it('emits the empty listing byte for byte, orphan newline included', () => {
    // No metadata, no technical sheet: the bare `[font][size=13]` line keeps
    // its trailing newline and "Sous-titres :/Aucun" still shows. Both are
    // easy to lose in a rewrite and both are part of the contract.
    const bb = buildFiche({ type: 'movie', title: 'No metadata' }, {}, emptySheet(), defaultOptions());
    expect(bb).toBe(GOLDEN_MINIMAL);
  });
});
