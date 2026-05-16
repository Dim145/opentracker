/**
 * Release-name / NFO tag inference.
 *
 * Trackarr stores torrent tags as free-form labels (resolution,
 * codec, source, language, …). Uploaders rarely fill them by hand;
 * the same facets are baked into the scene filename
 * (`Movie.2024.1080p.BluRay.x265-RLSGRP`) and often re-declared in
 * the NFO body (`Qualité vidéo : 2160p`, `Codec vidéo : H.265`).
 *
 * This module extracts those facets without touching the DB, so it
 * stays pure and easy to test. The upload route handles the
 * `resolveTagsByName()` → `torrentTags` insert at the call site —
 * we just return the tag names.
 *
 * Design principles:
 *
 *   - **Faceted**: each "category" (resolution, source, video
 *     codec, audio codec, channels, language, HDR) carries at most
 *     one tag. Extras (REMUX, EXTENDED, REPACK, …) are a free list
 *     because a release can carry several at once.
 *   - **Title is authoritative**: when both the filename and the
 *     NFO declare a facet, the filename wins (it's the canonical
 *     scene name). NFO fills *only* the facets the filename was
 *     silent about — matching the user's "ajout de tags si pas
 *     parser par le titre" rule.
 *   - **Slug-normalising**: outputs canonical tag *names* that
 *     downstream `slugifyTag()` collapses to one slug per facet
 *     value (h.264 / h264 / x264 → "x264", h.265 / hevc / x265 →
 *     "hevc", etc.) so the same release pattern can't spawn
 *     duplicate tag rows depending on which spelling the
 *     uploader / NFO author used.
 */

export interface ReleaseFacets {
  /** Frame size: 480p / 720p / 1080p / 1440p / 2160p / 4K → '2160p'. */
  resolution?: string;
  /** BluRay / WEBRip / WEB-DL / HDTV / DVDRip / CAM …                */
  source?: string;
  /** Video codec — x264 / HEVC / AV1 / XviD …                        */
  videoCodec?: string;
  /** Audio codec — AAC / AC3 / DTS / FLAC / Opus …                   */
  audioCodec?: string;
  /** Channel layout — 2.0 / 5.1 / 7.1.                               */
  audioChannels?: string;
  /** Audio language tag — MULTI / VOSTFR / VFF / TRUEFRENCH / DUAL.  */
  language?: string;
  /** HDR / HDR10 / HDR10+ / Dolby Vision.                            */
  hdr?: string;
  /** Free list — REMUX, EXTENDED, UNRATED, IMAX, REPACK, PROPER.     */
  extras: string[];
}

const EMPTY: ReleaseFacets = { extras: [] };

/**
 * Match an alphanumeric token with word-style boundaries (anything
 * that isn't `[a-z0-9]` counts as a boundary). Lets us pick up
 * `.1080p.` inside a dot-separated scene name and also `2160p `
 * inside an NFO sentence.
 */
function token(pattern: string): RegExp {
  return new RegExp(`(?:^|[^a-z0-9])(?:${pattern})(?=[^a-z0-9]|$)`, 'i');
}

/** Tier of [regex pattern → canonical tag name] pairs for a facet.
 *  First match wins, so the list is ordered most-specific first. */
type FacetRules = ReadonlyArray<readonly [string, string]>;

const RESOLUTION_RULES: FacetRules = [
  ['2160p|4k|uhd', '2160p'],
  ['1440p|qhd', '1440p'],
  ['1080p|fhd', '1080p'],
  ['720p|hd', '720p'],
  ['576p', '576p'],
  ['480p|sd', '480p'],
];

const SOURCE_RULES: FacetRules = [
  // Order matters: "WEB-DL" must beat "WEB"; "BDRip" must beat "BD".
  ['bluray|blu-ray', 'BluRay'],
  ['uhd-?bdrip', 'BDRip'],
  ['bdrip', 'BDRip'],
  ['brrip', 'BRRip'],
  ['web-?dl', 'WEB-DL'],
  ['webrip', 'WEBRip'],
  ['hdtv', 'HDTV'],
  ['hdrip', 'HDRip'],
  ['dvdrip', 'DVDRip'],
  ['hd-?cam', 'HDCam'],
  ['cam-?rip', 'CAMRip'],
  ['telecine|tc', 'TeleCine'],
  ['telesync|ts', 'TeleSync'],
  ['screener|scr|dvdscr', 'Screener'],
  ['dvd', 'DVD'],
  ['web', 'WEB'],
];

const VIDEO_CODEC_RULES: FacetRules = [
  ['h\\.?265|hevc|x265', 'HEVC'],
  ['h\\.?264|avc|x264', 'x264'],
  ['av1', 'AV1'],
  ['vp9', 'VP9'],
  ['mpeg-?2', 'MPEG-2'],
  ['mpeg-?4', 'MPEG-4'],
  ['xvid', 'XviD'],
  ['divx', 'DivX'],
];

const AUDIO_CODEC_RULES: FacetRules = [
  // Atmos / TrueHD are subsumed under the broader "Atmos" tag if
  // present (they always pair with DD/DTS underneath); the bare
  // codec is reported in `audioCodec`, the Atmos flag in `extras`.
  ['atmos', 'Atmos'],            // → extras
  ['truehd', 'TrueHD'],
  ['eac-?3|ddp|dd\\+', 'EAC-3'],
  ['ac-?3|dd5', 'AC-3'],
  ['dts-?hd', 'DTS-HD'],
  ['dts-?x', 'DTS-X'],
  ['dts', 'DTS'],
  ['flac', 'FLAC'],
  ['opus', 'Opus'],
  ['aac', 'AAC'],
  ['mp3', 'MP3'],
];

