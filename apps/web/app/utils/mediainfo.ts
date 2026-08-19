/**
 * MediaInfo → listing model.
 *
 * Two producers, one model: the user can either drop the video file
 * (mediainfo.js, WebAssembly, reads it in the browser) or paste the
 * MediaInfo text output they already have to hand. Both paths converge on
 * `TechnicalSheet`, so the downstream BBCode generator never needs to know
 * where the data came from.
 *
 * Measured quantities (bitrate, size) are stored in base units — bit/s and
 * bytes — and never as text: the displayed unit is only a rendering
 * preference the user changes without the value moving. That is what lets
 * the Kbps/Mbps selector on the technical step be a display choice rather
 * than a rewrite of the data.
 *
 * Everything is strictly local: the file is never read by the server, and
 * only a few kilobytes of header and tail are actually walked by the WASM.
 */

export type TrackKind = 'video' | 'audio' | 'text';
export type BitRateUnit = 'Kbps' | 'Mbps';
export type SizeUnit = 'GiB' | 'MiB';

/** What kind of subtitle this is, in tracker terms. */
export type SubtitleKind = 'full' | 'forced' | 'sdh';

export interface MediaTrack {
  kind: TrackKind;
  format?: string;
  profile?: string;
  width?: number;
  height?: number;
  /** Bare number, no "FPS" suffix. */
  frameRate?: string;
  /** Débit en bit/s. */
  bitRate?: number;
  /** Display unit only — does not change `bitRate`. */
  bitRateUnit?: BitRateUnit;
  /** Bare number, no "bits" suffix. */
  bitDepth?: string;
  /** Disposition normalisée : « 2.0 », « 5.1 »… */
  channels?: string;
  /** Encodeur déclaré (« x264 ») — distingue un ré-encodage d'un remux. */
  encoder?: string;
  language?: string;
  title?: string;
  isDefault?: boolean;
  isForced?: boolean;
  /** Subtitles for the deaf and hard of hearing. */
  isSdh?: boolean;
}

export interface TechnicalSheet {
  fileName?: string;
  container?: string;
  /** Taille en octets. */
  fileSize?: number;
  fileSizeUnit?: SizeUnit;
  /** Durée déjà lisible : « 24 min 24 s ». */
  duration?: string;
  /** Débit global en bit/s. */
  overallBitRate?: number;
  video: MediaTrack[];
  audio: MediaTrack[];
  text: MediaTrack[];
  /** Sortie collée par l'utilisateur, conservée telle quelle. */
  raw?: string;
}

export function emptySheet(): TechnicalSheet {
  return { video: [], audio: [], text: [] };
}

export function isSheetEmpty(s: TechnicalSheet): boolean {
  return !s.video.length && !s.audio.length && !s.text.length && !s.container;
}

export function emptyTrack(kind: TrackKind): MediaTrack {
  if (kind === 'audio') {
    return { kind, format: 'AAC', channels: '2.0', language: 'fr', bitRateUnit: 'Kbps' };
  }
  if (kind === 'text') return { kind, format: 'SRT', language: 'fr' };
  return { kind, bitRateUnit: 'Mbps' };
}

/* ────────────────────────────────────────────────────────────────────────
   Grandeurs — analyse et rendu
   ──────────────────────────────────────────────────────────────────────── */

/**
 * `String(v)` before any string method, without exception.
 *
 * mediainfo.js returns `FrameRate`, `BitDepth`, `Width`… as NUMBERS where the
 * text output only gives strings. A `.replace()` on a number throws a
 * TypeError inside a `computed`, which blanks the whole page. Going through
 * here rather than trusting the types makes that crash impossible.
 */
function asText(v: unknown): string {
  return v === undefined || v === null ? '' : String(v);
}

/** Normalise MediaInfo separators: thin spaces, non-breaking spaces, comma. */
function normalizeNumeric(raw: unknown): string {
  return asText(raw)
    .replace(/[   \s]/g, '')
    .replace(',', '.')
    .trim();
}

