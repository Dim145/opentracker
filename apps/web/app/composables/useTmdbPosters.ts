/**
 * Composable around TMDb poster lookups.
 *
 * Each call site (e.g. /search grouped view, /downloads list) registers
 * the (tmdbId, typeHint) pairs it cares about; the composable batches
 * the fetches against `/api/metadata/lookup` and exposes a tiny state
 * machine per pair:
 *
 *   - `loading` → fetch in flight, show a skeleton.
 *   - `hit`     → metadata in hand (poster, title, year, …).
 *   - `missing` → 404 / TMDb returned null. The grouping/listing keeps
 *                 the row but renders without a poster.
 *
 * If the operator hasn't set TMDB_API_KEY the API replies with
 * `enabled: false`; we flip a sticky `tmdbDisabled` ref so subsequent
 * fetches short-circuit. The cache is process-local — server-side
 * Redis already deduplicates the upstream calls, so a 50-poster page
 * still hits TMDb once at most across all users.
 *
 * Usage:
 *
 *   const posters = useTmdbPosters();
 *   for (const item of items) {
 *     posters.register(item.tmdbBare, item.typeHint);
 *   }
 *   posters.posterFor(item.tmdbBare, item.typeHint); // → TmdbPoster | null
 *   posters.isPosterLoading(item.tmdbBare, item.typeHint);
 */

export interface TmdbPoster {
  title: string;
  year: number | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  overview: string | null;
  voteAverage: number | null;
  type: 'movie' | 'tv';
  url: string;
}

export type PosterTypeHint = 'movie' | 'tv' | null;

type PosterState =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'hit'; data: TmdbPoster };

interface MetadataLookupResponse {
  enabled: boolean;
  found: boolean;
  metadata: {
    title: string;
    year: number | null;
    posterUrl: string | null;
    backdropUrl: string | null;
    overview: string | null;
    voteAverage: number | null;
    type: 'movie' | 'tv';
    url: string;
  } | null;
}

function cacheKey(tmdbBare: string, type: PosterTypeHint): string {
  return `${type ?? 'auto'}:${tmdbBare}`;
}

export function useTmdbPosters() {
  // useState keeps the cache shared across components on the same page
  // load (and across the SSR/client hydration boundary). Each call site
  // observes the same Map.
  const postersMap = useState<Map<string, PosterState>>(
    'tmdb-posters',
    () => new Map()
  );
  const tmdbDisabled = useState<boolean>('tmdb-disabled', () => false);

  function setPoster(key: string, state: PosterState) {
    // Re-create the Map so consumers re-render — Map mutations are
    // not deeply reactive in Vue 3.
    const next = new Map(postersMap.value);
    next.set(key, state);
    postersMap.value = next;
  }

  async function fetchOne(tmdbBare: string, type: PosterTypeHint) {
    if (tmdbDisabled.value) return;
    const key = cacheKey(tmdbBare, type);
    if (postersMap.value.has(key)) return;
    setPoster(key, { kind: 'loading' });
    try {
      const res = await $fetch<MetadataLookupResponse>(
        '/api/metadata/lookup',
        {
          query: {
            source: 'tmdb',
            id: tmdbBare,
            type: type ?? undefined,
          },
        }
      );
      if (res.enabled === false) {
        // Operator never wired TMDB_API_KEY. Shut every other call
        // up for the rest of this session.
        tmdbDisabled.value = true;
        return;
      }
      if (res.metadata) {
        const m = res.metadata;
        setPoster(key, {
          kind: 'hit',
          data: {
            ...m,
            // The lookup endpoint returns w500; downscale to w342 so
            // grid cells stay light on the wire (~60% smaller). Same
            // CDN, just a different size variant.
            posterUrl: m.posterUrl?.replace('/w500/', '/w342/') ?? null,
          },
        });
      } else {
        setPoster(key, { kind: 'missing' });
      }
    } catch {
      // Network / auth hiccup — fall back to "missing" so the UI
      // doesn't keep spinning a skeleton forever.
      setPoster(key, { kind: 'missing' });
    }
  }

  function register(
    tmdbBare: string | null | undefined,
    type: PosterTypeHint = null
  ) {
    if (!tmdbBare) return;
    fetchOne(tmdbBare, type);
  }

  function stateFor(
    tmdbBare: string | null | undefined,
    type: PosterTypeHint = null
  ): PosterState | null {
    if (!tmdbBare) return null;
    if (tmdbDisabled.value) return { kind: 'missing' };
    return postersMap.value.get(cacheKey(tmdbBare, type)) ?? null;
  }

  function posterFor(
    tmdbBare: string | null | undefined,
    type: PosterTypeHint = null
  ): TmdbPoster | null {
    const s = stateFor(tmdbBare, type);
    return s?.kind === 'hit' ? s.data : null;
  }

  function isPosterLoading(
    tmdbBare: string | null | undefined,
    type: PosterTypeHint = null
  ): boolean {
    return stateFor(tmdbBare, type)?.kind === 'loading';
  }

  /**
   * Strip `movie/`/`tv/` prefix from the tmdbId stored on a torrent
   * row, returning the bare numeric id. Two siblings stored either
   * way still match; null/empty stays null.
   */
  function tmdbBare(tmdbId: string | null | undefined): string | null {
    if (!tmdbId) return null;
    const m = tmdbId.match(/^(?:movie|tv)\/(\d+)$/);
    return m ? m[1] : tmdbId;
  }

  /**
   * Pull a type hint from a stored tmdbId prefix. Returns null when
   * nothing's prefixed and the caller should rely on the category
   * type (or accept the legacy "movie-then-tv" probe).
   */
  function typeFromTmdbId(
    tmdbId: string | null | undefined
  ): PosterTypeHint {
    if (!tmdbId) return null;
    const m = tmdbId.match(/^(movie|tv)\//);
    return (m?.[1] as 'movie' | 'tv' | undefined) ?? null;
  }

  return {
    register,
    posterFor,
    isPosterLoading,
    stateFor,
    tmdbDisabled,
    tmdbBare,
    typeFromTmdbId,
  };
}
