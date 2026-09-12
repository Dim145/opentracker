/**
 * GET /api/mod/torrents/pending
 *
 * Moderation queue. Returns every torrent whose status isn't
 * `accepted` — i.e. pending, changes_requested, and rejected — so a
 * moderator sees the full backlog (including rejects, which are kept
 * around to block re-uploads and as a paper trail).
 *
 * Optional `?status=` query restricts the listing to a single bucket
 * when the moderator wants to focus on a specific lane.
 *
 * ── Ce qui a changé, et pourquoi ────────────────────────────────────────────
 *
 * Cette route ne renvoyait que le torrent, son uploadeur (id et nom), sa
 * catégorie et qui avait modéré. Le modérateur devait donc juger à froid :
 * ouvrir la fiche sur une autre page, ouvrir le profil de l'uploadeur sur une
 * troisième, et deviner le reste.
 *
 * Elle renvoie maintenant, pour chaque ligne :
 *
 *   · `signals`  — l'historique de l'uploadeur, le doublon éventuel, ses
 *                  drapeaux anti-triche, et le verdict des règles d'upload
 *                  rejoué en CONSULTATIF (voir `utils/moderationQueue.ts`) ;
 *   · `priority` — un score et surtout SES MOTIFS, pour que la file cesse
 *                  d'être une pile chronologique ;
 *   · `claim`    — qui la travaille en ce moment, si quelqu'un.
 *
 * Les endormis (`moderation_snoozed_until` dans le futur) sortent de la vue
 * par défaut et reviennent avec `?snoozed=1` — sinon on les aurait perdus.
 */
import { db, schema } from '@trackarr/db';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { and, desc, eq, gt, isNull, ne, or, sql } from 'drizzle-orm';
import {
  claimIsLive,
  collectSignals,
  computePriority,
} from '~~/utils/moderationQueue';

const ALLOWED_STATUSES = ['pending', 'changes_requested', 'rejected'] as const;

export default defineEventHandler(async (event) => {
  await requireModeratorSession(event);

  const query = getQuery(event);
  const status =
    typeof query.status === 'string' &&
    (ALLOWED_STATUSES as readonly string[]).includes(query.status)
      ? (query.status as (typeof ALLOWED_STATUSES)[number])
      : null;
  // `?snoozed=1` montre CE QUI DORT, et seulement cela : c'est une vue de
  // rattrapage, pas un filtre de plus sur la file courante.
  const snoozedOnly = query.snoozed === '1' || query.snoozed === 'true';

  const statusWhere = status
    ? eq(schema.torrents.moderationStatus, status)
    : ne(schema.torrents.moderationStatus, 'accepted');

  const snoozeWhere = snoozedOnly
    ? gt(schema.torrents.moderationSnoozedUntil, sql`now()`)
    : or(
        isNull(schema.torrents.moderationSnoozedUntil),
        sql`${schema.torrents.moderationSnoozedUntil} <= now()`
      );

  const rows = await db.query.torrents.findMany({
    where: and(statusWhere, snoozeWhere),
    with: {
      uploader: {
        columns: {
          id: true,
          username: true,
          isAdmin: true,
          isModerator: true,
        },
      },
      category: true,
      moderatedBy: {
        columns: { id: true, username: true },
      },
      moderationClaimedBy: {
        columns: { id: true, username: true },
      },
    },
    orderBy: [desc(schema.torrents.createdAt)],
  });

  // Les signaux ne valent que pour ce qui attend encore une décision. Calculer
  // l'historique d'un uploadeur pour une ligne rejetée il y a trois mois
  // coûterait autant et n'apprendrait rien.
  const open = rows.filter((r) => r.moderationStatus === 'pending');
  const signals = await collectSignals(
    open.map((r) => ({
      id: r.id,
      infoHash: r.infoHash,
      name: r.name,
      description: r.description ?? null,
      nfo: r.nfo ?? null,
      tmdbId: r.tmdbId ?? null,
      categoryId: r.categoryId ?? null,
      size: Number(r.size ?? 0),
      contentSignature: r.contentSignature ?? null,
      uploaderId: r.uploaderId ?? null,
      uploaderIsStaff: !!(r.uploader?.isAdmin || r.uploader?.isModerator),
    }))
  );

  const enriched = rows.map((r) => {
    const s = signals.get(r.id) ?? null;
    const live = claimIsLive(r.moderationClaimedAt);
    return {
      ...r,
      signals: s,
      priority: s ? computePriority({ createdAt: r.createdAt, signals: s }) : null,
      // Une réclamation périmée n'est pas rendue : la ligne redevient libre
      // pour tout le monde, ce que l'interface doit voir.
      claim: live
        ? {
            by: r.moderationClaimedBy,
            at: r.moderationClaimedAt,
          }
        : null,
      snoozedUntil: r.moderationSnoozedUntil,
    };
  });

  // Le tri final se fait ici plutôt qu'en SQL : la priorité dépend de signaux
  // calculés après la requête, et la file tient dans quelques dizaines de
  // lignes. Les décidés gardent l'ordre chronologique — ils ne sont que de
  // l'historique.
  enriched.sort((a, b) => {
    if (a.priority && b.priority && a.priority.score !== b.priority.score) {
      return b.priority.score - a.priority.score;
    }
    if (a.priority && !b.priority) return -1;
    if (!a.priority && b.priority) return 1;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  return enriched;
});
