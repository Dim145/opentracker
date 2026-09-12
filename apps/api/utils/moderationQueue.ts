/**
 * Ce que la file de modération sait, et qu'elle ne disait pas.
 *
 * `GET /api/mod/torrents/pending` renvoyait le torrent, l'uploadeur (id et
 * nom), la catégorie, et qui avait modéré. Rien d'autre. Un modérateur devait
 * donc juger à froid : ouvrir la fiche, ouvrir le profil de l'uploadeur,
 * deviner s'il existait déjà un doublon, et se rappeler quelles règles le site
 * impose. Trois pages et une mémoire, par envoi.
 *
 * Or le produit CALCULE déjà tout cela et le jette :
 *
 *   · `content_signature` sert au cross-seed depuis 0.3x — c'est exactement
 *     « ce contenu existe-t-il déjà », posé sur une colonne indexée ;
 *   · `anticheat_flags` sait si l'uploadeur est sous surveillance ;
 *   · `evaluateUpload` vérifie NFO, description et nommage — mais comme
 *     BARRIÈRE à l'upload, donc ce qui échoue n'atteint jamais la file et ce
 *     qui l'atteint arrive sans mention de ce qui a été vérifié ;
 *   · l'historique d'un uploadeur est un `count(*) FILTER` sur `torrents`.
 *
 * Ce module rassemble les quatre en un seul aller-retour, et calcule l'ordre
 * de la file. Il ne décide rien : un signal au rouge n'empêche pas d'accepter,
 * et aucun ne déclenche d'action. Un faux positif sur un rejet coûte un
 * membre ; sur une acceptation, la crédibilité du catalogue.
 */
import { db, schema } from '@trackarr/db';
import { and, eq, inArray, isNull, lt, ne, notInArray, or, sql } from 'drizzle-orm';
import { getUploadRules, evaluateUpload } from '~~/utils/uploadRules';

/**
 * Au-delà, une réclamation ne vaut plus rien.
 *
 * Un modérateur qui ferme son onglet ne doit pas geler un envoi pour tout le
 * monde : sans expiration, la première panne de réseau retire définitivement
 * une ligne de la file de tous les autres. Trente minutes tiennent le temps
 * d'une décision et ne survivent pas à une pause déjeuner.
 */
export const CLAIM_TTL_MS = 30 * 60 * 1000;

/** Une réclamation encore valide à cet instant. */
export function claimIsLive(claimedAt: Date | null | undefined): boolean {
  if (!claimedAt) return false;
  return Date.now() - claimedAt.getTime() < CLAIM_TTL_MS;
}

export interface UploaderRecord {
  accepted: number;
  rejected: number;
  changesRequested: number;
  /** Avertissements actifs : ni révoqués, ni expirés. */
  warnings: number;
  /** Drapeaux anti-triche non encore examinés. */
  openFlags: number;
  /** Date d'inscription, pour distinguer un nouveau d'un habitué. */
  memberSince: Date | null;
}

export interface DuplicateHint {
  infoHash: string;
  name: string;
  moderationStatus: string;
}

export interface RuleCheck {
  ok: boolean;
  reason?: string;
  detail?: string;
}

export interface QueueSignals {
  uploader: UploaderRecord;
  /** Un torrent ACCEPTÉ portant la même signature de contenu, s'il existe. */
  duplicate: DuplicateHint | null;
  /** Le verdict des règles d'upload, rejoué en consultatif. */
  rules: RuleCheck;
}

/**
 * Priorité d'un élément de file.
 *
 * La file était en `ORDER BY created_at DESC` en dur : une pile, pas une file.
 * Le plus vieil envoi — celui dont l'uploadeur attend depuis quatre jours —
 * finissait en bas. On garde l'ancienneté comme base et on remonte ce qui
 * mérite un regard plus tôt.
 *
 * Le score n'est pas affiché tel quel : l'interface en montre le motif
 * (« en attente depuis 4 jours », « premier envoi »). Un nombre nu
 * n'apprendrait rien à personne.
 */
