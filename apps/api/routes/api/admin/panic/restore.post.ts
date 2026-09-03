import { eq, and, asc, isNull } from 'drizzle-orm';
import { db } from '@trackarr/db';
import {
  users,
  torrents,
  panicState,
  forumPosts,
  torrentComments,
} from '@trackarr/db/schema';
import { deriveKey, decryptField, decrypt } from '~~/utils/panic';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { redis } from '~~/utils/server';
import { z } from 'zod';

/**
 * POST /api/admin/panic/restore
 * Restore encrypted database using panic password
 * This endpoint is publicly accessible (no auth required) since
 * user sessions may be invalid after encryption
 */

/**
 * Cap total restore attempts across every source, on top of the per-IP limit.
 * 30 tries per hour: generous for an operator fumbling a passphrase under
 * pressure, useless for an online search against a password that derives an
 * AES key through scrypt.
 */
const GLOBAL_ATTEMPT_KEY = 'panic:restore:attempts';
const GLOBAL_ATTEMPT_MAX = 30;
const GLOBAL_ATTEMPT_WINDOW_S = 3600;

async function assertGlobalAttemptBudget(): Promise<void> {
  let count: number;
  try {
    count = await redis.incr(GLOBAL_ATTEMPT_KEY);
    if (count === 1) await redis.expire(GLOBAL_ATTEMPT_KEY, GLOBAL_ATTEMPT_WINDOW_S);
  } catch {
    // Redis unreachable. Fail OPEN: the per-IP limit still applies, and a
    // recovery path that refuses to run because the cache is down would turn
    // an incident into an outage.
    return;
  }
  if (count > GLOBAL_ATTEMPT_MAX) {
    throw createError({
      statusCode: 429,
      message:
        'Too many restore attempts. Wait an hour, or clear the counter from Redis if this is a legitimate recovery.',
    });
  }
}

