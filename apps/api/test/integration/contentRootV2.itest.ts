import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db, schema } from '@trackarr/db';
import { loadProjections, projectTorrent } from '../../utils/federation/catalogRecord';

// The v2 content address has to survive the trip into a signed record — that is
// what carries it to a partner, where the mirror ingest reads it back. Here we
// prove the projection reads the columns and the record emits the FEP-d8c8 /
// trackarr fields for them, v2 and v1-only alike.

async function makeTorrent(over: Record<string, unknown> = {}): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.torrents).values({
    id,
    infoHash: `${randomUUID().replace(/-/g, '')}00000000`,
    name: 'Release.2160p',
    size: 1000,
    moderationStatus: 'accepted',
    ...over,
  });
  return id;
}

describe('v2 content addressing in the catalog record', () => {
  it('carries infoHashV2 and contentRootV2 from the torrent into the record', async () => {
    const id = await makeTorrent({
      infoHashV2: 'a'.repeat(64),
      contentRootV2: 'b'.repeat(64),
    });
    const [proj] = await loadProjections([id]);
    expect(proj!.infoHashV2).toBe('a'.repeat(64));
    expect(proj!.contentRootV2).toBe('b'.repeat(64));

    const rec = projectTorrent(proj!, 'did:key:zIssuer', 'https://me.example') as unknown as Record<string, unknown>;
    expect(rec['bt:infohash_v1']).toBe(proj!.infoHash);
    expect(rec['bt:infohash_v2']).toBe('a'.repeat(64));
    expect(rec['trackarr:contentRootV2']).toBe('b'.repeat(64));
  });

  it('emits null v2 fields for a v1-only torrent', async () => {
    const id = await makeTorrent();
    const [proj] = await loadProjections([id]);
    expect(proj!.infoHashV2).toBeNull();
    expect(proj!.contentRootV2).toBeNull();

    const rec = projectTorrent(proj!, 'did:key:zIssuer', null) as unknown as Record<string, unknown>;
    expect(rec['bt:infohash_v2']).toBeNull();
    expect(rec['trackarr:contentRootV2']).toBeNull();
  });
});
