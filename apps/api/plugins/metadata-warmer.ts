import { db, schema } from '@trackarr/db';
import { and, desc, eq, isNotNull, or } from 'drizzle-orm';
import { redis } from '~~/utils/server';
import { withCronLock } from '~~/utils/cronLock';
import {
  isMetadataEnabled,
  isSourceEnabled,
  lookupMetadata,
  normalizeSourceId,
  type LookupSource,
} from '~~/utils/metadata';
import type { MediaTypeHint } from '~~/utils/metadata/types';

/**
 * Préchauffer le cache des œuvres.
 *
 * Le catalogue ne lit que le cache des métadonnées : une œuvre dont personne
 * n'a ouvert la fiche s'affiche par son nom de fichier, sans affiche ni titre.
 * Cette tâche comble le trou à petite cadence — UNE recherche amont par tic,
 * vingt secondes entre deux par défaut — en partant des torrents les plus
 * récents. Ce qu'elle a tenté (trouvé ou non) est marqué sept jours dans un
 * ensemble Redis, pour ne pas retaper à la même porte.
 *
 * Elle respecte les mêmes gardes que la fiche : pas de fournisseur configuré,
 * pas d'appel ; une panne amont est déjà mise en cache court par `guarded`.
 */
const INTERVAL_MS = Math.max(5000, parseInt(process.env.METADATA_WARM_INTERVAL_MS || '20000', 10) || 20000);
const FIRST_RUN_DELAY_MS = 45_000;
const CANDIDATES = 300;
/*
 * Un marqueur PAR ŒUVRE, et non un ensemble.
 *
 * `EXPIRE` porte sur la clé entière : avec un `SADD` suivi d'un `EXPIRE`, chaque
 * nouveau marquage repoussait le délai de TOUT l'ensemble. Le collecteur
 * marquant une œuvre toutes les vingt secondes, l'ensemble n'expirait jamais et
 * une œuvre en échec n'était jamais reprise — le défaut qu'on croyait corriger.
 */
const MARK_PREFIX = 'meta:warm:v2:';
const markKey = (key: string) => `${MARK_PREFIX}${key}`;
const DONE_TTL_S = 7 * 86400;
/** Les œuvres tentées sans réponse (amont en panne, dépassement) : on y revient dans l'heure, pas dans la semaine. */
const RETRY_TTL_S = 3600;

type Ref = { source: LookupSource; id: string; hint: MediaTypeHint | undefined };

function refOf(row: { tmdbId: string | null; igdbId: string | null; openlibraryId: string | null }): Ref | null {
  if (row.tmdbId) {
    const hint = row.tmdbId.startsWith('tv/') ? 'tv' : row.tmdbId.startsWith('movie/') ? 'movie' : undefined;
    return { source: 'tmdb', id: row.tmdbId, hint };
  }
  if (row.igdbId) return { source: 'igdb', id: row.igdbId, hint: 'game' };
  if (row.openlibraryId) return { source: 'openlibrary', id: row.openlibraryId, hint: 'book' };
  return null;
}

async function tick(): Promise<void> {
  if (!isMetadataEnabled()) return;
  const rows = await db
    .select({ tmdbId: schema.torrents.tmdbId, igdbId: schema.torrents.igdbId, openlibraryId: schema.torrents.openlibraryId })
    .from(schema.torrents)
    .where(
      and(
        eq(schema.torrents.moderationStatus, 'accepted'),
        eq(schema.torrents.isActive, true),
        or(isNotNull(schema.torrents.tmdbId), isNotNull(schema.torrents.igdbId), isNotNull(schema.torrents.openlibraryId)),
      ),
    )
    .orderBy(desc(schema.torrents.createdAt))
    .limit(CANDIDATES);
  const candidates = rows
    .map((row) => refOf(row))
    .filter((ref): ref is Ref => !!ref)
    .map((ref) => ({ ref, key: `${ref.source}:${ref.id}` }));
  if (candidates.length === 0) return;
  // Une lecture pour toute la fenêtre : chaque marqueur porte son propre délai.
  const marks = await redis.mget(...candidates.map((c) => markKey(c.key)));
  const mark = (key: string, ttl: number) => redis.set(markKey(key), '1', 'EX', ttl);
  for (const [i, { ref, key }] of candidates.entries()) {
    if (marks[i]) continue;
    if (!isSourceEnabled(ref.source)) {
      await mark(key, DONE_TTL_S);
      continue;
    }
    const canonical = await normalizeSourceId(ref.source, ref.id);
    if (!canonical) {
      await mark(key, DONE_TTL_S);
      continue;
    }
    // « Fait » seulement sur une réponse ; une panne amont marquait l'œuvre
    // faite pour sept jours, et rien ne la redemandait avant qu'un membre
    // n'ouvre sa fiche. `lookupMetadata` rend null sur amont indisponible
    // comme sur 404 : dans le doute, on repasse dans l'heure.
    let meta: unknown = null;
    try {
      meta = await lookupMetadata(ref.source, canonical, ref.hint);
    } catch (err) {
      console.warn('[MetadataWarmer] lookup failed for', key, ':', (err as Error).message);
    }
    await mark(key, meta ? DONE_TTL_S : RETRY_TTL_S);
    return; // une œuvre par tic : la cadence est la protection des quotas
  }
}

export default defineNitroPlugin(() => {
  const run = async () => {
    try {
      await withCronLock('metadata_warmer:lock', 60, tick);
    } catch (err) {
      console.warn('[MetadataWarmer] tick failed:', (err as Error).message);
    }
  };
  setTimeout(run, FIRST_RUN_DELAY_MS).unref?.();
  setInterval(run, INTERVAL_MS).unref?.();
});
