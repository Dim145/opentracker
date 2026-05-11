/**
 * POST /api/torrents/:hash/moderation/messages
 *
 * Free-form chat post on a torrent's moderation thread. Doesn't
 * change the moderation status — that lives on /api/mod/torrents/…
 * actions. Either side (uploader or staff) can post.
 */
import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod/v4';
import { canAccessModerationThread, postMessage } from '~~/utils/torrentModeration';
import { validateBody } from '~~/utils/schemas';
import { notify, notifyMany, listStaffRecipients } from '~~/utils/notify';

const bodySchema = z.object({
  body: z.string().trim().min(1, 'Message body is required').max(4000),
});

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  const hash = getRouterParam(event, 'hash');
  if (!hash) {
    throw createError({ statusCode: 400, message: 'Torrent hash is required' });
  }
  const body = await validateBody(event, bodySchema);

  const torrent = await db.query.torrents.findFirst({
    where: eq(schema.torrents.infoHash, hash.toLowerCase()),
    columns: { id: true, uploaderId: true },
  });
  if (!torrent) {
    throw createError({ statusCode: 404, message: 'Torrent not found' });
  }
  if (!canAccessModerationThread({ torrent, user })) {
    throw createError({ statusCode: 404, message: 'Torrent not found' });
  }

  const row = await postMessage({
    torrentId: torrent.id,
    authorId: user.id,
    body: body.body,
  });

  // Notify the other side of the conversation:
  //  - When the uploader posts → fan-out to every staff member so a
  //    moderator picks the thread up (we don't know which one is
  //    actively monitoring).
  //  - When a staff member posts → notify the uploader directly.
  const link = `/torrents/${hash.toLowerCase()}`;
  if (user.id === torrent.uploaderId) {
    const staff = await listStaffRecipients();
    // Don't notify the author themselves if they're also staff.
    const recipients = staff.filter((id) => id !== user.id);
    void notifyMany(
      recipients,
      'moderation_message_received',
      {
        torrentName: (await db.query.torrents.findFirst({
          where: eq(schema.torrents.id, torrent.id),
          columns: { name: true },
        }))?.name ?? null,
        actorUsername: user.username,
        preview: body.body.slice(0, 200),
        from: 'uploader',
      },
      link,
    );
  } else if (torrent.uploaderId) {
    void notify(
      torrent.uploaderId,
      'moderation_message_received',
      {
        torrentName: (await db.query.torrents.findFirst({
          where: eq(schema.torrents.id, torrent.id),
          columns: { name: true },
        }))?.name ?? null,
        actorUsername: user.username,
        preview: body.body.slice(0, 200),
        from: 'staff',
      },
      link,
    );
  }

  return { success: true, message: row };
});
