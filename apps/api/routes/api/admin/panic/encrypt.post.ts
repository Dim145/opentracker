import { eq, and, asc } from 'drizzle-orm';
import { db } from '@trackarr/db';
import {
  users,
  torrents,
  panicState,
  forumPosts,
  torrentComments,
} from '@trackarr/db/schema';
import { requireAdminSession } from '~~/utils/adminAuth';
import {
  deriveKey,
  generateSalt,
  encryptField,
  encrypt,
} from '~~/utils/panic';

/**
 * POST /api/admin/panic/encrypt
 * Encrypt all sensitive database data
 * This is an emergency action that renders data unreadable
 */
export default defineEventHandler(async (event) => {
  await requireAdminSession(event);

  const body = await readBody(event);

  if (body.confirm !== 'ENCRYPT_ALL_DATA') {
    throw createError({
      statusCode: 400,
      message: 'Confirmation required. Send { confirm: "ENCRYPT_ALL_DATA" }',
    });
  }

  // The raw panic password is required so the encryption key can be
  // derived from it (not from the stored hash). Deriving from the
  // hash would leave BOTH KDF inputs (hash + salt) inside the very
  // dump panic mode is meant to protect — see finding C1.
  if (!body.panicPassword || typeof body.panicPassword !== 'string') {
    throw createError({
      statusCode: 400,
      message: 'Panic password is required to encrypt.',
    });
  }

  // Check if already encrypted
  const currentState = await db.query.panicState.findFirst();
  if (currentState?.isEncrypted) {
    throw createError({
      statusCode: 400,
      message: 'Database is already encrypted',
    });
  }

  // Get first admin with panic password hash
  const admin = await db.query.users.findFirst({
    where: and(eq(users.isAdmin, true)),
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
  const salt = generateSalt();

  // Derive the key from the RAW panic password (kdf_version 2). The
  // stored hash is NOT a key input — a DB dump then only yields the
  // scrypt verifier + salt + ciphertext, forcing an offline
  // brute-force rather than instant decryption (finding C1).
  const key = await deriveKey(body.panicPassword, Buffer.from(salt, 'base64'));

  // ── Encrypt sensitive user data ──────────────────────────────
  const allUsers = await db.select().from(users);
  for (const user of allUsers) {
    await db
      .update(users)
      .set({
        authSalt: encryptField(user.authSalt, key),
        authVerifier: encryptField(user.authVerifier, key),
        passkey: encryptField(user.passkey, key)!,
        lastIp: encryptField(user.lastIp, key) ?? undefined,
      })
      .where(eq(users.id, user.id));
  }

  // ── Encrypt torrent data ─────────────────────────────────────
  const allTorrents = await db.select().from(torrents);
  for (const torrent of allTorrents) {
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
    .insert(panicState)
    .values({
      id: 'singleton',
      isEncrypted: true,
      encryptedAt: new Date(),
      encryptionSalt: salt,
      encryptionIv: null,
      kdfVersion: 2,
    })
    .onConflictDoUpdate({
      target: panicState.id,
      set: {
        isEncrypted: true,
        encryptedAt: new Date(),
        encryptionSalt: salt,
        encryptionIv: null,
        kdfVersion: 2,
      },
    });

  return {
    success: true,
    message: 'Database encrypted. Use panic password to restore.',
    encryptedAt: new Date().toISOString(),
  };
});
