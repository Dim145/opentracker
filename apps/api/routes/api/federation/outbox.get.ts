/**
 * GET /api/federation/outbox[?page=N] — public.
 *
 * What this instance publishes, as an ActivityStreams collection. Without a
 * page it is the header — a count and a link to the first page — which is the
 * shape AS2 consumers expect and which lets one decide whether to walk it at
 * all.
 *
 * The records go out exactly as signed. A consumer that knows nothing about
 * Trackarr still gets the FEP-d8c8 core of each one — the infohash, the
 * magnet, the name, where it lives — which is the part that lets somebody
 * recognise, deduplicate and fetch a release. Our own terms travel alongside
 * and are theirs to ignore.
 *
 * Only what we authored. A record we relay belongs in its author's outbox, and
 * listing it here would be attributing somebody else's work to this instance.
 */
import { z } from 'zod';
import {
  AS2_CONTENT_TYPE,
  collectionHeader,
  collectionPage,
  outboxPage,
  outboxSize,
} from '~~/utils/federation/activityStreams';
import { requireDiscoverable } from '~~/utils/federation/discoverable';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).optional(),
});

export default defineEventHandler(async (event) => {
  const config = await requireDiscoverable(event);
  const { page } = await getValidatedQuery(event, querySchema.parse);

  const base = (config.publicUrl ?? '').replace(/\/$/, '');
  const id = `${base}/api/federation/outbox`;
  const total = await outboxSize();
  setHeader(event, 'content-type', AS2_CONTENT_TYPE);

  if (!page) return collectionHeader(id, total);
  return collectionPage(id, page, total, await outboxPage(page));
});
