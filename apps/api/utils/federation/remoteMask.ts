/**
 * Local moderation of federated content.
 *
 * Cutting a whole peer to hide one release throws away everything good it
 * carries. A mask is the finer lever: it hides a mirrored release from every
 * local read path — the flat browse, the grouped catalogue, a group's detail,
 * live search — without deleting the record, touching the peer, or telling the
 * partner anything. It is the tracker's editorial line over what it re-exposes,
 * which federation has always said stays each instance's own to draw.
 *
 * A mask matches by one of three keys (`scope`): a specific record, an infohash
 * (whoever serves it), or an author DID (a mute of one uploader). The read-path
 * predicate below is one `NOT EXISTS`, and every mirror query composes it in.
 */
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db, schema } from '@trackarr/db';

export type MaskScope = 'record' | 'infohash' | 'author';
export const MASK_SCOPES: readonly MaskScope[] = ['record', 'infohash', 'author'];

/**
 * The predicate: a `remote_torrents` row is shown only when nothing masks it.
 *
 * References the table by name, which is correct in every read path because
 * they all read the real `remote_torrents` (aliased in JS, never in SQL). One
 * index on `remote_masks(value)` serves all three branches, and the table is
 * tiny, so the cost next to a mirror scan is nil.
 */
export const NOT_MASKED: SQL = sql`NOT EXISTS (
  SELECT 1 FROM ${schema.remoteMasks} m
   WHERE (m.scope = 'record'   AND m.value = ${schema.remoteTorrents.recordId})
      OR (m.scope = 'infohash' AND m.value = ${schema.remoteTorrents.infoHash})
      OR (m.scope = 'author'   AND m.value = ${schema.remoteTorrents.authorDid})
)`;

/** Hide a mirrored release. Idempotent on `(scope, value)`. Returns the id. */
export async function maskRemote(
  scope: MaskScope,
  value: string,
  opts: { reason?: string | null; createdBy?: string | null } = {},
): Promise<string> {
  const id = randomUUID();
  const [row] = await db
    .insert(schema.remoteMasks)
    .values({
      id,
      scope,
      value,
      reason: opts.reason ?? null,
      createdBy: opts.createdBy ?? null,
    })
    .onConflictDoNothing({
      target: [schema.remoteMasks.scope, schema.remoteMasks.value],
    })
    .returning({ id: schema.remoteMasks.id });
  if (row) return row.id;
  // Already masked — return the existing id rather than a fresh one nobody has.
  const [existing] = await db
    .select({ id: schema.remoteMasks.id })
    .from(schema.remoteMasks)
    .where(
      and(eq(schema.remoteMasks.scope, scope), eq(schema.remoteMasks.value, value)),
    )
    .limit(1);
  return existing!.id;
}

/** Lift a mask, making the content reappear on the next read. */
export async function unmaskRemote(id: string): Promise<boolean> {
  const gone = await db
    .delete(schema.remoteMasks)
    .where(eq(schema.remoteMasks.id, id))
    .returning({ id: schema.remoteMasks.id });
  return gone.length > 0;
}
