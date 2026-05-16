/**
 * Auto-validate cron for the upload-request bounty board.
 *
 * When a request sits in `filled` state past the operator-set
 * timeout, this sweep validates it on behalf of the requester:
 * the filler is paid, the row flips to `validated`, and both
 * parties get a `request_auto_validated` notification so they
 * know the cron — not the requester — closed the loop.
 *
 * Cross-replica safety: a Redis SETNX lock makes sure only one
 * API instance sweeps per tick. Other replicas no-op gracefully.
 * The query filters on `status = 'filled' AND filled_at < cutoff`,
 * so the cron is fully idempotent — a row already validated by
 * the manual path won't be touched.
 */
import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { redis } from '~~/utils/server';
import { notify } from '~~/utils/notify';
import { payReward } from '~~/utils/requestPoints';
import { getRequestAutoValidateHours } from '~~/utils/settings';

const LOCK_KEY = 'request_auto_validate:lock';
const LOCK_TTL_S = 4 * 60;

export default defineNitroPlugin(async () => {
  // 10 min default — frequent enough that the auto-validation
  // feels responsive (a 7-day timeout is rarely exact to the
  // hour, +/- 10 min is fine), rare enough that the lock
  // contention stays trivial.
  const INTERVAL_MS = parseInt(
    process.env.REQUEST_AUTO_VALIDATE_INTERVAL || '600000',
    10,
  );

  console.log(
    `[Request Auto-Validate] Initialized — interval=${INTERVAL_MS}ms (${(
      INTERVAL_MS / 60_000
    ).toFixed(2)} min)`,
  );

  const sweep = async () => {
    const owner = `${process.pid}:${Date.now()}`;
    let holdsLock = false;
    try {
      const acquired = await redis.set(
        LOCK_KEY,
        owner,
        'EX',
        LOCK_TTL_S,
        'NX',
      );
      if (acquired !== 'OK') return;
      holdsLock = true;

      const hours = await getRequestAutoValidateHours();
      const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

      // Pull every elligible row. The partial index
      // `upload_requests_filled_at_idx` already restricts to
      // `status = 'filled' AND filled_at IS NOT NULL`, so this is
      // a tight scan even with thousands of historical rows.
      const expired = await db
        .select({
          id: schema.uploadRequests.id,
          title: schema.uploadRequests.title,
          requesterId: schema.uploadRequests.requesterId,
          filledById: schema.uploadRequests.filledById,
          rewardPoints: schema.uploadRequests.rewardPoints,
        })
        .from(schema.uploadRequests)
        .where(
          and(
            eq(schema.uploadRequests.status, 'filled'),
            isNotNull(schema.uploadRequests.filledAt),
            isNotNull(schema.uploadRequests.filledById),
            lt(schema.uploadRequests.filledAt, cutoff),
          ),
        );

      if (expired.length === 0) return;

      for (const row of expired) {
        if (!row.filledById) continue;
        const fillerId = row.filledById;
        const reward = row.rewardPoints;
        try {
          // Atomicity: do the conditional UPDATE FIRST and only
          // pay if it actually flipped a row. The earlier version
          // paid before the UPDATE, so a manual validate that
          // slipped in between SELECT and the cron's pay-step
          // would result in a double payout — the manual UPDATE
          // already credited the filler, the cron's UPDATE
          // no-ops because the status is already 'validated',
          // but `payReward` had already run.
          const paid = await db.transaction(async (tx) => {
            const [updated] = await tx
              .update(schema.uploadRequests)
              .set({
                status: 'validated',
                validatedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(schema.uploadRequests.id, row.id),
                  eq(schema.uploadRequests.status, 'filled'),
                ),
              )
              .returning({ id: schema.uploadRequests.id });
            if (!updated) {
              return false; // already validated by the manual path
            }
            if (reward > 0) {
              await payReward(tx, fillerId, reward);
            }
            await tx
              .update(schema.uploadRequestFillAttempts)
              .set({ status: 'validated' })
              .where(
                and(
                  eq(schema.uploadRequestFillAttempts.requestId, row.id),
                  eq(schema.uploadRequestFillAttempts.userId, fillerId),
                  eq(
                    schema.uploadRequestFillAttempts.status,
                    'proposed',
                  ),
                ),
              );
            return true;
          });
          if (!paid) {
            // Manual path got there first — skip the notification.
            continue;
          }

          const payload = {
            requestId: row.id,
            requestTitle: row.title,
            rewardPoints: reward,
            auto: true,
          };
          void notify(
            fillerId,
            'request_auto_validated',
            payload,
            `/requests/${row.id}`,
          );
          if (row.requesterId !== fillerId) {
            void notify(
              row.requesterId,
              'request_auto_validated',
              payload,
              `/requests/${row.id}`,
            );
          }
        } catch (err) {
          console.warn(
            '[Request Auto-Validate] row',
            row.id,
            'failed:',
            (err as Error).message,
          );
        }
      }

      console.log(
        `[Request Auto-Validate] Validated ${expired.length} request(s).`,
      );
    } catch (err) {
      console.error('[Request Auto-Validate] sweep failed:', err);
    } finally {
      if (holdsLock) {
        try {
          await redis.eval(
            `if redis.call("GET", KEYS[1]) == ARGV[1] then
               return redis.call("DEL", KEYS[1])
             else
               return 0
             end`,
            1,
            LOCK_KEY,
            owner,
          );
        } catch (err) {
          console.warn(
            '[Request Auto-Validate] lock release failed:',
            (err as Error).message,
          );
        }
      }
    }
  };

  const handle = setInterval(sweep, INTERVAL_MS);
  handle.unref?.();
  setTimeout(sweep, 10_000).unref?.();
});
