/**
 * IGDB metadata source — video games.
 *
 * IGDB is owned by Twitch/Amazon and authenticates through a
 * Twitch OAuth client-credentials grant. The operator supplies
 *   - IGDB_ID      (Twitch Client ID)
 *   - IGDB_SECRET  (Twitch Client Secret)
 * and the module exchanges them for an app-access token at first
 * use, then keeps it cached (memory + Redis) until ~5 minutes
 * before expiry. The token typically lives 60+ days so the refresh
 * cycle is far rarer than the TMDb key path.
 *
 * Rate limit: IGDB caps at 4 req/s per token. We cache aggressively
 * (24h hits, 1h misses, 6h searches) — the same TTLs as TMDb —
 * so a single popular page never hammers the upstream.
 *
 * Input formats accepted by `normalizeId`:
 *   - bare numeric id (`7346`)
 *   - canonical slug (`the-legend-of-zelda-breath-of-the-wild`)
 *   - full igdb.com URL
 * The slug path requires a network round-trip to resolve the
 * numeric id. The resolved id is what we store; the slug is
 * surfaced only in `url`.
 */
import { redis } from '../server';
import type {
  LookupOptions,
  MediaMetadata,
  MediaSearchHit,
  MediaSource,
  MediaTypeHint,
  SearchOptions,
} from './types';
import { META_TTL, NEG_SENTINEL } from './types';

const IGDB_BASE = 'https://api.igdb.com/v4';
const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';

const TOKEN_CACHE_KEY = 'meta:v1:igdb:token';
/** Refresh a few minutes before expiry so a request never lands
 *  on a token that the upstream rejected mid-flight. */
const TOKEN_REFRESH_BUFFER_S = 5 * 60;

interface TokenRecord {
  accessToken: string;
  /** Unix ms when the token expires. */
  expiresAt: number;
}

// In-process memo so we don't hit Redis on every request once the
// module is warm. Always validated against `expiresAt` before use.
let memoryToken: TokenRecord | null = null;

function hasCredentials(): boolean {
  return !!process.env.IGDB_ID && !!process.env.IGDB_SECRET;
}

