/**
 * DELETE /api/me/2fa/sessions/[id]
 *
 * Revoke a single trusted-device row. Caller can only delete their
 * own — `revokeTrustedDevice` filters on userId. Idempotent.
 */
import { revokeTrustedDevice } from '~~/utils/trustedDevices';

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event);
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, message: 'id required' });

  const removed = await revokeTrustedDevice(event, id, session.user.id);
  if (!removed) {
    throw createError({ statusCode: 404, message: 'Trusted device not found' });
  }
  return { revoked: id };
});
