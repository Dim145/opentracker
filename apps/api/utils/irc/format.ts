/**
 * The announce line, and the regular expression that reads it back.
 *
 * ## Why IRC at all, in 2026
 *
 * Because autobrr and autodl-irssi speak it, and between them they are how
 * releases are actually raced. The mechanism is deliberately archaic — a bot
 * says one line per accepted upload, a client matches it against filters and
 * grabs — and that is exactly why it is universal. An RSS feed is polled; a
 * channel message arrives.
 *
 * ## The one design decision worth reading
 *
 * The line is a template the operator can change, and the parsing regex is
 * DERIVED FROM THAT TEMPLATE rather than written next to it.
 *
 * Every tracker that ships a hand-written definition alongside a configurable
 * format eventually ships two things that disagree, and the failure is silent:
 * the channel keeps announcing, the definition keeps not matching, and members
 * conclude the tracker is broken. Deriving one from the other makes that
 * impossible by construction — `/api/irc/autobrr.yml` regenerates from the
 * template in force, so an operator who reorders the fields gets a definition
 * that reads the new order.
 *
 * It also settles the versioning question the roadmap worried about. The format
 * is not frozen because it does not need to be: the template is stored in
 * settings, so changing the DEFAULT here never changes what a running instance
 * emits, and whatever it emits is what the generated definition parses.
 *
 * ## Every field is always present
 *
 * No optional segments: a torrent with no tags says `-`, an anonymous upload
 * says `anonymous`, a release with no freeleech says `FL 0%`. A fixed shape
 * costs a few characters and buys a regex with no optional groups — and an
 * optional group is how a parser silently attributes one field's value to
 * another when the middle one is missing.
 *
 * ## Names that mean something to autobrr
 *
 * The capture names are taken from autobrr's own `MapVars` — `releaseName`,
 * `category`, `torrentSize`, `freeleechPercent`, `tags`, `uploader`,
 * `torrentId` — so the values land in the fields its filters read. Two
 * omissions are deliberate:
 *
 * - The upload multiplier is printed for people and mapped to nothing, because
 *   autobrr has no field for it. Inventing a variable name would produce a
 *   definition that looks richer and behaves identically.
 * - The seeding requirement is not in the line. autobrr reads `minimumratio`
 *   and `minimumseedtime` from the Torznab feed, which this site now serves,
 *   and there is no IRC variable for either. A field no tool can consume is
 *   noise in a format that has to stay parseable for years.
 */

/** The format the derived regex and the docs both describe. Bump on a change. */
export const ANNOUNCE_FORMAT_VERSION = 1;

/**
 * What a token may hold, and what autobrr calls it.
 *
 * `pattern` is lazy on purpose. The literals between tokens anchor the match,
 * and a greedy group would eat the next separator whenever a value happened to
 * contain one — which is precisely the case `sanitiseValue` cannot fully rule
 * out for a release name.
 */
export interface AnnounceToken {
  /** autobrr's variable name, or null when nothing consumes it. */
  readonly variable: string | null;
  /** Regex body, without the named-group wrapper. */
  readonly pattern: string;
  /** One line, for the operator staring at the template field. */
  readonly describes: string;
}

export const ANNOUNCE_TOKENS: Readonly<Record<string, AnnounceToken>> = {
  name: {
    variable: 'releaseName',
    pattern: '.+?',
    describes: 'the release name',
  },
  category: {
    variable: 'category',
    pattern: '.+?',
    describes: 'the category, or `uncategorised`',
  },
  size: {
    variable: 'torrentSize',
    // A number and a unit. autobrr parses the unit itself, so the group has to
    // keep them together.
    pattern: '\\d+(?:\\.\\d+)?\\s*[KMGTP]?i?B',
    describes: 'the total size, e.g. `14.62 GiB`',
  },
  freeleechPercent: {
    variable: 'freeleechPercent',
    // 0% for a normal torrent, 100% for freeleech, and the values in between
    // that per-torrent download multipliers make possible.
    pattern: '\\d{1,3}%',
    describes: 'how much of the download is free, e.g. `100%`',
  },
  uploadFactor: {
    // Printed for people. autobrr has no field for it — see the note above.
    variable: null,
    pattern: '\\d+(?:\\.\\d+)?',
    describes: 'the upload multiplier, e.g. `2`',
  },
  tags: {
    variable: 'tags',
    pattern: '[^:]*?',
    describes: 'comma-separated tags, or `-`',
  },
  uploader: {
    variable: 'uploader',
    pattern: '\\S+',
    describes: 'the uploader, or `anonymous`',
  },
  url: {
    // Not `baseUrl`: this is the whole page address, and autobrr's `baseUrl`
    // means the site root that its own templates prepend.
    variable: null,
    pattern: '\\S+',
    describes: 'the link to the release page',
  },
  infoHash: {
    variable: 'torrentId',
    // `torrentId` rather than `torrentHash` because the URL templates in the
    // generated definition interpolate `{{ .torrentId }}`, and on this site the
    // id in a download URL IS the v1 infohash.
    pattern: '[a-f0-9]{40}',
    describes: 'the v1 infohash — what the download URL is keyed on',
  },
} as const;

export type AnnounceTokenName = keyof typeof ANNOUNCE_TOKENS;

/**
 * The default line.
 *
 * Shaped after the definitions autobrr already ships — a literal lead-in, then
 * ` :: ` separated fields — so somebody who has written an indexer definition
 * before recognises it, and `announcers` filtering on the first word works the
 * way it does elsewhere.
 */
export const DEFAULT_ANNOUNCE_TEMPLATE =
  'NEW [{category}] {name} :: {size} :: FL {freeleechPercent} :: UL x{uploadFactor} :: {tags} :: by {uploader} :: {url} :: {infoHash}';

