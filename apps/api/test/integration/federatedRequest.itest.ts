import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db, schema } from '@trackarr/db';
import { makeUser, makeCategory } from './helpers';
import {
  fillersForPeer,
  openFederatedRequestId,
  resolveLocalCategoryForRemote,
} from '../../utils/federation/federatedRequest';

async function makePeer(): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.federationPeers).values({
    id,
    baseUrl: `https://p-${id.slice(0, 8)}.example`,
    status: 'active',
    sharesWithThem: { catalog: true, social: true, accounts: true, swarm: false },
    acceptsFromThem: { catalog: true, social: true, accounts: true, swarm: false },
  });
  return id;
}

async function makeMovieCategory(): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.categories).values({
    id,
    name: 'Films',
    slug: `movie_${id.slice(0, 8)}`,
    type: 'movie',
  });
  return id;
}

describe('federated request bridge (M1)', () => {
  describe('resolveLocalCategoryForRemote', () => {
    it('honours an explicit override', async () => {
      const cat = await makeCategory();
      expect(await resolveLocalCategoryForRemote(null, null, cat)).toBe(cat);
    });

    it('follows the taxonomy mapping when present', async () => {
      const cat = await makeCategory();
      await db
        .insert(schema.remoteCategoryMap)
        .values({ id: randomUUID(), remoteSlug: 'films', localCategoryId: cat });
      expect(await resolveLocalCategoryForRemote('films', null, undefined)).toBe(cat);
    });

    it('falls back to a same-type local category', async () => {
      const movie = await makeMovieCategory();
      expect(await resolveLocalCategoryForRemote('unmapped', 'movie', undefined)).toBe(
        movie,
      );
    });

    it('returns null when nothing fits', async () => {
      expect(await resolveLocalCategoryForRemote('unmapped', 'tv', undefined)).toBeNull();
    });
  });

  describe('openFederatedRequestId', () => {
    it('finds an open request for the same content and ignores closed ones', async () => {
      const user = await makeUser();
      const cat = await makeCategory();
      const hash = 'ab'.repeat(20);

      expect(await openFederatedRequestId(hash)).toBeNull();

      const reqId = randomUUID();
      await db.insert(schema.uploadRequests).values({
        id: reqId,
        requesterId: user,
        categoryId: cat,
        title: 'Wanted',
        description: 'from a partner',
        status: 'requested',
        federatedInfoHash: hash,
      });
      expect(await openFederatedRequestId(hash)).toBe(reqId);
    });

    it('treats validated requests as not-open', async () => {
      const user = await makeUser();
      const cat = await makeCategory();
      const hash = 'cd'.repeat(20);
      await db.insert(schema.uploadRequests).values({
        id: randomUUID(),
        requesterId: user,
        categoryId: cat,
        title: 'Done',
        description: 'from a partner',
        status: 'validated',
        federatedInfoHash: hash,
      });
      expect(await openFederatedRequestId(hash)).toBeNull();
    });
  });

  describe('fillersForPeer', () => {
    it('returns verified identity holders, excluding the requester and dedup', async () => {
      const peer = await makePeer();
      const requester = await makeUser();
      const holderA = await makeUser();
      const holderB = await makeUser();
      const pending = await makeUser();

      const rows = [
        { uid: holderA, status: 'verified' },
        { uid: holderA, status: 'verified' }, // second identity, same peer
        { uid: holderB, status: 'verified' },
        { uid: requester, status: 'verified' }, // excluded: it's the requester
        { uid: pending, status: 'pending' }, // excluded: not verified
      ];
      let n = 0;
      for (const r of rows) {
        await db.insert(schema.federatedIdentities).values({
          id: randomUUID(),
          localUserId: r.uid,
          peerId: peer,
          remoteUsername: `u${n++}`,
          status: r.status,
          method: 'key',
        });
      }

      const targets = await fillersForPeer(peer, requester);
      expect(targets.sort()).toEqual([holderA, holderB].sort());
    });
  });

});
