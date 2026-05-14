/**
 * TMDb metadata source — movies + TV shows.
 *
 * Exposes three `MediaSource` instances that share a single
 * implementation: native TMDb lookup, and IMDb / TVDB lookups
 * routed via TMDb's `/find/{external_id}?external_source=…`
 * endpoint. Each source advertises the same `handles` (`movie`,
 * `tv`) and the façade picks one based on the `source` query
 * param.
 *
 * Caching: every call goes through Redis. Positive hits live for
 * 24h, negative results for 1h (so an operator can fix a typo
 * without bouncing the API).
 *
 * Operator opt-in: set `TMDB_API_KEY=…` in the environment.
 * Without it `isEnabled()` returns false and the route surfaces
 * a 503 with a "feature not configured" message.
 */
import { redis } from '../server';
import { normalizeImdbId, normalizeTmdbId, normalizeTvdbId } from '../mediaIds';
import type {
  MediaMetadata,
  MediaSearchHit,
  MediaSource,
  MediaTypeHint,
} from './types';
import { META_TTL, NEG_SENTINEL } from './types';

const TMDB_BASE = 'https://api.themoviedb.org/3';
const POSTER_SIZE = 'w500';
const BACKDROP_SIZE = 'w1280';

/**
 * TMDb supports two credential shapes — legacy v3 API key (32-char
 * hex) and v4 Read-Only Access Token (JWT). We auto-detect by
 * checking the dot-separated structure so the env var stays a
 * single `TMDB_API_KEY`.
 */
type Credential =
  | { kind: 'apiKey'; value: string }
  | { kind: 'bearer'; value: string };

function getCredential(): Credential {
  const value = process.env.TMDB_API_KEY;
  if (!value) {
    throw createError({
      statusCode: 503,
      message:
        'TMDb integration is not configured. Set TMDB_API_KEY in the environment (either a v3 API key or a v4 Read-Only Access Token) to enable rich metadata.',
    });
  }
  const trimmed = value.trim();
  if (trimmed.includes('.')) return { kind: 'bearer', value: trimmed };
  return { kind: 'apiKey', value: trimmed };
}

async function tmdbGet<T = any>(
  path: string,
  params: Record<string, string>,
  cred: Credential
): Promise<T | null> {
  const search =
    cred.kind === 'apiKey'
      ? new URLSearchParams({ api_key: cred.value, ...params }).toString()
      : new URLSearchParams(params).toString();
  const url = search ? `${TMDB_BASE}${path}?${search}` : `${TMDB_BASE}${path}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (cred.kind === 'bearer') headers.Authorization = `Bearer ${cred.value}`;

  try {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      if (res.status === 404) return null;
      console.warn(`[metadata:tmdb] ${res.status} on ${path}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`[metadata:tmdb] fetch failed for ${path}:`, err);
    return null;
  }
}

function normalizeDetail(type: 'movie' | 'tv', data: any): MediaMetadata {
  const isMovie = type === 'movie';
  const title = (isMovie ? data.title : data.name) || '';
  const originalTitle = (isMovie ? data.original_title : data.original_name) || '';
  const releaseDate = isMovie ? data.release_date : data.first_air_date;
  const runtime = isMovie
    ? typeof data.runtime === 'number' && data.runtime > 0
      ? data.runtime
      : null
    : Array.isArray(data.episode_run_time) && data.episode_run_time[0] > 0
      ? data.episode_run_time[0]
      : null;
  const tvdbId =
    typeof data.external_ids?.tvdb_id === 'number'
      ? data.external_ids.tvdb_id
      : null;

  return {
    source: 'tmdb',
    type,
    tmdbId: data.id,
    imdbId: data.external_ids?.imdb_id || data.imdb_id || null,
    tvdbId,
    title,
    originalTitle:
      originalTitle && originalTitle !== title ? originalTitle : null,
    tagline: data.tagline || null,
    year: releaseDate
      ? parseInt(String(releaseDate).slice(0, 4), 10) || null
      : null,
    overview: data.overview || null,
    posterUrl: data.poster_path
      ? `https://image.tmdb.org/t/p/${POSTER_SIZE}${data.poster_path}`
      : null,
    backdropUrl: data.backdrop_path
      ? `https://image.tmdb.org/t/p/${BACKDROP_SIZE}${data.backdrop_path}`
      : null,
    genres: Array.isArray(data.genres)
      ? data.genres
          .map((g: any) => g?.name)
          .filter((n: unknown): n is string => typeof n === 'string')
      : [],
    runtime,
    voteAverage:
      typeof data.vote_average === 'number' ? data.vote_average : null,
    voteCount:
      typeof data.vote_count === 'number' ? data.vote_count : null,
    url: `https://www.themoviedb.org/${type}/${data.id}`,
  };
}

