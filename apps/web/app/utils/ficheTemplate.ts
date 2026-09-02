/**
 * The listing generator, expressed as data.
 *
 * `buildFiche()` in `ficheBbcode.ts` builds the listing by pushing lines into
 * an array. That is fine as long as the layout is ours, and useless the moment
 * a user wants their own: an array of `push()` calls cannot be edited from a
 * settings page. So the same output is expressed twice over here — a flat bag
 * of variables (`buildFicheContext`) and a template that consumes it
 * (`DEFAULT_FICHE_TEMPLATE`) — and `test/ficheTemplate.test.ts` asserts, over
 * two dozen fixtures, that rendering the second with the first returns the
 * exact bytes `buildFiche` returns. `buildFiche` stays the reference; this file
 * is what makes it replaceable.
 *
 * Two decisions worth knowing before editing:
 *
 * - The four repeated parts of the listing (facts, specs, audio, subtitles,
 *   size, cast photos, screenshots) arrive PRE-RENDERED as multi-line strings.
 *   The engine has no loop, on purpose: a template that cannot iterate cannot
 *   be made to iterate forever. The price is that the labels inside those
 *   blocks ("Pays :", "Débit vidéo :") are not editable from a template.
 * - Every formatter runs here, never in the template: dates through the ICU
 *   locale, sizes and bitrates through the `Number(toFixed())` rounding that
 *   drops trailing zeros (`1 GiB`, never `1.00 GiB`). A template only ever
 *   receives finished strings.
 */
import {
  audioLine,
  frenchDate,
  runtimeLabel,
  subtitleLine,
  type FicheOptions,
  type FicheRelease,
  type FicheWork,
} from './ficheBbcode';
import { emptySheet, formatBitRate, formatSheetSize, type TechnicalSheet } from './mediainfo';
import { renderTemplate, type TemplateContext } from '@trackarr/shared/templateEngine';

/**
 * The accent and the two label shapes as `ficheBbcode.ts` emits them, repeated
 * rather than imported: anything exported from `app/utils` becomes a Nuxt
 * auto-import for the whole application, and `field`/`ACCENT` are far too
 * common a name to take over. The drift this would normally invite is closed
 * by the byte-identity suite — change the accent in one file only and every
 * fixture fails at once.
 */
const ACCENT = '#3d85c6';
const field = (label: string, value: string) =>
  `[b][color=${ACCENT}]${label} :[/color][/b] [i]${value}[/i]`;
/** The original template italicises every value except these two. Reproduced as-is. */
const plain = (label: string, value: string) =>
  `[b][color=${ACCENT}]${label} :[/color][/b] ${value}`;

/**
 * `String(v)` before any string method, the same guard `ficheBbcode.ts`
 * applies for the same reason: mediainfo.js hands back numbers where the model
 * says string, and calling `.trim()` on a number throws inside a `computed`,
 * which blanks the page.
 */
const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v));

export type FicheVariableGroup =
  | 'header'
  | 'facts'
  | 'rating'
  | 'synopsis'
  | 'technical'
  | 'release'
  | 'options';

export interface FicheVariable {
  name: string;
  group: FicheVariableGroup;
  /** A pre-rendered multi-line block: usable as a value or as a condition, never as a loop. */
  block: boolean;
  /** Developer-facing; the UI labels these through i18n keyed on `name`. */
  description: string;
}

/**
 * What a template may refer to — the palette the editor offers, and the
 * complete list of what the wizard can actually fill today. Deliberately no
 * music, book or game variables: the metadata lookup only returns films and
 * series, so offering more would offer names that always render empty.
 */
