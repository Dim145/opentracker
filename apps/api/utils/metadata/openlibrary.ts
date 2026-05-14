/**
 * Open Library metadata source — books / ebooks.
 *
 * Open Library is operated by the Internet Archive and exposes a
 * free, key-less REST API. We use it as the primary book provider;
 * when an Open Library lookup or search returns nothing AND the
 * operator has set `GOOGLE_BOOKS_API_KEY` in the environment, we
 * fall back to Google Books for the same query — the response is
 * normalised back into our `MediaMetadata` / `MediaSearchHit`
 * shapes so the frontend can't tell the two apart.
 *
 * Canonical id stored on torrents (`openlibrary_id`): we accept
 * either an ISBN (10 or 13 digits) or an Open Library Work id
 * (`OL\d+W`). The picker normalises raw URLs / slugs into one of
 * those forms. ISBN is preferred when present because it's
 * cross-provider; Work id is the fallback for books with no ISBN
 * (older works, fan editions, …).
 *
 * Cache: 24h positive, 1h negative, 6h search — same TTLs as the
 * other sources. The cache key encodes the provider that resolved
 * the row so a future operator who turns Google Books OFF doesn't
 * re-serve stale Google entries forever.
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

const OL_BASE = 'https://openlibrary.org';
const OL_COVERS = 'https://covers.openlibrary.org';
const GOOGLE_BOOKS_BASE = 'https://www.googleapis.com/books/v1';

function googleBooksKey(): string | null {
  const value = process.env.GOOGLE_BOOKS_API_KEY;
  return value && value.trim() ? value.trim() : null;
}

function hasGoogleBooks(): boolean {
  return googleBooksKey() !== null;
}

/**
 * Open Library has no auth, but the upstream is happy to identify
 * us via a User-Agent — the docs ask for one when running scripts.
 * Keep it short and stable so we don't end up in their rate-limit
 * bucket if a single instance fans out.
 */
const UA = 'Trackarr/1.0 (+https://github.com/dimaslanjaka/trackarr)';

