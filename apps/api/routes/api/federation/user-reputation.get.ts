/**
 * GET /api/federation/user-reputation?username=  — inbound, S2S.
 *
 * Returns a partner-facing reputation snapshot for a local user (ratio,
 * volumes, account age, accepted-upload count). Read-only signal — the
 * consumer never folds it into its own economy. Gated on `accounts`.
 */
import { eq, and, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { verifyInboundS2S } from '~~/utils/federation/inbound';

export default defineEventHandler(async (event) => {
  await verifyInboundS2S(event, 'accounts');

  const q = getQuery(event);
  const username = typeof q.username === 'string' ? q.username.trim() : '';
  if (!username) throw createError({ statusCode: 400, message: 'username required' });

  const [u] = await db
    .select({
      id: schema.users.id,
      displayName: schema.users.displayName,
      uploaded: schema.users.uploaded,
      downloaded: schema.users.downloaded,
      createdAt: schema.users.createdAt,
      isBanned: schema.users.isBanned,
    })
    .from(schema.users)
    .where(eq(schema.users.username, username))
    .limit(1);
  // A banned user must not present a healthy reputation to peers. Return the
  // same 404 as a missing user so a banned account simply stops federating its
  // reputation / verified-identity standing (closes the laundering vector).
  if (!u || u.isBanned) {
    throw createError({ statusCode: 404, message: 'User not found' });
  }

  const [counts] = await db
    .select({ uploads: sql<number>`count(*)::int` })
    .from(schema.torrents)
    .where(
      and(
        eq(schema.torrents.uploaderId, u.id),
        eq(schema.torrents.moderationStatus, 'accepted'),
      ),
    );

  const uploaded = Number(u.uploaded ?? 0);
  const downloaded = Number(u.downloaded ?? 0);
  const ratio = downloaded > 0 ? Number((uploaded / downloaded).toFixed(3)) : null;

  return {
    ok: true,
    reputation: {
      displayName: u.displayName,
      uploaded,
      downloaded,
      ratio,
      memberSince: u.createdAt,
      uploadsCount: counts?.uploads ?? 0,
    },
  };
});
