/**
 * External media metadata lookup (issue #47, comment thread).
 *
 * Single integration target: TMDb. It's free, fast, and exposes a
 * `/find/{id}?external_source=imdb_id|tvdb_id` endpoint that
 * cross-references the other two databases — so we get IMDb / TMDb /
 * TVDB lookups from one API key and can return a single normalised
 * shape regardless of which id the user typed.
 *
 * Caching: every call goes through a Redis read first. Hits are kept
 * for 24h (metadata is fairly stable); negative results (no match) get
 * a 1h TTL so an operator can fix a typo and have the page re-resolve
 * within an hour without restarting the API.
 *
 * Operator opt-in: set `TMDB_API_KEY=...` in the environment. Without
 * it the helper throws a 503-style createError so the lookup endpoint
 * tells the UI integration is disabled rather than failing silently.
 */
import { redis } from './server';

export interface MediaMetadata {
  source: 'tmdb';
  type: 'movie' | 'tv';
  tmdbId: number;
  imdbId: string | null;
  tvdbId: number | null;
  title: string;
  originalTitle: string | null;
  tagline: string | null;
  year: number | null;
  overview: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  genres: string[];
  runtime: number | null; // minutes; for TV this is the per-episode runtime
  voteAverage: number | null; // 0–10
  voteCount: number | null;
  url: string; // canonical TMDb URL
}

const TMDB_BASE = 'https://api.themoviedb.org/3';
const POSTER_SIZE = 'w500';
const BACKDROP_SIZE = 'w1280';
const POS_TTL_S = 60 * 60 * 24; // 24h
const NEG_TTL_S = 60 * 60; // 1h
const NEG_SENTINEL = '__null__';

/**
 * TMDb supports two credential shapes that both authenticate v3 calls:
 *   - the legacy v3 API key (32-char hex), passed as `?api_key=…`
 *   - the v4 Read-Only Access Token (a JWT), passed as
 *     `Authorization: Bearer …`
 *
 * Both come out of the operator's TMDb account settings page, and a
 * given install will only have one. We auto-detect which by looking
 * for the JWT's dot-separated structure (header.payload.signature) so
 * the env var stays a single `TMDB_API_KEY`.
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
  // A JWT always has two dots; an API key is alphanumeric/hex with
  // no dots. Trim first to be tolerant of trailing whitespace from
  // copy-paste.
  const trimmed = value.trim();
  if (trimmed.includes('.')) {
    return { kind: 'bearer', value: trimmed };
  }
  return { kind: 'apiKey', value: trimmed };
}

async function tmdbGet<T = any>(
  path: string,
  params: Record<string, string>,
  cred: Credential
): Promise<T | null> {
  // Build query string. With a Bearer token, the api_key param is
  // omitted — TMDb will read the credential from the Authorization
  // header instead.
  const search =
    cred.kind === 'apiKey'
      ? new URLSearchParams({ api_key: cred.value, ...params }).toString()
      : new URLSearchParams(params).toString();
  const url = search ? `${TMDB_BASE}${path}?${search}` : `${TMDB_BASE}${path}`;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (cred.kind === 'bearer') {
    headers.Authorization = `Bearer ${cred.value}`;
  }

  try {
    const res = await fetch(url, {
      headers,
      // TMDb is normally <100ms; cap so a transient slowdown doesn't
      // hold a user-facing request open.
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      // 404 is "not found" — caller treats it as null. Anything else is
      // a real error worth surfacing.
      if (res.status === 404) return null;
      console.warn(`[metadata] TMDb ${res.status} on ${path}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`[metadata] TMDb fetch failed for ${path}:`, err);
    return null;
  }
}

function normalize(type: 'movie' | 'tv', data: any): MediaMetadata {
  const isMovie = type === 'movie';
  const title = (isMovie ? data.title : data.name) || '';
  const originalTitle = (isMovie ? data.original_title : data.original_name) || '';
  const releaseDate = isMovie ? data.release_date : data.first_air_date;
  // TMDb reports `runtime` for movies and `episode_run_time: number[]`
  // for TV (one entry per known episode-length variant).
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

async function fetchTmdbDetail(
  type: 'movie' | 'tv',
  id: string | number,
  cred: Credential
): Promise<MediaMetadata | null> {
  const data = await tmdbGet<any>(
    `/${type}/${id}`,
    {
      append_to_response: 'external_ids',
      language: 'en-US',
    },
    cred
  );
  if (!data) return null;
  return normalize(type, data);
}

export type LookupSource = 'imdb' | 'tmdb' | 'tvdb';
export type MediaTypeHint = 'movie' | 'tv';

/**
 * Look up metadata by an external id from any of the three sources.
 *
 * `typeHint` disambiguates between TMDb's movie/tv namespaces — same
 * numeric id can exist in both. The hint may also be encoded in the
 * `id` itself as a `tv/N` / `movie/N` prefix (matches what
 * `normalizeTmdbId` returns for prefixed input). Explicit `typeHint`
 * wins over a prefix; if neither is supplied, we fall back to the
 * legacy "try movie, then tv" probe.
 *
 * Returns null on miss; throws on missing API key.
 */