export const FICHE_VARIABLES: readonly FicheVariable[] = [
  { name: 'TITLE', group: 'header', block: false, description: 'Title as typed, BBCode included' },
  { name: 'YEAR', group: 'header', block: false, description: 'Release year, empty when unknown' },
  {
    name: 'IS_MOVIE',
    group: 'header',
    block: false,
    description: 'Condition: film rather than series',
  },
  {
    name: 'POSTER_URL',
    group: 'header',
    block: false,
    description: 'Poster, empty when the poster is switched off',
  },
  {
    name: 'FACTS_BLOCK',
    group: 'facts',
    block: true,
    description: 'Country, genres, date, original title, runtime, seasons, directors, cast',
  },
  {
    name: 'CAST_PHOTOS_BLOCK',
    group: 'facts',
    block: true,
    description: 'Cast thumbnails, glued edge to edge on one line',
  },
  { name: 'VOTE_AVERAGE', group: 'rating', block: false, description: 'Rating out of 10, 2 decimals' },
  { name: 'VOTE_COUNT', group: 'rating', block: false, description: 'Number of votes, unformatted' },
  { name: 'TMDB_ID', group: 'rating', block: false, description: 'TMDb identifier' },
  { name: 'TMDB_TYPE', group: 'rating', block: false, description: 'TMDb URL segment: movie or tv' },
  { name: 'OVERVIEW', group: 'synopsis', block: false, description: 'Synopsis, possibly multi-line' },
  {
    name: 'SPECS_BLOCK',
    group: 'technical',
    block: true,
    description: 'Source, quality, container, video codec and bitrate',
  },
  { name: 'AUDIO_BLOCK', group: 'technical', block: true, description: 'One line per audio track' },
  {
    name: 'SUBTITLES_BLOCK',
    group: 'technical',
    block: true,
    description: 'One line per subtitle track, empty when there are none',
  },
  { name: 'SIZE_BLOCK', group: 'technical', block: true, description: 'Total size and file count' },
  {
    name: 'SCREENSHOTS_BLOCK',
    group: 'release',
    block: true,
    description: 'Screenshots pasted by the user, http(s) only',
  },
  { name: 'RELEASE_NAME', group: 'release', block: false, description: 'Release name' },
  {
    name: 'INCLUDE_POSTER',
    group: 'options',
    block: false,
    description: 'Condition: the poster checkbox',
  },
  {
    name: 'INCLUDE_SYNOPSIS',
    group: 'options',
    block: false,
    description: 'Condition: the synopsis checkbox',
  },
  {
    name: 'INCLUDE_TECHNICAL',
    group: 'options',
    block: false,
    description: 'Condition: the technical-details checkbox',
  },
  {
    name: 'INCLUDE_CAST_PHOTOS',
    group: 'options',
    block: false,
    description: 'Condition: the cast-photos checkbox',
  },
];

/**
 * The built-in template: the listing the generator has always produced, to the
 * byte. Code and not a database row, so it is available on a fresh install,
 * cannot be deleted, and always gives a user something to copy from.
 *
 * Byte-for-byte details that look like typos and are not: the four spaces
 * before `(year)` and the newline that precedes them, inside the [size=29]
 * span; the space before "Audio :" that "Sous-titres :" does not have; the
 * space that opens the TMDb line and the `│` that ends it; the space inside
 * `[i] Propulsé`. The two size labels are not italicised while every other
 * value is. All of it comes from the listing the original tool produced, and
 * the byte-identity suite fails on any of them.
 */
export const DEFAULT_FICHE_TEMPLATE = `[center][font=Verdana][color=${ACCENT}][size=29][b]{{TITLE}}[/b]{{#YEAR}}
    ({{YEAR}}){{/YEAR}}[/size][/color][/font]
{{#POSTER_URL}}

[img]{{POSTER_URL}}[/img]
{{/POSTER_URL}}

{{#IS_MOVIE}}[img]https://i.imgur.com/EXBOmiU.png[/img]{{/IS_MOVIE}}{{^IS_MOVIE}}[img]https://i.imgur.com/u3WEe1w.png[/img]{{/IS_MOVIE}}

[font=Verdana][size=13]{{FACTS_BLOCK}}
{{#CAST_PHOTOS_BLOCK}}
{{CAST_PHOTOS_BLOCK}}
{{/CAST_PHOTOS_BLOCK}}
{{#VOTE_AVERAGE}}

⭐ [i]{{VOTE_AVERAGE}}{{#VOTE_COUNT}} ({{VOTE_COUNT}}){{/VOTE_COUNT}}[/i]
{{/VOTE_AVERAGE}}
{{#TMDB_ID}}

 [url=https://www.themoviedb.org/{{TMDB_TYPE}}/{{TMDB_ID}}][img]https://i.imgur.com/mxI05s2.png[/img][/url] │
{{/TMDB_ID}}
{{#OVERVIEW}}

[img]https://i.imgur.com/W3pvv6q.png[/img]

{{OVERVIEW}}

{{/OVERVIEW}}
{{#INCLUDE_TECHNICAL}}
{{#SPECS_BLOCK}}

[img]https://i.imgur.com/KMZsqZn.png[/img]
{{SPECS_BLOCK}}
{{/SPECS_BLOCK}}
{{#AUDIO_BLOCK}}

[b][color=${ACCENT}] Audio :[/color][/b]
{{AUDIO_BLOCK}}
{{/AUDIO_BLOCK}}
[b][color=${ACCENT}]Sous-titres :[/color][/b]
{{#SUBTITLES_BLOCK}}
{{SUBTITLES_BLOCK}}
{{/SUBTITLES_BLOCK}}
{{^SUBTITLES_BLOCK}}
Aucun
{{/SUBTITLES_BLOCK}}
{{#SIZE_BLOCK}}

[img]https://i.imgur.com/KFsABlN.png[/img]
{{SIZE_BLOCK}}
{{/SIZE_BLOCK}}
{{/INCLUDE_TECHNICAL}}
[/size][/font][/center]
{{#SCREENSHOTS_BLOCK}}

[center]{{SCREENSHOTS_BLOCK}}[/center]
{{/SCREENSHOTS_BLOCK}}
{{#RELEASE_NAME}}

[left][size=13][b][color=${ACCENT}]Nom release :[/color][/b] {{RELEASE_NAME}}[/size][/left]
{{/RELEASE_NAME}}

[right][size=10][i] Propulsé par Trackarr[/i][/size][/right]`;

