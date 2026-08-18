/**
 * MediaInfo → modèle de fiche.
 *
 * Deux producteurs, un seul modèle : l'utilisateur peut soit déposer le
 * fichier vidéo (mediainfo.js en WebAssembly le lit dans le navigateur),
 * soit coller la sortie texte de MediaInfo qu'il a déjà sous la main.
 * Les deux chemins convergent vers `TechnicalSheet`, si bien que le
 * générateur BBCode en aval ignore d'où viennent les données.
 *
 * Les grandeurs mesurées (débit, taille) sont stockées en unité de base —
 * bit/s et octets — et jamais sous forme de texte : l'unité affichée n'est
 * qu'une préférence de rendu que l'utilisateur change sans que la valeur
 * bouge. C'est ce qui permet au sélecteur Kbps/Mbps de l'étape technique
 * d'être un simple choix d'affichage plutôt qu'une réécriture de la donnée.
 *
 * Tout est strictement local : le fichier n'est jamais lu par le serveur,
 * seuls quelques kilo-octets d'en-tête et de queue sont réellement
 * parcourus par le WASM.
 */

export type TrackKind = 'video' | 'audio' | 'text';
export type BitRateUnit = 'Kbps' | 'Mbps';
export type SizeUnit = 'GiB' | 'MiB';

/** Nature d'un sous-titre, au sens des trackers. */
export type SubtitleKind = 'full' | 'forced' | 'sdh';