async function fetchDetail(
  type: 'movie' | 'tv',
  id: string | number,
  cred: Credential
): Promise<MediaMetadata | null> {
  const data = await tmdbGet<any>(
    `/${type}/${id}`,
    { append_to_response: 'external_ids', language: 'en-US' },
    cred
  );
  if (!data) return null;
  return normalizeDetail(type, data);
}

// ── Internal lookup helpers (shared by the three source vues) ──

/**
 * Native TMDb id lookup. `typeHint` disambiguates between TMDb's
 * movie/tv namespaces — same numeric id can exist in both. The
 * hint may also be encoded in the `id` itself as a `tv/N` /
 * `movie/N` prefix.
 */
async function lookupByTmdb(
  id: string,
  hint?: MediaTypeHint
): Promise<MediaMetadata | null> {
  const cred = getCredential();
  const cacheKey = `meta:v1:tmdb:${hint ?? 'auto'}:${id}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached === NEG_SENTINEL) return null;
    if (cached) return JSON.parse(cached) as MediaMetadata;
  } catch {
    /* Redis hiccup — fall through to network */
  }

  const prefixed = id.match(/^(movie|tv)\/(\d+)$/);
  const inferredType = prefixed ? (prefixed[1] as 'movie' | 'tv') : null;
  const bareId = prefixed ? prefixed[2]! : id;
  const tmdbType =
    hint === 'movie' || hint === 'tv' ? hint : inferredType ?? null;

  let result: MediaMetadata | null = null;
  if (tmdbType) {
    result = await fetchDetail(tmdbType, bareId, cred);
  } else {
    result = await fetchDetail('movie', bareId, cred);
    result ??= await fetchDetail('tv', bareId, cred);
  }

  try {
    if (result) {
      await redis.setex(cacheKey, META_TTL.POS_S, JSON.stringify(result));
    } else {
      await redis.setex(cacheKey, META_TTL.NEG_S, NEG_SENTINEL);
    }
  } catch {
    /* cache write failure non-fatal */
  }
  return result;
}

/**
 * /find resolves an external id (IMDb tt-form or TVDB integer) to
 * the corresponding TMDb id; we then re-fetch the full record so
 * the response shape is consistent across all three sources.
 */
async function lookupByExternal(
  externalSource: 'imdb' | 'tvdb',
  id: string,
  hint?: MediaTypeHint
): Promise<MediaMetadata | null> {
  const cred = getCredential();
  const cacheKey = `meta:v1:${externalSource}:${hint ?? 'auto'}:${id}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached === NEG_SENTINEL) return null;
    if (cached) return JSON.parse(cached) as MediaMetadata;
  } catch {
    /* Redis hiccup — fall through to network */
  }

  const find = await tmdbGet<any>(
    `/find/${id}`,
    {
      external_source: externalSource === 'imdb' ? 'imdb_id' : 'tvdb_id',
    },
    cred
  );
  const movieMatch = find?.movie_results?.[0];
  const tvMatch = find?.tv_results?.[0];

  let result: MediaMetadata | null = null;
  if (hint === 'tv' && tvMatch?.id) {
    result = await fetchDetail('tv', tvMatch.id, cred);
  } else if (hint === 'movie' && movieMatch?.id) {
    result = await fetchDetail('movie', movieMatch.id, cred);
  } else if (movieMatch?.id) {
    result = await fetchDetail('movie', movieMatch.id, cred);
  } else if (tvMatch?.id) {
    result = await fetchDetail('tv', tvMatch.id, cred);
  }

  try {
    if (result) {
      await redis.setex(cacheKey, META_TTL.POS_S, JSON.stringify(result));
    } else {
      await redis.setex(cacheKey, META_TTL.NEG_S, NEG_SENTINEL);
    }
  } catch {
    /* cache write failure non-fatal */
  }
  return result;
}

// ── Search (TMDb only — IMDb / TVDB don't expose a search API) ──

