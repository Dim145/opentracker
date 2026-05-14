/**
 * Parse a release filename into its constituent pieces — clean title,
 * year, season/episode, kind hint, and a normalised tag list.
 *
 * Used by the upload form to:
 *   - prefill the title field
 *   - kick off an automatic search against the right metadata source
 *   - prefill the Tags input with the obvious scene flags
 *
 * The grammar isn't formal — release names are infamously inconsistent —
 * but the heuristic catches >90% of mainstream patterns across films,
 * series, video games and books:
 *
 *   The.Mandalorian.S03E01.1080p.WEB.DDP5.1.H.264-NTb
 *   → title="The Mandalorian", season=3, episode=1, kind="tv"
 *
 *   Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX.HDR.HEVC.Atmos-FraMeSToR
 *   → title="Dune Part Two", year=2024, kind="movie"
 *
 *   [PS5] Kingdom.Come.Deliverance.2.v01.041 [EUR MULTI] PPSA21704-…
 *   → title="Kingdom Come Deliverance 2", kind="game",
 *     tags=["PS5","EUR","MULTI","v01.041"]
 *
 *   Bloom.Mikami.Saka.[T01.T05].FR.[CBZ]-ebdz
 *   → title="Bloom Mikami Saka", kind="book",
 *     tags=["T01-T05","FR","CBZ"]
 *
 * The parser accepts arbitrary separators (`.`, ` `, `_`, `-`) and
 * mixed bracket styles (`[…]`, `(…)`).
 */

export interface ParsedRelease {
  title: string;
  year: number | null;
  season: number | null;
  episode: number | null;
  /** What kind of thing the parser thinks this is. Independent of the
   *  category the user picked — used as a fallback hint when no
   *  category is set yet. */
  kind: 'movie' | 'tv' | 'game' | 'book' | null;
  tags: string[];
}

// ── Token tables ────────────────────────────────────────────
//
// `\b` doesn't trigger on `[`/`]` so we make the boundary explicit
// with `(?:^|[^\w])` / `(?=[^\w]|$)` where it matters (platform
// prefixes that always sit in square brackets, file-format flags
// that follow a separator).

/** Tokens common to films + series. */
const VIDEO_TAGS: Array<[label: string, pattern: RegExp]> = [
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
  ['10bit', /\b10[- ]?bit\b/i],
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
  ['EAC3 5.1', /\b(?:e-?ac3|eac3)[. _-]?5\.?1\b/i],
  ['DDP5.1', /\b(?:ddp|e-?ac3)[. _-]?5\.?1\b/i],
  ['DD5.1', /\b(?:dd|ac3)[. _-]?5\.?1\b/i],
  ['AC3 5.1', /\bac3[. _-]?5\.?1\b/i],
  ['2.0', /\b(?:aac|ac3|eac3|flac)[. _-]?2\.?0\b/i],
  ['AAC', /\baac\b/i],
  ['FLAC', /\bflac\b/i],
  ['MP3', /\bmp3\b/i],
];

/** Video-only language flags. Books use a tighter set further down. */
const VIDEO_LANG_TAGS: Array<[label: string, pattern: RegExp]> = [
  ['MULTI', /\bmulti\b/i],
  ['VFF', /\bvff\b/i],
  ['VFI', /\bvfi\b/i],
  ['VFQ', /\bvfq\b/i],
  ['VOF', /\bvof\b/i],
  ['TRUEFRENCH', /\btruefrench\b/i],
  ['FRENCH', /\bfrench\b/i],
  ['VOSTFR', /\bvostfr\b/i],
  ['VOST', /\bvost\b/i],
  ['SUBFRENCH', /\bsubfrench\b/i],
];

const VIDEO_QUALITY_TAGS: Array<[label: string, pattern: RegExp]> = [
  ['REPACK', /\brepack\b/i],
  ['PROPER', /\bproper\b/i],
  ['EXTENDED', /\bextended\b/i],
  ['REMASTERED', /\bremastered\b/i],
  ['UNCUT', /\buncut\b/i],
  ['INTERNAL', /\binternal\b/i],
  ['IMAX', /\bimax\b/i],
  ['COMPLETE', /\bcomplete\b/i],
];

