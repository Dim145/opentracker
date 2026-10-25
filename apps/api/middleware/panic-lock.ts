/**
 * Panic mode makes the API read-only.
 *
 * Panic encrypts the catalogue and the members' credentials in place, but it
 * does not end the sessions already open — on purpose, so staff keep a way in.
 * Those sessions could go on uploading, posting, resetting keys, registering
 * members: every such row landed in clear in a database announced as encrypted,
 * and the restore, which only knew how to decrypt, failed on each of them.
 *
 * The restore now keeps a row that is already clear (`decryptFieldOrKeep`), so
 * the lockout is gone either way; this is the other half — nothing new is
 * written in clear while the panic stands. A middleware rather than a check per
 * route, for the reason the audit log is a hook: a writing route added tomorrow
 * is covered before anyone remembers it should be.
 *
 * What still writes: the panic itself (resuming an interrupted encrypt, the
 * restore) and logging out.
 */
import { allowedDuringPanic, panicActive } from '~~/utils/panicLock';

export default defineEventHandler(async (event) => {
  if (allowedDuringPanic(event.method, event.path || '')) return;
  if (!(await panicActive())) return;
  throw createError({
    statusCode: 503,
    message: 'The site is locked while panic mode is active.',
    data: { reason: 'panic-lock' },
  });
});