async function fetchFreshToken(): Promise<TokenRecord> {
  const id = process.env.IGDB_ID!;
  const secret = process.env.IGDB_SECRET!;
  const body = new URLSearchParams({
    client_id: id,
    client_secret: secret,
    grant_type: 'client_credentials',
  });
  const res = await fetch(TWITCH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw createError({
      statusCode: 502,
      message: `IGDB OAuth failed (${res.status}). Verify IGDB_ID / IGDB_SECRET.`,
    });
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token || typeof data.expires_in !== 'number') {
    throw createError({
      statusCode: 502,
      message: 'IGDB OAuth returned an unexpected payload.',
    });
  }
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

async function getToken(): Promise<TokenRecord> {
  const now = Date.now();
  if (memoryToken && memoryToken.expiresAt - now > TOKEN_REFRESH_BUFFER_S * 1000) {
    return memoryToken;
  }
  // Redis is the second tier — keeps the OAuth ping count low when
  // running multiple API instances.
  try {
    const raw = await redis.get(TOKEN_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as TokenRecord;
      if (parsed.expiresAt - now > TOKEN_REFRESH_BUFFER_S * 1000) {
        memoryToken = parsed;
        return parsed;
      }
    }
  } catch {
    /* Redis hiccup — fall through to a fresh OAuth ping */
  }
  const fresh = await fetchFreshToken();
  memoryToken = fresh;
  try {
    // Store with a TTL ~30s shorter than the actual lifetime so
    // the Redis copy goes stale slightly before the real token.
    const ttlS = Math.max(
      60,
      Math.floor((fresh.expiresAt - Date.now()) / 1000) - 30
    );
    await redis.setex(TOKEN_CACHE_KEY, ttlS, JSON.stringify(fresh));
  } catch {
    /* cache write failure non-fatal */
  }
  return fresh;
}

interface IgdbGame {
  id: number;
  name: string;
  slug: string;
  summary?: string;
  storyline?: string;
  cover?: { image_id: string };
  first_release_date?: number; // unix seconds
  genres?: Array<{ name: string }>;
  platforms?: Array<{ name: string }>;
  game_modes?: Array<{ name: string }>;
  screenshots?: Array<{ image_id: string }>;
  total_rating?: number; // 0–100
  total_rating_count?: number;
  url?: string;
}

const COVER_SIZE = 't_cover_big_2x'; // ~528×704
const SCREENSHOT_SIZE = 't_screenshot_huge_2x'; // 1920×1080

function igdbImageUrl(imageId: string, size: string): string {
  return `https://images.igdb.com/igdb/image/upload/${size}/${imageId}.jpg`;
}

/**
 * Escape a user-supplied string for interpolation inside an
 * Apicalypse double-quoted literal. Backslashes are doubled BEFORE
 * quotes so a literal `\` in the input doesn't combine with the
 * escape we add for `"` to produce a malformed `\\"` sequence (which
 * IGDB would read as a backslash followed by an unescaped quote and
 * happily terminate the literal). Order matters — never invert.
 *
 * Called by `searchGames` and `resolveSlug`; both paths receive
 * already-validated input (URL/slug regex + trim) so this is
 * defense-in-depth more than a primary control.
 */
function escapeApicalypseString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** IGDB's query language is "Apicalypse" — a tiny DSL passed in
 *  the POST body. We always select the same field set so the
 *  normalised shape is deterministic. */
const GAME_FIELDS = [
  'id',
  'name',
  'slug',
  'summary',
  'storyline',
  'cover.image_id',
  'first_release_date',
  'genres.name',
  'platforms.name',
  'game_modes.name',
  'screenshots.image_id',
  'total_rating',
  'total_rating_count',
  'url',
].join(',');

async function igdbPost<T = any>(path: string, query: string): Promise<T | null> {
  const token = await getToken();
  const id = process.env.IGDB_ID!;
  try {
    const res = await fetch(`${IGDB_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Client-ID': id,
        Authorization: `Bearer ${token.accessToken}`,
        'Content-Type': 'text/plain',
        Accept: 'application/json',
      },
      body: query,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.warn(`[metadata:igdb] ${res.status} on ${path}: ${query}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`[metadata:igdb] fetch failed for ${path}:`, err);
    return null;
  }
}

function normalizeDetail(game: IgdbGame): MediaMetadata {
  const releaseTs = game.first_release_date
    ? new Date(game.first_release_date * 1000)
    : null;
  return {
    source: 'igdb',
    type: 'game',
    igdbId: game.id,
    title: game.name,
    originalTitle: null,
    tagline: null,
    year: releaseTs?.getUTCFullYear() ?? null,
    // IGDB ships both — prefer `summary` (one-paragraph blurb) and
    // surface storyline separately if frontends want it later.
    overview: game.summary || game.storyline || null,
    posterUrl: game.cover?.image_id
      ? igdbImageUrl(game.cover.image_id, COVER_SIZE)
      : null,
    backdropUrl: game.screenshots?.[0]?.image_id
      ? igdbImageUrl(game.screenshots[0].image_id, SCREENSHOT_SIZE)
      : null,
    genres: (game.genres ?? []).map((g) => g.name).filter(Boolean),
    runtime: null,
    voteAverage:
      typeof game.total_rating === 'number'
        ? // IGDB rates 0–100; collapse to 0–10 so the UI scale
          // matches TMDb.
          Math.round((game.total_rating / 10) * 10) / 10
        : null,
    voteCount:
      typeof game.total_rating_count === 'number'
        ? game.total_rating_count
        : null,
    url: game.url || `https://www.igdb.com/games/${game.slug}`,
    platforms: (game.platforms ?? []).map((p) => p.name).filter(Boolean),
    gameModes: (game.game_modes ?? []).map((m) => m.name).filter(Boolean),
    screenshots: (game.screenshots ?? [])
      .slice(0, 8)
      .map((s) => igdbImageUrl(s.image_id, SCREENSHOT_SIZE)),
    firstReleaseDate: releaseTs ? releaseTs.toISOString() : null,
  };
}

async function lookupGame(
  id: string,
  _hint?: MediaTypeHint,
  // IGDB's `/games` endpoint has no response-language axis — the
  // summary / name fields are English-only on the canonical record.
  // Accept the option for protocol parity with TMDb but don't fan
  // it out into the cache key: every locale would share the same
  // payload.
  _options?: LookupOptions
): Promise<MediaMetadata | null> {
  // Numeric id only at this layer — `normalizeId` already
  // resolved any slug / URL upstream.
  if (!/^\d+$/.test(id)) return null;
  const cacheKey = `meta:v1:igdb:${id}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached === NEG_SENTINEL) return null;
    if (cached) return JSON.parse(cached) as MediaMetadata;
  } catch {
    /* Redis hiccup */
  }

  const results = await igdbPost<IgdbGame[]>(
    '/games',
    `fields ${GAME_FIELDS}; where id = ${id}; limit 1;`
  );
  const game = results?.[0] ?? null;
  const result = game ? normalizeDetail(game) : null;

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

async function searchGames(
  query: string,
  _hint?: MediaTypeHint,
  // `language` / `year` / `includeAdult` all accepted for protocol
  // parity; IGDB's `/games` search ignores them on the wire.
  _options?: SearchOptions
): Promise<MediaSearchHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const cacheKey = `meta:v1:search:igdb:${trimmed.toLowerCase()}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached === NEG_SENTINEL) return [];
    if (cached) return JSON.parse(cached) as MediaSearchHit[];
  } catch {
    /* Redis hiccup */
  }

  // Apicalypse `search` clause is the equivalent of TMDb's
  // `/search/*` endpoints. IGDB ranks by best relevance and the
  // result set returns empty if we combine `search` with a `where`
  // filter — so we run the raw search and rank-filter client-side
  // below to push DLCs / mods / expansion-packs down the list.
  const escaped = escapeApicalypseString(trimmed);
  const results = await igdbPost<
    Array<IgdbGame & { category?: number; version_parent?: number }>
  >(
    '/games',
    `fields id,name,slug,summary,cover.image_id,first_release_date,total_rating,url,category,version_parent;
     search "${escaped}";
     limit 20;`
  );
  // Promote base games (category 0) ahead of expansions, remakes,
  // mods, etc. — keeps the top of the picker readable without
  // dropping anything outright (a user uploading a mod still gets
  // the mod, just lower in the list).
  const ranked = (results ?? []).slice().sort((a, b) => {
    const score = (g: { category?: number; version_parent?: number }) => {
      const cat = g.category ?? 0;
      // Base games + remakes / remasters / expanded / ports rank
      // first; expansions and DLCs in the middle; mods last.
      if (cat === 0 || cat === 8 || cat === 9 || cat === 10 || cat === 11) {
        return g.version_parent == null ? 0 : 1;
      }
      if (cat === 1 || cat === 2 || cat === 4) return 2; // DLC / expansion
      if (cat === 5) return 4; // mod
      return 3;
    };
    return score(a) - score(b);
  });
  const finalHits: MediaSearchHit[] = ranked.slice(0, 8).map((g) => ({
    source: 'igdb',
    type: 'game',
    id: String(g.id),
    title: g.name,
    originalTitle: null,
    year: g.first_release_date
      ? new Date(g.first_release_date * 1000).getUTCFullYear()
      : null,
    overview: g.summary || null,
    posterUrl: g.cover?.image_id
      ? igdbImageUrl(g.cover.image_id, COVER_SIZE)
      : null,
    voteAverage:
      typeof g.total_rating === 'number'
        ? Math.round((g.total_rating / 10) * 10) / 10
        : null,
    url: g.url || `https://www.igdb.com/games/${g.slug}`,
  }));

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