export default defineEventHandler(async (event) => {
  // No session is available post-panic, so the strict auth bucket is
  // the only guard against an online brute-force of the panic password
  // (scrypt is slow but still attackable with the endpoint open). 5
  // tries per 5 min per IP, with progressive lockout.
  await rateLimit(event, RATE_LIMITS.auth);

  // The per-IP bucket is not enough on its own: a distributed attacker rotates
  // addresses and never trips it. A global counter caps total attempts against
  // the panic password however many sources they come from — the password is
  // the single key to an encrypted database, and this endpoint is
  // unauthenticated by necessity (no session survives the encryption).
  await assertGlobalAttemptBudget();

  // A schema, not `readBody()`. Without one, `panicPassword` could arrive as
  // an object, an array, or several megabytes of text — all of which reach
  // scrypt, and the last of which is free CPU amplification for an
  // unauthenticated caller. 200 characters is well past any real passphrase.
  const body = await readValidatedBody(
    event,
    z.object({
      panicPassword: z.string().min(1, 'Panic password is required').max(200),
    }).strict().parse,
  );

  // Check if database is encrypted
  // Core select rather than `db.query.panicState.findFirst()`: the relational
  // builder hands back an untyped row here, which left `kdfVersion` and
  // `encryptionSalt` as `unknown` — the version comparison and both
  // `Buffer.from` calls below were unchecked.
  const [currentState] = await db.select().from(schema.panicState).limit(1);
  if (!currentState?.isEncrypted) {
    throw createError({
      statusCode: 400,
      message: 'Database is not encrypted',
    });
  }

  if (!currentState.encryptionSalt) {
    throw createError({
      statusCode: 500,
      message: 'Encryption metadata missing. Recovery impossible.',
    });
  }

  /*
   * Le hachis contre lequel on vérifie : celui du chiffrement, pas celui de
   * l'administrateur le plus ancien d'aujourd'hui.
   *
   * `encrypt` et cette route résolvaient toutes deux le détenteur par
   * « `is_admin = true` trié par `created_at` », et rien n'enregistrait qui
   * c'était. Trois façons de perdre la base avec le bon mot de passe en main :
   * l'administrateur qui a chiffré est rétrogradé (on vérifiait alors contre le
   * hachis d'un autre → 401), il efface son compte (`eraseAccount` vide
   * `panic_password_hash` sans toucher `is_admin`, et `created_at` reste le plus
   * ancien → 500), ou un administrateur plus récent était le seul à avoir
   * configuré un mot de passe.
   *
   * `encrypt` persiste désormais le hachis employé. Le repli sur la
   * re-sélection ne sert qu'aux bases chiffrées avant ce correctif.
   */
  let expectedHash = currentState.panicPasswordHash ?? null;
  if (!expectedHash) {
    const admin = await db.query.users.findFirst({
      where: and(eq(users.isAdmin, true), isNull(users.deletedAt)),
      orderBy: asc(users.createdAt),
    });
    expectedHash = admin?.panicPasswordHash ?? null;
  }

  if (!expectedHash) {
    throw createError({
      statusCode: 500,
      message: 'Admin panic password hash not found',
    });
  }

  // Verify panic password matches stored hash
  const isValid = await verifyPassword(expectedHash, body.panicPassword);
  if (!isValid) {
    throw createError({
      statusCode: 401,
      message: 'Invalid panic password',
    });
  }

  // Derive decryption key. kdf_version 2 (current) derives from the
  // RAW panic password the admin just submitted; version 1 (legacy,
  // pre-C1-fix) derived from the stored hash — we honour it so a
  // database encrypted before the fix can still be recovered. The IV
  // is embedded per-record (`iv:ct:tag`); `legacyIv` is forwarded for
  // databases encrypted before per-record IVs (single global IV).
  const kdfInput =
    (currentState.kdfVersion ?? 1) >= 2 ? body.panicPassword : expectedHash;
  const key = await deriveKey(
    kdfInput,
    Buffer.from(currentState.encryptionSalt, 'base64'),
    currentState.kdfVersion ?? 1
  );
  const legacyIv = currentState.encryptionIv
    ? Buffer.from(currentState.encryptionIv, 'base64')
    : undefined;

  /*
   * Les échecs sont comptés, et ils décident de la suite.
   *
   * Chaque ligne était dans un `try { … } catch { console.error(…) }` qui
   * continuait, puis la route effaçait inconditionnellement `encryption_salt`
   * et répondait « Database restored successfully ». Une seule ligne `users`
   * dont `auth_salt` ne déchiffrait pas — rot de bit, surchiffrement, ligne
   * insérée pendant le chiffrement — et ce membre restait chiffré POUR
   * TOUJOURS : le `try` englobe tout l'`update`, donc rien n'était écrit pour
   * lui, et le sel disparaissait ensuite. Son mot de passe et son passkey
   * d'annonce étaient morts, sans qu'aucun compteur ne le dise.
   *
   * Tant qu'il reste un échec, le sel et la phase sont conservés : la
   * restauration reste possible après correction, et elle est reprenable
   * puisque les lignes déjà déchiffrées ne déchiffrent plus.
   */
  const failures: string[] = [];
  const fail = (what: string, id: string, err: unknown) => {
    failures.push(`${what}:${id}`);
    console.error(`[panic] restore failed for ${what} ${id}:`, err);
  };

  await db
    .update(panicState)
    .set({ phase: 'restoring' })
    .where(eq(panicState.id, 'singleton'));

  // ── Decrypt user data ────────────────────────────────────────
  const allUsers = await db.select().from(users);
  for (const user of allUsers) {
    try {
      await db
        .update(users)
        .set({
          authSalt: decryptField(user.authSalt, key, legacyIv)!,
          authVerifier: decryptField(user.authVerifier, key, legacyIv)!,
          passkey: decryptField(user.passkey, key, legacyIv)!,
          rssKey: decryptField(user.rssKey, key, legacyIv) ?? undefined,
          apiKey: decryptField(user.apiKey, key, legacyIv) ?? undefined,
          lastIp: decryptField(user.lastIp, key, legacyIv) ?? undefined,
        })
        .where(eq(users.id, user.id));
    } catch (err) {
      fail('user', user.id, err);
    }
  }

  // ── Decrypt torrent data ─────────────────────────────────────
  const allTorrents = await db.select().from(torrents);
  for (const torrent of allTorrents) {
    try {
      const panicMetaMatch = torrent.description?.match(
        /^\[PANIC_META:([^\]]+)\](.*)?$/s
      );

      let decryptedDesc: string | null = null;
      let originalSize: number = torrent.size;
      let originalCategoryId: string | null = torrent.categoryId;

      if (panicMetaMatch) {
        const encryptedMeta = panicMetaMatch[1]!;
        const encryptedDescPart = panicMetaMatch[2] || null;

        try {
          const metaJson = decrypt(encryptedMeta, key, legacyIv);
          const meta = JSON.parse(metaJson);
          originalSize = meta.size ?? 0;
          originalCategoryId = meta.categoryId ?? null;
        } catch {
          // La taille et la catégorie sont dans ces métadonnées, et le
          // chiffrement a mis `size` à 0 : les perdre en silence était pire
          // que de refuser de terminer.
          fail('torrent-meta', torrent.id, 'metadata');
        }

        decryptedDesc = encryptedDescPart
          ? decryptField(encryptedDescPart, key, legacyIv)
          : null;
      } else {
        decryptedDesc = decryptField(torrent.description, key, legacyIv);
      }

      // .torrent payload → ascii string (matches encrypt-side wrapping)
      // → decrypt → base64 → Buffer.
      let decryptedTorrentData: Buffer | null = null;
      if (torrent.torrentData) {
        try {
          const encryptedStr = torrent.torrentData.toString('ascii');
          const decryptedBase64 = decrypt(encryptedStr, key, legacyIv);
          decryptedTorrentData = Buffer.from(decryptedBase64, 'base64');
        } catch {
          fail('torrent-data', torrent.id, 'torrentData');
        }
      }

      await db
        .update(torrents)
        .set({
          name: decryptField(torrent.name, key, legacyIv) ?? torrent.name,
          description: decryptedDesc,
          torrentData: decryptedTorrentData,
          size: originalSize,
          categoryId: originalCategoryId,
        })
        .where(eq(torrents.id, torrent.id));
    } catch (err) {
      fail('torrent', torrent.id, err);
    }
  }

  // ── Decrypt forum posts ──────────────────────────────────────
  const allPosts = await db.select().from(forumPosts);
  for (const post of allPosts) {
    try {
      await db
        .update(forumPosts)
        .set({
          content: decryptField(post.content, key, legacyIv) ?? post.content,
        })
        .where(eq(forumPosts.id, post.id));
    } catch (err) {
      fail('post', post.id, err);
    }
  }

  // ── Decrypt torrent comments ─────────────────────────────────
  const allComments = await db.select().from(torrentComments);
  for (const comment of allComments) {
    try {
      await db
        .update(torrentComments)
        .set({
          content: decryptField(comment.content, key, legacyIv) ?? comment.content,
        })
        .where(eq(torrentComments.id, comment.id));
    } catch (err) {
      fail('comment', comment.id, err);
    }
  }

  // =====================================================================
  // Update panic state
  // =====================================================================
  if (failures.length > 0) {
    // On garde tout ce qui permet de recommencer. Lever le drapeau ici
    // signifierait « c'est fini » à une base qui ne l'est pas, et effacer le
    // sel rendrait le reste illisible pour de bon.
    await db
      .update(panicState)
      .set({ phase: 'restoring' })
      .where(eq(panicState.id, 'singleton'));

    throw createError({
      statusCode: 500,
      message:
        `Restore incomplete: ${failures.length} record(s) could not be decrypted. ` +
        'The encryption salt has been KEPT so the restore can be retried once the ' +
        'cause is fixed. Do not re-encrypt.',
      data: { failed: failures.length, sample: failures.slice(0, 20) },
    });
  }

  await db
    .update(panicState)
    .set({
      isEncrypted: false,
      encryptedAt: null,
      encryptionSalt: null,
      encryptionIv: null,
      panicPasswordHash: null,
      phase: 'idle',
    })
    .where(eq(panicState.id, 'singleton'));

  return {
    success: true,
    message: 'Database restored successfully',
  };
});
