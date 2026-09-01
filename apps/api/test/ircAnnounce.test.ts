import { describe, it, expect } from 'vitest';
import {
  ANNOUNCE_TOKENS,
  DEFAULT_ANNOUNCE_TEMPLATE,
  announcePattern,
  freeleechPercent,
  humanSize,
  renderAnnounce,
  sanitiseValue,
  templateTokens,
  toJsRegExp,
  type AnnounceFields,
} from '../utils/irc/format';
import { SAMPLE_FIELDS, autobrrDefinition, slugifyId } from '../utils/irc/autobrr';

/**
 * The announce format, tested the only way that means anything: by parsing what
 * it emits with the pattern we hand to members.
 *
 * A tracker's announce format is a public contract with software nobody here
 * controls. The failure mode is not an exception — it is a channel that keeps
 * talking, an autobrr that keeps not matching, and members who conclude the
 * tracker is broken. So the round trip is the test, and it runs against the
 * REAL pattern from `announcePattern`, converted to JavaScript syntax rather
 * than rewritten in it.
 */

const parse = (template: string, line: string) =>
  toJsRegExp(announcePattern(template).pattern).exec(line)?.groups;

describe('the default format round-trips', () => {
  it('parses every field back out of a rendered line', () => {
    const line = renderAnnounce(DEFAULT_ANNOUNCE_TEMPLATE, SAMPLE_FIELDS);
    const groups = parse(DEFAULT_ANNOUNCE_TEMPLATE, line);
    expect(groups).toBeDefined();
    expect(groups).toMatchObject({
      category: 'Movies',
      name: 'Example.Release.2026.1080p.BluRay.x264-GROUP',
      size: '14.62 GiB',
      freeleechPercent: '100%',
      uploadFactor: '2',
      tags: '1080p, bluray, x264',
      uploader: 'example',
      infoHash: '0123456789abcdef0123456789abcdef01234567',
    });
  });

  it('survives the values that break naive patterns', () => {
    const awkward: AnnounceFields = {
      ...SAMPLE_FIELDS,
      // Brackets, colons, a dash run, unicode, and a name long enough to worry
      // about — all of which appear in real release names.
      name: 'Some.Show.S01E01.[HDR10+].Ünïcødé.-.MULTi.VFF.2160p.x265-Grp',
      category: 'TV/UHD',
      tags: 'hdr10+, x265, multi',
      uploader: 'user|autodl',
    };
    const line = renderAnnounce(DEFAULT_ANNOUNCE_TEMPLATE, awkward);
    const groups = parse(DEFAULT_ANNOUNCE_TEMPLATE, line);
    expect(groups?.name).toBe(awkward.name);
    expect(groups?.category).toBe('TV/UHD');
    expect(groups?.uploader).toBe('user|autodl');
    expect(groups?.tags).toBe('hdr10+, x265, multi');
  });

  it('parses a release with nothing on it', () => {
    // The empty case is a real one — an uncategorised, untagged, anonymous
    // upload with no buff — and it is where an optional group would go wrong.
    const bare: AnnounceFields = {
      ...SAMPLE_FIELDS,
      category: 'uncategorised',
      freeleechPercent: '0%',
      uploadFactor: '1',
      tags: '-',
      uploader: 'anonymous',
    };
    const groups = parse(
      DEFAULT_ANNOUNCE_TEMPLATE,
      renderAnnounce(DEFAULT_ANNOUNCE_TEMPLATE, bare)
    );
    expect(groups).toMatchObject({
      category: 'uncategorised',
      tags: '-',
      uploader: 'anonymous',
      freeleechPercent: '0%',
    });
  });
});