async function olGet<T = any>(
  path: string,
  params?: Record<string, string>
): Promise<T | null> {
  const search = params ? `?${new URLSearchParams(params).toString()}` : '';
  try {
    const res = await fetch(`${OL_BASE}${path}${search}`, {
      headers: { Accept: 'application/json', 'User-Agent': UA },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      if (res.status === 404) return null;
      console.warn(`[metadata:openlibrary] ${res.status} on ${path}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`[metadata:openlibrary] fetch failed for ${path}:`, err);
    return null;
  }
}

async function gbGet<T = any>(
  path: string,
  params: Record<string, string>
): Promise<T | null> {
  const key = googleBooksKey();
  if (!key) return null;
  const search = new URLSearchParams({ ...params, key }).toString();
  try {
    const res = await fetch(`${GOOGLE_BOOKS_BASE}${path}?${search}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      if (res.status === 404) return null;
      console.warn(`[metadata:googlebooks] ${res.status} on ${path}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`[metadata:googlebooks] fetch failed for ${path}:`, err);
    return null;
  }
}

// ── ID normalisation ─────────────────────────────────────────
//
// Three input shapes survive into storage:
//   - ISBN-13 (`9781234567890`)
//   - ISBN-10 (`123456789X`)
//   - Open Library Work id (`OL12345W`)
// URLs containing either of the above are stripped down to the bare
// form. Everything else returns null.

const ISBN13_RE = /^\d{13}$/;
const ISBN10_RE = /^\d{9}[\dXx]$/;
const OL_WORK_RE = /^OL\d+W$/;
const OL_EDITION_RE = /^OL\d+M$/;

function stripIsbnFormatting(s: string): string {
  return s.replace(/[\s-]/g, '');
}

export function normalizeOpenLibraryId(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Bare ISBN (with optional hyphens).
  const isbn = stripIsbnFormatting(trimmed);
  if (ISBN13_RE.test(isbn)) return isbn;
  if (ISBN10_RE.test(isbn)) return isbn.toUpperCase();

  // Bare Open Library work id.
  if (OL_WORK_RE.test(trimmed)) return trimmed;
  // Edition id can also be accepted — we resolve it to the work id
  // synchronously inside the lookup helper.
  if (OL_EDITION_RE.test(trimmed)) return trimmed;

  // URL forms.
  const olUrl = trimmed.match(/openlibrary\.org\/(?:works|books)\/(OL\d+[WM])/);
  if (olUrl) return olUrl[1]!;
  const isbnUrl = trimmed.match(/openlibrary\.org\/isbn\/(\d{10}|\d{13})/);
  if (isbnUrl) return isbnUrl[1]!;
  // `books.google.*?…isbn=…`
  const gbUrl = trimmed.match(/[?&]isbn=(\d{10}|\d{13})/);
  if (gbUrl) return gbUrl[1]!;

  return null;
}

// ── Open Library: ID → MediaMetadata ─────────────────────────

interface OlBookData {
  url?: string;
  title?: string;
  subtitle?: string;
  authors?: Array<{ name?: string }>;
  publishers?: Array<{ name?: string }>;
  publish_date?: string;
  number_of_pages?: number;
  cover?: { small?: string; medium?: string; large?: string };
  identifiers?: {
    isbn_10?: string[];
    isbn_13?: string[];
    openlibrary?: string[];
  };
  excerpts?: Array<{ text?: string }>;
  subjects?: Array<{ name?: string }>;
}

function olCoverUrl(id: string, kind: 'isbn' | 'olid'): string {
  // `-L` is ~800px on the long edge, plenty for our grid cell.
  return `${OL_COVERS}/b/${kind}/${id}-L.jpg`;
}

function yearFromString(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.match(/(\d{4})/);
  return m ? parseInt(m[1]!, 10) : null;
}

/**
 * `/api/books?bibkeys=ISBN:…,OLID:…&format=json&jscmd=data` returns
 * a normalised view of the book — title, authors, publish date,
 * cover, ISBNs. Cleaner than stitching `/works/X.json` together with
 * `/authors/Y.json`, which would need N+1 follow-up fetches.
 */
async function fetchOlBibkey(bibkey: string): Promise<OlBookData | null> {
  const data = await olGet<Record<string, OlBookData>>('/api/books', {
    bibkeys: bibkey,
    format: 'json',
    jscmd: 'data',
  });
  if (!data) return null;
  const book = data[bibkey];
  return book ?? null;
}

function bibkeyFor(id: string): { bibkey: string; coverKind: 'isbn' | 'olid' } {
  if (ISBN13_RE.test(id) || ISBN10_RE.test(id)) {
    return { bibkey: `ISBN:${id}`, coverKind: 'isbn' };
  }
  return { bibkey: `OLID:${id}`, coverKind: 'olid' };
}

function olToMedia(
  id: string,
  data: OlBookData,
  coverKind: 'isbn' | 'olid'
): MediaMetadata {
  const isbn13 = data.identifiers?.isbn_13?.[0] ?? null;
  const isbn10 = data.identifiers?.isbn_10?.[0] ?? null;
  const olWorkId = data.identifiers?.openlibrary?.[0] ?? null;
  // Cover: prefer the large hosted variant, fall back to the
  // canonical covers.openlibrary.org URL built from the resolved
  // bibkey. We pick ISBN-based URLs when the row stores an ISBN
  // because they're stable across re-edits.
  const posterUrl =
    data.cover?.large ||
    data.cover?.medium ||
    (coverKind === 'isbn' && (isbn13 || isbn10)
      ? olCoverUrl(isbn13 || isbn10!, 'isbn')
      : olCoverUrl(id, 'olid'));
  return {
    source: 'openlibrary',
    type: 'book',
    title: data.title || '(untitled)',
    originalTitle:
      data.subtitle && data.subtitle !== data.title ? data.subtitle : null,
    tagline: null,
    year: yearFromString(data.publish_date),
    overview: data.excerpts?.[0]?.text ?? null,
    posterUrl,
    backdropUrl: null,
    genres: (data.subjects ?? [])
      .map((s) => s.name)
      .filter((n): n is string => typeof n === 'string')
      .slice(0, 8),
    runtime: null,
    voteAverage: null,
    voteCount: null,
    url: data.url || `${OL_BASE}/${coverKind === 'isbn' ? 'isbn' : 'works'}/${id}`,
    authors: (data.authors ?? [])
      .map((a) => a.name)
      .filter((n): n is string => typeof n === 'string'),
    publisher: data.publishers?.[0]?.name ?? null,
    pageCount: data.number_of_pages ?? null,
    isbn13,
    isbn10,
    openlibraryId: olWorkId,
    bookProvider: 'openlibrary',
  };
}

// ── Google Books: ID → MediaMetadata (fallback) ───────────────

interface GbVolume {
  id: string;
  volumeInfo?: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    publisher?: string;
    publishedDate?: string;
    description?: string;
    industryIdentifiers?: Array<{
      type: 'ISBN_10' | 'ISBN_13' | string;
      identifier: string;
    }>;
    pageCount?: number;
    categories?: string[];
    averageRating?: number;
    ratingsCount?: number;
    imageLinks?: {
      thumbnail?: string;
      smallThumbnail?: string;
      small?: string;
      medium?: string;
      large?: string;
      extraLarge?: string;
    };
    infoLink?: string;
    canonicalVolumeLink?: string;
  };
}

interface GbVolumeList {
  totalItems?: number;
  items?: GbVolume[];
}

function gbCover(v: GbVolume): string | null {
  const img = v.volumeInfo?.imageLinks;
  if (!img) return null;
  // Highest-resolution variant available; Google sometimes ships
  // both via `&zoom=`-style params but the structured field is
  // safer. Force https — Google still serves `http://` links for
  // some long-tail volumes.
  const raw =
    img.extraLarge ||
    img.large ||
    img.medium ||
    img.small ||
    img.thumbnail ||
    img.smallThumbnail ||
    null;
  return raw ? raw.replace(/^http:\/\//, 'https://') : null;
}

function gbToMedia(v: GbVolume, fallbackId: string): MediaMetadata {
  const info = v.volumeInfo ?? {};
  const isbn13 =
    info.industryIdentifiers?.find((i) => i.type === 'ISBN_13')?.identifier ??
    null;
  const isbn10 =
    info.industryIdentifiers?.find((i) => i.type === 'ISBN_10')?.identifier ??
    null;
  return {
    source: 'openlibrary',
    type: 'book',
    title: info.title || '(untitled)',
    originalTitle: info.subtitle && info.subtitle !== info.title ? info.subtitle : null,
    tagline: null,
    year: yearFromString(info.publishedDate),
    overview: info.description ?? null,
    posterUrl: gbCover(v),
    backdropUrl: null,
    genres: (info.categories ?? []).slice(0, 8),
    runtime: null,
    voteAverage:
      typeof info.averageRating === 'number'
        ? // GB rates 0–5; rescale to 0–10 so the UI shares one scale.
          Math.round(info.averageRating * 2 * 10) / 10
        : null,
    voteCount:
      typeof info.ratingsCount === 'number' ? info.ratingsCount : null,
    url: info.canonicalVolumeLink || info.infoLink || `https://books.google.com/books?id=${v.id}`,
    authors: info.authors ?? [],
    publisher: info.publisher ?? null,
    pageCount: info.pageCount ?? null,
    isbn13,
    isbn10,
    openlibraryId: null,
    bookProvider: 'googlebooks',
    // Stash a synthetic id so the cache key downstream always has
    // something to hang onto when the original was an OL work id
    // that resolved here only because OL had no record.
  } as MediaMetadata & { _gbVolumeId?: string; _origId?: string };
}

async function fetchGoogleBooksByIsbn(
  isbn: string
): Promise<MediaMetadata | null> {
  const data = await gbGet<GbVolumeList>('/volumes', {
    q: `isbn:${isbn}`,
    maxResults: '1',
  });
  const vol = data?.items?.[0];
  return vol ? gbToMedia(vol, isbn) : null;
}

// ── Lookup ───────────────────────────────────────────────────

async function lookupBook(
  id: string,
  _hint?: MediaTypeHint,
  _options?: LookupOptions
): Promise<MediaMetadata | null> {
  const cacheKey = `meta:v1:openlibrary:${id}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached === NEG_SENTINEL) return null;
    if (cached) return JSON.parse(cached) as MediaMetadata;
  } catch {
    /* Redis hiccup */
  }

  let result: MediaMetadata | null = null;

  // Primary: Open Library.
  const { bibkey, coverKind } = bibkeyFor(id);
  const ol = await fetchOlBibkey(bibkey);
  if (ol && ol.title) {
    result = olToMedia(id, ol, coverKind);
  }

  // Fallback: Google Books, only for ISBN inputs (GB doesn't speak
  // Open Library work ids) and only when the operator wired the
  // API key.
  if (!result && hasGoogleBooks() && (ISBN13_RE.test(id) || ISBN10_RE.test(id))) {
    result = await fetchGoogleBooksByIsbn(id);
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

// ── Search ───────────────────────────────────────────────────

interface OlSearchResponse {
  numFound?: number;
  docs?: Array<{
    key?: string; // `/works/OL12345W`
    title?: string;
    subtitle?: string;
    author_name?: string[];
    first_publish_year?: number;
    cover_i?: number; // cover id
    cover_edition_key?: string;
    isbn?: string[];
    edition_count?: number;
  }>;
}

function olSearchHit(
  doc: NonNullable<OlSearchResponse['docs']>[number]
): MediaSearchHit | null {
  const workKey = doc.key?.replace(/^\/works\//, '') ?? null;
  if (!workKey) return null;
  const isbn = doc.isbn?.find((i) => /^\d{13}$/.test(i)) ?? doc.isbn?.[0];
  const posterUrl = doc.cover_i
    ? `${OL_COVERS}/b/id/${doc.cover_i}-L.jpg`
    : doc.cover_edition_key
      ? olCoverUrl(doc.cover_edition_key, 'olid')
      : isbn
        ? olCoverUrl(isbn, 'isbn')
        : null;
  return {
    source: 'openlibrary',
    type: 'book',
    // Prefer the ISBN as the picker-side id when one exists — it's
    // what we want to round-trip to lookup, and it's portable to
    // Google Books. Fall back to the OL work key otherwise.
    id: isbn ?? workKey,
    title: doc.title || '(untitled)',
    originalTitle:
      doc.subtitle && doc.subtitle !== doc.title ? doc.subtitle : null,
    year: doc.first_publish_year ?? null,
    overview: null,
    posterUrl,
    voteAverage: null,
    url: `${OL_BASE}/works/${workKey}`,
  };
}

function gbSearchHit(v: GbVolume): MediaSearchHit | null {
  const info = v.volumeInfo;
  if (!info?.title) return null;
  const isbn =
    info.industryIdentifiers?.find((i) => i.type === 'ISBN_13')?.identifier ??
    info.industryIdentifiers?.find((i) => i.type === 'ISBN_10')?.identifier ??
    null;
  return {
    source: 'openlibrary',
    type: 'book',
    id: isbn ?? v.id,
    title: info.title,
    originalTitle: info.subtitle && info.subtitle !== info.title ? info.subtitle : null,
    year: yearFromString(info.publishedDate),
    overview: info.description ?? null,
    posterUrl: gbCover(v),
    voteAverage:
      typeof info.averageRating === 'number'
        ? Math.round(info.averageRating * 2 * 10) / 10
        : null,
    url: info.canonicalVolumeLink || info.infoLink || `https://books.google.com/books?id=${v.id}`,
  };
}

async function searchBooks(
  query: string,
  _hint?: MediaTypeHint,
  options?: SearchOptions
): Promise<MediaSearchHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const year = options?.year;
  const cacheKey = `meta:v1:search:openlibrary:${
    year ?? '-'
  }:${trimmed.toLowerCase()}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached === NEG_SENTINEL) return [];
    if (cached) return JSON.parse(cached) as MediaSearchHit[];
  } catch {
    /* Redis hiccup */
  }

  // Primary: Open Library `/search.json`. Constrain by year when
  // we have one — disambiguates re-issues with the same title.
  const olParams: Record<string, string> = {
    title: trimmed,
    limit: '12',
  };
  if (year) olParams.first_publish_year = String(year);
  const ol = await olGet<OlSearchResponse>('/search.json', olParams);
  let hits = (ol?.docs ?? [])
    .map(olSearchHit)
    .filter((h): h is MediaSearchHit => h !== null)
    .slice(0, 8);

  // Fallback: Google Books — only when OL turned up zero and the
  // operator opted in. We don't merge results because that risks
  // duplicates (same book indexed twice) without a clean way to
  // dedupe across the two id spaces.
  if (hits.length === 0 && hasGoogleBooks()) {
    const gb = await gbGet<GbVolumeList>('/volumes', {
      q: trimmed,
      maxResults: '8',
    });
    hits = (gb?.items ?? [])
      .map(gbSearchHit)
      .filter((h): h is MediaSearchHit => h !== null)
      .slice(0, 8);
  }

  try {
    if (hits.length > 0) {
      await redis.setex(cacheKey, META_TTL.SEARCH_S, JSON.stringify(hits));
    } else {
      await redis.setex(cacheKey, META_TTL.NEG_S, NEG_SENTINEL);
    }
  } catch {
    /* cache write failure non-fatal */
  }
  return hits;
}

export const openlibrarySource: MediaSource = {
  id: 'openlibrary',
  label: 'Open Library',
  handles: ['book'],
  // Open Library has no auth; the source is always considered
  // enabled. Google Books is a silent fallback gated by its own
  // env var inside the helpers above.
  isEnabled: () => true,
  normalizeId: async (input) => normalizeOpenLibraryId(input),
  lookup: lookupBook,
  search: searchBooks,
};
