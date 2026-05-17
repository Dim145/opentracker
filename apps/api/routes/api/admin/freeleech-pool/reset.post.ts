/**
 * POST /api/admin/freeleech-pool/reset — drain the open cycle.
 *
 * Per the product spec, contributions are donations: no refunds.
 * The endpoint marks the current cycle `cancelled`, disables any
 * already-running pool freeleech, and resyncs the active-event
 * snapshot. A no-op when nothing is open.
 */
import { requireAdminSession } from '~~/utils/adminAuth';
import { adminReset } from '~~/utils/freeleechPool';
import { syncActiveSnapshot } from '~~/utils/bonusEvents';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  const result = await adminReset();
  await syncActiveSnapshot();
  return result;
});
