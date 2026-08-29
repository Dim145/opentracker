import { db, schema } from '@trackarr/db';
import { validateBody } from '~~/utils/schemas';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { notifyMany, listStaffRecipients } from '~~/utils/notify';

const reportSchema = z.object({
  targetType: z.enum(['torrent', 'user', 'post', 'comment', 'remote', 'message']),
  targetId: z.string().min(1),
  reason: z.string().min(10).max(500),
  details: z.string().max(2000).optional(),
});

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);

  // Through `validateBody` rather than a bare `.parse`: a raw Zod throw
  // leaves the handler unhandled and Nitro answers **500**, so "your
  // reason is too short" reached the reporter as a server error. Same
  // reasoning as the note on the role endpoint — a validation failure is
  // a 400 with something a human can act on.
  const data = await validateBody(event, reportSchema);

  // Self-reports are noise. A torrent uploader can already edit
  // or delete their own row, and a user reporting themselves has
  // no plausible legitimate use. Reject before we hit the DB.
  if (data.targetType === 'user' && data.targetId === user.id) {
    throw createError({
      statusCode: 400,
      message: 'You cannot report yourself',
    });
  }

  // Verify target exists
  let targetExists = false;
  switch (data.targetType) {
    case 'torrent':
      const torrent = await db.query.torrents.findFirst({
        where: (t, { eq }) => eq(t.id, data.targetId),
      });
      targetExists = !!torrent;
      break;
    case 'user':
      const targetUser = await db.query.users.findFirst({
        where: (u, { eq }) => eq(u.id, data.targetId),
      });
      targetExists = !!targetUser;
      break;
    case 'post':
      const post = await db.query.forumPosts.findFirst({
        where: (p, { eq }) => eq(p.id, data.targetId),
      });
      targetExists = !!post;
      break;
    case 'comment':
      const comment = await db.query.torrentComments.findFirst({
        where: (c, { eq }) => eq(c.id, data.targetId),
      });
      targetExists = !!comment;
      break;
    case 'message': {
      // Only a participant may report a private message. Without that
      // check, reporting is a way to ask the staff to read a conversation
      // you are not in — and to confirm which message ids exist.
      const message = await db.query.messages.findFirst({
        where: (m, { eq }) => eq(m.id, data.targetId),
      });
      if (message) {
        const seat = await db.query.conversationParticipants.findFirst({
          where: (p, { and, eq }) =>
            and(
              eq(p.conversationId, message.conversationId),
              eq(p.userId, user.id)
            ),
        });
        targetExists = !!seat;
      }
      break;
    }
    case 'remote':
      // A mirrored release the member saw on /federated, identified by its
      // infohash — durable across re-syncs and across peers, and exactly the
      // key a moderator masks by. (The mirror row's own UUID is ephemeral.)
      const remote = await db.query.remoteTorrents.findFirst({
        where: (r, { eq }) => eq(r.infoHash, data.targetId),
      });
      targetExists = !!remote;
      break;
  }

  if (!targetExists) {
    throw createError({
      statusCode: 404,
      message: 'Target not found',
    });
  }

  // Collapse duplicates: if this reporter already has an open (pending)
  // report against the same target, acknowledge it without inserting a
  // second row or re-fanning-out to every staff member. Stops a single
  // user spamming the mod queue + external channels with repeated
  // reports (finding L4); re-reporting is still allowed once the prior
  // report has been resolved/dismissed.
  const existingReport = await db.query.reports.findFirst({
    where: (r, { and, eq }) =>
      and(
        eq(r.reporterId, user.id),
        eq(r.targetType, data.targetType),
        eq(r.targetId, data.targetId),
        eq(r.status, 'pending'),
      ),
  });
  if (existingReport) {
    return {
      success: true,
      message: 'You already have an open report for this target',
      data: existingReport,
    };
  }

  // Create report
  const report = await db
    .insert(schema.reports)
    .values({
      id: randomUUID(),
      reporterId: user.id,
      targetType: data.targetType,
      targetId: data.targetId,
      reason: data.reason,
      details: data.details || null,
      status: 'pending',
    })
    .returning();

  // Tell every staff member there's a new report to triage.
  void (async () => {
    try {
      const staff = await listStaffRecipients();
      const recipients = staff.filter((sid) => sid !== user.id);
      await notifyMany(
        recipients,
        'new_report_filed',
        {
          targetType: data.targetType,
          reporterUsername: user.username,
          reasonPreview: data.reason.slice(0, 200),
        },
        '/mod/reports',
      );
    } catch (err) {
      console.warn(
        '[Reports] mod notify fan-out failed:',
        (err as Error).message,
      );
    }
  })();

  return {
    success: true,
    message: 'Report submitted successfully',
    data: report[0],
  };
});