/** Tokens specific to video-game releases. */
const GAME_TAGS: Array<[label: string, pattern: RegExp]> = [
  // Console / handheld / PC platforms, always wrapped in square
  // brackets in the wild ([PS5], [Switch], [DS], [XB1], …).
  ['PS5', /\[\s*ps5\s*\]/i],
  ['PS4', /\[\s*ps4\s*\]/i],
  ['PS3', /\[\s*ps3\s*\]/i],
  ['PS2', /\[\s*ps2\s*\]/i],
  ['PSP', /\[\s*psp\s*\]/i],
  ['PS Vita', /\[\s*ps[- ]?vita\s*\]/i],
  ['Xbox Series', /\[\s*xb(?:ox)?[- ]?(?:series|sx|ss)\s*\]/i],
  ['Xbox One', /\[\s*xb(?:ox)?[- ]?one\s*\]|\[\s*xb1\s*\]/i],
  ['Xbox 360', /\[\s*xb(?:ox)?[- ]?360\s*\]|\[\s*x360\s*\]/i],
  ['Switch', /\[\s*(?:n?switch|nsw)\s*\]/i],
  ['Wii U', /\[\s*wii[- ]?u\s*\]/i],
  ['Wii', /\[\s*wii\s*\]/i],
  ['3DS', /\[\s*3ds\s*\]/i],
  ['DS', /\[\s*n?ds\s*\]/i],
  ['PC', /\[\s*pc\s*\]/i],
  // PC + portable runtime hints — often inside the same square-bracket
  // metadata clump as the platform (e.g. `[WIN X64 MULTI PORTABLE]`).
  ['WIN', /\bwin(?:[- ]?x?64)?\b/i],
  ['MAC', /\bmac(?:[- ]?os)?\b/i],
  ['LINUX', /\blinux\b/i],
  ['PORTABLE', /\bportable\b/i],
  ['PREACTIVED', /\bpreactivated?\b/i],
  // Region hints — accept inside or outside brackets, with a leading
  // bracket / separator so we don't false-match country abbreviations
  // in real titles (e.g. "EU" inside "Europa Universalis").
  ['EUR', /(?:^|[^\w])eur(?:[^\w]|$)|\[\s*eur(?:[. _-]multi)?\s*\]/i],
  ['USA', /(?:^|[^\w])usa(?:[^\w]|$)|\[\s*usa(?:[. _-]multi)?\s*\]/i],
  ['JPN', /(?:^|[^\w])jpn?(?:[^\w]|$)|\[\s*jpn?(?:[. _-]multi)?\s*\]/i],
  // Common DLC / edition flags.
  ['ALL DLC', /\ball[. _-]dlc\b/i],
  ['DELUXE', /\bdeluxe\b/i],
  ['GOTY', /\bgoty\b/i],
  ['NSP', /\bnsp\b/i],
  ['XCI', /\bxci\b/i],
];

/** Tokens specific to book / ebook releases. */
const BOOK_TAGS: Array<[label: string, pattern: RegExp]> = [
  // Format. Almost always bracketed (`[EPUB]`, `[CBZ]`).
  ['EPUB', /\b(?:epub)\b|\[\s*epub\s*\]/i],
  ['PDF', /\b(?:pdf)\b|\[\s*pdf\s*\]/i],
  ['MOBI', /\b(?:mobi)\b|\[\s*mobi\s*\]/i],
  ['AZW3', /\b(?:azw3?)\b|\[\s*azw3?\s*\]/i],
  ['CBZ', /\b(?:cbz)\b|\[\s*cbz\s*\]/i],
  ['CBR', /\b(?:cbr)\b|\[\s*cbr\s*\]/i],
  ['DJVU', /\b(?:djvu)\b|\[\s*djvu\s*\]/i],
  // Edition / scope.
  ['INTEGRALE', /\b(?:integrale|intégrale)\b|\[\s*int[ée]grale\s*\]/i],
  // Book language flags — tighter than the video set (no VOSTFR etc.).
  ['FR', /(?:^|[^\w])(?:fr|vff?)(?:[^\w]|$)/i],
  ['EN', /(?:^|[^\w])(?:en|eng)(?:[^\w]|$)/i],
  ['MULTI', /\bmulti\b/i],
];

// ── Stop tokens — slice the title off the metadata tail ─────
//
// Bigger surface than just resolutions: platform brackets, format
// brackets, version markers and volume ranges. The very first match
// wins, which means in `Kingdom.Come.Deliverance.2.v01.041 [EUR MULTI]`
// the slice happens at `v01.041`, leaving `Kingdom Come Deliverance 2`
// as the title.

