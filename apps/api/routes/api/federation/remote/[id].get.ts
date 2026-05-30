/**
 * GET /api/federation/remote/:id  — authenticated.
 *
 * Detail view for a cached federated torrent (`remote_torrents.id`): returns
 * the cached metadata plus its comments pulled live from the origin instance
 * (best-effort, requires the `social` scope). Read-only — to comment, the
 * user follows the link back to the source instance.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireAuthSession } from '~~/utils/adminAuth';
import {
  getFederationConfig,
  getPrivateKeyPem,
  isFederationLive,
} from '~~/utils/federation/config';
import { signedGet } from '~~/utils/federation/signing';

interface RemoteComment {
  content: string;
  authorName: string | null;
  createdAt: string | null;
}

export default defineEventHandler(async (event) => {
  await requireAuthSession(event);
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, message: 'Missing id' });

  const [rt] = await db
    .select()
    .from(schema.remoteTorrents)
    .where(eq(schema.remoteTorrents.id, id))
    .limit(1);
  if (!rt) throw createError({ statusCode: 404, message: 'Federated torrent not found' });

  const [peer] = await db
    .select()
    .from(schema.federationPeers)
    .where(eq(schema.federationPeers.id, rt.peerId))
    .limit(1);
  if (!peer) throw createError({ statusCode: 404, message: 'Partner instance gone' });

  // Pull comments from the origin — best-effort, never fatal.
  let comments: RemoteComment[] = [];
  let commentsError = false;
  const config = await getFederationConfig();
  const canPull =
    isFederationLive(config) &&
    peer.status === 'active' &&
    !!peer.acceptsFromThem?.social;
  if (canPull) {
    const pk = getPrivateKeyPem(config!);
    if (pk && config!.instanceId) {
      try {
        const res = await signedGet({
          baseUrl: peer.baseUrl,
          pathname: `/api/federation/torrent-comments?infoHash=${encodeURIComponent(rt.infoHash)}`,
          instanceId: config!.instanceId,
          privateKeyPem: pk,
        });
        if (res.status === 200 && Array.isArray(res.data?.comments)) {
          comments = (res.data.comments as unknown[]).slice(0, 200).map((c) => {
            const o = c as Record<string, unknown>;
            return {
              content: typeof o.content === 'string' ? o.content.slice(0, 5000) : '',
              authorName: typeof o.authorName === 'string' ? o.authorName : null,
              createdAt: typeof o.createdAt === 'string' ? o.createdAt : null,
            };
          });
        } else {
          commentsError = true;
        }
      } catch {
        commentsError = true;
      }
    }
  }

  return {
    torrent: {
      id: rt.id,
      infoHash: rt.infoHash,
      name: rt.name,
      size: rt.size,
      description: rt.description,
      categorySlug: rt.categorySlug,
      categoryType: rt.categoryType,
      tags: rt.tags,
      seeders: rt.seeders,
      leechers: rt.leechers,
      uploaderName: rt.uploaderName,
      detailUrl: rt.remoteDetailUrl,
      remoteCreatedAt: rt.remoteCreatedAt,
    },
    peer: {
      id: peer.id,
      name: peer.displayName,
      baseUrl: peer.baseUrl,
      socialEnabled: canPull,
    },
    comments,
    commentsError,
  };
});
