/**
 * Normalised release name and NFO, derived from the technical data.
 *
 * Two outputs distinct from the BBCode listing: the release name names the
 * torrent, the NFO documents it. Both are derived from what we already know —
 * the user re-types nothing — but stay editable, because no derivation is 100%
 * reliable.
 */
import type { TechnicalSheet } from './mediainfo';
import { prettyAudioFormat, renderMediaInfo, resolutionLabel } from './mediainfo';
import { languageLabel } from './ficheBbcode';

export interface ReleaseNameParts {
  title: string;
  year?: number | null;
  language?: string;
  resolution?: string;
  source?: string;
  audio?: string;
  video?: string;
  team?: string;
}

/**
 * The video codec in the short form a release name expects.
 *
 * The same distinction as on the listing: `x264` for a re-encode, `H264` for an
 * original stream. Ignoring the encoder produced an `H264` name on a release
 * plainly encoded with x264 — contradicting the codec announced just above in
 * the same listing.
 */
function shortVideoCodec(format?: string, encoder?: string): string | undefined {
  const f = (format ?? '').toLowerCase();
  const e = (encoder ?? '').toLowerCase();
  if (!f) return undefined;
  if (f.includes('hevc') || f.includes('h.265') || f.includes('x265')) {
    return e.includes('x265') ? 'x265' : 'H265';
  }
  if (f.includes('avc') || f.includes('h.264') || f.includes('x264')) {
    return e.includes('x264') ? 'x264' : 'H264';
  }
  if (f.includes('av1')) return 'AV1';
  if (f.includes('vp9')) return 'VP9';
  if (f.includes('mpeg-2')) return 'MPEG2';
  return undefined;
}

/**
 * The language in upper case: FRENCH, VOSTFR, MULTi…
 *
 * The French tracker convention describes not the audio track but what the user
 * will hear and read: an original version subtitled in French is announced
 * VOSTFR, not JAPANESE. Hence the cross-check against the subtitles.
 */
function releaseLanguage(sheet: TechnicalSheet): string | undefined {
  const langs = sheet.audio
    .map((t) => languageLabel(t.language).name)
    .filter((n) => n && n !== 'Inconnu');
  const unique = [...new Set(langs)];
  if (!unique.length) return undefined;
  if (unique.length > 1) return 'MULTi';

  const only = unique[0]!;
  if (only === 'Français') return 'FRENCH';
  const hasFrenchSubs = sheet.text.some((t) => languageLabel(t.language).name === 'Français');
  if (hasFrenchSubs) return 'VOSTFR';

  const map: Record<string, string> = {
    Anglais: 'ENGLISH',
    Japonais: 'JAPANESE',
    Espagnol: 'SPANISH',
    Allemand: 'GERMAN',
    Italien: 'ITALIAN',
  };
  return map[only] ?? only.toUpperCase();
}

/**
 * The release team, derived from the original filename.
 *
 * The team follows the first hyphen of the LAST segment of the release (the one
 * dots or spaces separate). Splitting on the last hyphen of the whole name
 * truncated compound names: "x264-Foo-Bar" returned only "Bar". Deliberately
 * cautious elsewhere — we refuse anything that looks like a technical fragment
 * rather than propose just anything.
 */
export function guessTeam(fileName?: string): string | undefined {
  const base = (fileName ?? '').replace(/\.[a-z0-9]{2,4}$/i, '').trim();
  const token = base.split(/[\s.]+/).filter(Boolean).pop();
  if (!token) return undefined;
  const m = /^[^-]+-([A-Za-z0-9][A-Za-z0-9._-]{1,29})$/.exec(token);
  if (!m) return undefined;
  const candidate = m[1]!.replace(/[.-]$/, '');
  if (/^(x?26[45]|h26[45]|aac|ac3|dts|web|dl|rip|hdtv|\d+p)$/i.test(candidate)) {
    return undefined;
  }
  return candidate;
}

/** Derives everything derivable; the gaps are left to be filled by hand. */
export function deriveReleaseParts(
  title: string,
  year: number | null | undefined,
  sheet: TechnicalSheet,
  source?: string,
): ReleaseNameParts {
  const video = sheet.video[0];
  const audio = sheet.audio[0];
  return {
    title,
    year: year ?? null,
    language: releaseLanguage(sheet),
    resolution: resolutionLabel(video?.width, video?.height),
    source: source || undefined,
    audio: audio ? prettyAudioFormat(audio.format, audio.profile).replace(/[\s-]/g, '') : undefined,
    video: shortVideoCodec(video?.format, video?.encoder),
    team: guessTeam(sheet.fileName),
  };
}

/**
 * `Title.Year.LANGUAGE.Resolution.Source.Audio.Video-TEAM`
 *
 * Absent segments are simply omitted: an incomplete name is still usable, where
 * one riddled with "undefined" is not.
 */
export function formatReleaseName(
  parts: ReleaseNameParts,
  useSpaces = false,
): string {
  const sep = useSpaces ? ' ' : '.';
  const title = parts.title.trim().replace(/[\s._]+/g, sep);
  const segments = [
    title,
    parts.year ? String(parts.year) : '',
    parts.language,
    parts.resolution,
    parts.source,
    parts.audio,
    parts.video,
  ]
    .map((s) => (s ?? '').trim())
    .filter(Boolean);
  const base = segments.join(sep);
  return parts.team ? `${base}-${parts.team}` : base;
}

/**
 * The text NFO: the release name, then the model's MediaInfo block.
 *
 * The block is always rendered from `TechnicalSheet`, never from the raw output
 * kept in `sheet.raw`: the model is the single source of truth, so a track
 * added or corrected on the technical step shows up in the NFO. That is also
 * what makes the round trip lossless, since `renderMediaInfo` writes exactly
 * the labels the parser reads back.
 */
export function buildNfo(releaseName: string, sheet: TechnicalSheet): string {
  const head = releaseName.trim();
  const body = renderMediaInfo(sheet);
  if (!body) return head ? `${head}\n` : '';
  return head ? `${head}\n\n${body}\n` : `${body}\n`;
}
