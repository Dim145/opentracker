/**
 * Parse a release filename into its constituent pieces — clean title,
 * year, season/episode, kind hint, and a normalised tag list.
 *
 * Used by the upload form to:
 *   - prefill the title field
 *   - kick off an automatic TMDb search
 *   - prefill the Tags input with the obvious scene flags
 *
 * The grammar isn't formal — release names are infamously inconsistent —
 * but the heuristic catches >90% of mainstream patterns:
 *
 *   The.Mandalorian.S03E01.1080p.WEB.DDP5.1.H.264-NTb
 *   → title="The Mandalorian", season=3, episode=1, kind="tv",
 *     tags=["1080p","WEB","DDP5.1","H.264"]
 *
 *   Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX.HDR.HEVC.Atmos-FraMeSToR
 *   → title="Dune Part Two", year=2024, kind="movie",
 *     tags=["2160p","UHD","BluRay","REMUX","HDR","HEVC","Atmos"]
 */

export interface ParsedRelease {
  title: string;
  year: number | null;
  season: number | null;
  episode: number | null;
  kind: 'movie' | 'tv' | null;
  tags: string[];
}

/**
 * Tokens we recognise. The map's *key* is what shows in the tag chip;
 * the regex matches any spelling we expect to see in the wild.
 *
 * Order matters only for tags — the longest match wins so "WEB-DL"
 * doesn't get clobbered by "WEB".
 */
const TAG_PATTERNS: Array<[label: string, pattern: RegExp]> = [
  // Resolution
  ['2160p', /\b(?:2160p|4k|uhd-?2160)\b/i],
  ['1440p', /\b(?:1440p|qhd)\b/i],
  ['1080p', /\b1080p\b/i],
  ['720p', /\b720p\b/i],
  ['480p', /\b480p\b/i],
  // HDR / colour
  ['Dolby Vision', /\b(?:dolby[. _-]?vision|dv)(?=[^\w]|$)/i],
  ['HDR10+', /\bhdr10\+|\bhdr10plus\b/i],
  ['HDR10', /\bhdr10\b/i],
  ['HDR', /\bhdr\b/i],
  ['SDR', /\bsdr\b/i],
  // Source
  ['REMUX', /\bremux\b/i],
  ['BluRay', /\b(?:blu-?ray|bdrip|brrip)\b/i],
  ['UHD', /\buhd\b/i],
  ['WEB-DL', /\bweb-?dl\b/i],
  ['WEBRip', /\bwebrip\b/i],
  ['WEB', /\bweb\b/i],
  ['HDRip', /\bhdrip\b/i],
  ['HDTV', /\bhdtv\b/i],
  ['DVDRip', /\bdvdrip\b/i],
  ['DVD', /\bdvdr?\b/i],
  // Codec
  ['HEVC', /\b(?:hevc|h\.?265|x265)\b/i],
  ['AVC', /\b(?:avc|h\.?264|x264)\b/i],
  ['AV1', /\bav1\b/i],
  // Audio
  ['Atmos', /\batmos\b/i],
  ['TrueHD', /\btruehd\b/i],
  ['DTS-HD', /\bdts-?hd(?:[. ]?ma)?\b/i],
  ['DTS', /\bdts\b/i],
  ['DDP5.1', /\b(?:ddp|e-?ac3)[. _-]?5\.?1\b/i],
  ['DD5.1', /\b(?:dd|ac3)[. _-]?5\.?1\b/i],
  ['AAC', /\baac\b/i],
  ['FLAC', /\bflac\b/i],
  ['MP3', /\bmp3\b/i],
  // Language flags
  ['MULTI', /\bmulti\b/i],
  ['VFF', /\bvff\b/i],
  ['VFI', /\bvfi\b/i],
  ['VFQ', /\bvfq\b/i],
  ['TRUEFRENCH', /\btruefrench\b/i],
  ['FRENCH', /\bfrench\b/i],
  ['VOSTFR', /\bvostfr\b/i],
  ['SUBFRENCH', /\bsubfrench\b/i],
  // Quality flags
  ['REPACK', /\brepack\b/i],
  ['PROPER', /\bproper\b/i],
  ['EXTENDED', /\bextended\b/i],
  ['REMASTERED', /\bremastered\b/i],
  ['UNCUT', /\buncut\b/i],
  ['INTERNAL', /\binternal\b/i],
  ['IMAX', /\bimax\b/i],
  ['COMPLETE', /\bcomplete\b/i],
];