describe('an operator can change the format', () => {
  it('derives a pattern that reads a reordered template', () => {
    const custom = '[{category}] {name} | {size} | {tags} | {url}';
    const groups = parse(custom, renderAnnounce(custom, SAMPLE_FIELDS));
    expect(groups?.name).toBe(SAMPLE_FIELDS.name);
    expect(groups?.size).toBe('14.62 GiB');
    expect(groups?.tags).toBe('1080p, bluray, x264');
  });

  it('repeats a token as a non-capturing group, because RE2 has no backreference', () => {
    // Measured against Go 1.26, which is what autobrr compiles this with:
    //   `(?P<a>x) (?P<a>y)` compiles;  `(?P<a>x) (?P=a)` is a syntax error.
    // The first version of this emitted the backreference and asserted it here,
    // so the test locked in a pattern autobrr rejects outright — and the
    // round-trip could not see it, because `toJsRegExp` rewrote it to `\k<a>`,
    // which JavaScript does accept.
    const custom = 'NEW {name} :: {infoHash} :: {url} :: {infoHash}';
    const { pattern } = announcePattern(custom);
    expect(pattern).toContain('(?P<infoHash>');
    expect(pattern).not.toContain('(?P=');
    expect(pattern).toContain('(?:[a-f0-9]{40})');
    const groups = parse(custom, renderAnnounce(custom, SAMPLE_FIELDS));
    expect(groups?.infoHash).toBe(SAMPLE_FIELDS.infoHash);
  });

  it('treats an unknown token as literal text, in both directions', () => {
    // A typo has to render and parse consistently, or the line stops matching
    // for a reason nobody can see.
    const custom = 'NEW {nmae} {name} :: {url}';
    const line = renderAnnounce(custom, SAMPLE_FIELDS);
    expect(line).toContain('{nmae}');
    expect(parse(custom, line)?.name).toBe(SAMPLE_FIELDS.name);
  });

  it('escapes regex metacharacters in the literal parts', () => {
    const custom = 'NEW (release) [{category}] {name} $$ {url}';
    expect(parse(custom, renderAnnounce(custom, SAMPLE_FIELDS))?.category).toBe(
      'Movies'
    );
  });
});

describe('the failures the review found', () => {
  it('keeps a long release name parseable by cutting the name, not the line', () => {
    // The tail of the default template is `:: {url} :: {infoHash}` and the
    // pattern anchors on the hash, so truncating the finished line produced a
    // line no client could parse — for every release with a name over about 170
    // characters, which is routine.
    for (const length of [150, 171, 200, 256]) {
      const line = renderAnnounce(DEFAULT_ANNOUNCE_TEMPLATE, {
        ...SAMPLE_FIELDS,
        name: 'A'.repeat(length),
      });
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(400);
      const groups = parse(DEFAULT_ANNOUNCE_TEMPLATE, line);
      expect(groups, `name of ${length} chars`).toBeDefined();
      expect(groups?.infoHash).toBe(SAMPLE_FIELDS.infoHash);
    }
  });

  it('parses a colon inside a tag name, and leaves the URL alone', () => {
    // `tags.name` is free text — only the slug is charset-restricted — so a
    // member could create `quality:high` on their own upload and every future
    // release carrying that tag was announced unparseably. Fixed in the token
    // rather than by stripping colons from values: a live probe showed that
    // stripping turned `https://` into `https-//` in the link field.
    const line = renderAnnounce(DEFAULT_ANNOUNCE_TEMPLATE, {
      ...SAMPLE_FIELDS,
      tags: 'x264, quality:high',
    });
    const groups = parse(DEFAULT_ANNOUNCE_TEMPLATE, line);
    expect(groups).toBeDefined();
    expect(groups?.tags).toBe('x264, quality:high');
    expect(line).toContain('https://tracker.example.com/');
  });

  it('cuts a multi-byte name on a character boundary', () => {
    const line = renderAnnounce(DEFAULT_ANNOUNCE_TEMPLATE, {
      ...SAMPLE_FIELDS,
      name: '日'.repeat(300),
    });
    expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(400);
    expect(line).not.toContain('\ufffd');
    expect(parse(DEFAULT_ANNOUNCE_TEMPLATE, line)?.infoHash).toBe(SAMPLE_FIELDS.infoHash);
  });
});

