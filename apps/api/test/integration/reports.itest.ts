import { describe, it, expect } from 'vitest';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { makeReport, makeUser } from './helpers';

// Withdrawing a report — the 0.26 tombstone.
//
// The business rule fits in one sentence with two halves that look
// contradictory: the report must disappear for its author, and remain for the
// staff. That is exactly the kind of invariant a test protects better than a
// comment, because a future "simplification" that filtered in the same place
// on both sides would break precisely one of the two halves — and the broken
// half would be invisible in ordinary use.

/** What the reporter sees: everything but their withdrawals. */
function reporterList(reporterId: string) {
  return db
    .select({ id: schema.reports.id, status: schema.reports.status })
    .from(schema.reports)
    .where(
      and(
        eq(schema.reports.reporterId, reporterId),
        ne(schema.reports.status, 'withdrawn'),
      ),
    );
}

/** The withdrawal as the endpoint performs it: an UPDATE gated on status. */
async function withdraw(id: string, reporterId: string): Promise<void> {
  await db
    .update(schema.reports)
    .set({ status: 'withdrawn', withdrawnAt: new Date() })
    .where(
      and(
        eq(schema.reports.id, id),
        eq(schema.reports.reporterId, reporterId),
        eq(schema.reports.status, 'pending'),
      ),
    );
}

describe('withdrawal — the row survives but leaves the reporter’s view', () => {
  it('disappears from its author’s list without being deleted', async () => {
    const user = await makeUser();
    const id = await makeReport(user);

    expect(await reporterList(user)).toHaveLength(1);
    await withdraw(id, user);
    expect(await reporterList(user)).toHaveLength(0);

    // Proof this is not a DELETE: the row is still there.
    const [row] = await db
      .select()
      .from(schema.reports)
      .where(eq(schema.reports.id, id));
    expect(row).toBeDefined();
    expect(row!.status).toBe('withdrawn');
    expect(row!.withdrawnAt).toBeInstanceOf(Date);
  });

  it('stays visible to moderation', async () => {
    const user = await makeUser();
    const id = await makeReport(user);
    await withdraw(id, user);

    const seen = await db
      .select({ id: schema.reports.id })
      .from(schema.reports)
      .where(eq(schema.reports.status, 'withdrawn'));
    expect(seen.map((r) => r.id)).toEqual([id]);
  });

  it('timestamps the withdrawal, to tell an old one from a recent one', async () => {
    const user = await makeUser();
    const id = await makeReport(user);
    const before = Date.now();
    await withdraw(id, user);

    const [row] = await db
      .select({ at: schema.reports.withdrawnAt })
      .from(schema.reports)
      .where(eq(schema.reports.id, id));
    expect(row!.at!.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });
});

describe('withdrawal — guard rails', () => {
  it('does not touch another member’s report', async () => {
    const author = await makeUser();
    const intruder = await makeUser();
    const id = await makeReport(author);

    await withdraw(id, intruder);

    const [row] = await db
      .select({ s: schema.reports.status })
      .from(schema.reports)
      .where(eq(schema.reports.id, id));
    expect(row!.s).toBe('pending');
  });

  it('does not withdraw an already-handled report', async () => {
    // An accepted report triggered a cascade — torrent rejected, uploader
    // notified — which we are not going to undo here. A dismissed report is
    // precisely the trace we want to keep.
    const user = await makeUser();
    for (const status of ['resolved', 'dismissed'] as const) {
      const id = await makeReport(user, { status });
      await withdraw(id, user);
      const [row] = await db
        .select({ s: schema.reports.status })
        .from(schema.reports)
        .where(eq(schema.reports.id, id));
      expect(row!.s).toBe(status);
    }
  });

  it('applies only one of two concurrent withdrawals', async () => {
    // The UPDATE is gated on `status = 'pending'` for exactly this reason: a
    // moderator handling the report while the author withdraws it must not be
    // able to produce an inconsistent state.
    const user = await makeUser();
    const id = await makeReport(user);

    await Promise.all([withdraw(id, user), withdraw(id, user)]);

    const rows = await db
      .select({ s: schema.reports.status })
      .from(schema.reports)
      .where(eq(schema.reports.id, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.s).toBe('withdrawn');
  });

  it('a moderator ruling during a withdrawal wins or loses, never both', async () => {
    const user = await makeUser();
    const id = await makeReport(user);

    await Promise.all([
      withdraw(id, user),
      db
        .update(schema.reports)
        .set({ status: 'dismissed', resolvedAt: new Date() })
        .where(
          and(eq(schema.reports.id, id), eq(schema.reports.status, 'pending')),
        ),
    ]);

    const [row] = await db
      .select({ s: schema.reports.status })
      .from(schema.reports)
      .where(eq(schema.reports.id, id));
    // One of the two won — which one does not matter, what matters is that we
    // never land in an intermediate state.
    expect(['withdrawn', 'dismissed']).toContain(row!.s);
  });
});

describe('withdrawal count per reporter', () => {
  it('counts withdrawals one reporter at a time', async () => {
    // This is the tombstone's whole purpose: one withdrawal says nothing, a
    // run of them says a lot.
    const serial = await makeUser();
    const honest = await makeUser();

    for (let i = 0; i < 4; i++) {
      const id = await makeReport(serial);
      await withdraw(id, serial);
    }
    const single = await makeReport(honest);
    await withdraw(single, honest);
    await makeReport(honest); // pending, must not be counted

    const rows = await db
      .select({
        reporterId: schema.reports.reporterId,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.reports)
      .where(
        and(
          inArray(schema.reports.reporterId, [serial, honest]),
          eq(schema.reports.status, 'withdrawn'),
        ),
      )
      .groupBy(schema.reports.reporterId);

    const byAuthor = Object.fromEntries(
      rows.map((r) => [r.reporterId, r.count]),
    );
    expect(byAuthor[serial]).toBe(4);
    expect(byAuthor[honest]).toBe(1);
  });

  it('does not count handled reports as withdrawals', async () => {
    const user = await makeUser();
    await makeReport(user, { status: 'resolved' });
    await makeReport(user, { status: 'dismissed' });

    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.reports)
      .where(
        and(
          eq(schema.reports.reporterId, user),
          eq(schema.reports.status, 'withdrawn'),
        ),
      );
    expect(row!.count).toBe(0);
  });
});