/** « 23.976 FPS » → « 23.976 » ; « 8 bits » → « 8 ». */
function bareNumber(raw: unknown): string | undefined {
  const m = /-?\d+(?:\.\d+)?/.exec(normalizeNumeric(raw));
  return m ? m[0] : undefined;
}

const BITRATE_FACTORS: Record<string, number> = {
  '': 1,
  k: 1_000,
  m: 1_000_000,
  g: 1_000_000_000,
};

/**
 * "192 kb/s", "8 000 kb/s", "8.05 Mbps", "8000000" → bit/s.
 * A bare number is already in bit/s, the way mediainfo.js returns it.
 */
export function parseBitRate(raw?: string | number | null): number | undefined {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 ? raw : undefined;
  }
  const v = normalizeNumeric(raw).toLowerCase();
  if (!v) return undefined;
  const m = /^(\d+(?:\.\d+)?)([kmg])?b/.exec(v) ?? /^(\d+(?:\.\d+)?)$/.exec(v);
  if (!m) return undefined;
  const value = Number.parseFloat(m[1]!);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value * (BITRATE_FACTORS[m[2] ?? ''] ?? 1));
}

/** Past the megabit, Kbps becomes unreadable — that is the switchover point. */
export function pickBitRateUnit(bps?: number): BitRateUnit {
  return bps && bps >= 1_000_000 ? 'Mbps' : 'Kbps';
}

/** bit/s → the value expressed in the requested unit (for input fields). */
export function bitRateIn(bps: number | undefined, unit: BitRateUnit): number | undefined {
  if (!bps) return undefined;
  const scaled = unit === 'Mbps' ? bps / 1_000_000 : bps / 1_000;
  return Number(scaled.toFixed(unit === 'Mbps' ? 2 : 0));
}

/** Inverse of `bitRateIn`: input goes back to bit/s. */
export function bitRateFrom(value: number | undefined, unit: BitRateUnit): number | undefined {
  if (!value || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value * (unit === 'Mbps' ? 1_000_000 : 1_000));
}

export function formatBitRate(bps?: number, unit?: BitRateUnit): string | undefined {
  if (!bps) return undefined;
  const u = unit ?? pickBitRateUnit(bps);
  const value = bitRateIn(bps, u);
  return value === undefined ? undefined : `${value} ${u}`;
}

/** MediaInfo form, for re-emitting a readable block: "8 000 kb/s". */
function mediaInfoBitRate(bps?: number): string | undefined {
  if (!bps) return undefined;
  return `${Math.round(bps / 1000).toLocaleString('fr-FR').replace(/ | /g, ' ')} kb/s`;
}

const SIZE_FACTORS: Record<string, number> = {
  b: 1,
  kb: 1_000,
  kib: 1024,
  ko: 1024,
  mb: 1_000_000,
  mib: 1024 ** 2,
  mo: 1024 ** 2,
  gb: 1_000_000_000,
  gib: 1024 ** 3,
  go: 1024 ** 3,
  tb: 1_000_000_000_000,
  tib: 1024 ** 4,
  to: 1024 ** 4,
};

/** « 1.37 GiB », « 700 MiB », « 1473173712 » → octets. */
export function parseSize(raw?: string | number | null): number | undefined {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 ? raw : undefined;
  }
  const v = normalizeNumeric(raw).toLowerCase();
  if (!v) return undefined;
  const m = /^(\d+(?:\.\d+)?)([a-z]*)$/.exec(v);
  if (!m) return undefined;
  const value = Number.parseFloat(m[1]!);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value * (SIZE_FACTORS[m[2] ?? 'b'] ?? 1));
}

export function pickSizeUnit(bytes?: number): SizeUnit {
  return bytes && bytes >= 1024 ** 3 ? 'GiB' : 'MiB';
}

export function sizeIn(bytes: number | undefined, unit: SizeUnit): number | undefined {
  if (!bytes) return undefined;
  return Number((bytes / (unit === 'GiB' ? 1024 ** 3 : 1024 ** 2)).toFixed(2));
}