export interface MediaTrack {
  kind: TrackKind;
  format?: string;
  profile?: string;
  width?: number;
  height?: number;
  /** Nombre nu, sans « FPS ». */
  frameRate?: string;
  /** Débit en bit/s. */
  bitRate?: number;
  /** Unité d'affichage seulement — ne change pas `bitRate`. */
  bitRateUnit?: BitRateUnit;
  /** Nombre nu, sans « bits ». */
  bitDepth?: string;
  /** Disposition normalisée : « 2.0 », « 5.1 »… */
  channels?: string;
  /** Encodeur déclaré (« x264 ») — distingue un ré-encodage d'un remux. */
  encoder?: string;
  language?: string;
  title?: string;
  isDefault?: boolean;
  isForced?: boolean;
  /** Sous-titres pour sourds et malentendants. */
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
 * `String(v)` avant toute méthode de chaîne, systématiquement.
 *
 * mediainfo.js rend `FrameRate`, `BitDepth`, `Width`… comme des NOMBRES là
 * où la sortie texte ne donne que des chaînes. Un `.replace()` sur un nombre
 * lève un TypeError dans un `computed`, ce qui vide la page entière. Passer
 * par ici plutôt que se fier au typage rend ce plantage impossible.
 */
function asText(v: unknown): string {
  return v === undefined || v === null ? '' : String(v);
}

/** Normalise les séparateurs de MediaInfo : espaces fines, insécables, virgule. */
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
 * « 192 kb/s », « 8 000 kb/s », « 8.05 Mbps », « 8000000 » → bit/s.
 * Un nombre nu est déjà en bit/s, comme le rend mediainfo.js.
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

/** Au-delà du mégabit, le Kbps devient illisible — c'est le seuil de bascule. */
export function pickBitRateUnit(bps?: number): BitRateUnit {
  return bps && bps >= 1_000_000 ? 'Mbps' : 'Kbps';
}

/** bit/s → valeur exprimée dans l'unité demandée (pour les champs de saisie). */
export function bitRateIn(bps: number | undefined, unit: BitRateUnit): number | undefined {
  if (!bps) return undefined;
  const scaled = unit === 'Mbps' ? bps / 1_000_000 : bps / 1_000;
  return Number(scaled.toFixed(unit === 'Mbps' ? 2 : 0));
}

/** Inverse de `bitRateIn` : la saisie repart en bit/s. */
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

/** Forme MediaInfo, pour la ré-émission d'un bloc lisible : « 8 000 kb/s ». */
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
 * « 8 channels » / « 6 » → « 7.1 » / « 5.1 ». MediaInfo n'est pas homogène,
 * et la fonction doit rester idempotente : elle reçoit aussi bien la valeur
 * brute du décodeur que la disposition déjà normalisée qu'un select renvoie.
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

/** « 5.1 » → 6 : le compte de canaux qu'attend un bloc MediaInfo. */
export function layoutToChannels(layout?: string): number | undefined {
  const m = /^(\d+)\.(\d)$/.exec(asText(layout).trim());
  if (m) return Number.parseInt(m[1]!, 10) + Number.parseInt(m[2]!, 10);
  const n = Number.parseInt(asText(layout).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Noms commerciaux. MediaInfo rend le nom technique du codec ; sur une
 * fiche on attend le nom que les gens reconnaissent.
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
 * Codec vidéo tel qu'on l'annonce sur une fiche.
 *
 * `x264` et `H.264` désignent le même format mais pas la même release : le
 * premier signale un ré-encodage, le second un flux d'origine (remux, WEB
 * non retouché). L'encodeur déclaré par le conteneur tranche — c'est la
 * seule information fiable dont on dispose pour les distinguer.
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
 * Conteneur sous le nom que tout le monde emploie. MediaInfo dit
 * « Matroska » là où une fiche annonce « MKV » — et où le select de
 * l'étape technique propose « MKV ».
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
 * 3840×2160 → « 2160p ».
 *
 * Un palier est atteint dès que la largeur OU la hauteur y arrive, à 5 %
 * près : un master cinéma perd de la hauteur au rognage (1920×800 reste du
 * 1080p) et un master anamorphique perd de la largeur (1440×1080 aussi).
 * Se fier à la seule hauteur déclassait le premier cas en 720p.
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

/** Indices d'un sous-titre SDH — aucun conteneur ne porte le drapeau. */
const SDH_RE = /\b(sdh|hearing[\s-]?impaired|malentendant)/i;

/**
 * Parse la sortie texte de MediaInfo : des blocs séparés par une ligne
 * vide, chacun ouvert par son nom puis des paires `clé : valeur`.
 * Tolérant aux libellés français comme anglais.
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
 * Ré-émet un bloc MediaInfo depuis le modèle.
 *
 * Le format de sortie est celui de MediaInfo lui-même, pas un résumé
 * maison : c'est ce que `parseMediaInfoText` sait relire, si bien que le
 * texte proposé à l'étape technique peut être corrigé à la main puis
 * réinjecté sans rien perdre. Un résumé aux libellés inventés cassait ce
 * cycle — il rendait `Resolution : 1080p` que le parseur ignorait, et la
 * largeur comme la hauteur disparaissaient au premier aller-retour.
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
 * En `format: 'object'`, mediainfo.js ne produit AUCUN champ `_String` :
 * ni `FileSize_String`, ni `Duration_String`, ni `BitRate_String`. Seules
 * les valeurs brutes existent, et elles sont numériques. Les lire telles
 * quelles donnait « Débit vidéo : 8000000 » sur la fiche et laissait la
 * taille comme la durée vides. On lit donc le nombre et on met en forme
 * ici, en acceptant quand même les `_String` au cas où une version future
 * les rétablirait.
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

/** Convertit le JSON de mediainfo.js vers le même modèle. */
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
 * Analyse un fichier local avec mediainfo.js.
 *
 * Le module et son WASM (~3 Mo) sont importés dynamiquement : rien n'est
 * téléchargé tant que l'utilisateur n'a pas réellement déposé un fichier.
 * `readChunk` ne remonte que les tranches réclamées par la bibliothèque,
 * donc un fichier de 40 Go n'est jamais chargé en mémoire.
 */
export async function analyzeFile(file: File): Promise<TechnicalSheet> {
  const { default: mediaInfoFactory } = await import('mediainfo.js');
  // Le paquet expose son binaire ; `?url` laisse Vite l'émettre comme asset
  // servi par notre propre origine (aucun CDN, cohérent avec le CSP).
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
    // Le conteneur ne connaît pas toujours sa propre taille ; le `File`, si.
    sheet.fileSize = sheet.fileSize ?? file.size;
    sheet.fileSizeUnit = sheet.fileSizeUnit ?? pickSizeUnit(sheet.fileSize);
    return sheet;
  } finally {
    mediaInfo.close();
  }
}
