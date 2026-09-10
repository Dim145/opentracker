import { detectMediaId, type DetectedMediaId } from '~/utils/mediaIdDetect';

/**
 * Ce que la barre du catalogue comprend en tapant.
 *
 * Une recherche de tracker ressemble à « frieren 1080p x265 vostfr s02 » :
 * un titre et des qualificatifs. Ici, chaque mot que l'on sait nommer devient
 * un jeton typé — résolution, source, codec, langue, audio, HDR, saison,
 * épisode, année, uploadeur, identifiant externe — et le reste redevient le
 * texte cherché. Les jetons d'une même famille se cumulent en OU (« 1080p
 * 2160p » = l'une ou l'autre), les familles se croisent en ET.
 *
 * Les alias sont volontairement larges (`x265` et `hevc` désignent le même
 * codec, `vostfr` et `vost` la même langue) : un jeton porte TOUS les slugs
 * qu'il peut vouloir dire, et l'API teste « au moins un existe » — un synonyme
 * absent du vocabulaire de l'instance ne vide pas le résultat.
 */
export type TagKind = 'resolution' | 'source' | 'codec' | 'language' | 'audio' | 'hdr';
export type TokenKind =
  | TagKind
  | 'season'
  | 'episode'
  | 'year'
  | 'uploader'
  | 'imdb'
  | 'tmdb'
  | 'tvdb';

export interface SearchToken {
  kind: TokenKind;
  /** Ce que l'utilisateur a tapé, tel quel, pour la puce. */
  raw: string;
  /** La valeur canonique : slugs d'étiquette, numéro, nom, identifiant. */
  value: string;
  /** Pour les familles d'étiquettes : les slugs équivalents (OU). */
  slugs?: string[];
}

/** Les familles portées par les étiquettes, et leurs alias → slugs. */
const TAG_KINDS: readonly TagKind[] = ['resolution', 'source', 'codec', 'language', 'audio', 'hdr'];

const ALIASES: Record<TagKind, Record<string, string[]>> = {
  resolution: {
    '480p': ['480p'],
    '576p': ['576p'],
    '720p': ['720p'],
    '1080p': ['1080p'],
    '1080i': ['1080i', '1080p'],
    '2160p': ['2160p', '4k', 'uhd'],
    '4k': ['2160p', '4k', 'uhd'],
    uhd: ['2160p', '4k', 'uhd'],
    '4320p': ['4320p', '8k'],
    '8k': ['4320p', '8k'],
  },
  source: {
    bluray: ['bluray', 'blu-ray', 'bdrip', 'brrip'],
    'blu-ray': ['bluray', 'blu-ray', 'bdrip', 'brrip'],
    bdrip: ['bdrip', 'bluray'],
    brrip: ['brrip', 'bluray'],
    remux: ['remux'],
    web: ['web', 'web-dl', 'webrip'],
    'web-dl': ['web-dl', 'web'],
    webdl: ['web-dl', 'web'],
    webrip: ['webrip', 'web'],
    hdtv: ['hdtv'],
    dvdrip: ['dvdrip', 'dvd'],
    dvd: ['dvd', 'dvdrip'],
    cam: ['cam'],
    ts: ['ts', 'telesync'],
  },
  codec: {
    x264: ['x264', 'avc', 'h264', 'h-264'],
    h264: ['h264', 'h-264', 'avc', 'x264'],
    'h.264': ['h264', 'h-264', 'avc', 'x264'],
    avc: ['avc', 'x264', 'h264'],
    x265: ['x265', 'hevc', 'h265', 'h-265'],
    h265: ['h265', 'h-265', 'hevc', 'x265'],
    'h.265': ['h265', 'h-265', 'hevc', 'x265'],
    hevc: ['hevc', 'x265', 'h265'],
    av1: ['av1'],
    xvid: ['xvid'],
    vp9: ['vp9'],
  },
  language: {
    vf: ['vf', 'vff', 'vfq', 'french', 'truefrench'],
    vff: ['vff', 'vf', 'truefrench'],
    vfq: ['vfq', 'vf'],
    vfi: ['vfi', 'vf'],
    truefrench: ['truefrench', 'vff', 'vf'],
    french: ['french', 'vf', 'vff'],
    vostfr: ['vostfr', 'vost'],
    vost: ['vost', 'vostfr'],
    vo: ['vo', 'english'],
    english: ['english', 'vo'],
    multi: ['multi', 'multi-vf', 'multi-vff'],
    'multi-vf': ['multi-vf', 'multi'],
    'multi-vff': ['multi-vff', 'multi'],
    'multi-vfq': ['multi-vfq', 'multi'],
    subfrench: ['subfrench', 'vostfr'],
  },
  audio: {
    aac: ['aac'],
    ac3: ['ac-3', 'ac3', 'dd', 'dolby-digital'],
    'ac-3': ['ac-3', 'ac3', 'dd'],
    dd: ['dd', 'ac-3'],
    eac3: ['eac-3', 'eac3', 'ddp', 'dd-plus'],
    'eac-3': ['eac-3', 'eac3', 'ddp'],
    ddp: ['ddp', 'eac-3', 'dd-plus'],
    'dd+': ['ddp', 'eac-3', 'dd-plus'],
    dts: ['dts', 'dts-hd', 'dts-hd-ma', 'dts-x'],
    'dts-hd': ['dts-hd', 'dts-hd-ma'],
    'dts-x': ['dts-x'],
    dtsx: ['dts-x'],
    atmos: ['atmos'],
    truehd: ['truehd', 'true-hd'],
    'true-hd': ['truehd', 'true-hd'],
    flac: ['flac'],
    opus: ['opus'],
    '2.0': ['2-0', 'stereo'],
    stereo: ['stereo', '2-0'],
    '5.1': ['5-1'],
    '7.1': ['7-1'],
  },
  hdr: {
    hdr: ['hdr', 'hdr10', 'hdr10plus', 'hdr10-plus', 'dolby-vision', 'dv'],
    hdr10: ['hdr10', 'hdr'],
    'hdr10+': ['hdr10plus', 'hdr10-plus', 'hdr'],
    hdr10plus: ['hdr10plus', 'hdr10-plus', 'hdr'],
    dv: ['dv', 'dolby-vision'],
    dovi: ['dolby-vision', 'dv'],
    'dolby-vision': ['dolby-vision', 'dv'],
    dolbyvision: ['dolby-vision', 'dv'],
    sdr: ['sdr'],
  },
};

