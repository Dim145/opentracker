import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { makeUser } from './helpers';
import { sweepNotificationsRetention } from '../../utils/notify';
import { setSetting, SETTINGS_KEYS } from '../../utils/settings';

// Notification retention.
//
// This function had no test, and it had never once succeeded: it built its
// cutoff as a JS `Date` and interpolated it into a raw `sql` template, where
// drizzle has no column context and therefore applies no type mapper. The driver
// received a `Date`, Postgres received its `toString()` — `Fri May 29 2026
// 23:33:27 GMT+0000`, which is not a timestamp literal — and the statement threw
// every time.
//
// The failure was invisible: the caller wraps it in try/catch and logs a
// `console.warn`. So on every deployed instance the table has grown without
// bound, whatever the operator set for the two retention settings.
//
// What is tested below is therefore not just "does it delete" but the boundary
// on BOTH sides of BOTH cutoffs, because the two TTLs are independent and a fix
// that swapped them would still delete something.

const DAY = 86_400_000;

/** A notification at a chosen age, read or unread. */
async function makeNotification(
  userId: string,
  ageDays: number,
  read: boolean,
): Promise<string> {
  const id = randomUUID();
  const createdAt = new Date(Date.now() - ageDays * DAY);
  await db.insert(schema.notifications).values({
    id,
    userId,
    type: 'system',
    payload: { note: `age ${ageDays}d ${read ? 'read' : 'unread'}` },
    createdAt,
    readAt: read ? createdAt : null,
  });
  return id;
}

async function survivingIds(): Promise<Set<string>> {
  const rows = await db.select({ id: schema.notifications.id }).from(schema.notifications);
  return new Set(rows.map((r) => r.id));
}

beforeEach(async () => {
  await setSetting(SETTINGS_KEYS.NOTIFICATIONS_RETENTION_READ_DAYS, '30');
  await setSetting(SETTINGS_KEYS.NOTIFICATIONS_RETENTION_UNREAD_DAYS, '60');
});

describe('the sweep runs at all', () => {
  it('does not throw on an empty table', async () => {
    // The regression this whole file exists for: it used to throw here too,
    // because the statement was malformed before it ever matched a row.
    await expect(sweepNotificationsRetention()).resolves.toEqual({
      deletedRead: 0,
      deletedUnread: 0,
    });
  });
});

describe('what it deletes', () => {
  it('respects both cutoffs independently, on both sides', async () => {
    const uid = await makeUser({});

    // Read rows: TTL 30 days.
    const readOld = await makeNotification(uid, 40, true);
    const readFresh = await makeNotification(uid, 20, true);
    // Unread rows: TTL 60 days. The 40-day unread one is the case that catches a
    // fix which applied one cutoff to both.
    const unreadOld = await makeNotification(uid, 70, false);
    const unreadMiddle = await makeNotification(uid, 40, false);
    const unreadFresh = await makeNotification(uid, 10, false);

    const { deletedRead, deletedUnread } = await sweepNotificationsRetention();
    expect(deletedRead).toBe(1);
    expect(deletedUnread).toBe(1);

    const left = await survivingIds();
    expect(left.has(readOld)).toBe(false);
    expect(left.has(unreadOld)).toBe(false);
    expect(left.has(readFresh)).toBe(true);
    expect(left.has(unreadMiddle)).toBe(true);
    expect(left.has(unreadFresh)).toBe(true);
  });

  it('counts what it actually removed', async () => {
    // The counter is what the plugin logs, so a sweep that deleted rows and
    // reported zero would look exactly like a sweep that found nothing.
    const uid = await makeUser({});
    for (let i = 0; i < 3; i++) await makeNotification(uid, 100, true);
    for (let i = 0; i < 2; i++) await makeNotification(uid, 100, false);

    expect(await sweepNotificationsRetention()).toEqual({
      deletedRead: 3,
      deletedUnread: 2,
    });
    expect((await survivingIds()).size).toBe(0);
  });

  it('is a no-op the second time', async () => {
    const uid = await makeUser({});
    await makeNotification(uid, 100, true);
    await sweepNotificationsRetention();
    expect(await sweepNotificationsRetention()).toEqual({
      deletedRead: 0,
      deletedUnread: 0,
    });
  });

  it('follows the settings rather than a hardcoded default', async () => {
    // An operator who tightens retention should see it take effect, which was
    // the whole promise the broken sweep was silently not keeping.
    const uid = await makeUser({});
    const fiveDaysOld = await makeNotification(uid, 5, true);

    await sweepNotificationsRetention();
    expect((await survivingIds()).has(fiveDaysOld)).toBe(true);

    await setSetting(SETTINGS_KEYS.NOTIFICATIONS_RETENTION_READ_DAYS, '1');
    expect((await sweepNotificationsRetention()).deletedRead).toBe(1);
    expect((await survivingIds()).has(fiveDaysOld)).toBe(false);
  });

  it('leaves another table alone', async () => {
    // `RETURNING id` on the wrong table is the kind of typo a passing count
    // would hide.
    const uid = await makeUser({});
    await makeNotification(uid, 100, true);
    await sweepNotificationsRetention();

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.users)
      .where(eq(schema.users.id, uid));
    expect(count).toBe(1);
  });
});
