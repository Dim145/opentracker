/**
 * GET /api/mod/federation/masks — the locally-hidden federated content.
 *
 * A moderator's view of every mask in force: what is hidden, why, by whom, and
 * — for a record or infohash mask — the release it currently affects, so the
 * list reads as "you hid X" rather than a bare content address.
 */
import { desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireModeratorSession } from '~~/utils/adminAuth';

export default defineEventHandler(async (event) => {
  await requireModeratorSession(event);

  const masks = await db
    .select({
      id: schema.remoteMasks.id,
      scope: schema.remoteMasks.scope,
      value: schema.remoteMasks.value,
      reason: schema.remoteMasks.reason,
      createdAt: schema.remoteMasks.createdAt,
      createdByName: schema.users.username,
    })
    .from(schema.remoteMasks)
    .leftJoin(schema.users, eq(schema.users.id, schema.remoteMasks.createdBy))
    .orderBy(desc(schema.remoteMasks.createdAt));

  // A sample name for each mask, so the list is legible. One query, not N.
  const recordValues = masks.filter((m) => m.scope === 'record').map((m) => m.value);
  const hashValues = masks.filter((m) => m.scope === 'infohash').map((m) => m.value);
  const authorValues = masks.filter((m) => m.scope === 'author').map((m) => m.value);

  const [byRecord, byHash, byAuthor] = await Promise.all([
    recordValues.length
      ? db
          .select({ value: schema.remoteTorrents.recordId, name: schema.remoteTorrents.name })
          .from(schema.remoteTorrents)
          .where(inArray(schema.remoteTorrents.recordId, recordValues))
      : [],
    hashValues.length
      ? db
          .select({ value: schema.remoteTorrents.infoHash, name: schema.remoteTorrents.name })
          .from(schema.remoteTorrents)
          .where(inArray(schema.remoteTorrents.infoHash, hashValues))
      : [],
    authorValues.length
      ? db
          .select({ value: schema.remoteTorrents.authorDid, name: schema.remoteTorrents.name })
          .from(schema.remoteTorrents)
          .where(inArray(schema.remoteTorrents.authorDid, authorValues))
      : [],
  ]);

  const nameFor = new Map<string, string>();
  for (const r of [...byRecord, ...byHash, ...byAuthor]) {
    if (r.value && r.name && !nameFor.has(r.value)) nameFor.set(r.value, r.name);
  }

  return {
    masks: masks.map((m) => ({ ...m, sampleName: nameFor.get(m.value) ?? null })),
  };
});