/** Chaque slug connu → sa famille ; la première famille qui le nomme gagne. */
const KIND_OF_SLUG: Map<string, TagKind> = (() => {
  const m = new Map<string, TagKind>();
  for (const kind of TAG_KINDS) {
    for (const slugs of Object.values(ALIASES[kind])) {
      for (const slug of slugs) if (!m.has(slug)) m.set(slug, kind);
    }
  }
  return m;
})();

/** La famille d'un slug d'étiquette, ou `null` s'il n'en a pas (proper, 10bit…). */
export function kindOfSlug(slug: string): TagKind | null {
  return KIND_OF_SLUG.get(slug.toLowerCase()) ?? null;
}

/** Ce slug est-il déjà dans un jeton ? */
export function hasSlug(tokens: SearchToken[], slug: string): boolean {
  return tokens.some((t) => t.slugs?.includes(slug));
}

/**
 * Coche ou décoche un slug depuis le rail : un jeton par famille, ses slugs en
 * OU. Un slug coché depuis le rail vaut pour lui seul — pas pour ses
 * synonymes, c'est le compte affiché à côté qui fait foi.
 */
export function toggleSlug(tokens: SearchToken[], kind: TagKind, slug: string): SearchToken[] {
  const out = tokens.map((t) => ({ ...t, slugs: t.slugs ? [...t.slugs] : undefined }));
  const same = out.find((t) => t.kind === kind);
  if (!same) return [...out, { kind, raw: slug, value: slug, slugs: [slug] }];
  const current = same.slugs ?? [];
  same.slugs = current.includes(slug) ? current.filter((s) => s !== slug) : [...current, slug];
  // Virgules, pas espaces : l'URL porte alors UN mot qui est la liste exacte,
  // et `tokenize` la relit sans repasser par la table des synonymes. Avec des
  // espaces, décocher « hevc » ne survivait pas au rechargement — le mot
  // « x265 » ré-étendait toute sa famille.
  same.raw = same.slugs.join(',');
  same.value = same.slugs[0] ?? '';
  return same.slugs.length ? out : out.filter((t) => t !== same);
}