export function sizeFrom(value: number | undefined, unit: SizeUnit): number | undefined {
  if (!value || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value * (unit === 'GiB' ? 1024 ** 3 : 1024 ** 2));
}

export function formatSize(bytes?: number, unit?: SizeUnit): string | undefined {
  if (!bytes) return undefined;
  const u = unit ?? pickSizeUnit(bytes);
  const value = sizeIn(bytes, u);
  return value === undefined ? undefined : `${value} ${u}`;
}

/** Secondes → « 1 h 42 min » / « 24 min 24 s », comme MediaInfo. */
export function formatDuration(seconds?: number | string | null): string | undefined {
  const n = typeof seconds === 'number' ? seconds : Number.parseFloat(normalizeNumeric(seconds));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const total = Math.round(n);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h} h ${m} min`;
  if (m) return `${m} min ${s} s`;
  return `${s} s`;
}

/* ────────────────────────────────────────────────────────────────────────
   Normalisation
   ──────────────────────────────────────────────────────────────────────── */

/**
 * "8 channels" / "6" → "7.1" / "5.1". MediaInfo is not consistent, and this
 * function has to stay idempotent: it receives both the decoder's raw value
 * and the already-normalised layout a select hands back.
 */
export function channelsToLayout(raw?: string): string | undefined {
  if (!raw) return undefined;
  const value = asText(raw).trim();
  if (/^\d+\.\d$/.test(value)) return value; // déjà normalisé
  const n = Number.parseInt(value.replace(/[^\d]/g, ''), 10);
  if (!Number.isFinite(n) || n <= 0) return value;
  const map: Record<number, string> = {
    1: '1.0',
    2: '2.0',
    3: '2.1',
    6: '5.1',
    7: '6.1',
    8: '7.1',
  };
  return map[n] ?? `${n}.0`;
}

/** "5.1" → 6: the channel count a MediaInfo block expects. */
export function layoutToChannels(layout?: string): number | undefined {
  const m = /^(\d+)\.(\d)$/.exec(asText(layout).trim());
  if (m) return Number.parseInt(m[1]!, 10) + Number.parseInt(m[2]!, 10);
  const n = Number.parseInt(asText(layout).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Commercial names. MediaInfo returns the codec's technical name; a listing
 * is expected to carry the name people recognise.
 */
export function prettyAudioFormat(format?: string, profile?: string): string {
  const f = asText(format).trim();
  const p = asText(profile).trim();
  const both = `${f} ${p}`.toLowerCase();
  if (both.includes('ma') && both.includes('dts')) return 'DTS-HD MA';
  if (both.includes('dts') && both.includes('hra')) return 'DTS-HD HRA';
  if (both.includes('dts') && both.includes('es')) return 'DTS-ES';
  if (both.includes('dts')) return 'DTS';
  if (both.includes('truehd')) return 'TrueHD';
  if (both.includes('atmos')) return 'Atmos';
  if (both.includes('e-ac-3') || both.includes('eac3')) return 'E-AC3';
  if (both.includes('ac-3') || both.includes('ac3')) return 'AC3';
  if (both.includes('aac')) return 'AAC';
  if (both.includes('opus')) return 'Opus';
  if (both.includes('flac')) return 'FLAC';
  return f || 'Inconnu';
}

/**
 * The video codec as announced on a listing.
 *
 * `x264` and `H.264` name the same format but not the same release: the
 * first signals a re-encode, the second an original stream (remux, untouched
 * WEB). The encoder declared by the container settles it — the only reliable
 * information we have to tell them apart.
 */
export function prettyVideoFormat(format?: string, encoder?: string): string {
  const f = asText(format).trim().toLowerCase();
  const e = asText(encoder).trim().toLowerCase();
  if (f.includes('hevc') || f.includes('h.265')) return e.includes('x265') ? 'x265' : 'H.265';
  if (f.includes('avc') || f.includes('h.264')) return e.includes('x264') ? 'x264' : 'H.264';
  if (f.includes('av1') || f.includes('aomedia')) return 'AV1';
  if (f.includes('vp9')) return 'VP9';
  if (f.includes('vp8')) return 'VP8';
  if (f.includes('vc-1')) return 'VC-1';
  if (f.includes('mpeg-4 visual')) return e.includes('divx') ? 'DivX' : 'XviD';
  if (f.includes('mpeg video')) return 'MPEG-2';
  return asText(format).trim() || 'Inconnu';
}

/**
 * The container under the name everybody uses. MediaInfo says "Matroska"
 * where a listing announces "MKV" — and where the technical step's select
 * offers "MKV".
 */
export function prettyContainer(format?: string): string {
  const f = asText(format).trim().toLowerCase();
  if (!f) return '';
  if (f.includes('matroska')) return 'MKV';
  if (f.includes('mpeg-4') || f.includes('mp4')) return 'MP4';
  if (f.includes('bdav') || f.includes('m2ts')) return 'M2TS';
  if (f.includes('mpeg-ts') || f === 'ts') return 'TS';
  if (f.includes('avi')) return 'AVI';
  if (f.includes('iso')) return 'ISO';
  if (f.includes('windows media')) return 'WMV';
  if (f.includes('flash')) return 'FLV';
  if (f.includes('webm')) return 'WEBM';
  return asText(format).trim();
}

/**
 * 3840×2160 → "2160p".
 *
 * A tier is reached as soon as the width OR the height gets there, within
 * 5%: a cinema master loses height to cropping (1920×800 is still 1080p) and
 * an anamorphic master loses width (1440×1080 likewise). Trusting height
 * alone demoted the first case to 720p.
 */
export function resolutionLabel(width?: number, height?: number): string | undefined {
  const tiers = [
    { label: '4320p', w: 7680, h: 4320 },
    { label: '2160p', w: 3840, h: 2160 },
    { label: '1440p', w: 2560, h: 1440 },
    { label: '1080p', w: 1920, h: 1080 },
    { label: '720p', w: 1280, h: 720 },
    { label: '576p', w: 1024, h: 576 },
    { label: '480p', w: 854, h: 480 },
  ] as const;
  if (!width && !height) return undefined;
  for (const t of tiers) {
    if ((width && width >= t.w * 0.95) || (height && height >= t.h * 0.95)) {
      return t.label;
    }
  }
  return width && height ? `${width}×${height}` : undefined;
}

/* ────────────────────────────────────────────────────────────────────────
   Producteur 1 — sortie texte collée
   ──────────────────────────────────────────────────────────────────────── */

const SECTION_RE = /^(General|Video|Audio|Text|Menu|Général|Vidéo|Texte)(\s*#?\d+)?\s*$/i;

/** Hints that a subtitle is SDH — no container carries the flag. */
const SDH_RE = /\b(sdh|hearing[\s-]?impaired|malentendant)/i;

/**
 * Parse the MediaInfo text output: blocks separated by a blank line, each
 * opened by its name and followed by `key : value` pairs. Tolerant of both
 * French and English labels.
 */
export function parseMediaInfoText(raw: string): TechnicalSheet {
  const sheet = emptySheet();
  sheet.raw = raw.trim() || undefined;

  let current: { kind: string; fields: Record<string, string> } | null = null;
  const blocks: Array<{ kind: string; fields: Record<string, string> }> = [];

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const section = SECTION_RE.exec(trimmed);
    if (section) {
      current = { kind: section[1]!.toLowerCase(), fields: {} };
      blocks.push(current);
      continue;
    }
    if (!current) continue;

    const sep = trimmed.indexOf(':');
    if (sep <= 0) continue;
    const key = trimmed.slice(0, sep).trim().toLowerCase();
    const value = trimmed.slice(sep + 1).trim();
    if (value) current.fields[key] = value;
  }

  const pick = (f: Record<string, string>, ...keys: string[]) => {
    for (const k of keys) if (f[k]) return f[k];
    return undefined;
  };
  const num = (v?: string) => {
    const parsed = Number.parseInt(normalizeNumeric(v).replace(/[^\d].*$/, ''), 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const flag = (v?: string) => /^(yes|oui)$/i.test((v ?? '').trim());

  for (const block of blocks) {
    const f = block.fields;
    if (block.kind === 'general' || block.kind === 'général') {
      sheet.fileName = pick(f, 'complete name', 'nom complet', 'file name');
      sheet.container = pick(f, 'format');
      sheet.fileSize = parseSize(pick(f, 'file size', 'taille du fichier'));
      sheet.fileSizeUnit = pickSizeUnit(sheet.fileSize);
      sheet.duration = pick(f, 'duration', 'durée');
      sheet.overallBitRate = parseBitRate(pick(f, 'overall bit rate', 'débit global'));
      continue;
    }
    if (block.kind === 'video' || block.kind === 'vidéo') {
      const bitRate = parseBitRate(pick(f, 'bit rate', 'débit'));
      sheet.video.push({
        kind: 'video',
        format: pick(f, 'format'),
        profile: pick(f, 'format profile', 'profil du format'),
        width: num(pick(f, 'width', 'largeur')),
        height: num(pick(f, 'height', 'hauteur')),
        frameRate: bareNumber(pick(f, 'frame rate', 'images par seconde')),
        bitRate,
        bitRateUnit: pickBitRateUnit(bitRate),
        bitDepth: bareNumber(pick(f, 'bit depth', 'profondeur des bits')),
        encoder: pick(f, 'writing library', 'encoded library', "bibliothèque d'encodage"),
        language: pick(f, 'language', 'langue'),
        title: pick(f, 'title', 'titre'),
        isDefault: flag(pick(f, 'default', 'par défaut')),
        isForced: flag(pick(f, 'forced', 'forcé')),
      });
      continue;
    }
    if (block.kind === 'audio') {
      const bitRate = parseBitRate(pick(f, 'bit rate', 'débit'));
      sheet.audio.push({
        kind: 'audio',
        format: pick(f, 'format'),
        profile: pick(f, 'format profile', 'commercial name', 'profil du format'),
        channels: channelsToLayout(pick(f, 'channel(s)', 'channels', 'canaux')),
        bitRate,
        bitRateUnit: pickBitRateUnit(bitRate),
        language: pick(f, 'language', 'langue'),
        title: pick(f, 'title', 'titre'),
        isDefault: flag(pick(f, 'default', 'par défaut')),
        isForced: flag(pick(f, 'forced', 'forcé')),
      });
      continue;
    }
    if (block.kind === 'text' || block.kind === 'texte') {
      const title = pick(f, 'title', 'titre');
      sheet.text.push({
        kind: 'text',
        format: pick(f, 'format'),
        language: pick(f, 'language', 'langue'),
        title,
        isDefault: flag(pick(f, 'default', 'par défaut')),
        isForced: flag(pick(f, 'forced', 'forcé')),
        isSdh:
          flag(pick(f, 'hearing impaired', 'malentendants')) || SDH_RE.test(asText(title)),
      });
    }
  }

  return sheet;
}

/**
 * Re-emit a MediaInfo block from the model.
 *
 * The output format is MediaInfo's own, not an in-house summary: that is
 * what `parseMediaInfoText` can read back, so the text offered on the
 * technical step can be hand-corrected and fed back in without losing
 * anything. A summary with invented labels broke that cycle — it rendered
 * `Resolution : 1080p`, which the parser ignored, and both width and height
 * vanished on the first round trip.
 */
export function renderMediaInfo(sheet: TechnicalSheet): string {
  const out: string[] = [];
  const block = (title: string, rows: Array<[string, string | undefined]>) => {
    const kept = rows.filter(([, v]) => asText(v).trim());
    if (!kept.length) return;
    if (out.length) out.push('');
    out.push(title);
    for (const [k, v] of kept) out.push(`${k.padEnd(40)} : ${asText(v).trim()}`);
  };
  const yesNo = (v?: boolean) => (v ? 'Yes' : 'No');

  block('General', [
    ['Complete name', sheet.fileName],
    ['Format', sheet.container],
    ['File size', formatSize(sheet.fileSize, sheet.fileSizeUnit)],
    ['Duration', sheet.duration],
    ['Overall bit rate', mediaInfoBitRate(sheet.overallBitRate)],
  ]);

  sheet.video.forEach((t, i) => {
    block(sheet.video.length > 1 ? `Video #${i + 1}` : 'Video', [
      ['Format', t.format],
      ['Format profile', t.profile],
      ['Width', t.width ? `${t.width} pixels` : undefined],
      ['Height', t.height ? `${t.height} pixels` : undefined],
      ['Frame rate', t.frameRate ? `${t.frameRate} FPS` : undefined],
      ['Bit depth', t.bitDepth ? `${t.bitDepth} bits` : undefined],
      ['Bit rate', mediaInfoBitRate(t.bitRate)],
      ['Writing library', t.encoder],
      ['Language', t.language],
      ['Title', t.title],
      ['Default', yesNo(t.isDefault)],
      ['Forced', yesNo(t.isForced)],
    ]);
  });

  sheet.audio.forEach((t, i) => {
    const channels = layoutToChannels(t.channels);
    block(sheet.audio.length > 1 ? `Audio #${i + 1}` : 'Audio', [
      ['Format', t.format],
      ['Format profile', t.profile],
      ['Channel(s)', channels ? `${channels} channels` : undefined],
      ['Bit rate', mediaInfoBitRate(t.bitRate)],
      ['Language', t.language],
      ['Title', t.title],
      ['Default', yesNo(t.isDefault)],
      ['Forced', yesNo(t.isForced)],
    ]);
  });

  sheet.text.forEach((t, i) => {
    block(sheet.text.length > 1 ? `Text #${i + 1}` : 'Text', [
      ['Format', t.format],
      ['Language', t.language],
      ['Title', t.title],
      ['Hearing impaired', t.isSdh ? 'Yes' : undefined],
      ['Default', yesNo(t.isDefault)],
      ['Forced', yesNo(t.isForced)],
    ]);
  });

  return out.join('\n');
}

