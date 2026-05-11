import { eq } from 'drizzle-orm';
import { db } from '@trackarr/db';
import { torrents, torrentComments } from '@trackarr/db/schema';
import { requireAuthSession } from '~~/utils/adminAuth';
import {
  validateParam,
  validateBody,
  infoHashSchema,
  torrentCommentSchema,
} from '~~/utils/schemas';
import { notify } from '~~/utils/notify';

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event);

  // Validate hash parameter
  const hash = validateParam(event, 'hash', infoHashSchema);

  // Validate request body
  const body = await validateBody(event, torrentCommentSchema);

  // Find torrent by hash to get its UUID
  const torrent = await db.query.torrents.findFirst({
    where: eq(torrents.infoHash, hash.toLowerCase()),
  });

  if (!torrent) {
    throw createError({
      statusCode: 404,
      message: 'Torrent not found',
    });
  }

  const comment = await db
    .insert(torrentComments)
    .values({
      id: crypto.randomUUID(),
      torrentId: torrent.id,
      authorId: session.user.id,
      content: body.content,
    })
    .returning();

  // Notify the uploader — but never self-notify (a user commenting on
  // their own release doesn't need a bell ping).
  if (torrent.uploaderId && torrent.uploaderId !== session.user.id) {
    void notify(
      torrent.uploaderId,
      'comment_on_my_upload',
      {
        torrentName: torrent.name,
        actorUsername: session.user.username,
        preview: body.content.slice(0, 200),
      },
      `/torrents/${hash.toLowerCase()}`,
    );
  }

  return comment[0];
});
