import { describe, it, expect } from 'vitest';
import {
  channelsToLayout,
  formatBitRate,
  formatDuration,
  formatSheetSize,
  layoutToChannels,
  parseBitRate,
  parseMediaInfoText,
  parseSize,
  prettyAudioFormat,
  prettyContainer,
  prettyVideoFormat,
  renderMediaInfo,
  resolutionLabel,
  sheetFromMediaInfoJson,
} from '../app/utils/mediainfo';

// Reading MediaInfo into the listing model.
//
// Two traps have already cost time here, and both are pinned by these tests.
//
// The first is typing: `mediainfo.js` in `format:'object'` returns numeric
// fields as NUMBERS, where the text output only ever gives strings. A
// `.replace()` on a number throws a TypeError inside a `computed` and blanks
// the whole page — which is what happened.
//
// The second is subtler: that same mode emits NO `_String` field at all.
// Reading them naively left size and duration empty, and printed
// "Video bitrate: 8000000" on the listing.

describe('parseBitRate', () => {
  it('reads a bare number as bit/s, the way mediainfo.js returns it', () => {
    expect(parseBitRate(8_000_000)).toBe(8_000_000);
    expect(parseBitRate('8000000')).toBe(8_000_000);
  });

  it('reads MediaInfo textual forms', () => {
    expect(parseBitRate('192 kb/s')).toBe(192_000);
    expect(parseBitRate('8 000 kb/s')).toBe(8_000_000);
    expect(parseBitRate('8.05 Mbps')).toBe(8_050_000);
  });

  it('copes with the non-breaking spaces MediaInfo inserts', () => {
    expect(parseBitRate('8 000 kb/s')).toBe(8_000_000);
  });

  it('returns undefined rather than zero on an unusable value', () => {
    for (const bad of [undefined, null, '', 'n/a', 0, -5]) {
      expect(parseBitRate(bad as never)).toBeUndefined();
    }
  });
});

describe('formatBitRate', () => {
  it('picks Kbps below the megabit and Mbps above', () => {
    expect(formatBitRate(192_000)).toBe('192 Kbps');
    expect(formatBitRate(8_000_000)).toBe('8 Mbps');
  });

  it('honours a forced unit', () => {
    expect(formatBitRate(8_000_000, 'Kbps')).toBe('8000 Kbps');
    expect(formatBitRate(192_000, 'Mbps')).toBe('0.19 Mbps');
  });

  it('round-trips without drifting', () => {
    for (const bps of [192_000, 8_000_000, 4_500_000]) {
      expect(parseBitRate(formatBitRate(bps)!)).toBeCloseTo(bps, -3);
    }
  });
});

describe('parseSize / formatSheetSize', () => {
  it('reads bare bytes and suffixed forms', () => {
    expect(parseSize('1473173712')).toBe(1_473_173_712);
    expect(parseSize('1.37 GiB')).toBe(Math.round(1.37 * 1024 ** 3));
    expect(parseSize('700 MiB')).toBe(700 * 1024 ** 2);
  });

  it('switches to GiB past the gibibyte', () => {
    expect(formatSheetSize(1_473_173_712)).toBe('1.37 GiB');
    expect(formatSheetSize(700 * 1024 ** 2)).toBe('700 MiB');
  });
});

describe('formatDuration', () => {
  it('renders the MediaInfo form', () => {
    expect(formatDuration(1464.08)).toBe('24 min 24 s');
    expect(formatDuration(6120)).toBe('1 h 42 min');
    expect(formatDuration(45)).toBe('45 s');
  });

  it('returns undefined on an absent or zero duration', () => {
    expect(formatDuration(0)).toBeUndefined();
    expect(formatDuration(null)).toBeUndefined();
  });
});

describe('channelsToLayout / layoutToChannels', () => {
  it('turns a channel count into a layout', () => {
    expect(channelsToLayout('2')).toBe('2.0');
    expect(channelsToLayout('6')).toBe('5.1');
    expect(channelsToLayout('8 channels')).toBe('7.1');
  });

  it('is idempotent — an already normalised layout comes back untouched', () => {
    // Without this guard, "5.1" went back through the parser and became
    // "51.0", because non-digits were simply stripped.
    for (const layout of ['1.0', '2.0', '5.1', '7.1']) {
      expect(channelsToLayout(layout)).toBe(layout);
    }
  });

  it('recovers the count from the layout', () => {
    expect(layoutToChannels('5.1')).toBe(6);
    expect(layoutToChannels('2.0')).toBe(2);
    expect(layoutToChannels('7.1')).toBe(8);
  });
});

describe('resolutionLabel', () => {
  it('names the common tiers', () => {
    expect(resolutionLabel(1920, 1080)).toBe('1080p');
    expect(resolutionLabel(3840, 2160)).toBe('2160p');
    expect(resolutionLabel(1280, 720)).toBe('720p');
  });

  it('does not demote a cinema master cropped in height', () => {
    // 1920×800 is 1080p. Trusting height alone made it 720p — the defect this
    // function was rewritten to fix.
    expect(resolutionLabel(1920, 800)).toBe('1080p');
    expect(resolutionLabel(3840, 1600)).toBe('2160p');
  });

  it('does not demote an anamorphic master cropped in width either', () => {
    expect(resolutionLabel(1440, 1080)).toBe('1080p');
  });

  it('returns undefined when nothing is known', () => {
    expect(resolutionLabel(undefined, undefined)).toBeUndefined();
  });
});