/**
 * Resolve any user-provided input (URL / slug / numeric id) into
 * the canonical numeric id. Slug lookups hit IGDB once and the
 * result is cached for 24h via the same TTL as a detail lookup.
 */
async function resolveSlug(slug: string): Promise<string | null> {
  const cacheKey = `meta:v1:igdb:slug:${slug.toLowerCase()}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached === NEG_SENTINEL) return null;
    if (cached) return cached;
  } catch {
    /* Redis hiccup */
  }

  const escaped = escapeApicalypseString(slug);
  const results = await igdbPost<Array<{ id: number }>>(
    '/games',
    `fields id; where slug = "${escaped}"; limit 1;`
  );
  const id = results?.[0]?.id ? String(results[0]!.id) : null;
  try {
    if (id) {
      await redis.setex(cacheKey, META_TTL.POS_S, id);
    } else {
      await redis.setex(cacheKey, META_TTL.NEG_S, NEG_SENTINEL);
    }
  } catch {
    /* cache write failure non-fatal */
  }
  return id;
}

export async function normalizeIgdbId(input: unknown): Promise<string | null> {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Numeric id passes through.
  if (/^\d{1,9}$/.test(trimmed)) return trimmed;
  // URL form. IGDB URLs always carry the slug, never the numeric
  // id — `https://www.igdb.com/games/<slug>`.
  const fromUrl = trimmed.match(/igdb\.com\/games\/([a-z0-9-]+)/i);
  if (fromUrl) return await resolveSlug(fromUrl[1]!);
  // Bare slug — accepts kebab-case identifiers only.
  if (/^[a-z0-9][a-z0-9-]*$/.test(trimmed)) return await resolveSlug(trimmed);
  return null;
}

export const igdbSource: MediaSource = {
  id: 'igdb',
  label: 'IGDB',
  handles: ['game'],
  isEnabled: hasCredentials,
  normalizeId: normalizeIgdbId,
  lookup: lookupGame,
  search: searchGames,
};
