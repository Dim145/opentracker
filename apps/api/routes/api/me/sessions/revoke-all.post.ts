/**
 * POST /api/me/sessions/revoke-all — « Déconnecter partout ».
 *
 * Le cookie de session est scellé et SANS ÉTAT : sept jours, sans registre
 * serveur. Jusqu'ici rien ne pouvait l'invalider. `auth/password.put.ts`
 * documente d'ailleurs qu'un changement de mot de passe laisse les sessions
 * ouvertes, et se déconnecter ne vide que le cookie du navigateur courant. Un
 * cookie exfiltré — un poste partagé, un ordinateur volé, une extension
 * curieuse — valait donc sept jours d'accès ordinaire, et le seul recours
 * était de bannir le compte ou de faire tourner `NUXT_SESSION_SECRET`, ce qui
 * déconnecte TOUS les membres pour le problème d'un seul.
 *
 * Le geste est un incrément : `users.session_epoch + 1`. La session porte
 * l'époque reçue à la connexion, et `requireUserSession` compare les deux à
 * chaque requête — sur la lecture d'état vivant qui avait déjà lieu, donc sans
 * requête supplémentaire.
 *
 * CELLE DE L'APPELANT AUSSI. C'est voulu : « déconnecter partout » qui
 * épargnerait l'appareil courant obligerait à savoir lequel c'est, et cette
 * information n'existe pas dans un cookie sans état. Le membre se reconnecte —
 * et c'est aussi la bonne réponse quand il ne sait plus quel appareil est
 * compromis.
 *
 * `requireFreshAuth` comme sur la réinitialisation de passkey : une action qui
 * répare un vol de session ne doit pas être déclenchable PAR la session volée
 * sans que son porteur reprouve qui il est.
 */
import { db, schema } from '@trackarr/db';
import { eq, sql } from 'drizzle-orm';
import { requireAuthSession, requireFreshAuth } from '~~/utils/adminAuth';
import { invalidateRoleCache } from '~~/utils/liveRoles';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { auditDetail } from '~~/utils/audit';

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event);
  await requireFreshAuth(event);
  await rateLimit(event, RATE_LIMITS.mutation);

  auditDetail(event, {
    action: 'session.revoke_all',
    targetType: 'user',
    targetId: session.user.id,
  });

  const [row] = await db
    .update(schema.users)
    .set({ sessionEpoch: sql`${schema.users.sessionEpoch} + 1` })
    .where(eq(schema.users.id, session.user.id))
    .returning({ sessionEpoch: schema.users.sessionEpoch });

  // Le cache de rôles porte l'époque : sans cette purge, l'instance
  // continuerait d'accepter les sessions périmées jusqu'à 60 s.
  await invalidateRoleCache(session.user.id);

  // On ne vide pas le cookie ici : la prochaine requête le fera, avec le motif
  // `session-revoked` que le front sait présenter. Le vider maintenant
  // donnerait une déconnexion muette, impossible à distinguer d'une panne.
  return { ok: true, sessionEpoch: row?.sessionEpoch ?? null };
});
