/**
 * GET /api/admin/federation/health
 *
 * Répond à la seule question qu'un opérateur se pose vraiment : « ma
 * fédération va-t-elle bien ? »
 *
 * Les données existaient déjà — `federation_sync_state` consigne depuis
 * toujours le dernier passage, le curseur, le nombre d'éléments et l'erreur
 * éventuelle par couple (pair, ressource) — mais rien ne les relisait. Un
 * pair qui échouait en silence depuis des jours restait invisible tant que
 * personne n'allait lire la table à la main.
 *
 * Le verdict est calculé ici plutôt que dans l'interface : « en retard » n'a
 * de sens que rapporté à l'intervalle de synchronisation réel, que le serveur
 * connaît et que le navigateur devrait sinon deviner.
 */
import { db, schema } from '@trackarr/db';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { requireAdminSession } from '~~/utils/adminAuth';
import { getFederationConfig } from '~~/utils/federation/config';

/** Un pair est « en retard » au-delà de trois intervalles sans passage. */
const STALE_INTERVALS = 3;

type Verdict = 'ok' | 'stale' | 'error' | 'never';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);

  const config = await getFederationConfig();
  const intervalMs = Number(process.env.FEDERATION_SYNC_INTERVAL_MS || 900_000);
  const staleAfterMs = intervalMs * STALE_INTERVALS;
  const now = Date.now();

  // Seuls les pairs actifs comptent : un pair en attente ou bloqué n'est pas
  // censé synchroniser, l'afficher en erreur serait un faux positif.
  const peers = await db
    .select({
      id: schema.federationPeers.id,
      displayName: schema.federationPeers.displayName,
      baseUrl: schema.federationPeers.baseUrl,
      status: schema.federationPeers.status,
      lastSeenAt: schema.federationPeers.lastSeenAt,
      lastHandshakeAt: schema.federationPeers.lastHandshakeAt,
      lastError: schema.federationPeers.lastError,
    })
    .from(schema.federationPeers)
    .orderBy(desc(schema.federationPeers.lastSeenAt));

  const peerIds = peers.map((p) => p.id);

  // Un aller-retour par table plutôt qu'un par pair : le nombre de pairs est
  // petit mais la page se rafraîchit, et N+1 sur un rafraîchissement
  // automatique se paie tous les jours.
  const [states, mirrorCounts] = await Promise.all([
    peerIds.length
      ? db
          .select()
          .from(schema.federationSyncState)
          .where(inArray(schema.federationSyncState.peerId, peerIds))
      : [],
    peerIds.length
      ? db
          .select({
            peerId: schema.remoteTorrents.peerId,
            count: sql<number>`count(*)::int`,
          })
          .from(schema.remoteTorrents)
          .where(inArray(schema.remoteTorrents.peerId, peerIds))
          .groupBy(schema.remoteTorrents.peerId)
      : [],
  ]);

  const mirrorByPeer = new Map(mirrorCounts.map((r) => [r.peerId, r.count]));
  const statesByPeer = new Map<string, typeof states>();
  for (const s of states) {
    const list = statesByPeer.get(s.peerId) ?? [];
    list.push(s);
    statesByPeer.set(s.peerId, list);
  }

  const verdictFor = (
    lastRunAt: Date | null,
    lastStatus: string | null
  ): Verdict => {
    if (lastStatus === 'error') return 'error';
    if (!lastRunAt) return 'never';
    return now - lastRunAt.getTime() > staleAfterMs ? 'stale' : 'ok';
  };

  const rows = peers.map((peer) => {
    const resources = (statesByPeer.get(peer.id) ?? []).map((s) => ({
      resource: s.resource,
      cursor: s.cursor,
      lastRunAt: s.lastRunAt,
      lastStatus: s.lastStatus,
      itemsSynced: s.itemsSynced,
      lastError: s.lastError,
      verdict: verdictFor(s.lastRunAt, s.lastStatus),
    }));

    // Verdict du pair : le pire de ses ressources. Un catalogue qui passe
    // pendant que les suppressions échouent n'est pas un pair en bonne santé.
    const order: Verdict[] = ['ok', 'stale', 'never', 'error'];
    const worst = resources.reduce<Verdict>(
      (acc, r) => (order.indexOf(r.verdict) > order.indexOf(acc) ? r.verdict : acc),
      resources.length ? 'ok' : 'never'
    );

    return {
      ...peer,
      active: peer.status === 'active',
      mirrored: mirrorByPeer.get(peer.id) ?? 0,
      resources,
      verdict: peer.status === 'active' ? worst : null,
    };
  });

  const active = rows.filter((r) => r.active);
  const summary = {
    peersTotal: rows.length,
    peersActive: active.length,
    ok: active.filter((r) => r.verdict === 'ok').length,
    stale: active.filter((r) => r.verdict === 'stale').length,
    error: active.filter((r) => r.verdict === 'error').length,
    never: active.filter((r) => r.verdict === 'never').length,
    mirroredTotal: rows.reduce((n, r) => n + r.mirrored, 0),
    // Dernier passage toutes ressources confondues : le « battement de cœur »
    // de la fédération, ce qu'on regarde en premier.
    lastRunAt:
      states
        .map((s) => s.lastRunAt)
        .filter((d): d is Date => !!d)
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
  };

  return {
    enabled: !!config?.enabled,
    intervalMs,
    staleAfterMs,
    summary,
    peers: rows,
  };
});