export async function lookupMetadata(
  source: LookupSource,
  id: string,
  typeHint?: MediaTypeHint
): Promise<MediaMetadata | null> {
  const cred = getCredential();
  // Cache key includes the type so a hint flip re-resolves cleanly
  // instead of returning the cached wrong-namespace match.
  const cacheKey = `meta:v1:${source}:${typeHint ?? 'auto'}:${id}`;

  // Cache read first — the call below is cheap, but TMDb is rate-limited
  // (~50 req/s per key) and we don't want a popular page hammering it.
  try {
    const cached = await redis.get(cacheKey);
    if (cached === NEG_SENTINEL) return null;
    if (cached) return JSON.parse(cached) as MediaMetadata;
  } catch {
    // Redis hiccup → just hit TMDb.
  }

  let result: MediaMetadata | null = null;

  if (source === 'tmdb') {
    // Pull a type out of the id if it's there, so callers that have
    // already encoded the hint via prefix don't need to also pass
    // typeHint. Explicit param still wins.
    const prefixed = id.match(/^(movie|tv)\/(\d+)$/);
    const inferredType = prefixed
      ? (prefixed[1] as MediaTypeHint)
      : null;
    const bareId = prefixed ? prefixed[2]! : id;
    const effectiveType = typeHint ?? inferredType ?? null;

    if (effectiveType) {
      // Hint provided — go straight to the right namespace. No
      // fallback because a `tv/N` that doesn't exist in TV space
      // shouldn't quietly resolve to a different `movie/N`.
      result = await fetchTmdbDetail(effectiveType, bareId, cred);
    } else {
      // Last-resort guess: try movie then tv.
      result = await fetchTmdbDetail('movie', bareId, cred);
      if (!result) result = await fetchTmdbDetail('tv', bareId, cred);
    }
  } else {
    // /find resolves an external id (IMDb tt-form or TVDB integer) to
    // the corresponding TMDb id; we then re-fetch the full record so
    // the response shape is consistent across all three sources.
    const externalSource = source === 'imdb' ? 'imdb_id' : 'tvdb_id';
    const find = await tmdbGet<any>(
      `/find/${id}`,
      { external_source: externalSource },
      cred
    );
    const movieMatch = find?.movie_results?.[0];
    const tvMatch = find?.tv_results?.[0];

    // Honour the type hint when both arrays have a candidate.
    if (typeHint === 'tv' && tvMatch?.id) {
      result = await fetchTmdbDetail('tv', tvMatch.id, cred);
    } else if (typeHint === 'movie' && movieMatch?.id) {
      result = await fetchTmdbDetail('movie', movieMatch.id, cred);
    } else if (movieMatch?.id) {
      result = await fetchTmdbDetail('movie', movieMatch.id, cred);
    } else if (tvMatch?.id) {
      result = await fetchTmdbDetail('tv', tvMatch.id, cred);
    }
  }

  // Cache positive and negative results.
  try {
    if (result) {
      await redis.setex(cacheKey, POS_TTL_S, JSON.stringify(result));
    } else {
      await redis.setex(cacheKey, NEG_TTL_S, NEG_SENTINEL);
    }
  } catch {
    // Cache write failure is non-fatal.
  }

  return result;
}