describe('commercial names', () => {
  it('tells a re-encode from an untouched stream by the encoder', () => {
    // x264 signals a re-encode, H.264 an untouched stream. That is the
    // distinction a listing needs, and it rests entirely on
    // `Encoded_Library`.
    expect(prettyVideoFormat('AVC', 'x264')).toBe('x264');
    expect(prettyVideoFormat('AVC', undefined)).toBe('H.264');
    expect(prettyVideoFormat('HEVC', 'x265')).toBe('x265');
    expect(prettyVideoFormat('HEVC', '')).toBe('H.265');
  });

  it('recognises audio families from format and profile', () => {
    expect(prettyAudioFormat('DTS', 'DTS-HD MA')).toBe('DTS-HD MA');
    expect(prettyAudioFormat('AAC', 'LC')).toBe('AAC');
    expect(prettyAudioFormat('E-AC-3', undefined)).toBe('E-AC3');
    expect(prettyAudioFormat('', '')).toBe('Inconnu');
  });

  it('translates the container to its everyday name', () => {
    expect(prettyContainer('Matroska')).toBe('MKV');
    expect(prettyContainer('MPEG-4')).toBe('MP4');
    expect(prettyContainer('')).toBe('');
  });
});

describe('sheetFromMediaInfoJson — the real mediainfo.js output', () => {
  // A faithful excerpt from a real analysis: numeric fields not typed as
  // strings, and above all NO `_String` field.
  const raw = {
    media: {
      track: [
        {
          '@type': 'General',
          Format: 'Matroska',
          FileSize: '1473173712',
          Duration: 1464.08,
          OverallBitRate: 8049690,
        },
        {
          '@type': 'Video',
          Format: 'AVC',
          Format_Profile: 'High',
          Width: 1920,
          Height: 1080,
          FrameRate: 23.976,
          BitDepth: 8,
          BitRate: 8000000,
          Encoded_Library_Name: 'x264',
        },
        {
          '@type': 'Audio',
          Format: 'AAC',
          Channels: 2,
          BitRate: 192000,
          Language: 'ja',
          Default: 'Yes',
        },
        { '@type': 'Text', Format: 'ASS', Language: 'fr-FR', Default: 'Yes' },
      ],
    },
  };

  it('fills size, duration and overall bitrate despite the missing _String fields', () => {
    const s = sheetFromMediaInfoJson(raw);
    expect(s.fileSize).toBe(1_473_173_712);
    expect(s.duration).toBe('24 min 24 s');
    expect(s.overallBitRate).toBe(8_049_690);
  });

  it('converts numeric fields into safe strings', () => {
    // The heart of the historical crash: `frameRate` arrived as a number and
    // the first `.replace()` downstream blanked the page.
    const s = sheetFromMediaInfoJson(raw);
    expect(typeof s.video[0]!.frameRate).toBe('string');
    expect(s.video[0]!.frameRate).toBe('23.976');
    expect(s.video[0]!.bitDepth).toBe('8');
  });

  it('normalises channels and keeps the encoder', () => {
    const s = sheetFromMediaInfoJson(raw);
    expect(s.audio[0]!.channels).toBe('2.0');
    expect(s.video[0]!.encoder).toBe('x264');
  });

  it('keeps the regional language code as-is', () => {
    const s = sheetFromMediaInfoJson(raw);
    expect(s.text[0]!.language).toBe('fr-FR');
  });
});

describe('renderMediaInfo → parseMediaInfoText round trip', () => {
  it('loses neither width nor height', () => {
    // The reason `renderMediaInfo` exists: the old in-house summary wrote
    // "Resolution: 1080p", which the parser ignored, and the geometry
    // disappeared on the first round trip — emptying the specs.
    const before = sheetFromMediaInfoJson({
      media: {
        track: [
          { '@type': 'General', Format: 'Matroska', FileSize: '1073741824' },
          {
            '@type': 'Video',
            Format: 'AVC',
            Width: 1920,
            Height: 1080,
            BitRate: 8000000,
            Encoded_Library_Name: 'x264',
          },
          { '@type': 'Audio', Format: 'DTS', Channels: 6, BitRate: 1509000, Language: 'fr' },
        ],
      },
    });

    const after = parseMediaInfoText(renderMediaInfo(before));

    expect(after.video[0]!.width).toBe(1920);
    expect(after.video[0]!.height).toBe(1080);
    expect(after.video[0]!.encoder).toBe('x264');
    expect(after.audio[0]!.channels).toBe('5.1');
    expect(after.container).toBe('Matroska');
  });

  it('is stable: a second pass changes nothing further', () => {
    const s1 = parseMediaInfoText(
      renderMediaInfo(
        sheetFromMediaInfoJson({
          media: {
            track: [
              { '@type': 'General', Format: 'Matroska', FileSize: '1073741824' },
              { '@type': 'Video', Format: 'AVC', Width: 1920, Height: 1080 },
            ],
          },
        }),
      ),
    );
    const s2 = parseMediaInfoText(renderMediaInfo(s1));
    expect(s2.video[0]).toEqual(s1.video[0]);
    expect(s2.fileSize).toBe(s1.fileSize);
  });
});

describe('parseMediaInfoText — SDH detection', () => {
  it('spots an SDH subtitle from its title, for want of a container flag', () => {
    const sheet = parseMediaInfoText(
      ['Text', 'Format : PGS', 'Language : en', 'Title : English SDH'].join('\n'),
    );
    expect(sheet.text[0]!.isSdh).toBe(true);
  });

  it('does not mark an ordinary subtitle as SDH', () => {
    const sheet = parseMediaInfoText(
      ['Text', 'Format : SRT', 'Language : fr', 'Title : Complet'].join('\n'),
    );
    expect(sheet.text[0]!.isSdh).toBe(false);
  });
});
