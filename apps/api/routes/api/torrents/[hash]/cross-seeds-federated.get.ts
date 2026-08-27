/**
 * GET /api/torrents/:hash/cross-seeds-federated
 *
 * Mirrored releases on partner instances that are the SAME content as this local
 * torrent (M2). For a member who also has an account on that partner, each is a
 * release they can cross-seed from the bytes already on their disk — fetched with
 * their own partner passkey, never through us. See utils/federation/crossSeed.
 *
 * Same moderation visibility as `/api/torrents/:hash`; returns an empty list
 * (never 404 on the matching itself) when nothing federated matches.
 */
import { db } from '@trackarr/db';
import { getFederationConfig, isFederationLive } from '~~/utils/federation/config';
import { validateParam, infoHashSchema } from '~~/utils/schemas';
import {
  federatedContentAvailability,
  federatedCrossSeedMatches,
} from '~~/utils/federation/crossSeed';

export default defineEventHandler(async (event) => {
  const { user: session } = await requireUserSession(event);
  const infoHash = validateParam(event, 'hash', infoHashSchema);

  // Nothing to match against when the instance does not federate — skip the
  // mirror scans entirely rather than paying for them on every page view.
  if (!isFederationLive(await getFederationConfig())) {
    return { items: [], total: 0, availability: { releases: 0, seeders: 0, leechers: 0 } };
  }

  const source = await db.query.torrents.findFirst({
    where: (t, { eq }) => eq(t.infoHash, infoHash),
    columns: {
      uploaderId: true,
      moderationStatus: true,
      contentSignature: true,
      contentRootV2: true,
    },
  });
  if (!source) {
    throw createError({ statusCode: 404, message: 'Torrent not found' });
  }

  // Same gate as the parent endpoint: a non-accepted torrent is visible only to
  // its owner or staff.
  if (source.moderationStatus !== 'accepted') {
    const isOwner = source.uploaderId === session.id;
    const isStaff = !!(session.isAdmin || session.isModerator);
    if (!isOwner && !isStaff) {
      throw createError({ statusCode: 404, message: 'Torrent not found' });
    }
  }

  const key = {
    contentRootV2: source.contentRootV2,
    contentSignature: source.contentSignature,
  };
  const [items, availability] = await Promise.all([
    federatedCrossSeedMatches(key),
    federatedContentAvailability(key),
  ]);

  // A health signal, not a swarm bridge: partner swarms only interconnect with
  // ours when the infohash actually matches, so this tells the member the content
  // is alive across the mesh — worth cross-seeding — nothing more.
  return { items, total: items.length, availability };
});
