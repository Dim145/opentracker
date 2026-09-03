/**
 * BBCode listing generation.
 *
 * The template reproduces FicheGen's — taken from a listing the tool actually
 * produced, not guessed: centred Verdana block, #3d85c6 blue labels,
 * illustrated banners between sections, a flag per audio track. That is the
 * rendering regulars expect, and we do not stray from it.
 *
 * The emitted BBCode stays within the subset `editorFormats.ts` can read back,
 * so a listing pasted into the editor returns as HTML.
 */
import type { BitRateUnit, MediaTrack, SizeUnit, TechnicalSheet } from './mediainfo';
import {
  channelsToLayout,
  formatBitRate,
  formatSheetSize,
  prettyAudioFormat,
} from './mediainfo';

/** Label blue, taken verbatim from the original template. */
const ACCENT = '#3d85c6';

/**
 * The template's illustrated banners. These are FicheGen's visuals, reused
 * as-is by explicit decision. The accepted trade-off: they are hosted on a
 * third-party account, so an already-published listing degrades if that account
 * disappears. Bringing them in-house one day means changing these URLs, nothing
 * more.
 */
const BANNER = {
  movie: 'https://i.imgur.com/EXBOmiU.png',
  tv: 'https://i.imgur.com/u3WEe1w.png',
  synopsis: 'https://i.imgur.com/W3pvv6q.png',
  specs: 'https://i.imgur.com/KMZsqZn.png',
  size: 'https://i.imgur.com/KFsABlN.png',
  tmdb: 'https://i.imgur.com/mxI05s2.png',
} as const;

export interface FicheCastMember {
  name: string;
  character?: string | null;
  photoUrl?: string | null;
}

export interface FicheWork {
  type: 'movie' | 'tv';
  title: string;
  originalTitle?: string;
  year?: number | null;
  /** ISO `YYYY-MM-DD`; spelled out in full on the listing. */
  releaseDate?: string | null;
  runtime?: number | null;
  genres?: string[];
  countries?: string[];
  directors?: string[];
  cast?: FicheCastMember[];
  seasonCount?: number | null;
  episodeCount?: number | null;
  overview?: string;
  posterUrl?: string;
  voteAverage?: number | null;
  voteCount?: number | null;
  tmdbId?: string | number | null;
}

export interface FicheRelease {
  source?: string;
  quality?: string;
  container?: string;
  videoCodec?: string;
  /** bit/s; the unit is only a display choice. */
  videoBitRate?: number;
  videoBitRateUnit?: BitRateUnit;
  /** Octets. */
  totalSize?: number;
  totalSizeUnit?: SizeUnit;
  fileCount?: number | null;
  releaseName?: string;
}

export interface FicheOptions {
  includePoster: boolean;
  includeSynopsis: boolean;
  includeTechnical: boolean;
  includeCastPhotos: boolean;
  /** Image links pasted by the user, one per line. */
  screenshots: string;
}

export function defaultOptions(): FicheOptions {
  return {
    includePoster: true,
    includeSynopsis: true,
    includeTechnical: true,
    includeCastPhotos: true,
    screenshots: '',
  };
}

/**
 * `String(v)` before any string method, without exception.
 *
 * The model declares `string`, but a producer may hand over a number:
 * mediainfo.js returns `FrameRate` and `BitDepth` as numerics. A `.replace()`
 * on a number throws a TypeError inside a `computed`, which blanks the whole
 * page. Going through here rather than trusting the types makes that crash
 * impossible.
 */
function text(v: unknown): string {
  return v === undefined || v === null ? '' : String(v);
}

/** Libellé bleu en gras suivi de sa valeur en italique. */
function field(label: string, value: string): string {
  return `[b][color=${ACCENT}]${label} :[/color][/b] [i]${value}[/i]`;
}

/**
 * Exported for `ficheTemplate.ts`, which pre-renders this value before handing
 * it to a template: the result depends on the runtime's ICU data, so it has to
 * be computed once, here, rather than reimplemented on the template side where
 * the two spellings would drift apart on the first exotic locale.
 */
export function frenchDate(iso?: string | null): string | undefined {
  const raw = text(iso).trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) return undefined;
  const d = new Date(`${raw.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Exported for the same reason as `frenchDate`. Mind the asymmetry it encodes:
 * `2h 22min` has no space before "min" while the under-an-hour form `45 min`
 * does. That is the original template's spelling and a rewrite must keep it.
 */
export function runtimeLabel(minutes?: number | null): string | undefined {
  if (!minutes || minutes <= 0) return undefined;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}min` : `${m} min`;
}

/**
 * A flag per language. MediaInfo returns sometimes the English name, sometimes
 * the ISO code; we accept both and fall back to the raw label with no flag when
 * the language is unknown, rather than inventing one.
 */