export interface QueuePriority {
  score: number;
  /** Pourquoi cet élément remonte. Vide = rien de particulier. */
  reasons: Array<'aging' | 'first_upload' | 'flagged' | 'rules_failed'>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function computePriority(input: {
  createdAt: Date;
  signals: QueueSignals;
}): QueuePriority {
  const reasons: QueuePriority['reasons'] = [];
  const ageDays = (Date.now() - input.createdAt.getTime()) / DAY_MS;

  // L'ancienneté est la base, plafonnée : au-delà d'une semaine, attendre un
  // jour de plus ne rend pas un envoi plus urgent qu'un autre vieux de huit.
  let score = Math.min(ageDays, 7) * 10;
  if (ageDays >= 2) reasons.push('aging');

  const u = input.signals.uploader;
  // Un premier envoi mérite une réponse rapide : c'est le moment où un membre
  // décide s'il recommencera. Il ne mérite pas d'être traité en dernier parce
  // que la file est chronologique.
  if (u.accepted === 0 && u.rejected === 0 && u.changesRequested === 0) {
    score += 25;
    reasons.push('first_upload');
  }
  if (u.openFlags > 0 || u.warnings > 0) {
    score += 15;
    reasons.push('flagged');
  }
  if (!input.signals.rules.ok) {
    score += 20;
    reasons.push('rules_failed');
  }

  return { score: Math.round(score), reasons };
}

/**
 * Les signaux pour un lot d'envois, en un aller-retour par famille.
 *
 * Écrit en « batch » plutôt qu'en boucle : une file de vingt éléments ferait
 * quatre-vingts requêtes en boucle, et le N+1 se serait installé le jour où
 * quelqu'un aurait paginé plus large.
 */
export async function collectSignals(
  rows: Array<{
    id: string;
    infoHash: string;
    name: string;
    description: string | null;
    nfo: string | null;
    tmdbId: string | null;
    categoryId: string | null;
    size: number;
    contentSignature: string | null;
    uploaderId: string | null;
    uploaderIsStaff: boolean;
  }>
): Promise<Map<string, QueueSignals>> {
  const out = new Map<string, QueueSignals>();
  if (rows.length === 0) return out;

  const uploaderIds = [
    ...new Set(rows.map((r) => r.uploaderId).filter((v): v is string => !!v)),
  ];
  const signatures = [
    ...new Set(
      rows.map((r) => r.contentSignature).filter((v): v is string => !!v)
    ),
  ];
  const ids = rows.map((r) => r.id);

  const [history, warnings, flags, members, dupes, snapshot] = await Promise.all([
    // Combien d'envois de chaque uploadeur ont été acceptés, rejetés, renvoyés
    // pour correction. On exclut les lignes de la file courante, sinon un
    // uploadeur dont c'est le premier envoi se compterait lui-même.
    uploaderIds.length
      ? db
          .select({
            uploaderId: schema.torrents.uploaderId,
            accepted: sql<number>`count(*) FILTER (WHERE ${schema.torrents.moderationStatus} = 'accepted')::int`,
            rejected: sql<number>`count(*) FILTER (WHERE ${schema.torrents.moderationStatus} = 'rejected')::int`,
            changes: sql<number>`count(*) FILTER (WHERE ${schema.torrents.moderationStatus} = 'changes_requested')::int`,
          })
          .from(schema.torrents)
          .where(
            and(
              inArray(schema.torrents.uploaderId, uploaderIds),
              notInArray(schema.torrents.id, ids)
            )
          )
          .groupBy(schema.torrents.uploaderId)
      : Promise.resolve([] as Array<{ uploaderId: string | null; accepted: number; rejected: number; changes: number }>),

    uploaderIds.length
      ? db
          .select({
            userId: schema.userWarnings.userId,
            count: sql<number>`count(*)::int`,
          })
          .from(schema.userWarnings)
          .where(
            and(
              inArray(schema.userWarnings.userId, uploaderIds),
              isNull(schema.userWarnings.revokedAt),
              or(
                isNull(schema.userWarnings.expiresAt),
                sql`${schema.userWarnings.expiresAt} > now()`
              )
            )
          )
          .groupBy(schema.userWarnings.userId)
      : Promise.resolve([] as Array<{ userId: string; count: number }>),

    uploaderIds.length
      ? db
          .select({
            userId: schema.anticheatFlags.userId,
            count: sql<number>`count(*)::int`,
          })
          .from(schema.anticheatFlags)
          .where(
            and(
              inArray(schema.anticheatFlags.userId, uploaderIds),
              isNull(schema.anticheatFlags.reviewedAt)
            )
          )
          .groupBy(schema.anticheatFlags.userId)
      : Promise.resolve([] as Array<{ userId: string; count: number }>),

    uploaderIds.length
      ? db
          .select({
            id: schema.users.id,
            createdAt: schema.users.createdAt,
          })
          .from(schema.users)
          .where(inArray(schema.users.id, uploaderIds))
      : Promise.resolve([] as Array<{ id: string; createdAt: Date }>),

    // Le doublon : même signature de contenu, déjà ACCEPTÉ, et pas soi-même.
    // La colonne est indexée parce que le cross-seed s'en sert déjà.
    signatures.length
      ? db
          .select({
            infoHash: schema.torrents.infoHash,
            name: schema.torrents.name,
            moderationStatus: schema.torrents.moderationStatus,
            contentSignature: schema.torrents.contentSignature,
          })
          .from(schema.torrents)
          .where(
            and(
              inArray(schema.torrents.contentSignature, signatures),
              eq(schema.torrents.moderationStatus, 'accepted'),
              notInArray(schema.torrents.id, ids)
            )
          )
      : Promise.resolve([] as Array<{ infoHash: string; name: string; moderationStatus: string; contentSignature: string | null }>),

    getUploadRules(),
  ]);

  const histBy = new Map(history.map((h) => [h.uploaderId, h]));
  const warnBy = new Map(warnings.map((w) => [w.userId, w.count]));
  const flagBy = new Map(flags.map((f) => [f.userId, f.count]));
  const memberBy = new Map(members.map((m) => [m.id, m.createdAt]));
  const dupeBy = new Map<string, DuplicateHint>();
  for (const d of dupes) {
    if (d.contentSignature && !dupeBy.has(d.contentSignature)) {
      dupeBy.set(d.contentSignature, {
        infoHash: d.infoHash,
        name: d.name,
        moderationStatus: d.moderationStatus,
      });
    }
  }

  for (const r of rows) {
    const h = r.uploaderId ? histBy.get(r.uploaderId) : undefined;
    // `evaluateUpload` est pur : le rejouer ici ne coûte rien et ne bloque
    // rien. C'est la différence entre une barrière et un signal.
    const rules = evaluateUpload(snapshot, {
      title: r.name,
      description: r.description,
      nfo: r.nfo,
      tmdbId: r.tmdbId,
      categoryId: r.categoryId,
      sizeBytes: Number(r.size ?? 0),
      // On veut le verdict BRUT, pas celui qu'un contournement staff aurait
      // rendu : un modérateur doit voir ce que la règle dit du fichier.
      isStaff: false,
    });

    out.set(r.id, {
      uploader: {
        accepted: h?.accepted ?? 0,
        rejected: h?.rejected ?? 0,
        changesRequested: h?.changes ?? 0,
        warnings: (r.uploaderId && warnBy.get(r.uploaderId)) || 0,
        openFlags: (r.uploaderId && flagBy.get(r.uploaderId)) || 0,
        memberSince: (r.uploaderId && memberBy.get(r.uploaderId)) || null,
      },
      duplicate: r.contentSignature
        ? (dupeBy.get(r.contentSignature) ?? null)
        : null,
      rules: { ok: rules.ok, reason: rules.reason, detail: rules.detail },
    });
  }

  return out;
}

/**
 * Prendre un élément, ou le rendre.
 *
 * Renvoie `false` quand quelqu'un d'autre le tient déjà — l'appelant répond
 * alors 409 plutôt que d'écraser en silence. Le `and()` sur l'état de la
 * réclamation fait la vérification et l'écriture dans la même instruction :
 * deux modérateurs qui cliquent à la même seconde ne peuvent pas gagner tous
 * les deux.
 */
export async function claimTorrent(
  torrentId: string,
  userId: string
): Promise<boolean> {
  const staleBefore = new Date(Date.now() - CLAIM_TTL_MS);
  const rows = await db
    .update(schema.torrents)
    .set({ moderationClaimedById: userId, moderationClaimedAt: new Date() })
    .where(
      and(
        eq(schema.torrents.id, torrentId),
        eq(schema.torrents.moderationStatus, 'pending'),
        or(
          isNull(schema.torrents.moderationClaimedById),
          eq(schema.torrents.moderationClaimedById, userId),
          // `lt` et non un template `sql` : une Date passée en paramètre brut
          // arrive au pilote comme un objet qu'il ne sait pas sérialiser
          // (« The "string" argument must be of type string »).
          lt(schema.torrents.moderationClaimedAt, staleBefore)
        )
      )
    )
    .returning({ id: schema.torrents.id });
  return rows.length > 0;
}

export async function releaseTorrent(
  torrentId: string,
  userId: string,
  { force = false }: { force?: boolean } = {}
): Promise<boolean> {
  const rows = await db
    .update(schema.torrents)
    .set({ moderationClaimedById: null, moderationClaimedAt: null })
    .where(
      force
        ? eq(schema.torrents.id, torrentId)
        : and(
            eq(schema.torrents.id, torrentId),
            eq(schema.torrents.moderationClaimedById, userId)
          )
    )
    .returning({ id: schema.torrents.id });
  return rows.length > 0;
}

/** Une décision relâche toujours la réclamation : l'élément quitte la file. */
export async function clearClaim(torrentId: string): Promise<void> {
  await db
    .update(schema.torrents)
    .set({ moderationClaimedById: null, moderationClaimedAt: null })
    .where(
      and(
        eq(schema.torrents.id, torrentId),
        ne(schema.torrents.moderationStatus, 'pending')
      )
    );
}