/* ────────────────────────────────────────────────────────────────────────
   Producteur 2 — mediainfo.js (WebAssembly)
   ──────────────────────────────────────────────────────────────────────── */

/**
 * In `format: 'object'`, mediainfo.js produces NO `_String` field at all:
 * no `FileSize_String`, no `Duration_String`, no `BitRate_String`. Only the
 * raw values exist, and they are numeric. Reading them as-is printed
 * "Video bitrate: 8000000" on the listing and left size and duration empty.
 * So we read the number and format here, while still accepting `_String`
 * fields in case a future version brings them back.
 */
type RawValue = string | number | undefined;

interface RawTrack {
  '@type'?: string;
  Format?: RawValue;
  Format_Profile?: RawValue;
  Format_Commercial_IfAny?: RawValue;
  Format_AdditionalFeatures?: RawValue;
  Width?: RawValue;
  Height?: RawValue;
  FrameRate?: RawValue;
  BitRate?: RawValue;
  BitRate_String?: RawValue;
  BitDepth?: RawValue;
  Channels?: RawValue;
  Encoded_Library?: RawValue;
  Encoded_Library_Name?: RawValue;
  Language?: RawValue;
  Title?: RawValue;
  Default?: RawValue;
  Forced?: RawValue;
  FileSize?: RawValue;
  FileSize_String?: RawValue;
  Duration?: RawValue;
  Duration_String?: RawValue;
  OverallBitRate?: RawValue;
  OverallBitRate_String?: RawValue;
  CompleteName?: RawValue;
  FileName?: RawValue;
}

