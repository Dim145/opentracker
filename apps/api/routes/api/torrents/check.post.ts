/**
 * POST /api/torrents/check — duplicate-infohash preflight.
 *
 * The upload form posts a .torrent here the moment the user picks a
 * file, so the page can flash a "this torrent is already on the
 * tracker" warning *before* they fill in the rest of the form. The
 * actual upload endpoint still does its own duplicate check (server-
 * side authoritative), so this is purely UX scaffolding — never relied
 * on for correctness.
 *
 * Returns `{ exists, infoHash, existing }`. When `exists` is true the
 * `existing` payload carries enough to surface a "View this torrent"
 * link (id, infoHash, name, moderationStatus) — no need to fetch the
 * full detail just for the warning row.
 */
import { db } from '@trackarr/db';
import parseTorrent from 'parse-torrent';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';

export default defineEventHandler(async (event) => {
  await requireUserSession(event);
  // Same bucket as the upload itself — a flood of "check" calls would
  // otherwise let a logged-in account probe the index for hashes
  // unrelated to a real intent to upload.
  await rateLimit(event, RATE_LIMITS.mutation);

  const formData = await readMultipartFormData(event);
  if (!formData || formData.length === 0) {
    throw createError({ statusCode: 400, message: 'No file uploaded' });
  }
  const file = formData.find(
    (f) => f.name === 'torrent' || f.filename?.toLowerCase().endsWith('.torrent')
  );
  if (!file || !file.data) {
    throw createError({
      statusCode: 400,
      message: 'No .torrent file found in request',
    });
  }

  let parsed: Awaited<ReturnType<typeof parseTorrent>>;
  try {
    parsed = await parseTorrent(file.data);
  } catch {
    throw createError({ statusCode: 400, message: 'Invalid torrent file' });
  }
  if (!parsed.infoHash) {
    throw createError({
      statusCode: 400,
      message: 'Could not extract info hash from torrent',
    });
  }
  const infoHash = parsed.infoHash.toLowerCase();

  const existing = await db.query.torrents.findFirst({
    where: (t, { eq }) => eq(t.infoHash, infoHash),
    columns: {
      id: true,
      infoHash: true,
      name: true,
      moderationStatus: true,
      createdAt: true,
    },
  });

  return {
    infoHash,
    exists: !!existing,
    existing: existing ?? null,
  };
});
