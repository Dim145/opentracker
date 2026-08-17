/**
 * Nom de release normalisé et NFO, dérivés des données techniques.
 *
 * Deux sorties distinctes de la fiche BBCode : le nom de release sert à
 * nommer le torrent, le NFO à le documenter. Les deux se déduisent de ce
 * qu'on sait déjà — l'utilisateur n'a rien à ressaisir — mais restent
 * modifiables, parce qu'aucune déduction n'est fiable à 100 %.
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
 * Codec vidéo dans la forme courte attendue dans un nom de release.
 *
 * Même distinction que sur la fiche : `x264` pour un ré-encodage, `H264`
 * pour un flux d'origine. Ignorer l'encodeur donnait un nom en `H264` sur
 * une release manifestement encodée en x264 — en contradiction avec le
 * codec annoncé juste au-dessus dans la même fiche.
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
 * Langue en majuscules : FRENCH, VOSTFR, MULTi…
 *
 * La convention des trackers francophones ne décrit pas la piste audio mais
 * ce que l'utilisateur va entendre et lire : une VO sous-titrée en français
 * s'annonce VOSTFR, pas JAPANESE. D'où le croisement avec les sous-titres.
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
 * Équipe de release, déduite du nom de fichier d'origine.
 *
 * L'équipe suit le premier tiret du DERNIER segment de la release (celui que
 * séparent les points ou les espaces). Découper au dernier tiret du nom
 * entier amputait les noms composés : « x264-Foo-Bar » ne rendait que
 * « Bar ». Déduction volontairement prudente pour le reste — on refuse ce
 * qui ressemble à un fragment technique plutôt que de proposer n'importe quoi.
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

/** Déduit tout ce qui est déductible ; les trous restent à la main. */
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
 * `Titre.Annee.LANGUE.Resolution.Source.Audio.Video-TEAM`
 *
 * Les segments absents sont simplement omis : un nom incomplet reste
 * utilisable, alors qu'un nom truffé de « undefined » ne l'est pas.
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
 * NFO texte : le nom de la release, puis le bloc MediaInfo du modèle.
 *
 * Le bloc est toujours rendu depuis `TechnicalSheet`, jamais depuis la sortie
 * brute conservée dans `sheet.raw` : le modèle est la seule source de vérité,
 * si bien qu'une piste ajoutée ou corrigée à l'étape technique se retrouve
 * dans le NFO. C'est aussi ce qui rend l'aller-retour sans perte, puisque
 * `renderMediaInfo` écrit exactement les libellés que le parseur relit.
 */
export function buildNfo(releaseName: string, sheet: TechnicalSheet): string {
  const head = releaseName.trim();
  const body = renderMediaInfo(sheet);
  if (!body) return head ? `${head}\n` : '';
  return head ? `${head}\n\n${body}\n` : `${body}\n`;
}