const LANGUAGE_FLAGS: Array<[RegExp, string, string]> = [
  [/^(fr|fre|fra|french|français|francais)$/i, '🇫🇷', 'Français'],
  [/^(en|eng|english|anglais)$/i, '🇬🇧', 'Anglais'],
  [/^(ja|jpn|japanese|japonais)$/i, '🇯🇵', 'Japonais'],
  [/^(es|spa|spanish|espagnol)$/i, '🇪🇸', 'Espagnol'],
  [/^(de|ger|deu|german|allemand)$/i, '🇩🇪', 'Allemand'],
  [/^(it|ita|italian|italien)$/i, '🇮🇹', 'Italien'],
  [/^(pt|por|portuguese|portugais)$/i, '🇵🇹', 'Portugais'],
  [/^(ru|rus|russian|russe)$/i, '🇷🇺', 'Russe'],
  [/^(ko|kor|korean|coreen|coréen)$/i, '🇰🇷', 'Coréen'],
  [/^(zh|chi|zho|chinese|chinois)$/i, '🇨🇳', 'Chinois'],
  [/^(nl|dut|nld|dutch|néerlandais)$/i, '🇳🇱', 'Néerlandais'],
  [/^(ar|ara|arabic|arabe)$/i, '🇸🇦', 'Arabe'],
];

/**
 * Regional variants that deserve their own flag: Brazilian Portuguese and Latin
 * American Spanish are announced as such on trackers, and conflating them with
 * the European variants would be a substantive error.
 */
const LANGUAGE_REGIONS: Array<[RegExp, string, string]> = [
  [/^pt[-_](br)$/i, '🇧🇷', 'Brésilien'],
  [/^es[-_](mx|419|ar|co)$/i, '🇲🇽', 'Espagnol latino'],
  [/^en[-_](us)$/i, '🇺🇸', 'Anglais'],
];

/**
 * MediaInfo returns sometimes the English name, sometimes the ISO code — and
 * often the regional code (`fr-FR`, `en-US`, `ja-JP`). Because the patterns are
 * anchored, `fr-FR` matched nothing and came out verbatim on the listing: so we
 * try the full value first, then the language part alone.
 */
export function languageLabel(raw?: string): { flag: string; name: string } {
  const value = text(raw).trim();
  if (!value) return { flag: '', name: 'Inconnu' };
  for (const [re, flag, name] of LANGUAGE_REGIONS) {
    if (re.test(value)) return { flag, name };
  }
  const base = value.split(/[-_]/)[0]!;
  for (const [re, flag, name] of LANGUAGE_FLAGS) {
    if (re.test(value) || re.test(base)) return { flag, name };
  }
  return { flag: '', name: value };
}

/** The list offered by the language selects, aligned with the flags above. */
export const LANGUAGE_OPTIONS = [
  'fr',
  'en',
  'ja',
  'es',
  'de',
  'it',
  'pt',
  'pt-BR',
  'ru',
  'ko',
  'zh',
  'nl',
  'ar',
] as const;

/** " 🇫🇷 Français [5.1] DTS-HD MA @ 640 Kbps" */
export function audioLine(t: MediaTrack): string {
  const { flag, name } = languageLabel(t.language);
  const layout = channelsToLayout(text(t.channels) || undefined);
  const codec = prettyAudioFormat(text(t.format), text(t.profile));
  const bitrate = formatBitRate(t.bitRate, t.bitRateUnit);
  return [
    flag ? ` ${flag} ` : ' ',
    name,
    layout ? ` [${layout}]` : '',
    codec ? ` ${codec}` : '',
    bitrate ? ` @ ${bitrate}` : '',
  ]
    .join('')
    .replace(/\s+/g, ' ')
    .trimEnd();
}

/** "🇫🇷 Français (SRT - Forcé)" */
export function subtitleLine(t: MediaTrack): string {
  const { flag, name } = languageLabel(t.language);
  const kind = t.isForced ? 'Forcé' : t.isSdh ? 'SDH' : 'complets';
  const format = text(t.format).trim();
  const detail = format ? `${format} - ${kind}` : kind;
  return `${flag ? `${flag} ` : ''}${name} (${detail})`;
}

