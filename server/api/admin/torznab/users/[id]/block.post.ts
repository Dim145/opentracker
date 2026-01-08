/**
 * POST /api/admin/torznab/users/:id/block
 * Block a user from Torznab API access (admin only)
 */

import { requireAdminSession } from '../../../../../utils/adminAuth';
import {
  blockTorznabUser,
  unblockTorznabUser,
} from '../../../../../utils/torznabStats';
import { db } from '../../../../../db';
import * as schema from '../../../../../db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

const bodySchema = z.object({
  block: z.boolean(),
  reason: z.string().optional(),
});

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);

  const userId = getRouterParam(event, 'id');

  if (!userId) {
    throw createError({
      statusCode: 400,
      message: 'User ID is required',
    });
  }

  const body = await readBody(event);
  const parsed = bodySchema.safeParse(body);

  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      message: 'Invalid request body',
    });
  }

  // Get user passkey
  const users = await db
    .select({ passkey: schema.users.passkey, username: schema.users.username })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (users.length === 0) {
    throw createError({
      statusCode: 404,
      message: 'User not found',
    });
  }

  const { passkey, username } = users[0];
  const { block, reason } = parsed.data;

  if (block) {
    await blockTorznabUser(passkey, reason || 'Blocked by admin');
  } else {
    await unblockTorznabUser(passkey);
  }

  return {
    success: true,
    message: block
      ? `Blocked Torznab access for ${username}`
      : `Unblocked Torznab access for ${username}`,
    blocked: block,
  };
});