function normaliseHit(type: 'movie' | 'tv', data: any): MediaSearchHit {
  const isMovie = type === 'movie';
  const releaseDate = isMovie ? data.release_date : data.first_air_date;
  return {
    source: 'tmdb',
    type,
    id: String(data.id),
    title: (isMovie ? data.title : data.name) || '',
    originalTitle:
      (isMovie ? data.original_title : data.original_name) || null,
    year: releaseDate
      ? parseInt(String(releaseDate).slice(0, 4), 10) || null
      : null,
    overview: data.overview || null,
    posterUrl: data.poster_path
      ? `https://image.tmdb.org/t/p/${POSTER_SIZE}${data.poster_path}`
      : null,
    voteAverage:
      typeof data.vote_average === 'number' ? data.vote_average : null,
    url: `https://www.themoviedb.org/${type}/${data.id}`,
  };
}

async function searchTmdb(
  query: string,
  hint?: MediaTypeHint,
  options?: { year?: number; includeAdult?: boolean }
): Promise<MediaSearchHit[]> {
  // Movie / TV constrained search; game hint is a no-op (TMDb
  // doesn't serve games).
  const type = hint === 'movie' || hint === 'tv' ? hint : undefined;
  const year = options?.year;
  const includeAdult = options?.includeAdult ?? false;
  const cred = getCredential();
  const trimmed = query.trim();
  if (!trimmed) return [];

  const cacheKey = `meta:v1:search:tmdb:${type ?? 'auto'}:${
    includeAdult ? 'adult' : 'sfw'
  }:${year ?? '-'}:${trimmed.toLowerCase()}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached === NEG_SENTINEL) return [];
    if (cached) return JSON.parse(cached) as MediaSearchHit[];
  } catch {
    /* Redis hiccup */
  }

  const params: Record<string, string> = {
    query: trimmed,
    include_adult: includeAdult ? 'true' : 'false',
    language: 'en-US',
    page: '1',
  };
  const movieParams = { ...params };
  const tvParams = { ...params };
  if (year) {
    movieParams.year = String(year);
    tvParams.first_air_date_year = String(year);
  }

  type RankedHit = MediaSearchHit & { _pop: number };
  let hits: RankedHit[] = [];
  const PAGE_SIZE = 8;

  if (type === 'movie' || !type) {
    const data = await tmdbGet<any>('/search/movie', movieParams, cred);
    if (Array.isArray(data?.results)) {
      hits = hits.concat(
        data.results.slice(0, PAGE_SIZE).map(
          (r: any): RankedHit => ({
            ...normaliseHit('movie', r),
            _pop: typeof r.popularity === 'number' ? r.popularity : 0,
          })
        )
      );
    }
  }
  if (type === 'tv' || !type) {
    const data = await tmdbGet<any>('/search/tv', tvParams, cred);
    if (Array.isArray(data?.results)) {
      hits = hits.concat(
        data.results.slice(0, PAGE_SIZE).map(
          (r: any): RankedHit => ({
            ...normaliseHit('tv', r),
            _pop: typeof r.popularity === 'number' ? r.popularity : 0,
          })
        )
      );
    }
  }

  if (!type) hits.sort((a, b) => b._pop - a._pop);
  const finalHits: MediaSearchHit[] = hits
    .slice(0, PAGE_SIZE)
    .map(({ _pop, ...rest }) => rest);

  try {
    if (finalHits.length > 0) {
      await redis.setex(
        cacheKey,
        META_TTL.SEARCH_S,
        JSON.stringify(finalHits)
      );
    } else {
      await redis.setex(cacheKey, META_TTL.NEG_S, NEG_SENTINEL);
    }
  } catch {
    /* cache write failure non-fatal */
  }
  return finalHits;
}

function isEnabled(): boolean {
  return !!process.env.TMDB_API_KEY;
}

// ── Three sources, one implementation ────────────────────────

export const tmdbSource: MediaSource = {
  id: 'tmdb',
  label: 'TMDb',
  handles: ['movie', 'tv'],
  isEnabled,
  normalizeId: async (input) => normalizeTmdbId(input),
  lookup: lookupByTmdb,
  search: searchTmdb,
};

export const imdbSource: MediaSource = {
  id: 'imdb',
  label: 'IMDb',
  handles: ['movie', 'tv'],
  isEnabled,
  normalizeId: async (input) => normalizeImdbId(input),
  lookup: (id, hint) => lookupByExternal('imdb', id, hint),
  // IMDb has no free-text search exposed through TMDb's /find.
  search: async () => [],
};

export const tvdbSource: MediaSource = {
  id: 'tvdb',
  label: 'TVDB',
  handles: ['movie', 'tv'],
  isEnabled,
  normalizeId: async (input) => normalizeTvdbId(input),
  lookup: (id, hint) => lookupByExternal('tvdb', id, hint),
  search: async () => [],
};
