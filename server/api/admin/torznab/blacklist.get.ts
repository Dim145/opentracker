/**
 * GET /api/admin/torznab/blacklist
 * Get currently blacklisted IPs from rate limiting (admin only)
 */

import { createHash } from 'crypto';
import { requireAdminSession } from '../../../utils/adminAuth';
import { redis } from '../../../redis/client';

const BLACKLIST_KEY = 'ddos:blacklist';
const TORZNAB_BLOCK_KEY = 'torznab:blocked';

interface BlacklistEntry {
  ip: string;
  reason: string;
  expiresAt: number;
  violations: number;
}

interface BlockedUser {
  blockId: string;
  passkey: string;
  reason: string;
  blockedAt: number;
}

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);

  try {
    // Get IP blacklist
    const blacklistData = await redis.hgetall(BLACKLIST_KEY);
    const ipBlacklist: BlacklistEntry[] = [];

    for (const [ip, data] of Object.entries(blacklistData)) {
      try {
        const entry = JSON.parse(data);
        if (entry.expiresAt > Date.now()) {
          ipBlacklist.push({
            ip: `${ip.substring(0, 8)}...`, // Mask IP for privacy
            reason: entry.reason,
            expiresAt: entry.expiresAt,
            violations: entry.violations,
          });
        }
      } catch {
        // Skip invalid entries
      }
    }

    // Get blocked Torznab users
    const blockedData = await redis.hgetall(TORZNAB_BLOCK_KEY);
    const blockedUsers: BlockedUser[] = [];

    for (const [passkey, data] of Object.entries(blockedData)) {
      try {
        const entry = JSON.parse(data);
        // Generate a short hash as blockId for secure unblock operations
        const blockId = createHash('sha256')
          .update(passkey)
          .digest('hex')
          .substring(0, 16);
        blockedUsers.push({
          blockId,
          passkey: `${passkey.substring(0, 8)}...${passkey.substring(36)}`,
          reason: entry.reason,
          blockedAt: entry.blockedAt,
        });
      } catch {
        // Skip invalid entries
      }
    }

    return {
      ipBlacklist: ipBlacklist.sort((a, b) => b.expiresAt - a.expiresAt),
      blockedUsers: blockedUsers.sort((a, b) => b.blockedAt - a.blockedAt),
    };
  } catch (error) {
    console.error('[Torznab] Failed to get blacklist:', error);
    return {
      ipBlacklist: [],
      blockedUsers: [],
    };
  }
});
