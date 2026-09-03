import { eq, and, asc, isNull } from 'drizzle-orm';
import { db } from '@trackarr/db';
import {
  users,
  torrents,
  panicState,
  forumPosts,
  torrentComments,
} from '@trackarr/db/schema';
import { requireAdminSession } from '~~/utils/adminAuth';
import { auditDetail } from '~~/utils/audit';
import { z } from 'zod';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import {
  CURRENT_KDF_VERSION,
  deriveKey,
  generateSalt,
  // `encryptFieldOnce` et non `encryptField` : une reprise doit reconnaître ce
  // qui est déjà chiffré plutôt que le chiffrer une seconde fois.
  encryptFieldOnce as encryptField,
  encrypt,
} from '~~/utils/panic';

/**
 * POST /api/admin/panic/encrypt
 * Encrypt all sensitive database data
 * This is an emergency action that renders data unreadable
 */
/*
 * Le corps est borné, et l'appel limité — comme `restore`.
 *
 * `restore` porte les trois durcissements (seau `RATE_LIMITS.auth`, budget
 * global, schéma `.max(200)`) et les justifie : « free CPU amplification »,
 * parce que la valeur atteint scrypt. `encrypt` dérive la MÊME clé depuis le
 * MÊME mot de passe et n'en avait aucun — `readBody()` nu, aucune limite.
 *
 * Deux conséquences. Un `panicPassword` de plusieurs mégaoctets part dans
 * scrypt à chaque appel ; et surtout `verifyPassword(admin.panicPasswordHash,
 * …)` plus bas est un oracle : sans plafond, une session d'administration
 * compromise essaie le mot de passe qui déchiffre TOUTE la base autant de fois
 * qu'elle veut. Que la porte demande déjà une session admin ne change rien —
 * c'est précisément le scénario contre lequel le mode panique existe.
 */