export function buildFiche(
  work: FicheWork,
  release: FicheRelease,
  sheet: TechnicalSheet,
  opts: FicheOptions,
): string {
  const out: string[] = [];
  const isMovie = work.type === 'movie';

  /* ── En-tête : titre, année, affiche, bandeau de type ───────────────── */
  const year = work.year ? `\n    (${work.year})` : '';
  out.push(
    `[center][font=Verdana][color=${ACCENT}][size=29][b]${text(work.title)}[/b]${year}[/size][/color][/font]`,
  );
  if (opts.includePoster && text(work.posterUrl).trim()) {
    out.push('', `[img]${text(work.posterUrl).trim()}[/img]`);
  }
  out.push('', `[img]${isMovie ? BANNER.movie : BANNER.tv}[/img]`, '');

  /* ── Identité de l'œuvre ────────────────────────────────────────────── */
  const facts: string[] = [];
  const push = (label: string, value?: string) => {
    const v = text(value).trim();
    if (v) facts.push(field(label, v));
  };
  push('Pays', work.countries?.join(', '));
  push('Genres', work.genres?.join(', '));
  push('Date de sortie', frenchDate(work.releaseDate));
  push('Titre original', work.originalTitle);
  push('Durée', runtimeLabel(work.runtime));
  if (!isMovie) {
    push('Nombre de saisons', work.seasonCount ? String(work.seasonCount) : '');
    push('Nombre d’épisodes', work.episodeCount ? String(work.episodeCount) : '');
  }
  push(isMovie ? 'Réalisateur(s)' : 'Créateur(s)', work.directors?.join(', '));
  push('Acteurs', work.cast?.map((c) => c.name).join(', '));

  out.push(`[font=Verdana][size=13]${facts.join('\n')}`);

  if (opts.includeCastPhotos) {
    const photos = (work.cast ?? [])
      .map((c) => text(c.photoUrl).trim())
      .filter(Boolean)
      .map((url) => `[img width=75]${url}[/img]`);
    if (photos.length) out.push(photos.join(''));
  }

  if (typeof work.voteAverage === 'number' && work.voteAverage > 0) {
    const votes = work.voteCount ? ` (${work.voteCount})` : '';
    out.push('', `⭐ [i]${work.voteAverage.toFixed(2)}${votes}[/i]`);
  }
  if (work.tmdbId) {
    out.push(
      '',
      ` [url=https://www.themoviedb.org/${isMovie ? 'movie' : 'tv'}/${work.tmdbId}][img]${BANNER.tmdb}[/img][/url] │`,
    );
  }

  /* ── Synopsis ───────────────────────────────────────────────────────── */
  if (opts.includeSynopsis && text(work.overview).trim()) {
    out.push('', `[img]${BANNER.synopsis}[/img]`, '', text(work.overview).trim(), '');
  }

  /* ── Spécifications ─────────────────────────────────────────────────── */
  if (opts.includeTechnical) {
    const specs: string[] = [];
    const spec = (label: string, value?: string) => {
      const v = text(value).trim();
      if (v) specs.push(field(label, v));
    };
    spec('Release source', release.source);
    spec('Qualité vidéo', release.quality);
    spec('Format vidéo', release.container || sheet.container);
    spec('Codec vidéo', release.videoCodec);
    spec('Débit vidéo', formatBitRate(release.videoBitRate, release.videoBitRateUnit));
    if (specs.length) out.push('', `[img]${BANNER.specs}[/img]`, specs.join('\n'));

    const audio = sheet.audio.map(audioLine);
    if (audio.length) {
      out.push('', `[b][color=${ACCENT}] Audio :[/color][/b]`, audio.join('\n'));
    }
    const subs = sheet.text.map(subtitleLine);
    out.push(
      `[b][color=${ACCENT}]Sous-titres :[/color][/b]`,
      subs.length ? subs.join('\n') : 'Aucun',
    );

    // The original template does NOT italicise these two values, unlike every
    // other one — we reproduce the discrepancy as-is.
    const plain = (label: string, value: string) =>
      `[b][color=${ACCENT}]${label} :[/color][/b] ${value}`;
    const sizeLines: string[] = [];
    const totalSize =
      formatSheetSize(release.totalSize, release.totalSizeUnit) ??
      formatSheetSize(sheet.fileSize, sheet.fileSizeUnit);
    if (totalSize) sizeLines.push(plain('Taille totale', totalSize));
    if (release.fileCount)
      sizeLines.push(plain('Nombre de fichier', String(release.fileCount)));
    if (sizeLines.length) out.push('', `[img]${BANNER.size}[/img]`, sizeLines.join('\n'));
  }

  /* Close the centred block opened above. */
  out.push('[/size][/font][/center]');

  /* ── Captures collées par l'utilisateur ─────────────────────────────── */
  const shots = opts.screenshots
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s));
  if (shots.length) {
    out.push('', `[center]${shots.map((u) => `[img]${u}[/img]`).join('\n')}[/center]`);
  }

  if (text(release.releaseName).trim()) {
    out.push(
      '',
      `[left][size=13][b][color=${ACCENT}]Nom release :[/color][/b] ${text(release.releaseName).trim()}[/size][/left]`,
    );
  }

  out.push('', '[right][size=10][i] Propulsé par Trackarr[/i][/size][/right]');

  return out.join('\n').replace(/\n{4,}/g, '\n\n\n').trim();
}
