import { parseReleaseName } from '@trackarr/shared/releaseParse';

/**
 * Turn a release name into the handful of facts somebody chooses between.
 *
 * Inside a group every release is the same work, so the only question left is
 * "which of these do I take" — and that is answered by five or six tokens
 * buried in a sixty-character filename. Pulling them out into fixed slots lets
 * the eye go straight to the one it cares about: a member who only ever wants
 * 2160p looks at one column, never reads a name.
 *
 * Slots, not a list. Every row puts the resolution in the same place, in the
 * same colour, whether or not the neighbouring rows have an audio format. A
 * variable-length tag soup would put the resolution in a different position on
 * every line and undo the whole point.
 *
 * The parser is the same one the upload form uses to prefill tags, so what is
 * shown here is exactly what the uploader was offered — no second vocabulary
 * to keep in step.
 */
export interface ReleaseChips {
  /** `MULTI.VFF`, `VOSTFR`, `FRENCH` — joined when a release carries several. */
  language: string | null;
  resolution: string | null;
  /** `WEB-DL`, `BluRay`, `REMUX`… */
  source: string | null;
  /** `Atmos`, `DTS-HD`, `DDP5.1`… */
  audio: string | null;
  /** `HEVC`, `AVC`, `AV1`. */
  codec: string | null;
  /** `Dolby Vision`, `HDR10+`, `HDR`… */
  hdr: string | null;
  /** Console or runtime, for games. */
  platform: string | null;
  /** `EPUB`, `CBZ`, `PDF`… for books. */
  format: string | null;
  /** `PROPER`, `REPACK`, `EXTENDED`, `INTEGRALE`… whatever is left worth saying. */
  flags: string[];
}

// Each list is priority-ordered: the first tag present wins the slot. The
// order mirrors the parser's own token tables, which are already written
// strongest-first (`REMUX` before `BluRay`, `2160p` before `1080p`).
const LANGUAGES = [
  'MULTI', 'TRUEFRENCH', 'VFF', 'VFI', 'VFQ', 'VOF', 'FRENCH',
  'VOSTFR', 'VOST', 'SUBFRENCH', 'FR', 'EN',
];
const RESOLUTIONS = ['2160p', '1440p', '1080p', '720p', '480p'];
const SOURCES = [
  'REMUX', 'BluRay', 'UHD', 'WEB-DL', 'WEBRip', 'WEB',
  'HDRip', 'HDTV', 'DVDRip', 'DVD',
];
/*
 * Le FORMAT audio, et les canaux, séparément.
 *
 * `2.0` était dans la même liste, avant `AAC` : sur
 * `…WEB-DL.AAC.2.0.H.264…` le parseur sort bien `["2.0", "AAC"]`, mais le
 * premier trouvé prenait la place et le codec disparaissait. Mesuré sur le
 * catalogue : `AAC` survivait onze fois dans la rangée de tags parce qu'aucune
 * pastille ne le disait — c'était la seule information que les tags
 * apportaient vraiment.
 *
 * Les entrées composées (`DDP5.1`, `EAC3 5.1`) portent déjà les deux ; elles
 * restent dans la liste des formats et ne se voient rien ajouter.
 */
const AUDIO = [
  'Atmos', 'TrueHD', 'DTS-HD', 'DTS', 'EAC3 5.1', 'DDP5.1', 'DD5.1',
  'AC3 5.1', 'FLAC', 'AAC', 'MP3',
];
const AUDIO_CHANNELS = ['7.1', '5.1', '2.0'];
const CODECS = ['HEVC', 'AVC', 'AV1'];
const HDR = ['Dolby Vision', 'HDR10+', 'HDR10', 'HDR', '10bit', 'SDR'];
const PLATFORMS = [
  'PS5', 'PS4', 'PS3', 'PS2', 'PSP', 'PS Vita',
  'Xbox Series', 'Xbox One', 'Xbox 360',
  'Switch', 'Wii U', 'Wii', '3DS', 'DS', 'PC', 'WIN', 'MAC', 'LINUX',
];
const FORMATS = ['EPUB', 'PDF', 'MOBI', 'AZW3', 'CBZ', 'CBR', 'DJVU'];

/**
 * Flags worth a chip of their own. Everything else the parser found — regions,
 * version strings, volume ranges — is dropped rather than shown: a row that
 * ends in six grey pills is a row nobody reads.
 */
const FLAGS = [
  'PROPER', 'REPACK', 'EXTENDED', 'REMASTERED', 'UNCUT', 'IMAX',
  'INTEGRALE', 'COMPLETE', 'GOTY', 'DELUXE', 'ALL DLC', 'PORTABLE',
];

function pick(tags: Set<string>, order: string[]): string | null {
  for (const t of order) if (tags.has(t)) return t;
  return null;
}

/**
 * Le format et les canaux dans une seule fente — `AAC 2.0`.
 *
 * Une fente, pas deux : c'est une seule facette, l'audio, dite sur deux
 * dimensions. Le même parti que `language`, qui joint déjà `MULTI.VFF`.
 * Un format qui porte déjà ses canaux (`DDP5.1`) ne se voit rien ajouter, et
 * des canaux sans format se suffisent à eux-mêmes.
 */
function audioChip(tags: Set<string>): string | null {
  const format = pick(tags, AUDIO);
  const channels = pick(tags, AUDIO_CHANNELS);
  if (!format) return channels;
  if (!channels || /\d\.\d/.test(format)) return format;
  return `${format} ${channels}`;
}

export function releaseChips(name: string): ReleaseChips {
  let tags: string[] = [];
  try {
    tags = parseReleaseName(name).tags;
  } catch {
    // A name the parser chokes on still renders — as a row with no chips,
    // which is honest, rather than as a broken group.
  }
  const set = new Set(tags);

  // Languages combine: `MULTI.VFF` says something neither half says alone —
  // several audio tracks, one of which is the true French dub.
  const languages = LANGUAGES.filter((l) => set.has(l));

  return {
    language: languages.length ? languages.slice(0, 2).join('.') : null,
    resolution: pick(set, RESOLUTIONS),
    source: pick(set, SOURCES),
    audio: audioChip(set),
    codec: pick(set, CODECS),
    hdr: pick(set, HDR),
    platform: pick(set, PLATFORMS),
    format: pick(set, FORMATS),
    flags: FLAGS.filter((f) => set.has(f)),
  };
}

/**
 * The resolution tier, as a class suffix. Drives the coloured rule down the
 * left edge of a release row, which is what lets a member scan a season for
 * "is there a 4K here" without reading a single chip.
 */
export function resolutionTier(resolution: string | null): string {
  switch (resolution) {
    case '2160p':
      return 'uhd';
    case '1440p':
    case '1080p':
      return 'hd';
    case '720p':
      return 'sd';
    case '480p':
      return 'low';
    default:
      return 'none';
  }
}