/** Ce qu'un mot devient, ou `null` s'il fait partie du texte cherché. */
export function tokenize(word: string): SearchToken | null {
  const raw = word.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  if (lower.startsWith('@') && lower.length > 1 && /^@[\w.-]{1,64}$/.test(lower)) {
    return { kind: 'uploader', raw, value: raw.slice(1) };
  }

  // s02e04 / s02 / e04 / saison 2 arrive séparé (« saison », « 2 ») : on ne
  // reconnaît que la forme compacte, la seule non ambiguë sans contexte.
  const se = lower.match(/^s(\d{1,3})(?:e(\d{1,4}))?$/);
  if (se) {
    // s02e04 : deux jetons — l'appelant les recompose via `tokenizeAll`.
    return { kind: 'season', raw, value: String(Number(se[1])), slugs: se[2] ? [String(Number(se[2]))] : undefined };
  }
  const ep = lower.match(/^e(?:p)?(\d{1,4})$/);
  if (ep) return { kind: 'episode', raw, value: String(Number(ep[1])) };

  if (/^(19|20)\d{2}$/.test(lower)) return { kind: 'year', raw, value: lower };

  // Une liste explicite (`x265,h265,h-265`) : ce que le rail a coché, tel quel.
  // Aucune extension par synonymes, sinon décocher n'aurait aucun effet durable.
  if (lower.includes(',')) {
    const parts = Array.from(new Set(lower.split(',').map((p) => p.trim()).filter(Boolean)));
    const kinds = new Set(parts.map((p) => KIND_OF_SLUG.get(p)));
    const only = parts.length > 0 && kinds.size === 1 ? [...kinds][0] : undefined;
    if (only) return { kind: only, raw: parts.join(','), value: parts[0]!, slugs: parts };
  }

  for (const kind of TAG_KINDS) {
    const slugs = ALIASES[kind][lower];
    if (slugs) return { kind, raw, value: slugs[0]!, slugs: Array.from(new Set(slugs)) };
  }
  // Un slug d'étiquette que le rail a coché (`2-0`, `dolby-vision`) : il n'est
  // pas une clé d'alias mais il a une famille, il doit survivre à l'URL.
  const slugKind = KIND_OF_SLUG.get(lower);
  if (slugKind) return { kind: slugKind, raw, value: lower, slugs: [lower] };

  const media: DetectedMediaId | null = detectMediaId(raw);
  if (media && (media.source === 'imdb' || media.source === 'tmdb' || media.source === 'tvdb')) {
    return { kind: media.source, raw, value: media.id };
  }
  return null;
}

/** Une saisie entière → ses jetons et le texte restant. */
export function parseSearchInput(input: string): { tokens: SearchToken[]; text: string } {
  const tokens: SearchToken[] = [];
  const rest: string[] = [];
  for (const word of input.split(/\s+/)) {
    if (!word) continue;
    const t = tokenize(word);
    if (!t) {
      rest.push(word);
      continue;
    }
    if (t.kind === 'season' && t.slugs?.length) {
      // s02e04 : la saison porte l'épisode dans `slugs` le temps du transport.
      const episode = t.slugs[0]!;
      tokens.push({ kind: 'season', raw: t.raw, value: t.value });
      tokens.push({ kind: 'episode', raw: t.raw, value: episode });
      continue;
    }
    tokens.push(t);
  }
  return { tokens: mergeTokens(tokens), text: rest.join(' ') };
}

/**
 * Deux jetons de la même famille d'étiquettes ne font qu'un groupe (OU) ; un
 * numéro ou un nom ne peut valoir qu'une fois — le dernier tapé gagne.
 */
export function mergeTokens(tokens: SearchToken[]): SearchToken[] {
  const out: SearchToken[] = [];
  for (const t of tokens) {
    const isTagKind = (TAG_KINDS as readonly string[]).includes(t.kind);
    if (isTagKind) {
      const same = out.find((o) => o.kind === t.kind);
      if (same) {
        same.slugs = Array.from(new Set([...(same.slugs ?? []), ...(t.slugs ?? [])]));
        // Deux mots d'une même famille : le libellé les joint, et la forme
        // reste celle que `tokenize` sait relire (virgules si l'un est une liste).
        same.raw = same.raw.includes(',') || t.raw.includes(',') ? same.slugs.join(',') : `${same.raw} ${t.raw}`;
        continue;
      }
      out.push({ ...t, slugs: [...(t.slugs ?? [])] });
      continue;
    }
    const idx = out.findIndex((o) => o.kind === t.kind);
    if (idx >= 0) out.splice(idx, 1);
    out.push({ ...t });
  }
  return out;
}