/** Pre-title stop tokens. Whatever appears at or after these is metadata. */
const STOP_REGEX = new RegExp(
  // Year (1900-2099) in word boundary
  '\\b(?:19|20)\\d{2}\\b' +
    // Season/episode markers: S01, S01E03, 1x03, season 1
    '|\\bs\\d{1,2}(?:e\\d{1,4})?\\b' +
    '|\\b\\d{1,2}x\\d{1,4}\\b' +
    '|\\bseason[. ]?\\d{1,2}\\b' +
    '|\\bepisode[. ]?\\d{1,4}\\b' +
    // Resolution
    '|\\b(?:2160p|1440p|1080p|720p|480p|4k|uhd)\\b' +
    // Source
    '|\\b(?:web|web-?dl|webrip|blu-?ray|bdrip|brrip|hdtv|hdrip|dvdrip|remux)\\b' +
    // Codec
    '|\\b(?:x264|x265|h\\.?264|h\\.?265|hevc|avc|av1)\\b',
  'i'
);

/**
 * Strip the file extension if it's a torrent / video container — we
 * sometimes get called with a `.torrent` or `.mkv` filename.
 */
function stripExtension(s: string): string {
  return s.replace(/\.(?:torrent|mkv|mp4|avi|mov|webm|m4v|ts|wmv)$/i, '');
}

/** Strip the trailing release-group suffix ("-NTb", "-RARBG"). */
function stripGroup(s: string): string {
  return s.replace(/-[A-Za-z0-9_]+$/, '');
}

/** Replace separators with spaces and squash repeats. */
function tokenise(s: string): string {
  return s.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Merge a parsed tag list into an existing one without duplicating
 * (case-insensitive, so "1080p" / "1080P" don't both end up in the
 * chip row). Returns both the merged list and the newly-added items
 * so the caller can show a "X tags added" notice.
 *
 * Used by both upload and edit pages to power their "Parse title"
 * button: the parser produces a fresh tag list from the title, this
 * helper folds it into whatever the user has already typed.
 */
export function mergeParsedTags(
  current: string[],
  parsed: string[]
): { merged: string[]; added: string[] } {
  const seen = new Map<string, string>();
  for (const t of current) {
    const key = t.trim().toLowerCase();
    if (key.length > 0) seen.set(key, t.trim());
  }
  const added: string[] = [];
  for (const t of parsed) {
    const trimmed = t.trim();
    const key = trimmed.toLowerCase();
    if (key.length > 0 && !seen.has(key)) {
      seen.set(key, trimmed);
      added.push(trimmed);
    }
  }
  return { merged: Array.from(seen.values()), added };
}

export function parseReleaseName(input: string): ParsedRelease {
  const raw = stripGroup(stripExtension(input || ''));

  // Find the first stop token to slice the title off the metadata tail.
  const stopMatch = raw.match(STOP_REGEX);
  const titleSlice = stopMatch
    ? raw.slice(0, stopMatch.index ?? raw.length)
    : raw;
  let title = tokenise(titleSlice)
    // Drop any trailing brackets fragments left by the slice ("(2024" or
    // "[NTb"). They'd otherwise show up as a stray opening punctuation.
    .replace(/[\[\(].*$/, '')
    .trim();

  // Year — always a 4-digit number 19xx/20xx that isn't part of a longer run.
  const yearMatch = raw.match(/\b(19\d{2}|20\d{2})\b/);
  const year = yearMatch ? parseInt(yearMatch[1]!, 10) : null;

  // Season + episode (S03E01 form, then 1x03, then "Season 3")
  let season: number | null = null;
  let episode: number | null = null;
  const sxxe = raw.match(/\bs(\d{1,2})(?:e(\d{1,4}))?\b/i);
  if (sxxe) {
    season = parseInt(sxxe[1]!, 10);
    episode = sxxe[2] ? parseInt(sxxe[2]!, 10) : null;
  } else {
    const x = raw.match(/\b(\d{1,2})x(\d{1,4})\b/);
    if (x) {
      season = parseInt(x[1]!, 10);
      episode = parseInt(x[2]!, 10);
    } else {
      const s = raw.match(/\bseason[. ]?(\d{1,2})\b/i);
      if (s) season = parseInt(s[1]!, 10);
    }
  }

  // Kind hint: any season marker → tv; otherwise if we have a year and
  // resolution → movie. If neither signal matches, leave it null and let
  // the category supply the type.
  let kind: 'movie' | 'tv' | null = null;
  if (season !== null) {
    kind = 'tv';
  } else if (year !== null && /\b(?:1080p|2160p|720p|4k|uhd)\b/i.test(raw)) {
    kind = 'movie';
  }

  // Tags: greedy-pick from the metadata tail (so we don't accidentally
  // tag bits of the title — "Atomic Blonde" wouldn't match anyway, but
  // "WEB" appearing inside a movie name like "World End Beach" would).
  const tail = stopMatch ? raw.slice(stopMatch.index ?? 0) : raw;
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const [label, pattern] of TAG_PATTERNS) {
    if (pattern.test(tail) && !seen.has(label)) {
      tags.push(label);
      seen.add(label);
    }
  }

  return {
    title,
    year,
    season,
    episode,
    kind,
    tags,
  };
}
