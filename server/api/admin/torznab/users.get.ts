/**
 * GET /api/admin/torznab/users
 * Get users with Torznab API access info (admin only)
 */

import { requireAdminSession } from '../../../utils/adminAuth';
import { db, schema } from '../../../db';
import { desc, eq, sql } from 'drizzle-orm';
import { getTorznabUserStats } from '../../../utils/torznabStats';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);

  const query = getQuery(event);
  const limit = Math.min(parseInt(query.limit as string) || 50, 100);
  const offset = parseInt(query.offset as string) || 0;

  // Get users with their passkeys (masked) and API usage stats
  const users = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      passkey: schema.users.passkey,
      isBanned: schema.users.isBanned,
      lastSeen: schema.users.lastSeen,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .where(eq(schema.users.isBanned, false))
    .orderBy(desc(schema.users.lastSeen))
    .limit(limit)
    .offset(offset);

  // Get API usage stats for each user
  const usersWithStats = await Promise.all(
    users.map(async (user) => {
      const stats = await getTorznabUserStats(user.passkey);
      return {
        id: user.id,
        username: user.username,
        // Mask passkey for display (show first 8 + last 4 chars)
        passkeyMasked: `${user.passkey.substring(0, 8)}...${user.passkey.substring(36)}`,
        lastSeen: user.lastSeen,
        createdAt: user.createdAt,
        apiStats: stats,
      };
    })
  );

  // Get total count
  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.users)
    .where(eq(schema.users.isBanned, false));

  return {
    users: usersWithStats,
    total: countResult[0]?.count || 0,
    limit,
    offset,
  };
});
