import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { checkAndMarkHnrs } from '../../utils/hnr';
import { setSetting } from '../../utils/settings';
import { makeUser } from './helpers';

// The sweep now runs on its own (`plugins/hnr-sweep`), so what it flags is what
// members get notified about without a moderator in the loop. A row is born at
// the Download click; only one where bytes actually moved can be a hit-and-run.

const DAY = 24 * 3600 * 1000;

async function makeTorrent(): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.torrents).values({
    id,
    infoHash: `${randomUUID().replace(/-/g, '')}00000000`,
    name: 'Release',
    size: 1000,
    moderationStatus: 'accepted',
  });
  return id;
}

async function track(over: Partial<typeof schema.hnrTracking.$inferInsert>): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.hnrTracking).values({
    id,
    userId: await makeUser(),
    torrentId: await makeTorrent(),
    downloadedAt: new Date(Date.now() - 5 * DAY),
    ...over,
  });
  return id;
}

async function isHnr(id: string): Promise<boolean> {
  const [row] = await db
    .select({ isHnr: schema.hnrTracking.isHnr })
    .from(schema.hnrTracking)
    .where(eq(schema.hnrTracking.id, id));
  return row!.isHnr;
}

describe('checkAndMarkHnrs', () => {
  beforeEach(async () => {
    await setSetting('hnr_enabled', 'true');
    await setSetting('hnr_grace_period', String(3 * 24 * 3600));
  });

  it('flags a download past its grace period, and only that', async () => {
    const leeched = await track({ downloaded: 700 });
    const clickedOnly = await track({ downloaded: 0 });
    const inGrace = await track({ downloaded: 700, downloadedAt: new Date(Date.now() - DAY) });
    const seeded = await track({ downloaded: 700, completedAt: new Date() });
    const exempt = await track({ downloaded: 700, isExempt: true });

    expect(await checkAndMarkHnrs()).toBe(1);
    expect(await isHnr(leeched)).toBe(true);
    expect(await isHnr(clickedOnly)).toBe(false);
    expect(await isHnr(inGrace)).toBe(false);
    expect(await isHnr(seeded)).toBe(false);
    expect(await isHnr(exempt)).toBe(false);

    // Idempotent: a second pass flags nothing new.
    expect(await checkAndMarkHnrs()).toBe(0);
  });

  it('does nothing while hit-and-run is disabled', async () => {
    await setSetting('hnr_enabled', 'false');
    const leeched = await track({ downloaded: 700 });
    expect(await checkAndMarkHnrs()).toBe(0);
    expect(await isHnr(leeched)).toBe(false);
  });
});
