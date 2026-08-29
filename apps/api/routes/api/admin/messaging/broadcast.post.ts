/**
 * POST /api/admin/messaging/broadcast
 *
 * Write once, deliver to a cohort.
 *
 * Returns as soon as the recipients are counted and the row is written;
 * delivery runs behind it. A broadcast to thousands of members outlasts
 * any sensible request timeout, and holding the connection open only lets
 * a proxy decide when it stopped.
 *
 * Behind fresh auth. It is the one action here that writes into thousands
 * of people's inboxes, and a borrowed session should not be enough.
 */
import { db, schema } from '@trackarr/db';
import { z } from 'zod';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';
import { requireAdminSession } from '~~/utils/adminAuth';
import { getMessagingDmScope } from '~~/utils/settings';
import {
  formatAudience,
  newBroadcastId,
  parseAudience,
  resolveAudience,
  runBroadcast,
} from '~~/utils/messaging/broadcast';

const BODY_MAX = 4000;

const bodySchema = z
  .object({
    audience: z.string().trim().min(1).max(64),
    body: z.string().trim().min(1).max(BODY_MAX),
  })
  .strict();

export default defineEventHandler(async (event) => {
  const { user } = await requireAdminSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  await requireFreshAuth(event);

  // Messaging being off is not a reason to half-work: the recipients
  // could not read what they were sent.
  if ((await getMessagingDmScope()) === 'off') {
    throw createError({
      statusCode: 409,
      message: 'Messaging is off — turn it on before broadcasting',
    });
  }

  const body = await validateBody(event, bodySchema);
  const audience = parseAudience(body.audience);
  if (!audience) {
    throw createError({ statusCode: 400, message: 'Unknown audience' });
  }

  const recipients = await resolveAudience(audience, user.id);
  if (recipients.length === 0) {
    throw createError({
      statusCode: 409,
      // Said rather than silently succeeding: a broadcast that reached
      // nobody looks exactly like one that worked.
      message: 'That audience is empty',
    });
  }

  const id = newBroadcastId();
  await db.insert(schema.messagingBroadcasts).values({
    id,
    createdById: user.id,
    audience: formatAudience(audience),
    body: body.body,
    total: recipients.length,
  });

  // Detached on purpose — see the header. The row is the progress report.
  void runBroadcast(id, user.id, user.username, recipients, body.body);

  return { id, total: recipients.length };
});
