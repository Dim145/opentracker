/**
 * Composable around external-metadata poster lookups.
 *
 * Each call site (e.g. /torrents grouped view, /downloads list)
 * registers the (id, typeHint) pairs it cares about; the composable
 * batches the fetches against `/api/metadata/lookup` and exposes a
 * tiny state machine per pair:
 *
 *   - `loading` → fetch in flight, show a skeleton.
 *   - `hit`     → metadata in hand (poster, title, year, …).
 *   - `missing` → 404 / upstream returned null. The grouping keeps
 *                 the row but renders without a poster.
 *
 * Sources: `movie` and `tv` resolve via TMDb; `game` resolves via
 * IGDB. The hint→source mapping lives in `sourceFor` and is the
 * single point you touch when plugging a new provider (books via
 * Open Library, apps via App Store …). The cache key includes the
 * type so the namespaces stay isolated, and each source carries
 * its own sticky `disabled` flag so a missing IGDB key never
 * silences TMDb (or vice-versa).
 *
 * Usage:
 *
 *   const posters = useMediaPosters();
 *   for (const item of items) {
 *     posters.register(item.externalId, item.typeHint);
 *   }
 *   posters.posterFor(item.externalId, item.typeHint);
 *   posters.isPosterLoading(item.externalId, item.typeHint);
 */

export interface MediaPoster {
  title: string;
  year: number | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  overview: string | null;
  voteAverage: number | null;
  type: 'movie' | 'tv' | 'game';
  url: string;
}

export type PosterTypeHint = 'movie' | 'tv' | 'game' | null;

type PosterState =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'hit'; data: MediaPoster };

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
    type: 'movie' | 'tv' | 'game';
    url: string;
  } | null;
}

function cacheKey(externalId: string, type: PosterTypeHint): string {
  return `${type ?? 'auto'}:${externalId}`;
}

function sourceFor(type: PosterTypeHint): 'tmdb' | 'igdb' {
  return type === 'game' ? 'igdb' : 'tmdb';
}

export function useMediaPosters() {
  // useState keeps the cache shared across components on the same page
  // load (and across the SSR/client hydration boundary). Each call site
  // observes the same Map.
  const postersMap = useState<Map<string, PosterState>>(
    'tmdb-posters',
    () => new Map()
  );
  // Per-source sticky "disabled" flags — the route fans out 503s
  // separately for TMDb and IGDB depending on which env vars are
  // unset. Once one source returns enabled:false we stop pinging
  // it for the rest of the session, but the other source keeps
  // running.
  const tmdbDisabled = useState<boolean>('tmdb-disabled', () => false);
  const igdbDisabled = useState<boolean>('igdb-disabled', () => false);

  function isSourceDisabled(type: PosterTypeHint): boolean {
    return type === 'game' ? igdbDisabled.value : tmdbDisabled.value;
  }
  function markSourceDisabled(type: PosterTypeHint) {
    if (type === 'game') igdbDisabled.value = true;
    else tmdbDisabled.value = true;
  }

  function setPoster(key: string, state: PosterState) {
    // Re-create the Map so consumers re-render — Map mutations are
    // not deeply reactive in Vue 3.
    const next = new Map(postersMap.value);
    next.set(key, state);
    postersMap.value = next;
  }

  async function fetchOne(externalId: string, type: PosterTypeHint) {
    // Posters are a client-only concern. If we run during SSR the
    // `$fetch('/api/metadata/lookup')` call lacks the user cookie
    // (Nitro doesn't forward it through unless we explicitly opt
    // in) and would return 401; meanwhile we'd mark the key as
    // `loading` in the useState map and ship that to the browser.
    // Hydration then skips the fetch (cache hit) and the skeleton
    // spins forever. Bail early so the first real fetch happens
    // on the client, with a session cookie attached.
    if (import.meta.server) return;
    if (isSourceDisabled(type)) return;
    const key = cacheKey(externalId, type);
    if (postersMap.value.has(key)) return;
    setPoster(key, { kind: 'loading' });
    try {
      const res = await $fetch<MetadataLookupResponse>(
        '/api/metadata/lookup',
        {
          query: {
            source: sourceFor(type),
            id: externalId,
            type: type ?? undefined,
          },
        }
      );
      if (res.enabled === false) {
        // Source not configured. Shut every other call to that
        // source up for the rest of this session.
        markSourceDisabled(type);
        return;
      }
      if (res.metadata) {
        const m = res.metadata;
        // TMDb ships w500 → downscale to w342 so grid cells stay
        // light on the wire (~60% smaller). IGDB serves a single
        // size per request (we already ask for t_cover_big_2x at
        // the source) so no rewrite needed.
        const posterUrl =
          type === 'game'
            ? m.posterUrl
            : (m.posterUrl?.replace('/w500/', '/w342/') ?? null);
        setPoster(key, {
          kind: 'hit',
          data: { ...m, posterUrl },
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
    externalId: string | null | undefined,
    type: PosterTypeHint = null
  ) {
    if (!externalId) return;
    fetchOne(externalId, type);
  }

  function stateFor(
    externalId: string | null | undefined,
    type: PosterTypeHint = null
  ): PosterState | null {
    if (!externalId) return null;
    if (isSourceDisabled(type)) return { kind: 'missing' };
    return postersMap.value.get(cacheKey(externalId, type)) ?? null;
  }

  function posterFor(
    externalId: string | null | undefined,
    type: PosterTypeHint = null
  ): MediaPoster | null {
    const s = stateFor(externalId, type);
    return s?.kind === 'hit' ? s.data : null;
  }

  function isPosterLoading(
    externalId: string | null | undefined,
    type: PosterTypeHint = null
  ): boolean {
    return stateFor(externalId, type)?.kind === 'loading';
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
    igdbDisabled,
    tmdbBare,
    typeFromTmdbId,
  };
}