export interface AnnounceFields {
  name: string;
  category: string;
  size: string;
  freeleechPercent: string;
  uploadFactor: string;
  tags: string;
  uploader: string;
  url: string;
  infoHash: string;
}

/** How long a rendered line may be before it is cut. */
const MAX_LINE_BYTES = 400;

/**
 * Make a value safe to put in an IRC message, and safe to parse back out.
 *
 * The first half is not cosmetic. IRC frames commands with CRLF, so a value
 * carrying `\r\n` does not corrupt the line — it ENDS it, and everything after
 * becomes a command the bot appears to have sent. A release name is
 * member-supplied text, which makes this the injection boundary of the whole
 * feature.
 *
 * The second half keeps the format readable: the separator is stripped from
 * values so a name containing ` :: ` cannot invent a field, and control
 * characters (including the colour codes IRC clients interpret) are dropped
 * rather than escaped, because nothing downstream has a use for them.
 */
export function sanitiseValue(raw: string): string {
  return (
    raw
      // CR, LF, NUL and the rest of C0, plus DEL: the frame delimiters and the
      // colour codes. Replaced with a space rather than removed, so two words
      // separated by one do not silently become a single word.
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s*::\s*/g, ' - ')
      .replace(/\s+/g, ' ')
      .trim() || '-'
  );
}

/** Bytes, the way IRC counts them. */
function byteLength(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

/**
 * Render one line.
 *
 * Truncation is by bytes and not by characters, because the 512-byte frame is a
 * byte limit and a release name is UTF-8. Cutting mid-sequence would emit a
 * replacement character to every client in the channel, so the cut walks back
 * to a whole character.
 */
export function renderAnnounce(
  template: string,
  fields: AnnounceFields
): string {
  const line = template.replace(/\{(\w+)\}/g, (whole, token: string) => {
    if (!(token in ANNOUNCE_TOKENS)) return whole;
    const value = fields[token as keyof AnnounceFields];
    return sanitiseValue(value == null ? '' : String(value));
  });

  if (byteLength(line) <= MAX_LINE_BYTES) return line;
  let cut = line;
  while (byteLength(cut) > MAX_LINE_BYTES - 1 && cut.length > 0) {
    cut = cut.slice(0, -1);
  }
  return `${cut}…`;
}

/** Which tokens a template uses, in order, ignoring anything unknown. */
export function templateTokens(template: string): AnnounceTokenName[] {
  const out: AnnounceTokenName[] = [];
  for (const m of template.matchAll(/\{(\w+)\}/g)) {
    const token = m[1]!;
    if (token in ANNOUNCE_TOKENS) out.push(token as AnnounceTokenName);
  }
  return out;
}

/** Regex metacharacters in the template's literal text. */
function escapeLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface AnnouncePattern {
  /** RE2-compatible pattern with named groups — Go's regexp, which is what
   *  autobrr compiles it with. */
  pattern: string;
  /** The autobrr variables it captures, in order. */
  variables: string[];
}

/**
 * Turn a template into the pattern that reads its output.
 *
 * A token used twice gets a named group once and a back-reference after, since
 * Go's regexp rejects a repeated group name — and a template that mentions the
 * infohash in both the URL and a field of its own is a reasonable thing for an
 * operator to write.
 */
export function announcePattern(template: string): AnnouncePattern {
  let pattern = '';
  const named = new Set<string>();
  const variables: string[] = [];
  let last = 0;

  for (const m of template.matchAll(/\{(\w+)\}/g)) {
    const token = m[1]!;
    const start = m.index!;
    pattern += escapeLiteral(template.slice(last, start));
    last = start + m[0].length;

    const def = ANNOUNCE_TOKENS[token];
    if (!def) {
      // An unknown token is emitted literally by the renderer, so it is matched
      // literally here. Anything else would make the pattern disagree with the
      // line for the one input an operator typo produces.
      pattern += escapeLiteral(m[0]);
      continue;
    }
    if (named.has(token)) {
      pattern += `(?P=${token})`;
      continue;
    }
    named.add(token);
    pattern += `(?P<${token}>${def.pattern})`;
    if (def.variable) variables.push(def.variable);
  }
  pattern += escapeLiteral(template.slice(last));
  return { pattern: `^${pattern}$`, variables };
}

/**
 * The same pattern as a JavaScript RegExp.
 *
 * Go writes named groups `(?P<x>…)` and JavaScript writes `(?<x>…)`; the two
 * differ in that one character and in nothing else that this pattern uses.
 * Converting rather than generating twice is what lets the test parse the real
 * shipped pattern instead of a lookalike.
 */
export function toJsRegExp(pattern: string): RegExp {
  return new RegExp(
    pattern.replace(/\(\?P</g, '(?<').replace(/\(\?P=(\w+)\)/g, '\\k<$1>')
  );
}

/**
 * The freeleech figure, from a download multiplier.
 *
 * `0` means the download is free, so it reads as 100%. Rounded to whole
 * percent: the token's pattern accepts three digits and no decimal point, and a
 * multiplier is a slider an operator set rather than a measurement.
 */
export function freeleechPercent(downloadMultiplier: number): string {
  const clamped = Math.min(1, Math.max(0, downloadMultiplier));
  return `${Math.round((1 - clamped) * 100)}%`;
}

/** `14.62 GiB` — binary units, the ones a torrent client shows. */
export function humanSize(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  // Whole bytes have no decimals; everything else gets two, which is what the
  // size pattern accepts and what every client renders.
  return unit === 0
    ? `${Math.round(value)} ${units[unit]}`
    : `${value.toFixed(2)} ${units[unit]}`;
}