/**
 * The variable bag for one listing.
 *
 * Each entry mirrors a decision taken in `buildFiche`, and the mirroring is
 * exact rather than approximate — a value it drops (`voteAverage: 0`, a
 * `fileCount` of 0, a `year` of 0) has to arrive here as an empty string, so
 * that the section wrapping it in the template closes for the same reason.
 * The three composition checkboxes that empty a single variable are folded in
 * here (`POSTER_URL`, `OVERVIEW`, `CAST_PHOTOS_BLOCK`), which keeps them
 * honoured even in a template that dropped the `{{#INCLUDE_…}}` guard;
 * `INCLUDE_TECHNICAL` cannot be folded away because the "Sous-titres :" header
 * depends on the option rather than on the data.
 */
export function buildFicheContext(
  work: FicheWork,
  release: FicheRelease,
  sheet: TechnicalSheet,
  opts: FicheOptions,
): TemplateContext {
  const isMovie = work.type === 'movie';

  const facts: string[] = [];
  const fact = (label: string, value?: string) => {
    const v = str(value).trim();
    if (v) facts.push(field(label, v));
  };
  fact('Pays', work.countries?.join(', '));
  fact('Genres', work.genres?.join(', '));
  fact('Date de sortie', frenchDate(work.releaseDate));
  fact('Titre original', work.originalTitle);
  fact('Durée', runtimeLabel(work.runtime));
  if (!isMovie) {
    fact('Nombre de saisons', work.seasonCount ? String(work.seasonCount) : '');
    fact('Nombre d’épisodes', work.episodeCount ? String(work.episodeCount) : '');
  }
  fact(isMovie ? 'Réalisateur(s)' : 'Créateur(s)', work.directors?.join(', '));
  fact('Acteurs', work.cast?.map((c) => c.name).join(', '));

  // A cast with no photo URL leaves this empty even with the option on, which
  // is what makes the option safe to fold into the value.
  const photos = opts.includeCastPhotos
    ? (work.cast ?? [])
        .map((c) => str(c.photoUrl).trim())
        .filter(Boolean)
        .map((url) => `[img width=75]${url}[/img]`)
    : [];

  const specs: string[] = [];
  const spec = (label: string, value?: string) => {
    const v = str(value).trim();
    if (v) specs.push(field(label, v));
  };
  spec('Release source', release.source);
  spec('Qualité vidéo', release.quality);
  // Falls back to the RAW MediaInfo container name, so a blanked field prints
  // "Matroska" rather than "MKV". Kept: the wizard normally pre-fills the
  // pretty name, and only a user who clears it reaches this.
  spec('Format vidéo', release.container || sheet.container);
  spec('Codec vidéo', release.videoCodec);
  spec('Débit vidéo', formatBitRate(release.videoBitRate, release.videoBitRateUnit));

  const sizeLines: string[] = [];
  const totalSize =
    formatSheetSize(release.totalSize, release.totalSizeUnit) ??
    formatSheetSize(sheet.fileSize, sheet.fileSizeUnit);
  if (totalSize) sizeLines.push(plain('Taille totale', totalSize));
  if (release.fileCount) sizeLines.push(plain('Nombre de fichier', String(release.fileCount)));

  const technical = opts.includeTechnical;
  // The only scheme-filtered input of the whole listing: these links are
  // pasted by hand, the rest comes from the metadata provider.
  const shots = opts.screenshots
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s));

  const vote =
    typeof work.voteAverage === 'number' && work.voteAverage > 0
      ? work.voteAverage.toFixed(2)
      : '';

  return {
    IS_MOVIE: isMovie,
    TITLE: str(work.title),
    YEAR: work.year ? String(work.year) : '',
    POSTER_URL: opts.includePoster ? str(work.posterUrl).trim() : '',
    FACTS_BLOCK: facts.join('\n'),
    CAST_PHOTOS_BLOCK: photos.join(''),
    VOTE_AVERAGE: vote,
    VOTE_COUNT: work.voteCount ? String(work.voteCount) : '',
    TMDB_ID: work.tmdbId ? String(work.tmdbId) : '',
    TMDB_TYPE: isMovie ? 'movie' : 'tv',
    OVERVIEW: opts.includeSynopsis ? str(work.overview).trim() : '',
    SPECS_BLOCK: technical ? specs.join('\n') : '',
    AUDIO_BLOCK: technical ? sheet.audio.map(audioLine).join('\n') : '',
    SUBTITLES_BLOCK: technical ? sheet.text.map(subtitleLine).join('\n') : '',
    SIZE_BLOCK: technical ? sizeLines.join('\n') : '',
    SCREENSHOTS_BLOCK: shots.map((u) => `[img]${u}[/img]`).join('\n'),
    RELEASE_NAME: str(release.releaseName).trim(),
    INCLUDE_POSTER: opts.includePoster,
    INCLUDE_SYNOPSIS: opts.includeSynopsis,
    INCLUDE_TECHNICAL: technical,
    INCLUDE_CAST_PHOTOS: opts.includeCastPhotos,
  };
}