/** Convert the mediainfo.js JSON into the same model. */
export function sheetFromMediaInfoJson(result: unknown): TechnicalSheet {
  const sheet = emptySheet();
  const tracks = (result as { media?: { track?: RawTrack[] } })?.media?.track ?? [];
  const str = (v: RawValue) =>
    v === undefined || v === null || v === '' ? undefined : String(v);
  const n = (v: RawValue) => {
    const parsed = Number.parseInt(String(v ?? ''), 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const flag = (v: RawValue) => /^yes$/i.test(String(v ?? '').trim());

  for (const t of tracks) {
    switch ((t['@type'] ?? '').toLowerCase()) {
      case 'general': {
        sheet.fileName = str(t.CompleteName) ?? str(t.FileName);
        sheet.container = str(t.Format);
        sheet.fileSize = parseSize(str(t.FileSize_String) ?? str(t.FileSize));
        sheet.fileSizeUnit = pickSizeUnit(sheet.fileSize);
        sheet.duration = str(t.Duration_String) ?? formatDuration(str(t.Duration));
        sheet.overallBitRate = parseBitRate(
          str(t.OverallBitRate_String) ?? str(t.OverallBitRate),
        );
        break;
      }
      case 'video': {
        const bitRate = parseBitRate(str(t.BitRate_String) ?? str(t.BitRate));
        sheet.video.push({
          kind: 'video',
          format: str(t.Format),
          profile: str(t.Format_Profile),
          width: n(t.Width),
          height: n(t.Height),
          frameRate: bareNumber(t.FrameRate),
          bitRate,
          bitRateUnit: pickBitRateUnit(bitRate),
          bitDepth: bareNumber(t.BitDepth),
          encoder: str(t.Encoded_Library_Name) ?? str(t.Encoded_Library),
          language: str(t.Language),
          title: str(t.Title),
          isDefault: flag(t.Default),
          isForced: flag(t.Forced),
        });
        break;
      }
      case 'audio': {
        const bitRate = parseBitRate(str(t.BitRate_String) ?? str(t.BitRate));
        sheet.audio.push({
          kind: 'audio',
          format: str(t.Format),
          profile:
            str(t.Format_Commercial_IfAny) ??
            str(t.Format_Profile) ??
            str(t.Format_AdditionalFeatures),
          channels: channelsToLayout(str(t.Channels)),
          bitRate,
          bitRateUnit: pickBitRateUnit(bitRate),
          language: str(t.Language),
          title: str(t.Title),
          isDefault: flag(t.Default),
          isForced: flag(t.Forced),
        });
        break;
      }
      case 'text': {
        const title = str(t.Title);
        sheet.text.push({
          kind: 'text',
          format: str(t.Format),
          language: str(t.Language),
          title,
          isDefault: flag(t.Default),
          isForced: flag(t.Forced),
          isSdh: SDH_RE.test(asText(title)),
        });
        break;
      }
    }
  }
  return sheet;
}

/**
 * Analyse a local file with mediainfo.js.
 *
 * The module and its WASM (~3 MB) are imported dynamically: nothing is
 * downloaded until the user actually drops a file. `readChunk` only returns
 * the slices the library asks for, so a 40 GB file is never loaded into
 * memory.
 */
export async function analyzeFile(file: File): Promise<TechnicalSheet> {
  const { default: mediaInfoFactory } = await import('mediainfo.js');
  // The package exposes its binary; `?url` lets Vite emit it as an asset
  // served from our own origin (no CDN, consistent with the CSP).
  const wasmUrl = (await import('mediainfo.js/MediaInfoModule.wasm?url')).default;

  const mediaInfo = await mediaInfoFactory({
    format: 'object',
    locateFile: () => wasmUrl,
  });

  try {
    const result = await mediaInfo.analyzeData(
      () => file.size,
      (chunkSize: number, offset: number) =>
        new Promise<Uint8Array>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) =>
            resolve(new Uint8Array((e.target?.result as ArrayBuffer) ?? new ArrayBuffer(0)));
          reader.onerror = () => reject(reader.error ?? new Error('read failed'));
          reader.readAsArrayBuffer(file.slice(offset, offset + chunkSize));
        }),
    );
    const sheet = sheetFromMediaInfoJson(result);
    sheet.fileName = sheet.fileName ?? file.name;
    // The container does not always know its own size; the `File` does.
    sheet.fileSize = sheet.fileSize ?? file.size;
    sheet.fileSizeUnit = sheet.fileSizeUnit ?? pickSizeUnit(sheet.fileSize);
    return sheet;
  } finally {
    mediaInfo.close();
  }
}
