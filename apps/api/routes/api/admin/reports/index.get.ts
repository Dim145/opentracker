/**
 * GET /api/admin/reports
 *
 * Paginated list of moderation reports. Available to moderators AND
 * admins (the route still lives under /admin but enforces the wider
 * `requireModeratorSession` gate).
 *
 * Each row is enriched with a `target` object that gives the UI
 * everything it needs to render a clickable reference to the reported
 * entity. The enrichment is batched per target type so the handler
 * stays O(1) regardless of page size.
 *
 * Les commentaires et les messages de forum étaient laissés en références
 * NON RÉSOLUES : la file affichait un `targetType` et un identifiant, et le
 * modérateur devait aller chercher lui-même ce qu'on lui signalait — dans la
 * base, ou en devinant le lien. Un signalement qu'on ne peut pas lire ne se
 * traite pas ; c'était le trou le plus net de la file.
 *
 * Ils portent maintenant leur extrait, leur auteur et un lien d'ancre vers
 * l'endroit exact. L'extrait est TRONQUÉ côté serveur : la file n'a pas à
 * transporter un pavé de 4 000 caractères pour chaque ligne, et le modérateur
 * ouvre le lien quand il lui en faut plus.
 */
import { db, schema } from '@trackarr/db';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { eq, desc, and, sql, inArray, type SQL } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  await requireModeratorSession(event);

  const query = getQuery(event);
  const status = query.status as string | undefined;
  const page = parseInt(query.page as string) || 1;
  const limit = Math.min(parseInt(query.limit as string) || 20, 50);
  const offset = (page - 1) * limit;

  const conditions: SQL[] = [];
  if (status && ['pending', 'resolved', 'dismissed', 'withdrawn'].includes(status)) {
    conditions.push(eq(schema.reports.status, status));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [reports, countResult, statusCounts] = await Promise.all([
    db.query.reports.findMany({
      where: whereClause,
      with: {
        reporter: { columns: { id: true, username: true } },
        resolver: { columns: { id: true, username: true } },
        // Qui s'en occupe : sans cela l'interface ne pourrait pas dire
        // qu'un collègue instruit déjà ce dossier.
        assignedTo: { columns: { id: true, username: true } },
      },
      orderBy: [desc(schema.reports.createdAt)],
      limit,
      offset,
    }),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.reports)
      .where(whereClause),
    // Snapshot of unfiltered counts per status. Lets the UI render
    // the filter chips with live totals so a mod can see at a glance
    // how much work is pending without flipping through tabs.
    db
      .select({
        status: schema.reports.status,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.reports)
      .groupBy(schema.reports.status),
  ]);

  // ── Target enrichment ──────────────────────────────────────
  // Group target ids by type so we can fan out one query per type
  // (each capped to ~50 rows by the page limit upstream).
  const torrentIds = reports
    .filter((r) => r.targetType === 'torrent')
    .map((r) => r.targetId);
  const userIds = reports
    .filter((r) => r.targetType === 'user')
    .map((r) => r.targetId);
  const commentIds = reports
    .filter((r) => r.targetType === 'comment')
    .map((r) => r.targetId);
  const postIds = reports
    .filter((r) => r.targetType === 'post')
    .map((r) => r.targetId);

  const [torrents, users, comments, posts] = await Promise.all([
    torrentIds.length
      ? db.query.torrents.findMany({
          where: inArray(schema.torrents.id, torrentIds),
          columns: { id: true, infoHash: true, name: true },
        })
      : Promise.resolve([] as { id: string; infoHash: string; name: string }[]),
    userIds.length
      ? db.query.users.findMany({
          where: inArray(schema.users.id, userIds),
          columns: { id: true, username: true },
        })
      : Promise.resolve([] as { id: string; username: string }[]),
    // Le commentaire signalé, avec de quoi l'ouvrir : l'empreinte du torrent
    // qui le porte fait le lien, l'auteur dit à qui parler.
    commentIds.length
      ? db.query.torrentComments.findMany({
          where: inArray(schema.torrentComments.id, commentIds),
          columns: { id: true, content: true, createdAt: true },
          with: {
            author: { columns: { id: true, username: true } },
            torrent: { columns: { infoHash: true, name: true } },
          },
        })
      : Promise.resolve(
          [] as Array<{
            id: string;
            content: string;
            createdAt: Date;
            author: { id: string; username: string } | null;
            torrent: { infoHash: string; name: string } | null;
          }>
        ),
    postIds.length
      ? db.query.forumPosts.findMany({
          where: inArray(schema.forumPosts.id, postIds),
          columns: { id: true, content: true, createdAt: true },
          with: {
            author: { columns: { id: true, username: true } },
            topic: { columns: { id: true, title: true } },
          },
        })
      : Promise.resolve(
          [] as Array<{
            id: string;
            content: string;
            createdAt: Date;
            author: { id: string; username: string } | null;
            topic: { id: string; title: string } | null;
          }>
        ),
  ]);

  const torrentMap = new Map(torrents.map((t) => [t.id, t]));
  const userMap = new Map(users.map((u) => [u.id, u]));
  const commentMap = new Map(comments.map((c) => [c.id, c]));
  const postMap = new Map(posts.map((p) => [p.id, p]));

  /** Ce que la file transporte d'un contenu signalé : assez pour juger d'un
   *  coup d'œil, pas assez pour peser sur la réponse. */
  const EXCERPT = 280;
  const excerpt = (body: string) =>
    body.length > EXCERPT ? `${body.slice(0, EXCERPT)}…` : body;

  const enriched = reports.map((r) => {
    let target:
      | { kind: 'torrent'; name: string; link: string }
      | { kind: 'user'; name: string; link: string }
      | {
          kind: 'comment' | 'post';
          name: string;
          link: string;
          excerpt: string;
          author: { id: string; username: string } | null;
          postedAt: Date | null;
          /** Vrai quand le contenu a disparu entre le signalement et sa
           *  lecture — supprimé par son auteur, ou par un autre modérateur.
           *  L'interface doit le dire plutôt que d'afficher un vide. */
          gone?: true;
        }
      | null = null;

    switch (r.targetType) {
      case 'torrent': {
        const t = torrentMap.get(r.targetId);
        if (t) {
          target = {
            kind: 'torrent',
            name: t.name,
            link: `/torrents/${t.infoHash}`,
          };
        }
        break;
      }
      case 'user': {
        const u = userMap.get(r.targetId);
        if (u) {
          target = {
            kind: 'user',
            name: u.username,
            link: `/users/${u.id}`,
          };
        }
        break;
      }
      case 'comment': {
        const c = commentMap.get(r.targetId);
        target = c
          ? {
              kind: 'comment',
              name: c.torrent?.name ?? '—',
              // L'ancre mène au commentaire lui-même, pas au haut de la fiche.
              link: c.torrent
                ? `/torrents/${c.torrent.infoHash}#comment-${c.id}`
                : '',
              excerpt: excerpt(c.content),
              author: c.author ?? null,
              postedAt: c.createdAt,
            }
          : {
              kind: 'comment',
              name: '—',
              link: '',
              excerpt: '',
              author: null,
              postedAt: null,
              gone: true,
            };
        break;
      }
      case 'post': {
        const p = postMap.get(r.targetId);
        target = p
          ? {
              kind: 'post',
              name: p.topic?.title ?? '—',
              link: p.topic ? `/forum/topic/${p.topic.id}#post-${p.id}` : '',
              excerpt: excerpt(p.content),
              author: p.author ?? null,
              postedAt: p.createdAt,
            }
          : {
              kind: 'post',
              name: '—',
              link: '',
              excerpt: '',
              author: null,
              postedAt: null,
              gone: true,
            };
        break;
      }
    }
    return { ...r, target };
  });

  // Roll the grouped count rows up into a typed object so the UI
  // doesn't have to .find() on every render.
  const counts = {
    pending: 0,
    resolved: 0,
    dismissed: 0,
    withdrawn: 0,
  };
  for (const row of statusCounts) {
    if (row.status in counts) {
      counts[row.status as keyof typeof counts] = row.count;
    }
  }
  const total =
    counts.pending + counts.resolved + counts.dismissed + counts.withdrawn;

  // Withdrawals per reporter present on this page. This is the tombstone's
  // whole purpose: one withdrawn report says nothing, a series says a lot. One
  // grouped query over the page's ids rather than a subquery per row.
  const reporterIds = [...new Set(enriched.map((r) => r.reporterId).filter(Boolean))];
  const withdrawnRows = reporterIds.length
    ? await db
        .select({
          reporterId: schema.reports.reporterId,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.reports)
        .where(
          and(
            inArray(schema.reports.reporterId, reporterIds as string[]),
            eq(schema.reports.status, 'withdrawn')
          )
        )
        .groupBy(schema.reports.reporterId)
    : [];
  const withdrawnByReporter: Record<string, number> = {};
  for (const row of withdrawnRows) {
    if (row.reporterId) withdrawnByReporter[row.reporterId] = row.count;
  }

  return {
    data: enriched.map((r) => ({
      ...r,
      reporterWithdrawnCount: r.reporterId
        ? (withdrawnByReporter[r.reporterId] ?? 0)
        : 0,
    })),
    counts: { ...counts, all: total },
    pagination: {
      page,
      limit,
      total: countResult[0]?.count || 0,
      pages: Math.ceil((countResult[0]?.count || 0) / limit),
    },
  };
});