describe('sanitising, which is the injection boundary', () => {
  it('strips the frame delimiters out of a release name', () => {
    // A name carrying CRLF would not corrupt the line — it would END it, and
    // the rest would be a command the bot appears to have sent.
    const evil = 'Nice.Release\r\nPRIVMSG #ops :give me ops\r\n';
    const cleaned = sanitiseValue(evil);
    expect(cleaned).not.toMatch(/[\r\n]/);
    expect(cleaned).toBe('Nice.Release PRIVMSG #ops :give me ops');
  });

  it('renders an injected newline into one harmless line', () => {
    const line = renderAnnounce(DEFAULT_ANNOUNCE_TEMPLATE, {
      ...SAMPLE_FIELDS,
      name: 'X\r\nQUIT',
    });
    expect(line.split('\n')).toHaveLength(1);
    expect(line).not.toContain('\r');
  });

  it('drops the colour codes and control bytes', () => {
    // U+0003 is mIRC colour, U+0002 bold, U+000F reset. Clients render them,
    // a parser does not, and neither belongs in a machine-readable line.
    expect(sanitiseValue('\u000304red \u0002text\u000f')).toBe('04red text');
  });

  it('cannot invent a field by carrying the separator', () => {
    const groups = parse(
      DEFAULT_ANNOUNCE_TEMPLATE,
      renderAnnounce(DEFAULT_ANNOUNCE_TEMPLATE, {
        ...SAMPLE_FIELDS,
        name: 'Release :: 999 GiB :: FL 100%',
      })
    );
    // The name keeps its text with the separator neutralised, and the real size
    // field is still the real one.
    expect(groups?.size).toBe('14.62 GiB');
    expect(groups?.name).toContain('Release - 999 GiB - FL 100%');
  });

  it('never renders an empty field', () => {
    // An empty value would collapse two separators into one and shift every
    // field after it.
    expect(sanitiseValue('   ')).toBe('-');
    const groups = parse(
      DEFAULT_ANNOUNCE_TEMPLATE,
      renderAnnounce(DEFAULT_ANNOUNCE_TEMPLATE, { ...SAMPLE_FIELDS, tags: '' })
    );
    expect(groups?.tags).toBe('-');
  });

  it('truncates by bytes and stays on a character boundary', () => {
    const line = renderAnnounce(DEFAULT_ANNOUNCE_TEMPLATE, {
      ...SAMPLE_FIELDS,
      name: 'é'.repeat(500),
    });
    expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(403);
    expect(line).not.toContain('�');
  });
});

describe('the figures in the line', () => {
  it('reads a download multiplier as a freeleech percentage', () => {
    expect(freeleechPercent(1)).toBe('0%');
    expect(freeleechPercent(0)).toBe('100%');
    expect(freeleechPercent(0.5)).toBe('50%');
    // Out-of-range values are clamped rather than printed: the token's pattern
    // accepts three digits, and `-40%` would not parse at all.
    expect(freeleechPercent(-1)).toBe('100%');
    expect(freeleechPercent(9)).toBe('0%');
  });

  it('formats sizes the way a client shows them', () => {
    expect(humanSize(0)).toBe('0 B');
    expect(humanSize(1023)).toBe('1023 B');
    expect(humanSize(1024)).toBe('1.00 KiB');
    expect(humanSize(15_700_000_000)).toBe('14.62 GiB');
  });

  it('formats every size the size pattern accepts', () => {
    const pattern = new RegExp(`^${ANNOUNCE_TOKENS.size!.pattern}$`);
    for (const bytes of [0, 1, 999, 1024, 1_048_576, 15_700_000_000, 2 ** 50]) {
      expect(pattern.test(humanSize(bytes))).toBe(true);
    }
  });
});