/**
 * La place du groupe d'une famille dans `tagGroups` (même ordre que
 * `tokensToQuery`), ou -1 si la famille n'a pas de jeton : c'est la clé de
 * `tagsByGroup` dans la réponse des facettes.
 */
export function tagGroupIndex(tokens: SearchToken[], kind: TagKind): number {
  const groups = tokens.filter((t) => (TAG_KINDS as readonly string[]).includes(t.kind) && t.slugs?.length);
  return groups.findIndex((t) => t.kind === kind);
}

/** Les paramètres d'API que ces jetons produisent (voir `torrentQuerySchema`). */
export function tokensToQuery(tokens: SearchToken[]): Record<string, string | undefined> {
  const groups = tokens
    .filter((t) => (TAG_KINDS as readonly string[]).includes(t.kind) && t.slugs?.length)
    .map((t) => t.slugs!.join(','));
  const one = (kind: TokenKind) => tokens.find((t) => t.kind === kind)?.value;
  return {
    tagGroups: groups.length ? groups.join(';') : undefined,
    season: one('season'),
    episode: one('episode'),
    year: one('year'),
    uploader: one('uploader'),
  };
}

/**
 * Les paramètres d'URL — courts, lisibles, et surtout REVERSIBLES : le
 * groupe garde le mot tapé (`x265`, pas ses quatre slugs) pour que la puce
 * se relise à l'identique après un rechargement.
 */
export function tokensToUrl(tokens: SearchToken[]): Record<string, string | undefined> {
  const words = tokens
    .filter((t) => (TAG_KINDS as readonly string[]).includes(t.kind))
    .flatMap((t) => t.raw.split(' '));
  const one = (kind: TokenKind) => tokens.find((t) => t.kind === kind)?.value;
  return {
    tk: words.length ? words.join(' ') : undefined,
    se: one('season'),
    ep: one('episode'),
    y: one('year'),
    u: one('uploader'),
  };
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** L'inverse de `tokensToUrl` : ce que la page relit au chargement. */
export function tokensFromQuery(query: Record<string, unknown>): SearchToken[] {
  const tokens: SearchToken[] = [];
  const tk = str(query.tk);
  if (tk) tokens.push(...parseSearchInput(tk).tokens.filter((t) => (TAG_KINDS as readonly string[]).includes(t.kind)));
  const se = str(query.se);
  if (se && /^\d{1,3}$/.test(se)) tokens.push({ kind: 'season', raw: `s${se.padStart(2, '0')}`, value: String(Number(se)) });
  const ep = str(query.ep);
  if (ep && /^\d{1,4}$/.test(ep)) tokens.push({ kind: 'episode', raw: `e${ep.padStart(2, '0')}`, value: String(Number(ep)) });
  const y = str(query.y);
  if (y && /^(19|20)\d{2}$/.test(y)) tokens.push({ kind: 'year', raw: y, value: y });
  const u = str(query.u);
  if (u && /^[\w.-]{1,64}$/.test(u)) tokens.push({ kind: 'uploader', raw: `@${u}`, value: u });
  return mergeTokens(tokens);
}

/** Les slugs qu'une recherche enregistrée peut retenir de ces jetons. */
export function tokenSlugs(tokens: SearchToken[]): string[] {
  return Array.from(new Set(tokens.flatMap((t) => (t.slugs?.length ? [t.slugs[0]!] : []))));
}

/** Le texte de la puce : « S02 », « E04 », « @nom », ou le mot tapé. */
export function tokenLabel(t: SearchToken): string {
  if (t.kind === 'season') return `S${t.value.padStart(2, '0')}`;
  if (t.kind === 'episode') return `E${t.value.padStart(2, '0')}`;
  if (t.kind === 'uploader') return `@${t.value}`;
  if (t.kind === 'imdb' || t.kind === 'tmdb' || t.kind === 'tvdb') return t.value;
  // Une liste explicite se lit avec des points médians, pas avec des virgules collées.
  return t.raw.includes(',') ? t.raw.split(',').join(' · ') : t.raw;
}

export const TAG_TOKEN_KINDS = TAG_KINDS;
