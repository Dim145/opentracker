import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { torrents, torrentComments } from '@trackarr/db/schema';
import { canComment } from '~~/utils/commentPolicy';
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
    with: {
      // Only the uploader's comment policy — this handler has no
      // business reading the rest of their row.
      uploader: { columns: { id: true, restrictComments: true } },
    },
  });

  if (!torrent) {
    throw createError({
      statusCode: 404,
      message: 'Torrent not found',
    });
  }

  // The uploader may require a minimum account age from commenters.
  // Checked here rather than in the client because the client is not a
  // security boundary: the toggle is meant to stop a throwaway account
  // from posting, and a throwaway account can call the API directly.
  //
  // `createdAt` is not in the session cookie, so it costs one read on a
  // primary key — only when the uploader has the restriction on, so the
  // default path pays nothing.
  if (torrent.uploader?.restrictComments) {
    const author = await db.query.users.findFirst({
      where: eq(schema.users.id, session.user.id),
      columns: { id: true, createdAt: true, isAdmin: true, isModerator: true },
    });
    if (!author) {
      throw createError({ statusCode: 401, message: 'Session user not found' });
    }
    const verdict = canComment({ uploader: torrent.uploader, author });
    if (!verdict.allowed) {
      // 403 with the wait in the payload so the UI can say how long
      // rather than showing a bare refusal.
      throw createError({
        statusCode: 403,
        message: 'COMMENTS_RESTRICTED_ACCOUNT_AGE',
        data: { daysRemaining: verdict.daysRemaining },
      });
    }
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
