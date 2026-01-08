/**
 * POST /api/admin/torznab/unblock
 * Unblock a user from Torznab API using their blockId (admin only)
 */

import { createHash } from 'crypto';
import { requireAdminSession } from '../../../utils/adminAuth';
import { redis } from '../../../redis/client';

const TORZNAB_BLOCK_KEY = 'torznab:blocked';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);

  const { blockId } = await readBody<{ blockId: string }>(event);

  if (!blockId || typeof blockId !== 'string' || blockId.length !== 16) {
    throw createError({
      statusCode: 400,
      message: 'Invalid blockId',
    });
  }

  try {
    // Get all blocked users and find the one matching the blockId
    const blockedData = await redis.hgetall(TORZNAB_BLOCK_KEY);

    let targetPasskey: string | null = null;

    for (const passkey of Object.keys(blockedData)) {
      const hash = createHash('sha256')
        .update(passkey)
        .digest('hex')
        .substring(0, 16);
      if (hash === blockId) {
        targetPasskey = passkey;
        break;
      }
    }

    if (!targetPasskey) {
      throw createError({
        statusCode: 404,
        message: 'Blocked user not found',
      });
    }

    // Unblock the user
    await redis.hdel(TORZNAB_BLOCK_KEY, targetPasskey);

    return {
      success: true,
      message: 'User unblocked successfully',
    };
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) {
      throw error;
    }

    console.error('[Torznab] Failed to unblock user:', error);
    throw createError({
      statusCode: 500,
      message: 'Failed to unblock user',
    });
  }
});