/**
 * One call for the wizard: a template plus the models, BBCode out. Going
 * through here rather than assembling the two halves at the call site is what
 * keeps the closing whitespace pass from being forgotten.
 */
export function renderFiche(
  template: string,
  work: FicheWork,
  release: FicheRelease,
  sheet: TechnicalSheet,
  opts: FicheOptions,
): string {
  return renderTemplate(template, buildFicheContext(work, release, sheet, opts));
}

/**
 * A filled-in bag for the template editor's live preview: editing a template
 * from the settings page happens far from any upload, with no metadata to hand.
 * Built through `buildFicheContext` on purpose, so a preview can never show a
 * variable the real listing does not have.
 */
export function sampleFicheContext(): TemplateContext {
  const sheet: TechnicalSheet = {
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
        language: 'fr',
      },
    ],
    text: [{ kind: 'text', format: 'SRT', language: 'en', isForced: true }],
  };
  return buildFicheContext(
    {
      type: 'movie',
      title: 'Titre du film',
      originalTitle: 'Original Title',
      year: 2026,
      releaseDate: '2026-03-07',
      runtime: 122,
      genres: ['Drame', 'Thriller'],
      countries: ['France'],
      directors: ['Réalisateur'],
      cast: [{ name: 'Actrice' }, { name: 'Acteur' }],
      overview: 'Le synopsis du film, tel qu’il apparaîtra sur la fiche.',
      posterUrl: 'https://image.tmdb.org/exemple.jpg',
      voteAverage: 7.8,
      voteCount: 1234,
      tmdbId: 550,
    },
    {
      source: 'WEB-DL',
      quality: '1080p',
      container: 'MKV',
      videoCodec: 'x264',
      videoBitRate: 8_000_000,
      videoBitRateUnit: 'Mbps',
      totalSize: 1_473_173_712,
      totalSizeUnit: 'GiB',
      fileCount: 1,
      releaseName: 'Titre.Du.Film.2026.1080p.WEB-DL.x264-TEAM',
    },
    sheet,
    {
      includePoster: true,
      includeSynopsis: true,
      includeTechnical: true,
      includeCastPhotos: true,
      screenshots: 'https://exemple.org/capture-1.png\nhttps://exemple.org/capture-2.png',
    },
  );
}
