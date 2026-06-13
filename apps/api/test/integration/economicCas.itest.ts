import { describe, it, expect } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { makeUser, makeCategory, makeInvitation, makeRequest } from './helpers';

// These exercise the compare-and-swap UPDATE patterns the security fixes
// rely on, against a REAL Postgres under genuine concurrency (separate
// pool connections racing the same row). They lock in the property that
// matters — "exactly one writer wins" — independent of timing, because
// the losing writer re-evaluates its WHERE predicate against the winner's
// committed row (EvalPlanQual under READ COMMITTED) and matches zero rows.

describe('invite consume CAS — one invite mints one account (findings M1/H3)', () => {
  it('exactly one of N concurrent claims wins; used_by ends non-null', async () => {
    const inviter = await makeUser();
    const inviteId = await makeInvitation(inviter);
    const claimants = await Promise.all(
      Array.from({ length: 5 }, () => makeUser()),
    );

    // The register/delete burn: UPDATE ... WHERE id AND used_by IS NULL RETURNING.
    const claims = await Promise.all(
      claimants.map((uid) =>
        db
          .update(schema.invitations)
          .set({ usedBy: uid, usedAt: new Date() })
          .where(
            and(
              eq(schema.invitations.id, inviteId),
              isNull(schema.invitations.usedBy),
            ),
          )
          .returning({ id: schema.invitations.id }),
      ),
    );

    const winners = claims.filter((rows) => rows.length === 1);
    expect(winners).toHaveLength(1); // never 0, never >1

    const [row] = await db
      .select({ usedBy: schema.invitations.usedBy })
      .from(schema.invitations)
      .where(eq(schema.invitations.id, inviteId));
    expect(row!.usedBy).not.toBeNull();
  });
});

describe('reward bump CAS — advertised reward never exceeds escrow (finding M8)', () => {
  it('only one of two concurrent bumps off the same base lands', async () => {
    const u = await makeUser();
    const cat = await makeCategory();
    const req = await makeRequest(u, cat, { rewardPoints: 100, status: 'requested' });

    // Both bumps computed their delta against base=100; the CAS predicate
    // pins the write to reward_points=100 so only the first commits.
    const bumps = await Promise.all(
      [150, 200].map((target) =>
        db
          .update(schema.uploadRequests)
          .set({ rewardPoints: target })
          .where(
            and(
              eq(schema.uploadRequests.id, req),
              eq(schema.uploadRequests.status, 'requested'),
              eq(schema.uploadRequests.rewardPoints, 100),
            ),
          )
          .returning({ id: schema.uploadRequests.id }),
      ),
    );

    expect(bumps.filter((rows) => rows.length === 1)).toHaveLength(1);

    const [row] = await db
      .select({ r: schema.uploadRequests.rewardPoints })
      .from(schema.uploadRequests)
      .where(eq(schema.uploadRequests.id, req));
    // The winner's exact value — never a silent merge to some other number.
    expect([150, 200]).toContain(row!.r);
  });
});

describe('reject vs validate CAS — no double resolution (finding M6)', () => {
  it('only one of a concurrent validate/reject on a filled request wins', async () => {
    const requester = await makeUser();
    const cat = await makeCategory();
    const req = await makeRequest(requester, cat, { status: 'filled', rewardPoints: 50 });

    const [validate, reject] = await Promise.all([
      db
        .update(schema.uploadRequests)
        .set({ status: 'validated', validatedAt: new Date() })
        .where(
          and(
            eq(schema.uploadRequests.id, req),
            eq(schema.uploadRequests.status, 'filled'),
          ),
        )
        .returning({ id: schema.uploadRequests.id }),
      db
        .update(schema.uploadRequests)
        .set({ status: 'requested', filledById: null })
        .where(
          and(
            eq(schema.uploadRequests.id, req),
            eq(schema.uploadRequests.status, 'filled'),
          ),
        )
        .returning({ id: schema.uploadRequests.id }),
    ]);

    expect([validate, reject].filter((rows) => rows.length === 1)).toHaveLength(1);

    const [row] = await db
      .select({ s: schema.uploadRequests.status })
      .from(schema.uploadRequests)
      .where(eq(schema.uploadRequests.id, req));
    // Whoever won, the request left the 'filled' state exactly once.
    expect(['validated', 'requested']).toContain(row!.s);
    expect(row!.s).not.toBe('filled');
  });
});