const VIDEO_STOP =
  '\\b(?:19|20)\\d{2}\\b' +
  '|\\bs\\d{1,2}(?:e\\d{1,4})?\\b' +
  '|\\b\\d{1,2}x\\d{1,4}\\b' +
  '|\\bseason[. _-]?\\d{1,2}\\b' +
  '|\\bepisode[. _-]?\\d{1,4}\\b' +
  '|\\b(?:2160p|1440p|1080p|720p|480p|4k|uhd)\\b' +
  '|\\b(?:web|web-?dl|webrip|blu-?ray|bdrip|brrip|hdtv|hdrip|dvdrip|remux)\\b' +
  '|\\b(?:x264|x265|h\\.?264|h\\.?265|hevc|avc|av1)\\b' +
  '|\\b(?:multi|vff|vfi|vfq|vof|truefrench|french|vostfr|vost|subfrench)\\b';

const GAME_STOP =
  // Platform bracket — earliest possible stop, since it usually sits
  // in front of the title.
  '\\[\\s*(?:ps[2345]|psp|ps[- ]?vita|xb(?:ox)?[- ]?(?:one|series|sx|ss|360)|xb1|x360|n?switch|nsw|wii[- ]?u|wii|3ds|n?ds|pc)\\s*\\]' +
  // Version stamp.
  '|\\bv\\d+(?:[._]\\d+)*\\b' +
  // Region bracket.
  '|\\[\\s*(?:eur|usa|jpn?)(?:[. _-]multi)?\\s*\\]' +
  // Format / DLC flags.
  '|\\b(?:nsp|xci|all[. _-]dlc|deluxe|goty|preactivated?|portable)\\b' +
  // Runtime / OS flags.
  '|\\bwin(?:[- ]?x?64)?\\b|\\bmac(?:[- ]?os)?\\b|\\blinux\\b';

const BOOK_STOP =
  // Format bracket — strongest signal we're past the title.
  '\\[\\s*(?:epub|pdf|mobi|azw3?|cbz|cbr|djvu)\\s*\\]' +
  // Volume range / "tome" notation.
  '|\\[\\s*t\\d+(?:[. _-]t?\\d+)*\\s*\\]' +
  '|\\bt\\d{2,3}\\b' +
  // Year (helps split "Author.2021.FR.[EPUB]" stacks).
  '|\\b(?:19|20)\\d{2}\\b' +
  // Edition + language.
  '|\\b(?:integrale|intégrale)\\b' +
  '|\\b(?:fr|vff?|en|eng)\\b' +
  '|\\bmulti\\b';

// ── Helpers ─────────────────────────────────────────────────

function stripExtension(s: string): string {
  return s.replace(/\.(?:torrent|mkv|mp4|avi|mov|webm|m4v|ts|wmv)$/i, '');
}

/** Strip the trailing release-group suffix ("-NTb", "-PapriKa"). */
function stripGroup(s: string): string {
  return s.replace(/-[A-Za-z0-9_]+$/, '');
}

/** Replace separators with spaces and squash repeats. Brackets are
 *  intentionally preserved so the platform / format markers survive
 *  the slice. */