describe('the generated autobrr definition', () => {
  const definition = autobrrDefinition({
    siteName: 'Example Tracker',
    baseUrl: 'https://tracker.example.com',
    irc: {
      host: 'irc.example.com',
      port: 6697,
      tls: true,
      channel: '#announce',
      announcer: 'trackarr',
      keyed: true,
      invited: true,
    },
    template: DEFAULT_ANNOUNCE_TEMPLATE,
  });

  it('carries the pattern that reads this instance format', () => {
    const { pattern } = announcePattern(DEFAULT_ANNOUNCE_TEMPLATE);
    // Single-quoted YAML, so the only escaping is a doubled quote — and the
    // pattern has none. This is the assertion that the file we hand out is the
    // pattern we tested above, rather than something adjacent to it.
    expect(definition).toContain(`pattern: '${pattern}'`);
  });

  it('carries a self-test line that its own pattern parses', () => {
    const line = renderAnnounce(DEFAULT_ANNOUNCE_TEMPLATE, SAMPLE_FIELDS);
    expect(definition).toContain(line);
    expect(parse(DEFAULT_ANNOUNCE_TEMPLATE, line)).toBeDefined();
  });

  it('expects each mapped variable, and nothing unmapped', () => {
    for (const token of templateTokens(DEFAULT_ANNOUNCE_TEMPLATE)) {
      const def = ANNOUNCE_TOKENS[token]!;
      if (def.variable) expect(definition).toContain(`${token}: `);
    }
    // `url` and `uploadFactor` are printed for people and mapped to nothing;
    // claiming them in `expect` would put autobrr's own test suite at odds with
    // its behaviour.
    expect(definition).not.toContain('url: "https://tracker.example.com/torrents/');
  });

  it('asks for the API key and never for the passkey', () => {
    expect(definition).toContain('name: apikey');
    expect(definition).toContain('{{ .apikey }}');
    // The help text names the passkey to warn a member off it, so what must be
    // absent is the SUBSTITUTION — no URL in this file may carry the credential
    // that can announce on somebody's behalf.
    expect(definition).not.toContain('{{ .passkey }}');
    expect(definition).not.toMatch(/passkey=/);
  });

  it('points the download URL at the endpoint that takes a read key', () => {
    expect(definition).toContain(
      'downloadurl: "/api/torznab/download?id={{ .torrentId }}&apikey={{ .apikey }}"'
    );
    expect(definition).toContain('infourl: "/torrents/{{ .torrentId }}"');
  });

  it('names the network and the announcer autobrr has to match', () => {
    expect(definition).toContain('server: "irc.example.com"');
    expect(definition).toContain('port: 6697');
    expect(definition).toContain('tls: true');
    expect(definition).toContain('- "trackarr"');
    expect(definition).toContain('name: "#announce"');
  });

  it('offers the invite field only when the channel is not open', () => {
    const open = autobrrDefinition({
      siteName: 'Example Tracker',
      baseUrl: 'https://tracker.example.com',
      irc: {
        host: 'irc.example.com',
        port: 6667,
        tls: false,
        channel: '#announce',
        announcer: 'bot',
        keyed: false,
        invited: false,
      },
      template: DEFAULT_ANNOUNCE_TEMPLATE,
    });
    expect(definition).toContain('invite_command');
    expect(open).not.toContain('invite_command');
  });

  it('derives an identifier that will not collide with a shipped one', () => {
    expect(slugifyId('Example Tracker')).toBe('example-tracker');
    // `Ü` and `é` decompose and lose their marks; `ø` does not — it is a letter
    // in its own right, so it becomes a separator like any other non-ASCII
    // character. Pinned because the alternative is meeting it in a filename.
    expect(slugifyId('Ünïcødé Trackér!')).toBe('unic-de-tracker');
    expect(slugifyId('///')).toBe('trackarr');
  });

  it('re-derives itself when the operator edits the template', () => {
    const custom = 'DROP {name} [{category}] {size} {url}';
    const other = autobrrDefinition({
      siteName: 'Example Tracker',
      baseUrl: 'https://tracker.example.com',
      irc: {
        host: 'irc.example.com',
        port: 6697,
        tls: true,
        channel: '#announce',
        announcer: 'trackarr',
        keyed: false,
        invited: false,
      },
      template: custom,
    });
    expect(other).toContain(`pattern: '${announcePattern(custom).pattern}'`);
    // And the definition no longer claims fields the new template does not emit.
    expect(other).not.toContain('freeleechPercent: ');
  });
});
