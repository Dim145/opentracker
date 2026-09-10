import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Une panne amont n'est pas une absence.
 *
 * Mesuré sur la pile e2e : une rafale de recherches au chargement du catalogue
 * a expiré à huit secondes, et chaque expiration était retenue comme « pas de
 * fiche » pendant une heure — trente fiches sans affiche pour un réseau qui a
 * toussé. Le 404, lui, doit rester retenu une heure : c'est une vraie absence.
 */
const store = new Map<string, { value: string; ttl: number }>();
vi.mock('../utils/server', () => ({
  redis: {
    get: async (key: string) => store.get(key)?.value ?? null,
    setex: async (key: string, ttl: number, value: string) => {
      store.set(key, { value, ttl });
      return 'OK';
    },
    set: async () => 'OK',
    del: async () => 1,
  },
}));

async function load() {
  vi.resetModules();
  process.env.TMDB_API_KEY = 'test-key';
  return await import('../utils/metadata/tmdb');
}

const written = () => [...store.entries()].map(([key, e]) => ({ key, ...e }));

beforeEach(() => store.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.TMDB_API_KEY;
});

describe('TMDB : absence contre panne', () => {
  it('un 404 est une absence, retenue une heure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    const { tmdbSource } = await load();
    expect(await tmdbSource.lookup('movie/1', 'movie')).toBeNull();
    const [entry] = written();
    expect(entry?.value).toBe('__null__');
    expect(entry?.ttl).toBe(3600);
  });

  it('un délai dépassé est une panne, retenue deux minutes, et ne casse rien', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    });
    const { tmdbSource } = await load();
    expect(await tmdbSource.lookup('tv/65942', 'tv')).toBeNull();
    const [entry] = written();
    expect(entry?.value).toBe('__null__');
    expect(entry?.ttl).toBe(120);
  });

  it('un 503 amont aussi, sur une recherche', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', async () => new Response('busy', { status: 503 }));
    const { tmdbSource } = await load();
    expect(await tmdbSource.search('frieren', 'tv')).toEqual([]);
    expect(written()[0]?.ttl).toBe(120);
  });

  it('une réponse vaut toujours vingt-quatre heures', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify({ id: 1, name: 'Frieren', first_air_date: '2023-09-29' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const { tmdbSource } = await load();
    const meta = await tmdbSource.lookup('tv/1', 'tv');
    expect(meta?.title).toBe('Frieren');
    expect(written()[0]?.ttl).toBe(86400);
  });
});
