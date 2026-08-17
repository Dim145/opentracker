/**
 * Génération de la fiche en BBCode.
 *
 * Le gabarit reproduit celui de FicheGen — relevé sur une fiche réellement
 * produite par l'outil, pas deviné : bloc centré en Verdana, libellés bleus
 * #3d85c6, bandeaux illustrés entre les sections, drapeau par piste audio.
 * C'est le rendu attendu par les habitués, on ne s'en écarte pas.
 *
 * Le BBCode émis reste dans le sous-ensemble que `editorFormats.ts` sait
 * relire, pour qu'une fiche recollée dans l'éditeur revienne en HTML.
 */
import type { BitRateUnit, MediaTrack, SizeUnit, TechnicalSheet } from './mediainfo';
import {
  channelsToLayout,
  formatBitRate,
  formatSize,
  prettyAudioFormat,
} from './mediainfo';

/** Bleu des libellés, repris tel quel du gabarit d'origine. */
const ACCENT = '#3d85c6';

/**
 * Bandeaux illustrés du gabarit. Ce sont les visuels de FicheGen, réutilisés
 * tels quels sur décision explicite. Contrepartie assumée : ils sont hébergés
 * sur un compte tiers, donc une fiche déjà publiée se dégrade si ce compte
 * disparaît. Les rapatrier un jour ne demandera que de changer ces URLs.
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
  /** ISO `YYYY-MM-DD` ; rendue en toutes lettres sur la fiche. */
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
  /** bit/s ; l'unité n'est qu'un choix d'affichage. */
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
  /** Liens d'images collés par l'utilisateur, un par ligne. */
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
 * `String(v)` avant toute méthode de chaîne, systématiquement.
 *
 * Le modèle annonce des `string`, mais un producteur peut livrer un nombre :
 * mediainfo.js rend `FrameRate` et `BitDepth` numériques. Un `.replace()` sur
 * un nombre lève un TypeError dans un `computed`, ce qui vide la page entière.
 * Passer par ici plutôt que se fier au typage rend ce plantage impossible.
 */
function text(v: unknown): string {
  return v === undefined || v === null ? '' : String(v);
}

/** Libellé bleu en gras suivi de sa valeur en italique. */
function field(label: string, value: string): string {
  return `[b][color=${ACCENT}]${label} :[/color][/b] [i]${value}[/i]`;
}

function frenchDate(iso?: string | null): string | undefined {
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

function runtimeLabel(minutes?: number | null): string | undefined {
  if (!minutes || minutes <= 0) return undefined;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}min` : `${m} min`;
}

/**
 * Drapeau par langue. MediaInfo rend tantôt le nom anglais, tantôt le code
 * ISO ; on accepte les deux et on retombe sur le libellé brut sans drapeau
 * quand la langue est inconnue, plutôt que d'inventer.
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
 * Variantes régionales qui méritent leur propre drapeau : le portugais du
 * Brésil et l'espagnol d'Amérique latine sont annoncés comme tels sur les
 * trackers, les confondre avec la métropole serait une erreur de fond.
 */
const LANGUAGE_REGIONS: Array<[RegExp, string, string]> = [
  [/^pt[-_](br)$/i, '🇧🇷', 'Brésilien'],
  [/^es[-_](mx|419|ar|co)$/i, '🇲🇽', 'Espagnol latino'],
  [/^en[-_](us)$/i, '🇺🇸', 'Anglais'],
];

/**
 * MediaInfo rend tantôt le nom anglais, tantôt le code ISO — et souvent le
 * code régional (`fr-FR`, `en-US`, `ja-JP`). Les motifs étant ancrés, un
 * `fr-FR` ne correspondait à rien et ressortait tel quel sur la fiche : on
 * essaie donc d'abord la valeur complète, puis la seule partie langue.
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

/** Liste proposée par les selects de langue, alignée sur les drapeaux ci-dessus. */
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

    // Le gabarit d'origine ne met PAS ces deux valeurs en italique, à la
    // différence de toutes les autres — on reproduit l'écart tel quel.
    const plain = (label: string, value: string) =>
      `[b][color=${ACCENT}]${label} :[/color][/b] ${value}`;
    const sizeLines: string[] = [];
    const totalSize =
      formatSize(release.totalSize, release.totalSizeUnit) ??
      formatSize(sheet.fileSize, sheet.fileSizeUnit);
    if (totalSize) sizeLines.push(plain('Taille totale', totalSize));
    if (release.fileCount)
      sizeLines.push(plain('Nombre de fichier', String(release.fileCount)));
    if (sizeLines.length) out.push('', `[img]${BANNER.size}[/img]`, sizeLines.join('\n'));
  }

  /* Fermeture du bloc centré ouvert plus haut. */
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