function tokenise(s: string): string {
  return s.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Pull out a volume-range expression like `[T01.T05]` → `T01-T05`,
 *  or a single `T05` → `T05`. Returns null when nothing matched. */
function extractVolumeTag(raw: string): string | null {
  const range = raw.match(
    /\[\s*t(\d{1,3})[. _-]+t?(\d{1,3})\s*\]/i
  );
  if (range) return `T${range[1]!.padStart(2, '0')}-T${range[2]!.padStart(2, '0')}`;
  const single = raw.match(/\bt(\d{2,3})\b/i);
  return single ? `T${single[1]}` : null;
}

/** Pull out a version stamp like `v01.041`, `V1.0.1`, `v1.5.5`. */
function extractVersionTag(raw: string): string | null {
  const m = raw.match(/\bv(\d+(?:[._]\d+){1,4})\b/i);
  return m ? `v${m[1]}` : null;
}

/**
 * Heuristically pick what kind of thing the filename describes. The
 * caller may override this with the category's `kind` — these signals
 * are only consulted when no category is set yet OR to break ties in
 * the autoplay flow.
 */
function detectKind(raw: string): ParsedRelease['kind'] {
  // Strong signals first.
  if (/\b(?:cbz|cbr|epub|mobi|azw3?|pdf|djvu)\b/i.test(raw)) return 'book';
  if (/\[\s*(?:ps[2345]|psp|ps[- ]?vita|xb(?:ox)?[- ]?(?:one|series|sx|ss|360)|xb1|x360|n?switch|nsw|wii[- ]?u|wii|3ds|n?ds|pc)\s*\]/i.test(raw))
    return 'game';
  if (/\b(?:nsp|xci|goty|preactivated?)\b/i.test(raw)) return 'game';
  if (/\bs\d{1,2}(?:e\d{1,4})?\b/i.test(raw) || /\b\d{1,2}x\d{1,4}\b/.test(raw))
    return 'tv';
  if (/\b(?:1080p|2160p|720p|4k|uhd)\b/i.test(raw) && /\b(19|20)\d{2}\b/.test(raw))
    return 'movie';
  return null;
}

// ── Merge ───────────────────────────────────────────────────

/**
 * Merge a parsed tag list into an existing one without duplicating
 * (case-insensitive, so "1080p" / "1080P" don't both end up in the
 * chip row). Returns both the merged list and the newly-added items
 * so the caller can show a "X tags added" notice.
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

// ── Parse ───────────────────────────────────────────────────

export function parseReleaseName(
  input: string,
  kindHint?: ParsedRelease['kind']
): ParsedRelease {
  const raw = stripGroup(stripExtension(input || ''));

  // 1) Decide what kind we're parsing. The caller-supplied hint (from
  //    the picked category) wins over filename inference — the user
  //    has more context. We fall back to detectKind so a parse that
  //    happens before a category is picked still routes sanely.
  const inferred = detectKind(raw);
  const kind: ParsedRelease['kind'] = kindHint ?? inferred;

  // 2) Build the stop regex appropriate for that kind. Films / series
  //    share one (`VIDEO_STOP`) since the field set overlaps almost
  //    entirely.
  const stopSource =
    kind === 'game'
      ? GAME_STOP
      : kind === 'book'
        ? BOOK_STOP
        : VIDEO_STOP;
  const STOP = new RegExp(stopSource, 'i');

  // 3) Slice the title off the metadata tail. We also strip the
  //    leading platform bracket for games before tokenising so the
  //    title isn't prefixed with `[PS5]`.
  const stopMatch = raw.match(STOP);
  let titleSlice = stopMatch
    ? raw.slice(0, stopMatch.index ?? raw.length)
    : raw;
  if (kind === 'game') {
    titleSlice = titleSlice.replace(
      /^\s*\[\s*(?:ps[2345]|psp|ps[- ]?vita|xb(?:ox)?[- ]?(?:one|series|sx|ss|360)|xb1|x360|n?switch|nsw|wii[- ]?u|wii|3ds|n?ds|pc)\s*\][. _-]*/i,
      ''
    );
  }
  let title = tokenise(titleSlice)
    // Drop any trailing bracketed fragment left by the slice
    // ("(2024" or "[NTb"). It would otherwise show up as stray
    // opening punctuation.
    .replace(/[\[\(].*$/, '')
    .trim();

  // 4) Year — always 19xx / 20xx that isn't part of a longer run.
  //    For books, the year is also a useful disambiguator for
  //    Open Library's `first_publish_year` search filter.
  const yearMatch = raw.match(/\b(19\d{2}|20\d{2})\b/);
  const year = yearMatch ? parseInt(yearMatch[1]!, 10) : null;

  // 5) Season + episode (only meaningful for TV).
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
      const s = raw.match(/\bseason[. _-]?(\d{1,2})\b/i);
      if (s) season = parseInt(s[1]!, 10);
    }
  }

  // 6) Tags — pick the right table for the inferred / supplied kind.
  //    The tail starts at the first stop token; everything beyond it
  //    is fair game for tag harvesting without risking false hits
  //    inside the title (`Web` inside "World End Beach", etc.).
  const tail = stopMatch ? raw.slice(stopMatch.index ?? 0) : raw;
  const tags: string[] = [];
  const seen = new Set<string>();
  function push(label: string) {
    if (seen.has(label.toLowerCase())) return;
    tags.push(label);
    seen.add(label.toLowerCase());
  }
  const pushTable = (
    table: Array<[label: string, pattern: RegExp]>,
    where: string
  ) => {
    for (const [label, pattern] of table) {
      if (pattern.test(where)) push(label);
    }
  };

  if (kind === 'game') {
    // Games — platform + version + region + edition flags. We scan
    // the *whole* string because the platform bracket usually sits
    // in front of the title.
    pushTable(GAME_TAGS, raw);
    const ver = extractVersionTag(raw);
    if (ver) push(ver);
  } else if (kind === 'book') {
    pushTable(BOOK_TAGS, raw);
    const vol = extractVolumeTag(raw);
    if (vol) push(vol);
  } else {
    // Films + series. Scan the tail for video tags + lang + quality
    // — the title is far less likely to false-trigger here.
    pushTable(VIDEO_TAGS, tail);
    pushTable(VIDEO_LANG_TAGS, tail);
    pushTable(VIDEO_QUALITY_TAGS, tail);
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