const HDR_RULES: FacetRules = [
  ['dolby[\\s\\-]?vision|dovi|\\bdv\\b', 'Dolby Vision'],
  ['hdr10\\+', 'HDR10+'],
  ['hdr10', 'HDR10'],
  ['hdr', 'HDR'],
];

const LANGUAGE_RULES: FacetRules = [
  // Multi-language indicators take precedence over single-language
  // ones because a "MULTI VOSTFR" release is conventionally tagged
  // MULTI (the VOSTFR is an extra subtitle pack, not the primary).
  ['multi', 'MULTI'],
  ['truefrench|vff', 'TRUEFRENCH'],
  ['vfq', 'VFQ'],
  ['vostfr', 'VOSTFR'],
  ['vfi', 'VFI'],
  ['\\bvf\\b', 'VF'],
  ['\\bvo\\b', 'VO'],
  ['dual', 'DUAL'],
  ['french', 'FRENCH'],
];

const CHANNELS_RULES: FacetRules = [
  ['7\\.1', '7.1'],
  ['5\\.1', '5.1'],
  ['2\\.0|stereo', '2.0'],
];

const EXTRA_RULES: FacetRules = [
  ['remux', 'REMUX'],
  ['imax', 'IMAX'],
  ['unrated', 'UNRATED'],
  ['uncut', 'UNCUT'],
  ['extended', 'EXTENDED'],
  ['director[s\']?[ -]?cut|dc', "Director's Cut"],
  ['repack', 'REPACK'],
  ['proper', 'PROPER'],
  ['internal', 'INTERNAL'],
  ['atmos', 'Atmos'],
];

/** Pick the first rule whose pattern matches. Returns the canonical
 *  tag name (the second slot of the tuple) or undefined. */
function pickFirst(rules: FacetRules, haystack: string): string | undefined {
  for (const [pattern, label] of rules) {
    if (token(pattern).test(haystack)) return label;
  }
  return undefined;
}

/** Collect every rule whose pattern matches — used for the "extras"
 *  bucket where multiple tags can co-exist on a single release. */
function pickAll(rules: FacetRules, haystack: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const [pattern, label] of rules) {
    if (seen.has(label)) continue;
    if (token(pattern).test(haystack)) {
      out.push(label);
      seen.add(label);
    }
  }
  return out;
}

function detectFacets(input: string): ReleaseFacets {
  if (!input) return { extras: [] };
  return {
    resolution: pickFirst(RESOLUTION_RULES, input),
    source: pickFirst(SOURCE_RULES, input),
    videoCodec: pickFirst(VIDEO_CODEC_RULES, input),
    audioCodec: pickFirst(AUDIO_CODEC_RULES, input),
    audioChannels: pickFirst(CHANNELS_RULES, input),
    language: pickFirst(LANGUAGE_RULES, input),
    hdr: pickFirst(HDR_RULES, input),
    extras: pickAll(EXTRA_RULES, input),
  };
}

/** Parse facets directly from a torrent filename / release name.
 *  Dot-separated scene names work as-is thanks to the word-style
 *  token boundaries; UI-edited names with spaces work too. */
export function facetsFromTitle(name: string | null | undefined): ReleaseFacets {
  if (!name) return { extras: [] };
  return detectFacets(name);
}

/** Parse facets from a description / NFO blob. Strips BBCode tags
 *  and HTML tags first so labels like `[b]Codec vidéo :[/b] [i]H.265[/i]`
 *  resolve to a clean `Codec vidéo : H.265` before the token scan
 *  runs. */
export function facetsFromNfo(nfo: string | null | undefined): ReleaseFacets {
  if (!nfo) return { extras: [] };
  const plain = nfo
    .replace(/\[[^\]]{0,128}\]/g, ' ') // strip BBCode tags
    .replace(/<[^>]{0,256}>/g, ' ')    // strip any HTML tags
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ');
  return detectFacets(plain);
}

/** Merge two facet sets: `primary` wins on conflict, `secondary`
 *  fills only the facets `primary` was silent about. Extras are
 *  union'd (deduped) because they're additive, not exclusive. */
export function mergeFacets(
  primary: ReleaseFacets,
  secondary: ReleaseFacets,
): ReleaseFacets {
  return {
    resolution: primary.resolution ?? secondary.resolution,
    source: primary.source ?? secondary.source,
    videoCodec: primary.videoCodec ?? secondary.videoCodec,
    audioCodec: primary.audioCodec ?? secondary.audioCodec,
    audioChannels: primary.audioChannels ?? secondary.audioChannels,
    language: primary.language ?? secondary.language,
    hdr: primary.hdr ?? secondary.hdr,
    extras: Array.from(new Set([...primary.extras, ...secondary.extras])),
  };
}

/** Flatten a facet object to the tag-name list the upload route
 *  feeds into `resolveTagsByName()`. Blank fields drop out. */
export function facetsToTagNames(f: ReleaseFacets): string[] {
  return [
    f.resolution,
    f.source,
    f.videoCodec,
    f.audioCodec,
    f.audioChannels,
    f.language,
    f.hdr,
    ...f.extras,
  ].filter((v): v is string => !!v && v.length > 0);
}

/** Top-level helper: given a release name and (optional) NFO, return
 *  the canonical tag names that should be auto-attached to the
 *  torrent. Equivalent to `facetsToTagNames(mergeFacets(title, nfo))`
 *  — exported as a one-shot for the upload route's caller. */
export function inferReleaseTags(
  name: string | null | undefined,
  nfo: string | null | undefined,
): string[] {
  const fromTitle = facetsFromTitle(name);
  const fromNfo = facetsFromNfo(nfo);
  return facetsToTagNames(mergeFacets(fromTitle, fromNfo));
}

export const _EMPTY_FACETS: ReleaseFacets = EMPTY;