/**
 * `true` if TMDB integration is wired up. Used by the lookup endpoint
 * to give the UI a clean "feature disabled" signal without throwing.
 */
export function isMetadataEnabled(): boolean {
  return !!process.env.TMDB_API_KEY;
}

/** Lightweight search hit — what the upload form's picker needs. */
export interface MediaSearchHit {
  type: 'movie' | 'tv';
  tmdbId: number;
  title: string;
  originalTitle: string | null;
  year: number | null;
  overview: string | null;
  posterUrl: string | null;
  voteAverage: number | null;
  url: string;
}

const SEARCH_PAGE_SIZE = 8;
const SEARCH_TTL_S = 60 * 60 * 6; // 6h — fresh enough for poster swaps

function normaliseHit(type: 'movie' | 'tv', data: any): MediaSearchHit {
  const isMovie = type === 'movie';
  const releaseDate = isMovie ? data.release_date : data.first_air_date;
  return {
    type,
    tmdbId: data.id,
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

/**
 * Free-text search against TMDb. `type` constrains the namespace — when
 * undefined we run both /search/movie and /search/tv in parallel and
 * interleave by descending popularity (TMDb already returns its own
 * ranking, so we just merge and sort by the `popularity` field that
 * comes back).
 *
 * Throws on missing API key so the route can convert it into a clean
 * 503 — same pattern as `lookupMetadata`.
 */
export async function searchMetadata(
  query: string,
  type?: MediaTypeHint,
  year?: number
): Promise<MediaSearchHit[]> {
  const cred = getCredential();
  const trimmed = query.trim();
  if (!trimmed) return [];

  const cacheKey = `meta:v1:search:${type ?? 'auto'}:${year ?? '-'}:${trimmed.toLowerCase()}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached === NEG_SENTINEL) return [];
    if (cached) return JSON.parse(cached) as MediaSearchHit[];
  } catch {
    // Redis hiccup → just hit TMDb.
  }

  const params: Record<string, string> = {
    query: trimmed,
    include_adult: 'false',
    language: 'en-US',
    page: '1',
  };

  // The two endpoints take different year-filter param names. We pass
  // both — the unused one is silently ignored on the wrong route.
  const movieParams = { ...params } as Record<string, string>;
  const tvParams = { ...params } as Record<string, string>;
  if (year) {
    movieParams.year = String(year);
    tvParams.first_air_date_year = String(year);
  }

  // Track popularity for the merge sort below without leaking it into
  // the public shape.
  type RankedHit = MediaSearchHit & { _pop: number };
  let hits: RankedHit[] = [];

  if (type === 'movie' || !type) {
    const data = await tmdbGet<any>('/search/movie', movieParams, cred);
    if (Array.isArray(data?.results)) {
      hits = hits.concat(
        data.results.slice(0, SEARCH_PAGE_SIZE).map(
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
        data.results.slice(0, SEARCH_PAGE_SIZE).map(
          (r: any): RankedHit => ({
            ...normaliseHit('tv', r),
            _pop: typeof r.popularity === 'number' ? r.popularity : 0,
          })
        )
      );
    }
  }

  // When both namespaces are queried, sort by raw popularity so the
  // most likely match floats to the top. Within a single namespace
  // TMDb already returns popularity-desc so the sort is a no-op.
  if (!type) hits.sort((a, b) => b._pop - a._pop);
  const finalHits: MediaSearchHit[] = hits
    .slice(0, SEARCH_PAGE_SIZE)
    .map(({ _pop, ...rest }) => rest);

  try {
    if (finalHits.length > 0) {
      await redis.setex(cacheKey, SEARCH_TTL_S, JSON.stringify(finalHits));
    } else {
      await redis.setex(cacheKey, NEG_TTL_S, NEG_SENTINEL);
    }
  } catch {
    // Cache write failure is non-fatal.
  }

  return finalHits;
}
