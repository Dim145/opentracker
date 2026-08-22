import { describe, expect, it } from 'vitest';
import {
  buildFiche,
  defaultOptions,
  type FicheOptions,
  type FicheRelease,
  type FicheWork,
} from '../app/utils/ficheBbcode';
import {
  DEFAULT_FICHE_TEMPLATE,
  FICHE_VARIABLES,
  buildFicheContext,
  renderFiche,
  sampleFicheContext,
} from '../app/utils/ficheTemplate';
import { renderTemplate, templateVariables } from '@trackarr/shared/templateEngine';
import { emptySheet, type TechnicalSheet } from '../app/utils/mediainfo';

// The proof that the template rewrite changed nothing.
//
// `buildFiche` is the reference and stays untouched: it pushes lines into an
// array, and `test/fiche.test.ts` pins the bytes it produces. Here the same
// listing goes through the variable bag and the template instead, and the two
// must come out equal — not equivalent, equal, character for character. That
// transitivity is the whole point: the golden fixtures pin `buildFiche`, this
// suite pins the template to `buildFiche`, so the template is pinned to the
// bytes without repeating a 2 kB string here.
//
// The matrix exists because the interesting failures are all conditional. A
// section that renders when it should not costs a blank line, which no
// behavioural assertion notices; the "\n{4,}" collapse only fires on user text
// with several blank lines in it; the empty-subtitle case is the only one that
// prints "Aucun"; a runtime under the hour is the only one that puts a space
// before "min". Each of those is one line below.

function sheet(over: Partial<TechnicalSheet> = {}): TechnicalSheet {
  return {
    ...emptySheet(),
    container: 'Matroska',
    fileSize: 1_473_173_712,
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
    ...over,
  };
}

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

const opts: FicheOptions = {
  ...defaultOptions(),
  screenshots: 'https://s.example/a.png\nhttps://s.example/b.png',
};

type Case = [string, FicheWork, FicheRelease, TechnicalSheet, FicheOptions];

const cases: Case[] = [
  ['every section filled', work, release, sheet(), opts],
  ['nothing at all', { type: 'movie', title: 'No metadata' }, {}, emptySheet(), defaultOptions()],
  // The type decides the header banner, the TMDb path and the
  // director/creator label, and switches the season counts off entirely.
  ['a film rather than a series', { ...work, type: 'movie' }, release, sheet(), opts],
  ['a series with no season counts', { ...work, seasonCount: null, episodeCount: null }, release, sheet(), opts],
  // The five composition options, one at a time.
  ['the poster switched off', work, release, sheet(), { ...opts, includePoster: false }],
  ['the synopsis switched off', work, release, sheet(), { ...opts, includeSynopsis: false }],
  ['the technical block switched off', work, release, sheet(), { ...opts, includeTechnical: false }],
  ['the cast photos switched off', work, release, sheet(), { ...opts, includeCastPhotos: false }],
  ['no screenshots pasted', work, release, sheet(), { ...opts, screenshots: '' }],
  ['all four options off at once', work, release, sheet(), {
    includePoster: false,
    includeSynopsis: false,
    includeTechnical: false,
    includeCastPhotos: false,
    screenshots: '',
  }],
  // Missing data, section by section.
  ['no poster URL', { ...work, posterUrl: '' }, release, sheet(), opts],
  ['no cast at all', { ...work, cast: [] }, release, sheet(), opts],
  // Cast photos come from the lookup only: editing the actors by hand rebuilds
  // the cast without them, so "named cast, no photo" is the common case.
  ['a cast with no photo', { ...work, cast: [{ name: 'Solo' }] }, release, sheet(), opts],
  ['no rating', { ...work, voteAverage: null, voteCount: null }, release, sheet(), opts],
  ['a rating of exactly zero', { ...work, voteAverage: 0 }, release, sheet(), opts],
  ['a rating with no vote count', { ...work, voteCount: 0 }, release, sheet(), opts],
  ['no TMDb id', { ...work, tmdbId: null }, release, sheet(), opts],
  ['an empty synopsis', { ...work, overview: '' }, release, sheet(), opts],
  ['no release date', { ...work, releaseDate: null }, release, sheet(), opts],
  ['no audio track', work, release, sheet({ audio: [] }), opts],
  // The only fixture that prints "Aucun": the header is emitted whether or not
  // there is anything under it.
  ['no subtitle track', work, release, sheet({ text: [] }), opts],
  ['neither audio nor subtitles', work, release, sheet({ audio: [], text: [] }), opts],
  ['no size and no file count', work, { ...release, totalSize: undefined, fileCount: 0 }, sheet({ fileSize: undefined }), opts],
  ['no release name', work, { ...release, releaseName: '' }, sheet(), opts],
  ['no technical spec at all', work, { releaseName: 'X' }, sheet({ container: '' }), opts],
  // "Format vidéo" falls back to the raw MediaInfo name: "Matroska", not "MKV".
  ['a blanked container falling back to MediaInfo', work, { ...release, container: '' }, sheet(), opts],
  // A sub-unit bitrate formats as "0 Mbps" and the line is still emitted.
  ['a bitrate below its own unit', work, { ...release, videoBitRate: 1 }, sheet(), opts],
  ['a title carrying BBCode of its own', { ...work, title: 'A[/size][/center]B' }, release, sheet(), opts],
  // Where the "\n{4,}" collapse actually fires — user text, not scaffolding.
  ['a synopsis with five blank lines', { ...work, overview: 'a\n\n\n\n\nb' }, release, sheet(), opts],
  ['an original title spread over several lines', { ...work, originalTitle: 'x\n\n\n\n\n\ny' }, release, sheet(), opts],
  // Under an hour is the only branch that puts a space before "min".
  ['a runtime under the hour', { ...work, runtime: 45 }, release, sheet(), opts],
  ['a runtime of exactly one hour', { ...work, runtime: 60 }, release, sheet(), opts],
  ['no runtime', { ...work, runtime: 0 }, release, sheet(), opts],
  // Year 0 drops the whole "\n    (year)" suffix, indent included.
  ['a year of zero', { ...work, year: 0 }, release, sheet(), opts],
  ['screenshots mixed with links to reject', work, release, sheet(), {
    ...opts,
    screenshots: 'https://ok/1.png\njavascript:alert(1)\nftp://x/2.png\n\n  https://ok/2.png  ',
  }],
];