const bodySchema = z
  .object({
    confirm: z.literal('ENCRYPT_ALL_DATA'),
    panicPassword: z.string().min(1, 'Panic password is required').max(200),
  })
  .strict();

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  await rateLimit(event, RATE_LIMITS.auth);
  // Named before the body is read, so the entry exists even when a guard
  // below rejects the request — an attempted panic is worth as much as a
  // completed one, and the status code on the row says which it was.
  //
  // No `changes`: the body carries the raw panic password.
  auditDetail(event, { action: 'panic.encrypt', targetType: 'instance' });

  // The raw panic password is required so the encryption key can be
  // derived from it (not from the stored hash). Deriving from the
  // hash would leave BOTH KDF inputs (hash + salt) inside the very
  // dump panic mode is meant to protect — see finding C1.
  const body = await readValidatedBody(event, bodySchema.parse);

  const currentState = await db.query.panicState.findFirst();
  if (currentState?.isEncrypted) {
    throw createError({
      statusCode: 400,
      message: 'Database is already encrypted',
    });
  }

  /*
   * Une reprise, et non un second chiffrement.
   *
   * Les quatre boucles ci-dessous tournent ligne par ligne, hors transaction.
   * Une interruption au milieu — délai HTTP, mémoire épuisée, conteneur
   * redémarré — laissait la moitié des lignes chiffrées sous une clé dérivée
   * d'un sel qui n'existait que dans la mémoire du processus, `is_encrypted`
   * restant à `false` : la donnée était définitivement perdue, et relancer la
   * route générait un NOUVEAU sel puis surchiffrait les lignes déjà faites.
   *
   * Désormais : le sel, le hachis et la version sont écrits AVANT la première
   * boucle avec `phase = 'encrypting'`. Une interruption laisse donc une base
   * restaurable, et une relance reprend avec le MÊME sel — les champs déjà
   * chiffrés sont reconnus et laissés tels quels par `encryptFieldOnce`.
   */
  const resuming = currentState?.phase === 'encrypting' && !!currentState.encryptionSalt;

  // Le détenteur du mot de passe. En reprise, c'est celui qu'on a enregistré :
  // le re-sélectionner est précisément ce qui perdait la base quand
  // l'administrateur d'origine était rétrogradé ou effaçait son compte.
  const admin = resuming
    ? { panicPasswordHash: currentState!.panicPasswordHash }
    : await db.query.users.findFirst({
        where: and(eq(users.isAdmin, true), isNull(users.deletedAt)),
        orderBy: asc(users.createdAt),
      });

  if (!admin?.panicPasswordHash) {
    throw createError({
      statusCode: 400,
      message: 'No panic password configured. Cannot encrypt.',
    });
  }

  // Verify the supplied password against the stored hash before we
  // lock the database — encrypting under a key the admin can't
  // reproduce would brick the data.
  const passwordOk = await verifyPassword(
    admin.panicPasswordHash,
    body.panicPassword
  );
  if (!passwordOk) {
    throw createError({ statusCode: 401, message: 'Invalid panic password' });
  }

  // We only need a salt now — IVs are generated per-record inside
  // `encrypt()` and prefixed into each ciphertext. The legacy IV
  // column on `panic_state` is left null on fresh panics; restore
  // still reads it as a fallback when decrypting old data.
  const salt = resuming ? currentState!.encryptionSalt! : generateSalt();
  const kdfVersion = resuming
    ? (currentState!.kdfVersion ?? CURRENT_KDF_VERSION)
    : CURRENT_KDF_VERSION;

  // Derive the key from the RAW panic password (kdf_version 2). The
  // stored hash is NOT a key input — a DB dump then only yields the
  // scrypt verifier + salt + ciphertext, forcing an offline
  // brute-force rather than instant decryption (finding C1).
  const key = await deriveKey(
    body.panicPassword,
    Buffer.from(salt, 'base64'),
    kdfVersion
  );

  // Le sel, le hachis employé et la phase — AVANT de toucher la moindre ligne.
  // C'est ce qui rend une interruption récupérable au lieu de fatale.
  await db
    .insert(panicState)
    .values({
      id: 'singleton',
      isEncrypted: false,
      encryptionSalt: salt,
      encryptionIv: null,
      kdfVersion,
      panicPasswordHash: admin.panicPasswordHash,
      phase: 'encrypting',
    })
    .onConflictDoUpdate({
      target: panicState.id,
      set: {
        encryptionSalt: salt,
        encryptionIv: null,
        kdfVersion,
        panicPasswordHash: admin.panicPasswordHash,
        phase: 'encrypting',
      },
    });

  // ── Encrypt sensitive user data ──────────────────────────────
  const allUsers = await db.select().from(users);
  for (const user of allUsers) {
    await db
      .update(users)
      .set({
        authSalt: encryptField(user.authSalt, key)!,
        authVerifier: encryptField(user.authVerifier, key)!,
        passkey: encryptField(user.passkey, key)!,
        // The two read keys are credentials like the passkey is. Leaving them
        // out would mean a panicked database still carrying live secrets in
        // plaintext — a "the data is encrypted" that is only mostly true, which
        // is the kind of gap nobody finds until it matters. `encryptField`
        // passes null through, so an account that never minted one stays null.
        rssKey: encryptField(user.rssKey, key) ?? undefined,
        apiKey: encryptField(user.apiKey, key) ?? undefined,
        lastIp: encryptField(user.lastIp, key) ?? undefined,
      })
      .where(eq(users.id, user.id));
  }

  // ── Encrypt torrent data ─────────────────────────────────────
  const allTorrents = await db.select().from(torrents);
  for (const torrent of allTorrents) {
    /*
     * Une ligne déjà traitée se reconnaît à un marqueur exact, pas à une forme.
     *
     * Ce tour-ci n'est pas idempotent comme celui des utilisateurs : il écrase
     * `size` par 0 et enveloppe la description dans `[PANIC_META:…]`. Repasser
     * dessus enregistrerait donc `size: 0` comme taille « originale » — perdue
     * pour de bon — et produirait un second niveau d'enveloppe que la
     * restauration ne défait pas. Le préfixe est écrit par nous, il est donc
     * une preuve et non une supposition.
     */
    if (torrent.description?.startsWith('[PANIC_META:')) continue;

    const originalMeta = JSON.stringify({
      size: torrent.size,
      categoryId: torrent.categoryId,
    });
    const encryptedMeta = encrypt(originalMeta, key);

    let encryptedTorrentData: Buffer | null = null;
    if (torrent.torrentData) {
      const base64Data = torrent.torrentData.toString('base64');
      const encryptedBase64 = encrypt(base64Data, key);
      // Each ciphertext is ASCII (`iv:ct:tag` base64), but bytea is
      // tagged binary — wrap as ascii so the bytes round-trip cleanly
      // through Postgres without utf8 normalisation surprises on
      // restore.
      encryptedTorrentData = Buffer.from(encryptedBase64, 'ascii');
    }

    const encryptedDesc = encryptField(torrent.description, key);
    const descWithMeta = `[PANIC_META:${encryptedMeta}]${encryptedDesc ?? ''}`;

    await db
      .update(torrents)
      .set({
        name: encryptField(torrent.name, key) ?? '[ENCRYPTED]',
        description: descWithMeta,
        torrentData: encryptedTorrentData,
        size: 0,
        categoryId: null,
      })
      .where(eq(torrents.id, torrent.id));
  }

  // ── Encrypt forum posts ──────────────────────────────────────
  const allPosts = await db.select().from(forumPosts);
  for (const post of allPosts) {
    await db
      .update(forumPosts)
      .set({ content: encryptField(post.content, key) ?? '[ENCRYPTED]' })
      .where(eq(forumPosts.id, post.id));
  }

  // ── Encrypt torrent comments ─────────────────────────────────
  const allComments = await db.select().from(torrentComments);
  for (const comment of allComments) {
    await db
      .update(torrentComments)
      .set({ content: encryptField(comment.content, key) ?? '[ENCRYPTED]' })
      .where(eq(torrentComments.id, comment.id));
  }

  // ── Save panic state ─────────────────────────────────────────
  // encryptionIv is left null — IVs are now embedded per-record.
  // The column stays in the schema for backward-compatible restore
  // of databases encrypted before this fix.
  await db
    .update(panicState)
    .set({
      isEncrypted: true,
      encryptedAt: new Date(),
      phase: 'encrypted',
    })
    .where(eq(panicState.id, 'singleton'));

  return {
    success: true,
    message: 'Database encrypted. Use panic password to restore.',
    encryptedAt: new Date().toISOString(),
    /*
     * Ce que « encrypted » couvre, et ce qu'il ne couvre pas.
     *
     * La réponse disait « Database encrypted » sans réserve. La couverture
     * réelle est : `users` (sel et vérificateur d'authentification, passkey,
     * clés RSS et API, dernière IP), `torrents` (nom, description, octets du
     * .torrent, taille, catégorie), `forum_posts.content` et
     * `torrent_comments.content`.
     *
     * Restent EN CLAIR : `messages.body` et `room_messages.body` — soit tout le
     * texte des conversations privées et du salon public, le chiffrement de
     * bout en bout étant optionnel et par conversation —, les tickets et leurs
     * messages, les titres de sujets de forum, la bio et le nom affiché,
     * `totp_secret`, la configuration serveur des canaux, le journal de
     * connexions (adresses, agents), les signalements de l'anti-triche, le
     * journal d'audit, le miroir des torrents distants et la clé privée de
     * fédération.
     *
     * Étendre la couverture ferait de ces boucles quelque chose de bien plus
     * long, ce qui rend la reprise (voir `phase`) d'autant plus nécessaire.
     * D'ici là, l'énoncé est ici plutôt que dans une promesse tacite :
     * `doc/guide/messaging.md` fait exactement ce travail de précision pour le
     * cadenas de bout en bout.
     */
    covers: [
      'users.auth_salt', 'users.auth_verifier', 'users.passkey',
      'users.rss_key', 'users.api_key', 'users.last_ip',
      'torrents.name', 'torrents.description', 'torrents.torrent_data',
      'torrents.size', 'torrents.category_id',
      'forum_posts.content', 'torrent_comments.content',
    ],
    leavesInCleartext: [
      'messages.body', 'room_messages.body',
      'tickets.*', 'ticket_messages.*',
      'forum_topics.title', 'users.bio', 'users.display_name',
      'users.totp_secret', 'notification_channels.server_config',
      'login_events.*', 'anticheat_flags.ip', 'anticheat_flags.user_agent',
      'audit_log.*', 'remote_torrents.*', 'federation_config.private_key',
    ],
  };
});
