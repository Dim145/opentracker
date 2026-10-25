import { db } from '@trackarr/db';
import { panicState } from '@trackarr/db/schema';
import { requireAdminSession } from '~~/utils/adminAuth';

/**
 * GET /api/admin/panic
 * Get current panic/encryption state
 */
export default defineEventHandler(async (event) => {
  await requireAdminSession(event);

  const state = await db.query.panicState.findFirst();

  return {
    isEncrypted: state?.isEncrypted ?? false,
    encryptedAt: state?.encryptedAt ?? null,
    // `isEncrypted` is false for the whole encrypt pass and for an interrupted
    // one; only the phase tells an admin that a pass needs resuming, or that a
    // restore stopped half way.
    phase: state?.phase ?? 'idle',
  };
});