describe('the default template reproduces buildFiche', () => {
  for (const [name, w, r, s, o] of cases) {
    it(`is byte-identical with ${name}`, () => {
      const rendered = renderTemplate(DEFAULT_FICHE_TEMPLATE, buildFicheContext(w, r, s, o));
      expect(rendered).toBe(buildFiche(w, r, s, o));
    });
  }

  it('is compared strictly enough to notice a single missing letter', () => {
    // Without this, an equality that somehow compared two empty strings would
    // pass every case above and prove nothing.
    const tweaked = DEFAULT_FICHE_TEMPLATE.replace('Sous-titres', 'Sous-titre');
    const rendered = renderTemplate(tweaked, buildFicheContext(work, release, sheet(), opts));
    expect(rendered).not.toBe(buildFiche(work, release, sheet(), opts));
  });

  it('renders the same through renderFiche as through the two halves by hand', () => {
    expect(renderFiche(DEFAULT_FICHE_TEMPLATE, work, release, sheet(), opts)).toBe(
      buildFiche(work, release, sheet(), opts),
    );
  });
});

describe('the variable catalogue', () => {
  const catalogue = new Set(FICHE_VARIABLES.map((v) => v.name));

  it('covers every name the default template refers to', () => {
    // A typo in the template renders empty rather than failing, so the listing
    // would just quietly lose a line. This is what catches it.
    const unknown = templateVariables(DEFAULT_FICHE_TEMPLATE).filter((n) => !catalogue.has(n));
    expect(unknown).toEqual([]);
  });

  it('names nothing the context does not fill', () => {
    const context = buildFicheContext(work, release, sheet(), opts);
    const missing = [...catalogue].filter((n) => !(n in context));
    expect(missing).toEqual([]);
  });

  it('fills every catalogued name in the preview sample the editor uses', () => {
    const sample = sampleFicheContext();
    const missing = [...catalogue].filter((n) => !(n in sample));
    expect(missing).toEqual([]);
  });

  it('exposes no name the context does not know', () => {
    const extra = Object.keys(buildFicheContext(work, release, sheet(), opts)).filter(
      (n) => !catalogue.has(n),
    );
    expect(extra).toEqual([]);
  });
});
